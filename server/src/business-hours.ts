import type { BusinessHours, DayHours } from './types.js';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(tz: string): boolean {
  if (tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function normDay(d: unknown): DayHours | null {
  if (d === null || typeof d !== 'object') return null;
  const { open, close } = d as { open?: unknown; close?: unknown };
  if (typeof open !== 'string' || typeof close !== 'string' || !HM.test(open) || !HM.test(close)) return null;
  return open < close ? { open, close } : null; // drop inverted/empty windows
}

/** Coerce untrusted input into a well-formed BusinessHours (always 7 days). */
export function normalizeBusinessHours(raw: unknown, fallback: BusinessHours): BusinessHours {
  const r = (raw ?? {}) as Record<string, unknown>;
  const days: (DayHours | null)[] = Array.isArray(r.days)
    ? Array.from({ length: 7 }, (_, i) => normDay((r.days as unknown[])[i]))
    : fallback.days.map((d) => (d ? { ...d } : null));
  return {
    enabled: r.enabled === true,
    // An unknown zone used to be stored as typed and then throw a RangeError on the next
    // inbound ticket (after it was inserted), so customers retried and made duplicates.
    timezone: typeof r.timezone === 'string' && isValidTimeZone(r.timezone.trim()) ? r.timezone.trim() : fallback.timezone,
    message: typeof r.message === 'string' && r.message.trim() !== '' ? r.message : fallback.message,
    days,
  };
}

// Opening-hours math, kept dependency-free (Intl only) and pure so it unit-tests
// cleanly. Days are indexed 0 = Sunday .. 6 = Saturday to match Date.getDay().

/** tz-local day-of-week (0=Sun) and minutes-since-midnight for an instant. */
export function tzParts(ms: number, timezone: string): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hh = (parseInt(get('hour'), 10) || 0) % 24; // some environments render midnight as "24"
  const mm = parseInt(get('minute'), 10) || 0;
  return { dow: DOW[get('weekday')] ?? 0, minutes: hh * 60 + mm };
}

function parseHM(s: string): number {
  const [h, m] = String(s).split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

/** True when `ms` falls inside the configured open window for its tz-local day.
 *  Hours disabled ⇒ always "open" (nothing auto-fires). */
export function isOpenNow(bh: BusinessHours, ms: number): boolean {
  if (!bh.enabled) return true;
  const { dow, minutes } = tzParts(ms, bh.timezone);
  const day = bh.days[dow];
  if (!day) return false;
  return parseHM(day.open) <= minutes && minutes < parseHM(day.close);
}

/** ISO instant the desk next reopens, searching up to a week out; null if never. */
export function nextOpenIso(bh: BusinessHours, ms: number): string | null {
  for (let off = 0; off <= 7; off++) {
    const probe = ms + off * 86_400_000;
    const { dow, minutes: curMin } = tzParts(probe, bh.timezone);
    const day = bh.days[dow];
    if (!day) continue;
    // Shift the probe so its tz-local clock lands on this day's opening minute.
    // (Ignores the rare DST change between the two moments — close enough for a countdown.)
    const openInstant = probe + (parseHM(day.open) - curMin) * 60_000;
    if (openInstant > ms) return new Date(openInstant).toISOString();
  }
  return null;
}
