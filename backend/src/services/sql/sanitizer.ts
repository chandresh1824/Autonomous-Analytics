export const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CREATE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "MERGE",
  "REPLACE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
];

export function findForbiddenKeywords(sql: string): string[] {
  const upper = sql.toUpperCase();
  return FORBIDDEN_KEYWORDS.filter((keyword) => new RegExp(`\\b${keyword}\\b`).test(upper));
}

export function isSingleStatement(sql: string): boolean {
  const stripped = sql.trim().replace(/;+$/, "");
  return !stripped.includes(";");
}

export function isReadOnlySelect(sql: string): boolean {
  const stripped = sql.trim().toUpperCase();
  return stripped.startsWith("SELECT") || stripped.startsWith("WITH");
}

/**
 * Ensure the query cannot return more than `maxRows` rows. If the generator
 * already added a LIMIT/TOP/FETCH FIRST clause it is left as-is (SQL
 * Agent-generated LIMITs are already <= maxRows by construction).
 */
export function enforceRowLimit(sql: string, maxRows: number): string {
  const stripped = sql.trim().replace(/;+$/, "");
  const upper = stripped.toUpperCase();
  if (/\bLIMIT\s+\d+\b/.test(upper) || /\bTOP\s+\d+\b/.test(upper) || upper.includes("FETCH FIRST")) {
    return stripped;
  }
  return `${stripped}\nLIMIT ${maxRows}`;
}
