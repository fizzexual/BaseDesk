import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { linearForecast } from '../src/stats.js';

describe('forecast', () => {
  it('projects a flat trend flat', () => {
    expect(linearForecast([5, 5, 5, 5], 3)).toEqual([5, 5, 5]);
  });
  it('projects a rising trend upward', () => {
    expect(linearForecast([1, 2, 3, 4], 2)).toEqual([5, 6]);
  });
  it('clamps a falling trend at zero (never negative)', () => {
    expect(linearForecast([4, 3, 2, 1], 3)).toEqual([0, 0, 0]);
  });
  it('handles an empty series', () => {
    expect(linearForecast([], 3)).toEqual([0, 0, 0]);
  });

  it('exposes a 7-day forecast of future dates via /api/stats', async () => {
    const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-forecast-')));
    const stats = await (await app.request('/api/stats')).json();
    const fc = stats.forecastNext7Days as { date: string; count: number }[];
    expect(fc).toHaveLength(7);
    const today = new Date().toISOString().slice(0, 10);
    expect(fc.every((p) => p.date > today && typeof p.count === 'number' && p.count >= 0)).toBe(true);
    // Dates are consecutive and ascending.
    for (let i = 1; i < fc.length; i++) expect(fc[i].date > fc[i - 1].date).toBe(true);
  });
});
