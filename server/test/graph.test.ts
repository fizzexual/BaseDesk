import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-graph-'))).app;
}

describe('ticket knowledge graph', () => {
  it('level 0 — categories are hubs, sub-categories are leaves, counts add up', async () => {
    const app = makeApp();
    const g = await (await app.request('/api/graph')).json();
    expect(g.level).toBe(0);
    expect(g.total).toBeGreaterThan(0);
    // Taxonomy is a two-level tree; each category's sub-counts sum to its count.
    for (const cat of g.taxonomy) {
      expect(cat.subs.length).toBeGreaterThan(0);
      const sum = cat.subs.reduce((n: number, s: { count: number }) => n + s.count, 0);
      expect(sum).toBe(cat.count);
    }
    expect(g.hubs.every((h: { key: string }) => h.key.startsWith('cat:'))).toBe(true);
    expect(g.leaves.every((l: { kind: string }) => l.kind === 'sub')).toBe(true);
  });

  it('level 1 — drilling into a category yields sub-category hubs and sampled tickets', async () => {
    const app = makeApp();
    const top = (await (await app.request('/api/graph')).json()).taxonomy[0].name as string;
    const g = await (await app.request(`/api/graph?category=${encodeURIComponent(top)}`)).json();
    expect(g.level).toBe(1);
    expect(g.hubs.every((h: { key: string }) => h.key.startsWith(`sub:${top}/`))).toBe(true);
    expect(g.leaves.length).toBeGreaterThan(0);
    expect(g.leaves.every((l: { kind: string; category: string; ticketId?: string }) => l.kind === 'ticket' && l.category === top && typeof l.ticketId === 'string')).toBe(true);
    // Each sub contributes at most the per-sub sample cap.
    const perSub = new Map<string, number>();
    for (const l of g.leaves) perSub.set(l.sub, (perSub.get(l.sub) ?? 0) + 1);
    for (const n of perSub.values()) expect(n).toBeLessThanOrEqual(40);
  });

  it('level 2 — drilling into a sub-category yields only that sub-category’s tickets', async () => {
    const app = makeApp();
    const top = (await (await app.request('/api/graph')).json()).taxonomy[0];
    const catName = top.name as string;
    const subName = top.subs[0].name as string;
    const g = await (await app.request(`/api/graph?category=${encodeURIComponent(catName)}&sub=${encodeURIComponent(subName)}`)).json();
    expect(g.level).toBe(2);
    expect(g.leaves.every((l: { sub: string; kind: string }) => l.sub === subName && l.kind === 'ticket')).toBe(true);
  });

  it('serves a compact hierarchical outline for the AI', async () => {
    const app = makeApp();
    const text = await (await app.request('/api/graph?format=outline')).text();
    expect(text).toMatch(/Ticket map — \d+ tickets, \d+ categories/);
    expect(text).toMatch(/## .+ \(\d+\)/); // category heading
    expect(text).toMatch(/- .+ \(\d+\)/); // sub-category line
    expect(text).toMatch(/Drill: GET/); // navigation hint

    // Drilling into a category+sub lists the actual titles.
    const top = (await (await app.request('/api/graph')).json()).taxonomy[0];
    const drilled = await (await app.request(`/api/graph?format=outline&category=${encodeURIComponent(top.name)}&sub=${encodeURIComponent(top.subs[0].name)}`)).text();
    expect(drilled).toMatch(/#\d+ .+ \[/); // a ticket title with its number + status
  });
});
