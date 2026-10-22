import { ResolvedFilter } from "../../schemas/agent";
import { Plan } from "../../schemas/planner";
import { Dimension, Entity, SemanticModel } from "../../schemas/semantic";
import { getLogger } from "../../core/logging";
import { RetrievalHit, SemanticRetriever } from "../rag/retriever";

const logger = getLogger("services.semantic.resolver");

export const RAG_SCORE_THRESHOLD = 0.32;
// How a KPI's match score must compare with the plain metric's before the KPI
// (and its default filters/required grouping) is preferred - see
// `resolvePrimaryMeasure`. Negative: the KPI is kept unless a metric beats it
// by more than this. A KPI's and a metric's scores come from differently
// worded index text, so a metric often edges out the KPI that wraps it by a
// few hundredths on the very same words - and a bare metric silently drops the
// KPI's default filters (e.g. "Closed" for Closed Case Volume). Whenever a
// metric still wins, `kpiWrappingMetric` switches to the KPI that wraps it.
export const KPI_PREFERENCE_MARGIN = -0.05;

// A KPI that only ties a metric (the relaxed, negative margin above) must
// still be a reasonably good match in its own right; a weak, near-tied KPI
// ("cases" -> Open Case Volume 0.500 vs Created Case Volume 0.499) is no
// reason to apply its filters. A KPI that clearly beats the best metric by
// this much is used whatever its absolute score.
export const KPI_STRONG_MARGIN = 0.05;
export const KPI_MIN_SCORE = 0.52;

// Same idea, one level down: how much higher a Metric's match score must be
// than the best bare Measure's before the Metric (and its filters/format) is
// preferred over just resolving directly to the measure.
export const METRIC_PREFERENCE_MARGIN = 0.05;

// How much higher a dimension/filter phrase's RAG match score must clear
// `scoreThreshold` before it's accepted when the matched dimension belongs to
// a DIFFERENT entity than the ones already established as relevant to this
// question.
export const CROSS_ENTITY_SCORE_MARGIN = 0.2;

// A dimension phrase's RAG match scoring below this is only accepted when the
// phrase also shares a word with the dimension's own name/column/description/
// synonyms - see `isLexicallyRelated`.
export const STRONG_DIMENSION_SCORE = 0.45;

function wordStems(text: string): Set<string> {
  const stem = (w: string): string => {
    if (w.length > 3 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
    if (w.length > 4 && /(?:ch|sh|x|s|z)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  };
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem).filter((w) => w.length >= 3));
}

/** True when `phrase` shares at least one word (singular/plural-insensitive)
 * with the dimension's name, column name, synonyms or description. */
export function isLexicallyRelated(phrase: string, dim: Dimension): boolean {
  const phraseWords = wordStems(phrase);
  if (phraseWords.size === 0) return true;
  const dimWords = wordStems([dim.name, dim.column_name, dim.description, ...dim.synonyms].join(" "));
  for (const w of phraseWords) if (dimWords.has(w)) return true;
  return false;
}

// Ops the SQL generator (services/sql/generator.ts) actually understands -
// anything else silently compiles to "=" there, so filter parsing below only
// ever emits these.
const KNOWN_OPS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "contains",
  "exists",
  "not_exists",
  "last_n_months",
  "last_n_days",
  "last_n_years",
  "between",
]);

// Short spellings of time units ("last qtr", "qtr over qtr", "last 2 yrs")
// and to-date periods ("YTD" is "this year": Jan 1 up to now) - expanded to
// the full wording before any period/bucketing pattern is matched.
const UNIT_ABBREVIATIONS: [RegExp, string][] = [
  [/\bwtd\b/gi, "this week"],
  [/\bmtd\b/gi, "this month"],
  [/\bqtd\b/gi, "this quarter"],
  [/\bytd\b/gi, "this year"],
  [/\bqtrs\b/gi, "quarters"],
  [/\bqtr\b/gi, "quarter"],
  [/\bwks\b/gi, "weeks"],
  [/\bwk\b/gi, "week"],
  [/\bmths\b/gi, "months"],
  [/\bmth\b/gi, "month"],
  [/\byrs\b/gi, "years"],
  [/\byr\b/gi, "year"],
];

export function expandUnitAbbreviations(text: string): string {
  let out = text;
  for (const [pattern, full] of UNIT_ABBREVIATIONS) out = out.replace(pattern, full);
  return out;
}

const LAST_N_RE = /^last\s+(\d+)\s*(day|month|quarter|year)s?$/i;
const LAST_UNIT_RE = /^last\s+(day|week|month|quarter|year)$/i;
const THIS_UNIT_RE = /^this\s+(day|week|month|quarter|year)$/i;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAME_PATTERN = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join("|");

