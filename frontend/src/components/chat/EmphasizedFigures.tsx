import { Fragment, ReactNode } from 'react';

const FIGURE_RE = /-?\d[\d,]*(?:\.\d+)?%?/g;
const YEAR_RE = /^(?:19|20)\d{2}$/;
const MONTH_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*$/i;
const MONTH_AFTER_RE = /^\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/** True for numbers that are part of a date or period ("2025", "1 Nov",
 * "Nov 30", "Q4") rather than a figure from the result. */
function isDatePart(figure: string, before: string, after: string): boolean {
  if (YEAR_RE.test(figure)) return true;
  if (/\bq$/i.test(before)) return true;
  return MONTH_RE.test(before) || MONTH_AFTER_RE.test(after);
}

/** Renders text with its figures (counts, totals, percentages) in semibold so
 * an answer can be skimmed by its numbers. Dates and years stay plain. */
export function EmphasizedFigures({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(FIGURE_RE)) {
    const start = match.index ?? 0;
    const figure = match[0];
    const end = start + figure.length;
    if (isDatePart(figure, text.slice(Math.max(0, start - 6), start), text.slice(end, end + 5))) continue;
    parts.push(text.slice(last, start), <strong className="answer-figure" key={start}>{figure}</strong>);
    last = end;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}
