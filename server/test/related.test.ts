import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { findRelated, type RelatedRow } from '../src/related.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-related-')));
}
const row = (id: string, number: number, subject: string, category: string, requesterId = 'c_1'): RelatedRow =>
  ({ id, number, subject, status: 'open', category, requesterId });

describe('related tickets', () => {
  it('only compares inside the ticket’s own branch, not the whole table', async () => {
    const { app, db } = makeApp();
    const t = db.prepare("SELECT id FROM tickets WHERE category = 'Billing' AND mergedIntoId IS NULL AND bucket = 'inbox' LIMIT 1").get() as { id: string };
    const r = await (await app.request(`/api/tickets/${t.id}/related`)).json();

    expect(r.ticket.category).toBe('Billing');
    expect(typeof r.ticket.sub).toBe('string');
    // The whole point: the search space is a branch, far smaller than the desk.
    expect(r.scope.compared).toBeLessThan(r.scope.totalActive);
    expect(r.scope.totalActive).toBeGreaterThan(1000);
    expect(r.scope.branch).toContain('Billing →');
    // Titles only — never message bodies.
    for (const m of r.related) {
      expect(typeof m.title).toBe('string');
      expect(m).not.toHaveProperty('body');
    }
  });

  it('404s an unknown ticket', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/tickets/nope/related')).status).toBe(404);
  });

  it('serves a compact text answer for the AI', async () => {
    const { app, db } = makeApp();
    const t = db.prepare("SELECT id FROM tickets WHERE mergedIntoId IS NULL AND bucket = 'inbox' LIMIT 1").get() as { id: string };
    const text = await (await app.request(`/api/tickets/${t.id}/related?format=outline`)).text();
    expect(text).toMatch(/^#\d+ .+ — .+ → .+/); // header: ticket + its branch
    expect(text).toMatch(/Searched \d+ tickets in that .+ — \d+ active in total/);
  });

  it('surfaces a near-duplicate from the same customer and ranks it top', () => {
    const pool: RelatedRow[] = [
      row('t_dup', 2, 'Refund for order 49011 never arrived', 'Billing', 'c_1'),
      row('t_other', 3, 'Delivery window passed for order 12', 'Billing', 'c_9'),
      // A near-identical subject in a *different* category must not be reachable.
      row('t_wrong_branch', 4, 'Refund for order 49011 never arrived', 'Shipping', 'c_1'),
    ];
    const current = row('t_cur', 1, 'Refund for order 49011 never arrived', 'Billing', 'c_1');
    const found = findRelated(current, pool);
    expect(found.matches[0].id).toBe('t_dup');
    expect(found.matches[0].sameRequester).toBe(true);
    expect(found.matches.some((m) => m.id === 't_wrong_branch')).toBe(false);
  });

  it('widens to the category when the sub-category branch is too thin', () => {
    const pool: RelatedRow[] = [row('t_a', 2, 'Delivery window passed for order 12', 'Shipping', 'c_2')];
    const current = row('t_cur', 1, 'Refund for order 49011 never arrived', 'Shipping', 'c_1');
    const found = findRelated(current, pool);
    expect(found.scope).toBe('category'); // one sibling is not a branch worth trusting
    expect(found.compared).toBe(1);
  });
});
