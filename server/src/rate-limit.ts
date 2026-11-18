// A fixed-window rate limiter for the credential endpoints.
//
// In-memory on purpose: BaseDesk is one process with one SQLite file, so there is no
// second node to share state with, and reaching for Redis would contradict the whole
// deployment story. Counters reset if the process restarts — acceptable for slowing
// credential stuffing, since the value lost is bounded by the window length.

export interface RateLimitResult {
  /** False when the caller has exhausted its allowance for the current window. */
  ok: boolean;
  /** Attempts left after this one. */
  remaining: number;
  /** Seconds until the window resets — the value for a Retry-After header. */
  retryAfter: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Count one attempt against `key` and report whether it is allowed.
   *
   * Callers should key on client address *and* route, so a burst against sign-in
   * cannot exhaust an unrelated endpoint's budget for that same address.
   */
  check(key: string, now: number): RateLimitResult {
    this.sweep(now);
    const win = this.hits.get(key);
    if (win === undefined || now >= win.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true, remaining: this.limit - 1, retryAfter: 0 };
    }
    win.count += 1;
    const retryAfter = Math.max(1, Math.ceil((win.resetAt - now) / 1000));
    return win.count > this.limit
      ? { ok: false, remaining: 0, retryAfter }
      : { ok: true, remaining: this.limit - win.count, retryAfter: 0 };
  }

  /** Forget a caller's history — called after a success, so one typo is not punished. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /**
   * Drop expired windows. Without this the map grows once per distinct address and
   * never shrinks, which on a public endpoint is a slow way to exhaust the box.
   */
  private sweep(now: number): void {
    for (const [k, w] of this.hits) if (now >= w.resetAt) this.hits.delete(k);
  }
}
