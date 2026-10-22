import fs from "node:fs";
import path from "node:path";
import { getLogger } from "../core/logging";
import { Plan, PlannerResult, PlannerResultSchema, ResolvedTimeRange, TimeGranularity } from "../schemas/planner";
import { QueryShapeResult } from "../schemas/queryShape";
import { ChatModel } from "../services/llm/client";
import { generateStructured } from "../services/llm/structuredOutput";
import { expandUnitAbbreviations, parseFilterValue } from "../services/semantic/resolver";
import { canonicalRelativePeriod, groundDimensions } from "./queryShapeAgent";

const logger = getLogger("agents.plannerAgent");
const PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "planner.txt");
const PERIOD_PLACEHOLDER = "[period]";

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

// Most specific first, so "nov 2025" is replaced as one period rather than
// leaving a stray month or year behind.
const PERIOD_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/gi, // 2025-11-30
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/gi, // 30/11/2025, 11-30-25
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s+'?\\d{2,4}\\b`, "gi"), // 30 nov 2025
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+'?\\d{2,4}\\b`, "gi"), // nov 30, 2025
  new RegExp(`\\b(?:${MONTHS})\\.?[\\s,'-]*\\d{2,4}\\b`, "gi"), // nov 2025, nov'25, november-2025
  /\b(?:q[1-4]|h[12])\s*(?:fy)?\s*'?\d{2,4}\b/gi, // Q3 2025, H1 FY25
  /\bfy\s*'?\d{2,4}(?:\s*[-/]\s*\d{2,4})?\b/gi, // FY2025, FY 24-25
  /\b(?:19|20)\d{2}\b/g, // bare year
];

/**
 * Replaces explicit time periods with `[period]`. The model only names which
 * business date a period applies to - code finds the period itself and turns
 * it into a range - and small models otherwise reject real questions like
 * "volume resolved by nov 2025" as being past their "knowledge cutoff".
 */
export function maskPeriods(question: string): string {
  let masked = question;
  for (const pattern of PERIOD_PATTERNS) masked = masked.replace(pattern, PERIOD_PLACEHOLDER);
  return masked;
}

const RANK_WORDS_RE = /\b(?:top|bottom|best|worst|highest|lowest)\s+\d+\b/gi;
const BUCKET_WORDS_RE = /\b(?:daily|weekly|monthly|quarterly|yearly|annually)\b/gi;
const OVER_PERIOD_RE = /\b(?:day|week|month|quarter|year)[-\s]over[-\s](?:day|week|month|quarter|year)\b/gi;
const FILLER_RE = /\b(?:show me|give me|tell me|what is|what are|how many|please)\b/gi;
const CONNECTOR_RE = /\b(?:by|in|for|during|per|across|of|the|were|was|are|is|been|did|does|do|have|has|with)\b/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The question's own wording for matching KPIs/metrics: periods, the
 * grouping attributes the planner found, ranking words, bucket words and
 * connectors removed - everything else, including qualifiers like "unique",
 * "received" or "closed" and a named priority, stays. Done in code so it does
 * not depend on how the small model happened to shorten the question.
 */
