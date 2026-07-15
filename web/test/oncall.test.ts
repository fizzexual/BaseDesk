import { describe, expect, it } from 'vitest';
import { currentOnCall, upcomingShifts } from '../src/data/oncall';
import type { OnCallConfig } from '../src/data/types';

const anchor = Date.parse('2024-01-01T00:00:00.000Z'); // a Monday
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const base: OnCallConfig = { enabled: true, cadence: 'weekly', startDate: '2024-01-01T00:00:00.000Z', rotation: ['a', 'b', 'c'] };

describe('on-call rotation math', () => {
  it('returns null when disabled or empty', () => {
    expect(currentOnCall({ ...base, enabled: false }, anchor)).toBeNull();
    expect(currentOnCall({ ...base, rotation: [] }, anchor)).toBeNull();
  });

  it('rotates weekly through the roster and wraps', () => {
    expect(currentOnCall(base, anchor)).toBe('a');
    expect(currentOnCall(base, anchor + WEEK)).toBe('b');
    expect(currentOnCall(base, anchor + 2 * WEEK)).toBe('c');
    expect(currentOnCall(base, anchor + 3 * WEEK)).toBe('a'); // wraps around
    expect(currentOnCall(base, anchor + WEEK + DAY)).toBe('b'); // holds mid-week
  });

  it('rotates daily when cadence is daily', () => {
    const daily: OnCallConfig = { ...base, cadence: 'daily' };
    expect(currentOnCall(daily, anchor)).toBe('a');
    expect(currentOnCall(daily, anchor + DAY)).toBe('b');
    expect(currentOnCall(daily, anchor + 3 * DAY)).toBe('a');
  });

  it('lists upcoming shifts starting with the current one', () => {
    const up = upcomingShifts(base, 4, anchor + WEEK); // current shift = b
    expect(up.map((s) => s.agentId)).toEqual(['b', 'c', 'a', 'b']);
    expect(up[0].startsAt).toBe(anchor + WEEK);
    expect(up[1].startsAt).toBe(anchor + 2 * WEEK);
  });

  it('handles times before the anchor without crashing', () => {
    expect(currentOnCall(base, anchor - WEEK)).toBe('c'); // -1 mod 3 → index 2
  });
});
