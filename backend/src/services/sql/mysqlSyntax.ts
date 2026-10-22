// MySQL is the only database engine this app connects to - both for its own
// metadata store (see `repositories/db.ts`) and for every user datasource
// (see `services/datasource/factory.ts`). The spellings below are therefore
// written directly in MySQL's own syntax rather than selected from a
// per-engine table; nothing here is generic "ANSI SQL", because the specific
// constructs involved (relative dates, date bucketing) have no portable
// spelling MySQL would accept unchanged.

/** The `database` option `node-sql-parser` expects for MySQL - the dialect
 * mode this app's SQL validator parses every generated query under. */
export const PARSER_DIALECT = "MySQL";

/**
 * A short, concrete syntax cheat-sheet for the LLM SQL Agent, covering
 * exactly the constructs a model is most likely to spell in some other
 * engine's dialect (relative dates, partial-string matching) - the two
 * places a query has been observed to fail outright against a real MySQL
 * datasource even though it looked like perfectly reasonable SQL.
 */
export function mysqlSyntaxNotes(): string {
  return (
    "Target database engine: MySQL. Write every function/expression in MySQL's own SQL dialect - " +
    "a construct borrowed from a different database engine is a real syntax error on MySQL, " +
    "not just a style mismatch, even if it looks like valid SQL in general.\n" +
    "  - A relative date/time (e.g. \"last 6 months\"): DATE_SUB(NOW(), INTERVAL 6 MONTH)\n" +
    "  - A partial-string match (e.g. \"contains\") is just a LIKE with the wildcards baked into " +
    "the literal itself: `col LIKE '%value%'` - never concatenate with `||` (that means logical OR " +
    "in MySQL's default mode, not string concatenation) or CONCAT() for a fixed literal value.\n" +
    "  - A double-quoted \"name\" is a STRING LITERAL in MySQL, not an identifier. `AS \"Alias\"` is fine, " +
    "but wherever an alias is REFERENCED (ORDER BY, GROUP BY, or inside OVER (...)) write it with backticks " +
    "(`Alias`) - ORDER BY \"Alias\" silently sorts by a constant, i.e. does not sort at all."
  );
}

/**
 * MySQL reads a double-quoted "Alias" as a string literal unless ANSI_QUOTES
 * is on, so `ORDER BY "ResolvedCaseVolume" DESC` sorts by a constant (no
 * sorting - a top-N then returns arbitrary groups) and the same inside
 * `OVER (... ORDER BY "Month")` makes LAG() compare an arbitrary row. Every
 * double-quoted token that is also a SELECT alias (`AS "Name"`) is rewritten
 * to backticks; double-quoted text that is not an alias is left alone, and
 * single-quoted strings and backticked identifiers are never touched.
 */
export function backtickAliasReferences(sql: string): string {
  const aliases = new Set<string>();
  for (const m of sql.matchAll(/\bAS\s+"([^"]+)"/gi)) aliases.add(m[1]);
  if (aliases.size === 0) return sql;

  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === "`") {
      // copy a single-quoted string / backticked identifier verbatim
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "\\" && ch === "'") j += 2;
        else if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) break;
        else j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      if (end === -1) {
        out += sql.slice(i);
        break;
      }
      const inner = sql.slice(i + 1, end);
      out += aliases.has(inner) ? `\`${inner.replace(/`/g, "``")}\`` : sql.slice(i, end + 1);
      i = end + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * MySQL SQL for "now minus N days/months/years". `unit` is singular or
 * plural ("month"/"months") - normalized here to the singular, uppercased
 * keyword MySQL's INTERVAL syntax requires.
 */
export function relativeDateSql(count: number, unit: string): string {
  const unitSingular = unit.replace(/s$/, "");
  return `DATE_SUB(NOW(), INTERVAL ${count} ${unitSingular.toUpperCase()})`;
}

export type TrendGranularity = "day" | "week" | "month" | "quarter" | "year";

/**
 * Truncates a datetime column expression down to the start of its
 * day/week/month/quarter/year bucket, in MySQL's own syntax. `col` is the
 * column reference to substitute in (e.g. `t0.resolved_at`) - the caller
 * supplies it already alias-qualified.
 *
 * Every expression below was verified to parse under `node-sql-parser`'s
 * MySQL mode (the same parser this app's SQL validator uses), and the week
 * formula was checked against all seven weekdays of a known week to confirm
 * it buckets to that week's Monday with no off-by-one - a naive formula
 * silently returns the WRONG week for rows that land exactly on a week
 * boundary, which is easy to miss without checking every day of the week,
 * not just an arbitrary sample date.
 *
 * Week buckets start on Monday (ISO 8601).
 *
 * Every bucket is rendered as a plain 'YYYY-MM-DD' string (the bucket's
 * first day) - a bare DATE value comes back from mysql2 as a JS Date and
 * reaches the UI as a full ISO timestamp ('2025-10-27T00:00:00.000Z'). The
 * string still sorts chronologically, so ORDER BY / LAG ordering is unchanged.
 */
export function dateBucketExpression(col: string, unit: TrendGranularity): string {
  switch (unit) {
    case "day":
      return `DATE_FORMAT(${col}, '%Y-%m-%d')`;
    case "week":
      // WEEKDAY() is already Monday=0..Sunday=6 in MySQL - no rebasing needed.
      return `DATE_FORMAT(DATE_SUB(DATE(${col}), INTERVAL WEEKDAY(${col}) DAY), '%Y-%m-%d')`;
    case "month":
      return `DATE_FORMAT(${col}, '%Y-%m-01')`;
    case "quarter":
      return `DATE_FORMAT(MAKEDATE(YEAR(${col}), 1) + INTERVAL (QUARTER(${col}) - 1) * 3 MONTH, '%Y-%m-%d')`;
    case "year":
      return `DATE_FORMAT(MAKEDATE(YEAR(${col}), 1), '%Y-%m-%d')`;
  }
}

/**
 * Default lookback window when a period-over-period question names no date
 * filter of its own (e.g. "what's the WoW change in resolved volume?") -
 * just wide enough to contain the current and immediately preceding bucket,
 * expressed as the same `last_n_days`/`last_n_months`/`last_n_years` filter
 * ops the Resolver and SQL Agent already support for relative-date filters.
 */
export function defaultPeriodOverPeriodWindow(unit: TrendGranularity): [string, number] {
  switch (unit) {
    case "day":
      return ["last_n_days", 2];
    case "week":
      return ["last_n_days", 14];
    case "month":
      return ["last_n_months", 2];
    case "quarter":
      return ["last_n_months", 6];
    case "year":
      return ["last_n_years", 2];
  }
}