export function measureSearchText(question: string, dimensions: string[]): string {
  let text = maskPeriods(question).replaceAll(PERIOD_PLACEHOLDER, " ");
  for (const dim of dimensions) {
    const phrase = dim.trim();
    if (phrase) text = text.replace(new RegExp(`\\b${escapeRegExp(phrase)}(?:e?s)?\\b`, "gi"), " ");
  }
  return text
    .replace(RANK_WORDS_RE, " ")
    .replace(OVER_PERIOD_RE, " ")
    .replace(BUCKET_WORDS_RE, " ")
    .replace(FILLER_RE, " ")
    .replace(CONNECTOR_RE, " ")
    .replace(/[?!.,;:]/g, " ")
    .replace(/\s+-\s*$|^\s*-\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Explicit periods in the question, in reading order, without overlaps. */
function findExplicitPeriods(question: string): string[] {
  let remaining = question;
  const found: { index: number; text: string }[] = [];
  for (const pattern of PERIOD_PATTERNS) {
    for (const match of remaining.matchAll(pattern)) {
      found.push({ index: match.index ?? 0, text: match[0] });
    }
    // Blank out what matched so a less specific pattern can't match inside it.
    remaining = remaining.replace(pattern, (m) => " ".repeat(m.length));
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.text.trim());
}

// Rejection reasons that are really the model judging dates/its own
// knowledge rather than the question - never valid for querying the user's
// own database.
const TIME_BASED_REJECTION =
  /knowledge[\s-]*cut[\s-]*off|cut[\s-]*off date|training data|my knowledge|future (?:date|period|data|event)|in the future|has(?:n't| not) (?:yet )?(?:happened|occurred)|not yet (?:available|occurred|happened)|real[\s-]*time|beyond (?:the |my )?(?:current|available)|current date|as of my|up[\s-]to[\s-]date|\[period\]/i;

const UNITS = "day|week|month|quarter|year";
const PERIOD_OVER_PERIOD_RE = new RegExp(`\\b(${UNITS})[\\s-]+(?:on|over)[\\s-]+(?:the[\\s-]+)?(?:previous[\\s-]+)?\\1\\b`, "i");
const PERIOD_OVER_PERIOD_ABBR: Record<string, TimeGranularity> = {
  dod: "day",
  wow: "week",
  mom: "month",
  qoq: "quarter",
  yoy: "year",
  "d/d": "day",
  "w/w": "week",
  "m/m": "month",
  "q/q": "quarter",
  "y/y": "year",
};
const PERIOD_OVER_PERIOD_ABBR_RE = /\b(dod|wow|mom|qoq|yoy|d\/d|w\/w|m\/m|q\/q|y\/y)\b/i;
const VERSUS_PREVIOUS_RE = new RegExp(
  `\\b(?:vs\\.?|versus|compared (?:to|with)|against)\\s+(?:the\\s+)?(?:last|previous|prior)\\s+(${UNITS})\\b`,
  "i"
);
const BUCKET_ADJECTIVES: Record<string, TimeGranularity> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
  annually: "year",
  annual: "year",
};
const BUCKET_ADJECTIVE_RE = /\b(daily|weekly|monthly|quarterly|yearly|annually|annual)\b/i;
const BY_UNIT_RE = new RegExp(`\\b(?:by|per|each|every)\\s+(${UNITS})\\b`, "i");

/** The bucketing unit and period-over-period wish stated in the question, or
 * null when it states none - read from the words, not left to the model. */
export function detectGranularity(question: string): { granularity: TimeGranularity; comparePrevious: boolean } | null {
  let m = PERIOD_OVER_PERIOD_RE.exec(question);
  if (m) return { granularity: m[1].toLowerCase() as TimeGranularity, comparePrevious: true };
  m = PERIOD_OVER_PERIOD_ABBR_RE.exec(question);
  if (m) return { granularity: PERIOD_OVER_PERIOD_ABBR[m[1].toLowerCase()], comparePrevious: true };
  m = VERSUS_PREVIOUS_RE.exec(question);
  if (m) return { granularity: m[1].toLowerCase() as TimeGranularity, comparePrevious: true };
  m = BUCKET_ADJECTIVE_RE.exec(question);
  if (m) return { granularity: BUCKET_ADJECTIVES[m[1].toLowerCase()], comparePrevious: false };
  m = BY_UNIT_RE.exec(question);
  if (m) return { granularity: m[1].toLowerCase() as TimeGranularity, comparePrevious: false };
  return null;
}

const WITHIN_YEAR_RE = /\b(first|last|final)\s+(quarter|month)\s+(?:of|in)\s+((?:19|20)\d{2})\b/i;
const TIME_WORD_RE =/^(?:day|week|month|quarter|year|daily|weekly|monthly|quarterly|yearly|annual|date|time|period)s?$/i;
const RANK_RE = /\b(top|bottom|best|worst|highest|lowest)\s+(\d+)\b/i;
const ASCENDING_RANK_WORDS = new Set(["bottom", "worst", "lowest"]);

/** The period the question names, read by code: one explicit period ("nov
 * 2025"), a span of two ("jan 2025 to mar 2025"), or one relative period
 * ("last quarter"). Falls back to the model's phrase only when it appears in
 * the question verbatim. */
function resolveTimePhrase(question: string, modelPhrase: string | null): string | null {
  // "last quarter of 2025" is Q4 2025, not all of 2025 (nor the quarter before today).
  const within = WITHIN_YEAR_RE.exec(question);
  if (within) {
    const [, position, unit, year] = within;
    const first = position.toLowerCase() === "first";
    return unit.toLowerCase() === "quarter" ? `q${first ? 1 : 4} ${year}` : `${first ? "jan" : "dec"} ${year}`;
  }
  const explicit = findExplicitPeriods(question);
  if (explicit.length === 1) return explicit[0];
  if (explicit.length >= 2) return `${explicit[0]} to ${explicit[explicit.length - 1]}`;
  const relative = canonicalRelativePeriod(question);
  if (relative) return relative;
  const phrase = modelPhrase?.trim();
  // A bucketing word ("monthly", "week over week") is a granularity, never a period.
  const isBucketWord = !!phrase && (TIME_WORD_RE.test(phrase) || detectGranularity(phrase) !== null);
  if (phrase && !isBucketWord && !phrase.includes(PERIOD_PLACEHOLDER) && question.toLowerCase().includes(phrase.toLowerCase())) {
    return phrase;
  }
  return null;
}

/** A concrete range for a time phrase, computed by code. A span "X to Y"
 * runs from the start of X to the end of Y. Null when it can't be parsed. */
export function resolveTimeRange(phrase: string | null): ResolvedTimeRange | null {
  if (!phrase) return null;
  const span = /^(.+?)\s+to\s+(.+)$/i.exec(phrase);
  if (span) {
    const from = parseFilterValue(span[1]);
    const to = parseFilterValue(span[2]);
    if (from?.[0] === "between" && to?.[0] === "between" && Array.isArray(from[1]) && Array.isArray(to[1])) {
      return { op: "between", value: [from[1][0], to[1][1]] };
    }
    return null;
  }
  const parsed = parseFilterValue(phrase);
  // A plain equality means the parser didn't recognise it as a period.
  if (!parsed || parsed[0] === "eq") return null;
  return { op: parsed[0], value: parsed[1] };
}

/**
 * Applies the checks the model is least reliable at, always moving the
 * output toward what the question literally says - never inventing a phrase
 * it lacks. Exported for tests.
 */
export function finalizePlan(raw: PlannerResult, rawQuestion: string): Plan {
  const question = expandUnitAbbreviations(rawQuestion);
  const plan: PlannerResult = {
    ...raw,
    dimensions: [...raw.dimensions],
    filters: { ...raw.filters },
    time: { ...raw.time },
  };

  // A rejection based on dates or the model's own knowledge is never valid.
  if (plan.intent !== "analytics_query" && TIME_BASED_REJECTION.test(plan.reason)) {
    logger.warning("planner_time_based_rejection_overridden", { intent: plan.intent, reason: plan.reason });
    plan.intent = "analytics_query";
    plan.reason = "";
  }

  // Grouping: only attributes the question names, and never a time word.
  const grounded = groundDimensions(plan.dimensions, question).filter(
    (d) => !TIME_WORD_RE.test(d.trim()) && !d.includes(PERIOD_PLACEHOLDER)
  );
  if (grounded.length !== plan.dimensions.length) {
    logger.info("planner_dimensions_dropped", { dropped: plan.dimensions.filter((d) => !grounded.includes(d)) });
  }
  plan.dimensions = grounded;

  // Time: the period and the bucketing unit come from the question's words.
  plan.time.phrase = resolveTimePhrase(question, plan.time.phrase);
  const bucket = detectGranularity(question);
  if (bucket) {
    plan.time.granularity = bucket.granularity;
    plan.time.compare_previous = bucket.comparePrevious;
  } else if (plan.time.granularity === null) {
    plan.time.compare_previous = false;
  }
  if (!plan.time.phrase && !plan.time.granularity) plan.time.field = null;
  else if (!plan.time.field?.trim()) plan.time.field = "Date";

  // Shape, from the strongest signal down.
  const rank = RANK_RE.exec(question);
  if (rank && !plan.time.granularity) {
    plan.analysis_pattern = "ranking";
    plan.rank_limit = Number(rank[2]);
    plan.rank_direction = ASCENDING_RANK_WORDS.has(rank[1].toLowerCase()) ? "asc" : "desc";
  } else if (plan.time.granularity) {
    plan.analysis_pattern = "trend";
  } else if (plan.dimensions.length === 0 && ["breakdown", "comparison"].includes(plan.analysis_pattern)) {
    plan.analysis_pattern = "single_value";
  }
  if (plan.analysis_pattern !== "ranking") plan.rank_limit = null;

  // What the catalog is searched for: the subject alone, so time/grouping
  // words don't skew the match.
  const fallbackSubject = maskPeriods(question).replaceAll(PERIOD_PLACEHOLDER, " ").replace(/\s+/g, " ").trim();
  if (plan.intent === "analytics_query" && !plan.subject.trim()) plan.subject = fallbackSubject;
  plan.subject = plan.subject.trim();

  return {
    ...plan,
    time_range: resolveTimeRange(plan.time.phrase),
    retrieval_query: plan.intent === "analytics_query" ? plan.subject || fallbackSubject : "",
    measure_text: plan.intent === "analytics_query" ? measureSearchText(question, plan.dimensions) : "",
  };
}

/**
 * What the databases are ranked on when choosing one: the subject plus every
 * grouping and filter word (field names and text values), without time
 * words - a period like "nov 2025" or a date field matches every catalog
 * alike and only blurs the scores.
 */
export function routingText(plan: Plan): string {
  const parts = [plan.subject, ...plan.dimensions];
  for (const [field, value] of Object.entries(plan.filters)) {
    parts.push(field);
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) if (typeof v === "string") parts.push(v);
  }
  const seen = new Set<string>();
  return parts
    .map((p) => p.trim())
    .filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()))
    .join(", ");
}