// Absolute month+year phrases such as "Nov 2025", "November 2025", "2025 Nov",
// "11/2025", "2025-11" - as opposed to the *relative* phrases above (which
// have no explicit year). These resolve to the full calendar month.
const MONTH_YEAR_NAME_RE = new RegExp(
  `^(?:(?<month>${MONTH_NAME_PATTERN})[\\s,-]+(?<year>\\d{4})` +
    `|(?<year2>\\d{4})[\\s,-]+(?<month2>${MONTH_NAME_PATTERN}))$`,
  "i"
);
const MONTH_YEAR_NUMERIC_RE = /^(?<a>\d{1,4})[/-](?<b>\d{1,4})$/;
const YEAR_ONLY_RE = /^\d{4}$/;
const WORD_RE = /\w+/g;

// Absolute quarter+year phrases such as "Q1 2025", "Quarter 1 2025", "2025 Q1",
// "2025-Q1".
const QUARTER_YEAR_RE = new RegExp(
  "^(?:q(?:uarter)?\\s*(?<q>[1-4])[\\s,-]+(?<year>\\d{4})" + "|(?<year2>\\d{4})[\\s,-]+q(?:uarter)?\\s*(?<q2>[1-4]))$",
  "i"
);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthBounds(year: number, month: number): [string, string] {
  const lastDay = daysInMonth(year, month);
  return [`${year}-${pad2(month)}-01`, `${year}-${pad2(month)}-${pad2(lastDay)}`];
}

function quarterBounds(year: number, quarter: number): [string, string] {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = daysInMonth(year, endMonth);
  return [`${year}-${pad2(startMonth)}-01`, `${year}-${pad2(endMonth)}-${pad2(lastDay)}`];
}

