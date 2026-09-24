import { describe, expect, it } from 'vitest';

import {
  monthRange,
  monthsBetween,
  previousMonthRange,
  roundCurrency,
  startOfMonth,
  startOfNextMonth,
  toIsoDate,
  trailingDays,
} from './dates';

describe('monthRange', () => {
  it('spans the calendar month with an exclusive end, matching Cost Explorer', () => {
    expect(monthRange(new Date('2026-03-15T12:00:00.000Z'))).toEqual({
      startDate: '2026-03-01',
      endDate: '2026-04-01',
    });
  });

  it('handles December without rolling the year incorrectly', () => {
    expect(startOfNextMonth(new Date('2026-12-31T23:00:00.000Z'))).toBe('2027-01-01');
  });

  it('handles a leap-year February', () => {
    expect(monthRange(new Date('2028-02-10T00:00:00.000Z'))).toEqual({
      startDate: '2028-02-01',
      endDate: '2028-03-01',
    });
  });
});

describe('previousMonthRange', () => {
  it('returns the month before the given date', () => {
    expect(previousMonthRange(new Date('2026-01-15T00:00:00.000Z'))).toEqual({
      startDate: '2025-12-01',
      endDate: '2026-01-01',
    });
  });
});

describe('trailingDays', () => {
  it('ends tomorrow so today is fully included', () => {
    expect(trailingDays(7, new Date('2026-03-10T08:00:00.000Z'))).toEqual({
      startDate: '2026-03-04',
      endDate: '2026-03-11',
    });
  });
});

describe('helpers', () => {
  it('formats UTC dates without local-time drift', () => {
    expect(toIsoDate(new Date('2026-03-01T23:30:00.000Z'))).toBe('2026-03-01');
    expect(startOfMonth(new Date('2026-03-31T23:30:00.000Z'))).toBe('2026-03-01');
  });

  it('counts whole months between dates', () => {
    expect(monthsBetween(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-04-01T00:00:00.000Z'))).toBe(3);
    expect(monthsBetween(new Date('2026-04-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'))).toBe(-3);
  });

  it('rounds currency to cents to avoid float noise in JSON payloads', () => {
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
    expect(roundCurrency(1234.5678)).toBe(1234.57);
  });
});