/** The plan in the shape the downstream Resolver and SQL Agent consume. */
export function toQueryShape(plan: Plan): QueryShapeResult {
  const filters: Record<string, unknown> = { ...plan.filters };
  if (plan.time.phrase && plan.time_range) filters[plan.time.field || "Date"] = plan.time.phrase;
  return {
    analysis_pattern: plan.analysis_pattern,
    rank_limit: plan.rank_limit,
    rank_direction: plan.rank_direction,
    dimensions: plan.dimensions,
    filters,
    trend_granularity: plan.time.granularity,
    period_over_period: plan.time.compare_previous,
  };
}

/**
 * Reads a question once and returns its whole plan: intent, the subject to
 * search the catalog for, analysis pattern, dimensions, filters, time and
 * ranking - all in the question's own words. Never shown the semantic
 * catalog and never writes SQL; the Resolver matches each part against the
 * catalog afterwards. Code-side checks (`finalizePlan`) handle what models
 * are least reliable at - dates, bucketing words, top-N and invented
 * breakdowns - so the prompt stays small.
 */
export class PlannerAgent {
  private readonly systemPrompt: string;

  constructor(private readonly chatModel: ChatModel) {
    this.systemPrompt = fs.readFileSync(PROMPT_PATH, "utf-8");
  }

  async plan(userQuery: string): Promise<Plan> {
    const raw = await generateStructured(this.chatModel, {
      systemPrompt: this.systemPrompt,
      userPrompt: `Question:\n${maskPeriods(userQuery)}`,
      schema: PlannerResultSchema,
    });
    return finalizePlan(raw, userQuery);
  }
}
