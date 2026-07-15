import type { OnCallConfig } from './types';

const PERIOD_MS: Record<OnCallConfig['cadence'], number> = { daily: 86_400_000, weekly: 7 * 86_400_000 };

/** The rotation index active at `now`, or null if on-call is off/empty/misconfigured. */
function rotationIndex(config: OnCallConfig, now: number): number | null {
  if (!config.enabled || config.rotation.length === 0) return null;
  const anchor = new Date(config.startDate).getTime();
  if (Number.isNaN(anchor)) return null;
  const idx = Math.floor((now - anchor) / PERIOD_MS[config.cadence]);
  const len = config.rotation.length;
  return ((idx % len) + len) % len;
}

/** The agent id on call at `now`, or null. */
export function currentOnCall(config: OnCallConfig, now = Date.now()): string | null {
  const i = rotationIndex(config, now);
  return i === null ? null : config.rotation[i];
}

/** The next `count` shifts as { agentId, startsAt } (the current shift first). */
export function upcomingShifts(config: OnCallConfig, count: number, now = Date.now()): { agentId: string; startsAt: number }[] {
  if (!config.enabled || config.rotation.length === 0) return [];
  const anchor = new Date(config.startDate).getTime();
  if (Number.isNaN(anchor)) return [];
  const period = PERIOD_MS[config.cadence];
  const currentIdx = Math.floor((now - anchor) / period);
  const len = config.rotation.length;
  const out: { agentId: string; startsAt: number }[] = [];
  for (let k = 0; k < count; k++) {
    const idx = currentIdx + k;
    const i = ((idx % len) + len) % len;
    out.push({ agentId: config.rotation[i], startsAt: anchor + idx * period });
  }
  return out;
}
