/**
 * Date helpers for cost windows. Pure functions so both the API's cost refresh
 * job and the web charts compute identical boundaries.
 *
 * All dates are handled as UTC `YYYY-MM-DD` strings because that is what Cost
 * Explorer accepts, and mixing local time with CE semantics silently shifts
 * spend between months.
 */

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Inclusive start of the month containing `date`, as `YYYY-MM-DD`. */
export function startOfMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Exclusive end of the month containing `date`. Cost Explorer treats `End` as
 * exclusive, so this is the first day of the next month.
 */
export function startOfNextMonth(date: Date): string {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return toIsoDate(next);
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** The full calendar month containing `date`. */
export function monthRange(date: Date): DateRange {
  return { startDate: startOfMonth(date), endDate: startOfNextMonth(date) };
}

/** The previous calendar month, for month-over-month comparisons. */
export function previousMonthRange(date: Date): DateRange {
  const previous = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return monthRange(previous);
}

/** Last `days` days ending tomorrow (exclusive end), clamped to today. */
export function trailingDays(days: number, now = new Date()): DateRange {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
}

export function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

/** Rounds to cents — avoids `0.30000000000000004` in JSON payloads. */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