function yearBounds(year: number): [string, string] {
  return [`${year}-01-01`, `${year}-12-31`];
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Inclusive [start, end] of the calendar day/week(Mon-Sun)/month/quarter/year
 * that ended just before the one containing `now`. */
export function previousUnitBounds(unit: string, now: Date): [string, string] {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  switch (unit.toLowerCase()) {
    case "day": {
      const day = fmtDate(addDays(now, -1));
      return [day, day];
    }
    case "week": {
      const dow = (now.getDay() + 6) % 7; // Monday = 0
      const thisMonday = addDays(now, -dow);
      return [fmtDate(addDays(thisMonday, -7)), fmtDate(addDays(thisMonday, -1))];
    }
    case "month":
      return month === 1 ? monthBounds(year - 1, 12) : monthBounds(year, month - 1);
    case "quarter": {
      const quarter = Math.floor((month - 1) / 3) + 1;
      return quarter === 1 ? quarterBounds(year - 1, 4) : quarterBounds(year, quarter - 1);
    }
    default:
      return yearBounds(year - 1);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** "$gte" / "GTE" -> "gte"; anything the generator doesn't know -> null. */
function normalizeOp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const op = raw.trim().replace(/^\$/, "").toLowerCase();
  return KNOWN_OPS.has(op) ? op : null;
}

// Keys a model may wrap a filter operand in, and key pairs it may use for an
// explicit range - the model is asked for plain values (planner.txt) but
// doesn't always comply, so these shapes are unwrapped rather than trusted.
const OPERAND_KEYS = ["value", "values", "val", "date", "period", "range"];
const RANGE_KEY_PAIRS: [string, string][] = [
  ["start", "end"],
  ["from", "to"],
  ["gte", "lte"],
  ["min", "max"],
  ["start_date", "end_date"],
];
const MAX_UNWRAP_DEPTH = 3;

/**
 * Reduces a model-invented object filter value ({"$op": "eq", "value": ...},
 * {"$date": ...}, {"start": ..., "end": ...}, ...) to an optional op plus a
 * non-object operand. Keys are matched case-insensitively with any leading
 * "$" stripped. Returns null when no usable operand can be found.
 */
function unwrapFilterObject(obj: Record<string, unknown>, depth = 0): [string | null, unknown] | null {
  if (depth > MAX_UNWRAP_DEPTH) return null;
  const entries = new Map(Object.entries(obj).map(([k, v]) => [k.trim().replace(/^\$/, "").toLowerCase(), v]));
  let op = normalizeOp(entries.get("op") ?? entries.get("operator"));
  entries.delete("op");
  entries.delete("operator");

  let operand: unknown = undefined;
  for (const key of OPERAND_KEYS) {
    if (entries.has(key)) {
      operand = entries.get(key);
      break;
    }
  }
  if (operand === undefined) {
    const pair = RANGE_KEY_PAIRS.find(([a, b]) => entries.has(a) && entries.has(b));
    if (pair) return ["between", [entries.get(pair[0]), entries.get(pair[1])]];
  }
  if (operand === undefined && entries.size === 1) {
    // A single operator-named key, e.g. {"$gte": "2025-11"} or {"$date": ...}.
    const [key, value] = [...entries][0];
    op = op ?? normalizeOp(key);
    operand = value;
  }
  if (operand === undefined || operand === null) return null;

  if (isPlainObject(operand)) {
    const inner = unwrapFilterObject(operand, depth + 1);
    if (!inner) return null;
    return [op ?? inner[0], inner[1]];
  }
  return [op, operand];
}

/**
 * Turns a planner filter value into an (op, value) pair the SQL generator
 * understands. Supports an explicit {op, value} escape hatch, list values
 * (between/in), and common relative-date phrases (today/yesterday/this
 * month/last 6 months/last quarter/...) plus absolute month/quarter/year
 * phrases (resolved to the full calendar month/quarter/year, inclusive);
 * anything else is treated as a plain equality filter. See the Python
 * resolver.py's `_parse_filter_value` docstring for the "quarter" op
 * rationale.
 */
export function parseFilterValue(rawValue: unknown): [string, unknown] | null {
  if (isPlainObject(rawValue)) {
    const unwrapped = unwrapFilterObject(rawValue);
    if (!unwrapped) return null;
    const [op, operand] = unwrapped;
    const parsed = parseFilterValue(operand);
    if (!parsed || op === null || op === "eq") return parsed;
    const [parsedOp, parsedValue] = parsed;
    if (parsedOp === "between" && Array.isArray(parsedValue) && ["gt", "gte", "lt", "lte"].includes(op)) {
      const edge = op === "gte" || op === "lt" ? parsedValue[0] : parsedValue[1];
      return [op, edge];
    }
    return [op, parsedOp === "eq" ? parsedValue : operand];
  }

  if (Array.isArray(rawValue)) {
    if (rawValue.some((item) => item === null || typeof item === "object")) return null;
    if (rawValue.length === 2) return ["between", rawValue];
    return ["in", rawValue];
  }

  if (typeof rawValue !== "string") {
    return ["eq", rawValue];
  }

  const text = expandUnitAbbreviations(rawValue.trim().toLowerCase());
  const now = new Date();

  if (text === "today") {
    return ["gte", fmtDate(now)];
  }
  if (text === "yesterday") {
    const yesterday = addDays(now, -1);
    return ["between", [fmtDate(yesterday), fmtDate(now)]];
  }

  let match = LAST_N_RE.exec(text);
  if (match) {
    const count = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === "quarter") return ["last_n_months", count * 3];
    return [`last_n_${unit}s`, count];
  }

  // "last quarter" etc. means the previous COMPLETED calendar unit (e.g. on
  // 13 Oct 2026, "last quarter" is Jul 1 - Sep 30 2026), not a rolling window
  // ending now - a rolling "last 3 months" is still what "last 3 months" gives.
  match = LAST_UNIT_RE.exec(text);
  if (match) {
    return ["between", previousUnitBounds(match[1], now)];
  }

  match = THIS_UNIT_RE.exec(text);
  if (match) {
    const unit = match[1];
    let start: Date;
    if (unit === "day") {
      start = now;
    } else if (unit === "week") {
      const dow = (now.getDay() + 6) % 7; // Python's Monday=0 weekday()
      start = addDays(now, -dow);
    } else if (unit === "month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (unit === "quarter") {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), quarterStartMonth, 1);
    } else {
      start = new Date(now.getFullYear(), 0, 1);
    }
    return ["gte", fmtDate(start)];
  }

  match = QUARTER_YEAR_RE.exec(text);
  if (match?.groups) {
    const quarter = parseInt(match.groups.q || match.groups.q2, 10);
    const year = parseInt(match.groups.year || match.groups.year2, 10);
    return ["between", quarterBounds(year, quarter)];
  }

  match = MONTH_YEAR_NAME_RE.exec(text);
  if (match?.groups) {
    const monthName = match.groups.month || match.groups.month2;
    const year = parseInt(match.groups.year || match.groups.year2, 10);
    const month = MONTH_NAMES[monthName.toLowerCase()];
    return ["between", monthBounds(year, month)];
  }

  match = MONTH_YEAR_NUMERIC_RE.exec(text);
  if (match?.groups) {
    const a = match.groups.a;
    const b = match.groups.b;
    if (a.length === 4 && Number(b) >= 1 && Number(b) <= 12) {
      return ["between", monthBounds(Number(a), Number(b))];
    }
    if (b.length === 4 && Number(a) >= 1 && Number(a) <= 12) {
      return ["between", monthBounds(Number(b), Number(a))];
    }
  }

  if (YEAR_ONLY_RE.test(text)) {
    return ["between", yearBounds(Number(text))];
  }

  return ["eq", rawValue];
}

export interface ResolvedSortRank {
  field: string;
  direction: "asc" | "desc";
  limit: number | null;
}

/** How one part of the plan was matched to the semantic model - kept so the
 * match can be shown and checked, not used for SQL. */
export interface ResolutionMatch {
  part: "subject" | "dimension" | "filter" | "time" | "kpi_grouping" | "entity";
  /** The plan's own wording. */
  phrase: string;
  /** The semantic-model item it matched, or null when nothing did. */
  matched: { type: string; name: string } | null;
  /** Similarity score, or null when matched by name/synonym/description. */
  score: number | null;
  /** How it was matched. */
  method: string;
  /** Next-best candidates from the search, for judging close calls. */
  alternatives: { type: string; name: string; score: number }[];
}

type DimensionMatch = { entityName: string; dim: Dimension; score: number | null; method: string; alternatives: RetrievalHit[] };

const DATE_DATATYPE_RE = /date|time/i;

export class SemanticResolution {
  kpis: string[] = [];
  metrics: string[] = [];
  dimensions: string[] = [];
  entities: string[] = [];
  filters: ResolvedFilter[] = [];
  sort_rank: ResolvedSortRank | null = null;
  /** The date field the question's period or time buckets apply to. */
  time_dimension: string | null = null;
  unresolved: string[] = [];
  matches: ResolutionMatch[] = [];
  // Real RAG cosine-similarity score (0-1, the actual "match percentage") per
  // resolved kpi/metric/dimension name - populated only when that name had
  // to fall back to RAG.
  scores: Record<string, number> = {};

  get fullyResolved(): boolean {
    return this.unresolved.length === 0;
  }
}

/**
 * Maps the Planner's plan onto one data source's semantic-model concepts,
 * part by part (see `resolvePlan`). See the Python `SemanticResolver`'s
 * docstring for the rationale of the matching rules below - preserved in
 * the inline comments throughout this file.
 */
export class SemanticResolver {
  constructor(
    private readonly model: SemanticModel,
    private readonly retriever: SemanticRetriever | null = null,
    private readonly scoreThreshold: number = RAG_SCORE_THRESHOLD,
    private readonly kpiPreferenceMargin: number = KPI_PREFERENCE_MARGIN,
    private readonly metricPreferenceMargin: number = METRIC_PREFERENCE_MARGIN,
    private readonly crossEntityScoreMargin: number = CROSS_ENTITY_SCORE_MARGIN,
    private readonly strongDimensionScore: number = STRONG_DIMENSION_SCORE
  ) {}

  /**
   * Matches each part of the plan against this data source's semantic model
   * on its own: the subject against KPIs/metrics/measures, each dimension
   * and filter field against dimensions, and the time field against date
   * dimensions - so words from one part never skew another part's match.
   */
  async resolvePlan(plan: Plan): Promise<SemanticResolution> {
    const resolution = new SemanticResolution();
    const entitiesTouched = new Set<string>();
    const subject = plan.subject.trim();

    // 1. What is measured. A "list" question has no computed measure.
    if (plan.analysis_pattern !== "list") {
      // The model's subject often drops the word that names a KPI ("unique",
      // "received"), so the question's own wording is searched too.
      const wording = plan.measure_text?.trim() ?? "";
      const hits = await this.searchPrimaryMeasure(subject, wording);
      const exactWording = wording ? this.exactMeasureMatch(wording) : null;
      // A KPI named exactly like the question's wording wins; otherwise an
      // item named like the subject (or, failing that, the wording) does.
      let exactSubject = this.exactMeasureMatch(subject);
      // A subject that only equals a plain metric/measure ("case count") must
      // not shut out a KPI the fuller wording points at ("open case count").
      if (exactSubject && exactSubject.type !== "kpi" && wording && normalizeName(wording) !== normalizeName(subject) && (hits.kpi ?? []).length > 0) {
        exactSubject = null;
      }
      const exact = exactWording?.type === "kpi" ? exactWording : exactSubject ?? exactWording;
      // An item named exactly like the subject wins over search scores.
      if (exact) this.resolvePrimaryMeasure({ [exact.type]: [{ ...exact, score: 1, entity: "", text: "", data_source_id: null }] }, resolution, entitiesTouched);
      else this.resolvePrimaryMeasure(hits, resolution, entitiesTouched);
      const chosen = resolution.kpis[0] ?? resolution.metrics[0] ?? null;
      const ranked = [...(hits.kpi ?? []), ...(hits.metric ?? []), ...(hits.measure ?? [])].sort((a, b) => b.score - a.score);
      const chosenType = resolution.kpis.length ? "kpi" : ranked.find((h) => h.name === chosen)?.type ?? "metric";
      if (exact && chosen) delete resolution.scores[chosen];
      resolution.matches.push({
        part: "subject",
        phrase: subject,
        matched: chosen ? { type: exact?.type ?? chosenType, name: chosen } : null,
        score: chosen && !exact ? resolution.scores[chosen] ?? null : null,
        method: exact ? "exact name/synonym" : "search (KPIs, metrics, measures)",
        alternatives: ranked.filter((h) => h.name !== chosen).slice(0, 3).map(toAlternative),
      });
      if (!chosen) resolution.unresolved.push(`measure:${subject || "(unspecified)"}`);
    }

    // 2. Grouping attributes.
    for (const phrase of plan.dimensions) {
      const found = await this.resolveDimensionPhrase(phrase, entitiesTouched);
      this.recordDimensionMatch(resolution, "dimension", phrase, found);
      if (found) {
        if (!resolution.dimensions.includes(found.dim.name)) resolution.dimensions.push(found.dim.name);
        if (found.score !== null) resolution.scores[found.dim.name] = found.score;
        entitiesTouched.add(found.entityName);
      } else {
        resolution.unresolved.push(`dimension:${phrase}`);
      }
    }

    // 3. Non-time conditions.
    for (const [fieldPhrase, rawValue] of Object.entries(plan.filters)) {
      const found = await this.resolveDimensionPhrase(fieldPhrase, entitiesTouched);
      this.recordDimensionMatch(resolution, "filter", `${fieldPhrase} = ${JSON.stringify(rawValue)}`, found);
      if (!found) {
        resolution.unresolved.push(`filter:${fieldPhrase}`);
        continue;
      }
      const parsed = parseFilterValue(rawValue);
      if (!parsed) {
        logger.warning("filter_value_unparseable", { field: found.dim.name, raw_value: rawValue });
        continue;
      }
      const [op, value] = parsed;
      resolution.filters.push({ field: found.dim.name, op, value, source: "planner" });
      if (found.score !== null) resolution.scores[found.dim.name] = found.score;
      entitiesTouched.add(found.entityName);
    }

    // 4. Every resolved KPI implicitly requires its grouping dimensions.
    for (const kpiName of resolution.kpis) {
      const kpi = this.model.getKpi(kpiName);
      if (!kpi) continue;
      for (const dimName of kpi.required_grouping_dimensions) {
        if (!resolution.dimensions.includes(dimName)) resolution.dimensions.push(dimName);
        const found = this.model.findDimension(dimName);
        if (found) entitiesTouched.add(found[0].name);
        resolution.matches.push({
          part: "kpi_grouping",
          phrase: kpiName,
          matched: { type: "dimension", name: dimName },
          score: null,
          method: "required by the KPI",
          alternatives: [],
        });
      }
    }

    // 5. Time: the date field the period/buckets apply to, and the period's
    // range - already computed by the Planner, never re-read from text here.
    if (plan.time.phrase || plan.time.granularity) {
      const found = await this.resolveTimeDimension(plan.time.field ?? "", resolution, entitiesTouched);
      const label = plan.time.phrase ?? `${plan.time.granularity} buckets`;
      this.recordDimensionMatch(resolution, "time", `${plan.time.field ?? "date"} (${label})`, found);
      if (found) {
        resolution.time_dimension = found.dim.name;
        entitiesTouched.add(found.entityName);
        if (plan.time_range) {
          resolution.filters.push({ field: found.dim.name, op: plan.time_range.op, value: plan.time_range.value, source: "time" });
        }
      } else {
        resolution.unresolved.push(`time:${plan.time.field ?? label}`);
      }
      if (plan.time.phrase && !plan.time_range) resolution.unresolved.push(`period:${plan.time.phrase}`);
    }

    // 6. A listing (or anything still without an entity): the entity the
    // subject is about, so the SQL stage reasons over one table.
    if (entitiesTouched.size === 0) {
      const entityName = await this.resolvePrimaryEntity(subject);
      if (entityName) entitiesTouched.add(entityName);
      resolution.matches.push({
        part: "entity",
        phrase: subject,
        matched: entityName ? { type: "entity", name: entityName } : null,
        score: null,
        method: "search (entities)",
        alternatives: [],
      });
    }

    resolution.entities = [...entitiesTouched].sort();
    resolution.sort_rank =
      plan.analysis_pattern === "ranking" && resolution.metrics.length
        ? { field: resolution.metrics[0], direction: plan.rank_direction, limit: plan.rank_limit }
        : null;
    return resolution;
  }

  /** The KPI, metric or measure whose name (or a measure's synonym) equals
   * `subject`, ignoring case, spacing and punctuation - KPIs first. */
  private exactMeasureMatch(subject: string): { type: "kpi" | "metric" | "measure"; name: string } | null {
    const key = normalizeName(subject);
    if (!key) return null;
    const kpi = this.model.kpis.find((k) => normalizeName(k.name) === key);
    if (kpi) return { type: "kpi", name: kpi.name };
    const metric = this.model.metrics.find((m) => normalizeName(m.name) === key);
    if (metric) return { type: "metric", name: metric.name };
    for (const entity of this.model.entities) {
      const measure = entity.measures.find(
        (m) => normalizeName(m.name) === key || m.synonyms.some((syn) => normalizeName(syn) === key)
      );
      if (measure) return { type: "measure", name: measure.name };
    }
    return null;
  }

  private recordDimensionMatch(
    resolution: SemanticResolution,
    part: ResolutionMatch["part"],
    phrase: string,
    found: DimensionMatch | null
  ): void {
    resolution.matches.push({
      part,
      phrase,
      matched: found ? { type: "dimension", name: found.dim.name } : null,
      score: found?.score ?? null,
      method: found?.method ?? "no match",
      alternatives: (found?.alternatives ?? []).filter((h) => h.name !== found?.dim.name).slice(0, 3).map(toAlternative),
    });
  }

  /**
   * The date dimension a period or time bucket applies to, in order:
   * the Planner's field name ("Resolved Date") matched by name/synonym or
   * search among date dimensions only; else the date field the matched
   * KPI/metric itself supports; else the only date field of the entity in
   * play.
   */
  private async resolveTimeDimension(
    fieldPhrase: string,
    resolution: SemanticResolution,
    entitiesTouched: Set<string>
  ): Promise<DimensionMatch | null> {
    const dateDims: [Entity, Dimension][] = this.model.entities.flatMap((e) =>
      e.dimensions.filter((d) => DATE_DATATYPE_RE.test(d.datatype)).map((d): [Entity, Dimension] => [e, d])
    );
    if (!dateDims.length) return null;
    const preferTouched = (list: [Entity, Dimension][]) =>
      list.find(([e]) => entitiesTouched.has(e.name)) ?? list[0];

    const phrase = fieldPhrase.trim();
    if (phrase) {
      const lower = phrase.toLowerCase();
      const exact = dateDims.filter(
        ([, d]) => d.name.toLowerCase() === lower || d.synonyms.some((syn) => syn.toLowerCase() === lower)
      );
      if (exact.length) {
        const [entity, dim] = preferTouched(exact);
        return { entityName: entity.name, dim, score: null, method: "exact name/synonym", alternatives: [] };
      }
      if (this.retriever) {
        const hits = await this.retriever.search(phrase, { docType: "dimension", dataSourceId: this.model.data_source_id, topK: 10 });
        const dateHits = hits.filter((h) => dateDims.some(([, d]) => d.name === h.name));
        for (const hit of dateHits) {
          if (hit.score < this.scoreThreshold) break;
          const match = preferTouched(dateDims.filter(([, d]) => d.name === hit.name));
          const outside = entitiesTouched.size > 0 && !entitiesTouched.has(match[0].name);
          if (outside && hit.score < this.scoreThreshold + this.crossEntityScoreMargin) continue;
          return { entityName: match[0].name, dim: match[1], score: hit.score, method: "search (date dimensions)", alternatives: dateHits };
        }
      }
    }

    // The matched KPI/metric's own date field.
    for (const name of this.supportedDimensionNames(resolution)) {
      const found = this.model.findDimension(name);
      if (found && DATE_DATATYPE_RE.test(found[1].datatype)) {
        return { entityName: found[0].name, dim: found[1], score: null, method: "date field of the matched KPI/metric", alternatives: [] };
      }
    }

    // The single date field of the entity in play.
    const inTouched = dateDims.filter(([e]) => entitiesTouched.has(e.name));
    if (inTouched.length === 1) {
      const [entity, dim] = inTouched[0];
      return { entityName: entity.name, dim, score: null, method: "only date field of the entity", alternatives: [] };
    }
    return null;
  }

  private supportedDimensionNames(resolution: SemanticResolution): string[] {
    const names: string[] = [];
    for (const kpiName of resolution.kpis) names.push(...(this.model.getKpi(kpiName)?.supported_dimensions ?? []));
    for (const metricName of resolution.metrics) {
      names.push(...(this.model.resolveMetricOrMeasure(metricName)?.supported_dimensions ?? []));
    }
    return names;
  }

  private async resolvePrimaryEntity(searchText: string): Promise<string | null> {
    if (!this.retriever || !searchText) return null;
    const hits = await this.retriever.search(searchText, {
      docType: "entity",
      dataSourceId: this.model.data_source_id,
      topK: 1,
    });
    if (hits.length && hits[0].score >= this.scoreThreshold && this.model.getEntity(hits[0].name)) {
      return hits[0].name;
    }
    return null;
  }

  /** Searches KPIs, metrics and measures with the planner's subject and, when
   * given, the question's own wording; each item keeps its better score. */
  private async searchPrimaryMeasure(searchText: string, wording = ""): Promise<Record<string, RetrievalHit[]>> {
    if (!this.retriever) return {};
    // When the wording already contains every word of the subject, it is the
    // more specific text ("open case count" vs "case count"); searching the
    // bare subject as well would only pull in generic matches.
    const subjectWords = [...wordStems(searchText)];
    const wordingWords = wordStems(wording);
    const wordingCoversSubject = wordingWords.size > 0 && subjectWords.every((w) => wordingWords.has(w));
    const texts = (wordingCoversSubject ? [wording] : [searchText, wording])
      .map((t) => t.trim())
      .filter((t, i, all) => t && all.indexOf(t) === i);
    if (texts.length === 0) return {};
    const docTypes = ["kpi", "metric", "measure"] as const;
    const results = await Promise.all(
      docTypes.map((docType) =>
        Promise.all(
          texts.map((text) =>
            this.retriever!.search(text, { docType, dataSourceId: this.model.data_source_id, topK: 3 })
          )
        )
      )
    );
    const out: Record<string, RetrievalHit[]> = {};
    docTypes.forEach((docType, i) => {
      const best = new Map<string, RetrievalHit>();
      for (const hits of results[i]) {
        for (const hit of hits) {
          const seen = best.get(hit.name);
          if (!seen || hit.score > seen.score) best.set(hit.name, hit);
        }
      }
      out[docType] = [...best.values()]
        .filter((hit) => hit.score >= this.scoreThreshold)
        .sort((a, b) => b.score - a.score);
    });
    return out;
  }

  /** The enabled KPI that wraps `metric` (its default filters are what give
   * the metric its business meaning). With several, the best-scoring one
   * among the search hits; with none in the hits, only a sole wrapper. */
  private kpiWrappingMetric(metricId: string, kpiHits: RetrievalHit[]): { name: string; score: number | null } | null {
    const wrappers = this.model.kpis.filter((k) => k.enabled && k.metric_ids.includes(metricId));
    if (wrappers.length === 0) return null;
    for (const hit of kpiHits) {
      if (wrappers.some((k) => k.name === hit.name)) return { name: hit.name, score: hit.score };
    }
    return wrappers.length === 1 ? { name: wrappers[0].name, score: null } : null;
  }

  private applyKpi(kpiName: string, score: number | null, resolution: SemanticResolution, entitiesTouched: Set<string>): boolean {
    const kpi = this.model.getKpi(kpiName);
    if (!kpi) return false;
    resolution.kpis.push(kpi.name);
    if (score !== null) resolution.scores[kpi.name] = score;
    for (const metricId of kpi.metric_ids) {
      const metric = this.model.getMetricById(metricId);
      if (metric && !resolution.metrics.includes(metric.name)) {
        resolution.metrics.push(metric.name);
        if (score !== null) resolution.scores[metric.name] = score;
        const entity = this.entityForMeasure(metric.base_measure);
        if (entity) entitiesTouched.add(entity);
      }
    }
    return true;
  }

  private resolvePrimaryMeasure(
    hits: Record<string, RetrievalHit[]>,
    resolution: SemanticResolution,
    entitiesTouched: Set<string>
  ): void {
    const kpiHits = hits.kpi ?? [];
    const metricHits = hits.metric ?? [];
    const measureHits = hits.measure ?? [];
    const useKpi =
      kpiHits.length > 0 &&
      (metricHits.length === 0 ||
        kpiHits[0].score >= metricHits[0].score + KPI_STRONG_MARGIN ||
        (kpiHits[0].score >= KPI_MIN_SCORE && kpiHits[0].score >= metricHits[0].score + this.kpiPreferenceMargin));

    if (useKpi && this.applyKpi(kpiHits[0].name, kpiHits[0].score, resolution, entitiesTouched)) {
      logger.info("primary_measure_selected", {
        kind: "kpi",
        name: kpiHits[0].name,
        kpi_score: kpiHits[0].score,
        best_metric_score: metricHits[0]?.score ?? null,
      });
      return;
    }

    const useMetric =
      metricHits.length > 0 && (measureHits.length === 0 || metricHits[0].score >= measureHits[0].score + this.metricPreferenceMargin);
    if (useMetric) {
      const metric = this.model.getMetric(metricHits[0].name);
      if (metric) {
        // A metric that a KPI wraps is only that KPI's aggregation: using it
        // bare would drop the KPI's default filters (Closed, Cancelled, ...).
        const wrapper = this.kpiWrappingMetric(metric.id, kpiHits);
        if (wrapper && this.applyKpi(wrapper.name, wrapper.score ?? metricHits[0].score, resolution, entitiesTouched)) {
          logger.info("primary_measure_selected", {
            kind: "kpi_wrapping_metric",
            name: wrapper.name,
            metric: metric.name,
            metric_score: metricHits[0].score,
            kpi_score: wrapper.score,
          });
          return;
        }
        resolution.metrics.push(metric.name);
        resolution.scores[metric.name] = metricHits[0].score;
        const entity = this.entityForMeasure(metric.base_measure);
        if (entity) entitiesTouched.add(entity);
        return;
      }
    }

    if (measureHits.length > 0) {
      const found = this.model.findMeasure(measureHits[0].name);
      if (found) {
        const [entity, measure] = found;
        resolution.metrics.push(measure.name);
        resolution.scores[measure.name] = measureHits[0].score;
        entitiesTouched.add(entity.name);
      }
    }
  }

  private async resolveDimensionPhrase(phrase: string, entitiesTouched: Set<string> | null = null): Promise<DimensionMatch | null> {
    const preferredEntities = entitiesTouched ?? new Set<string>();
    const found = this.model.findDimensionBySynonym(phrase);
    if (found) {
      const [entity, dim] = found;
      return { entityName: entity.name, dim, score: null, method: "exact name/synonym", alternatives: [] };
    }

    // Description-keyword tier: every word of the phrase must appear as a
    // whole word in the description.
    const phraseWords = new Set(phrase.toLowerCase().match(WORD_RE) ?? []);
    if (phraseWords.size > 0) {
      const candidates: [string, Dimension][] = [];
      for (const entity of this.model.entities) {
        for (const dim of entity.dimensions) {
          const descWords = new Set(dim.description.toLowerCase().match(WORD_RE) ?? []);
          let subset = true;
          for (const w of phraseWords) {
            if (!descWords.has(w)) {
              subset = false;
              break;
            }
          }
          if (subset) candidates.push([entity.name, dim]);
        }
      }
      if (candidates.length === 1) {
        const [entityName, dim] = candidates[0];
        return { entityName, dim, score: null, method: "description words", alternatives: [] };
      }
      if (candidates.length > 1 && preferredEntities.size > 0) {
        const narrowed = candidates.filter(([entityName]) => preferredEntities.has(entityName));
        if (narrowed.length === 1) {
          const [entityName, dim] = narrowed[0];
          return { entityName, dim, score: null, method: "description words", alternatives: [] };
        }
      }
    }

    if (this.retriever) {
      const hits = await this.retriever.search(phrase, { docType: "dimension", dataSourceId: this.model.data_source_id, topK: 5 });
      for (const hit of hits) {
        const exact = this.findDimensionPreferringEntities(hit.name, preferredEntities);
        if (!exact) continue;
        const [entity, dim] = exact;
        const requiredScore =
          preferredEntities.size > 0 && !preferredEntities.has(entity.name)
            ? this.scoreThreshold + this.crossEntityScoreMargin
            : this.scoreThreshold;
        if (hit.score < requiredScore) continue;
        // A weak embedding match with no shared wording is how "partner"
        // silently became the unrelated "state" column - better to report the
        // phrase as unresolved than to group by the wrong thing.
        if (hit.score < this.strongDimensionScore && !isLexicallyRelated(phrase, dim)) {
          logger.warning("dimension_weak_match_rejected", { phrase, candidate: dim.name, score: hit.score });
          continue;
        }
        return { entityName: entity.name, dim, score: hit.score, method: "search (dimensions)", alternatives: hits };
      }
    }
    return null;
  }

  private findDimensionPreferringEntities(name: string, preferredEntities: Set<string>): [Entity, Dimension] | null {
    const matches: [Entity, Dimension][] = [];
    for (const entity of this.model.entities) {
      for (const dim of entity.dimensions) {
        if (dim.name.toLowerCase() === name.toLowerCase()) matches.push([entity, dim]);
      }
    }
    if (matches.length === 0) return null;
    for (const [entity, dim] of matches) {
      if (preferredEntities.has(entity.name)) return [entity, dim];
    }
    return matches[0];
  }

  private entityForMeasure(measureName: string): string | null {
    const found = this.model.findMeasure(measureName);
    return found ? found[0].name : null;
  }
}

/** "Resolved Volume", "resolved-volume" and "ResolvedVolume" compare equal. */
function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toAlternative(hit: RetrievalHit): { type: string; name: string; score: number } {
  return { type: hit.type, name: hit.name, score: hit.score };
}
