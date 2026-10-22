/* Wording helpers used by the Planner's code-side checks (plannerAgent.ts).
   The separate Query Shape model call they once served is now part of the
   Planner's single call. */

/** Crude singularizer - only used to compare a dimension phrase against the
 * question's own words ("hub centers" vs "hub center", "priorities" vs
 * "priority"), never to display anything. */
function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 3 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:ch|sh|x|s|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function stems(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);
}

/**
 * Drops any dimension phrase the question never actually said. The prompt
 * forbids inventing a breakdown, but a small model sometimes adds a "topically
 * related" one anyway (e.g. "priority" for "volume resolved by nov 2025") - and
 * that silently turns a single number into a grouped table. A real dimension
 * phrase always shares at least one word with the question.
 */
export function groundDimensions(dimensions: string[], question: string): string[] {
  const questionStems = new Set(stems(question));
  return dimensions.filter((phrase) => {
    const words = stems(phrase).filter((w) => w.length >= 3);
    return words.length === 0 || words.some((w) => questionStems.has(w));
  });
}

// "this year", "last quarter", "last 3 months", "past 2 weeks" ...
const RELATIVE_PERIOD_RE = /\b(this|current|last|previous|prior|past)\s+(?:(\d+)\s+)?(day|week|month|quarter|year)s?\b/gi;
// An explicit period in the question wins over any relative wording around it
// (e.g. "last quarter of 2025") - leave those to the model's own value.
const ABSOLUTE_PERIOD_RE = /\b(?:19|20)\d{2}\b|\bq[1-4]\b|\bfy\s*\d/i;

/**
 * The one relative period a question names, in the canonical wording the
 * Resolver parses ("this year", "last quarter", "last 3 months") - or null if
 * it names none, several, or an explicit period alongside it.
 */
export function canonicalRelativePeriod(question: string): string | null {
  if (ABSOLUTE_PERIOD_RE.test(question)) return null;
  const matches = [...question.matchAll(RELATIVE_PERIOD_RE)];
  if (matches.length !== 1) return null;
  const [, qualifier, count, unit] = matches[0];
  const q = qualifier.toLowerCase();
  if (q === "this" || q === "current") return `this ${unit.toLowerCase()}`;
  if (count) return `last ${count} ${unit.toLowerCase()}s`;
  return `last ${unit.toLowerCase()}`;
}
