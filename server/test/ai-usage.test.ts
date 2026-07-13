import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-usage-'))).app;
}
const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let mock: Server | null = null;
function mockProvider(usage: { prompt_tokens: number; completion_tokens: number }): Promise<string> {
  return new Promise((resolve) => {
    mock = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'Here is a reply from the model.' } }], usage }));
      });
    });
    mock.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(mock!.address() as { port: number }).port}/v1`));
  });
}
afterEach(() => {
  mock?.close();
  mock = null;
});
const usageOf = async (app: ReturnType<typeof makeApp>) => (await (await app.request('/api/bootstrap')).json()).aiUsage;

describe('AI usage ledger', () => {
  it('records interactive draft token usage — the bug that undercounted spend', async () => {
    const app = makeApp();
    const base = await mockProvider({ prompt_tokens: 1200, completion_tokens: 150 });
    await app.request('/api/ai/provider', json('PUT', { enabled: true, baseUrl: base, model: 'm', apiKey: 'sk-test' }));

    const before = await usageOf(app);
    const tid = (await (await app.request('/api/bootstrap')).json()).tickets[0].id;
    const r = await (await app.request('/api/ai/draft', json('POST', { ticketId: tid }))).json();
    expect(r.source).toBe('model');
    expect(r.usage).toEqual({ promptTokens: 1200, completionTokens: 150 });

    const after = await usageOf(app);
    expect(after.promptTokens - before.promptTokens).toBe(1200);
    expect(after.completionTokens - before.completionTokens).toBe(150);
    expect(after.generations - before.generations).toBe(1);
  });

  it('also records summarize + triage calls', async () => {
    const app = makeApp();
    const base = await mockProvider({ prompt_tokens: 800, completion_tokens: 60 });
    await app.request('/api/ai/provider', json('PUT', { enabled: true, baseUrl: base, model: 'm', apiKey: 'sk-test' }));
    const tid = (await (await app.request('/api/bootstrap')).json()).tickets[0].id;

    const before = await usageOf(app);
    await app.request('/api/ai/summarize', json('POST', { ticketId: tid }));
    const after = await usageOf(app);
    expect(after.promptTokens - before.promptTokens).toBe(800);
    expect(after.generations - before.generations).toBe(1);
  });

  it('does not record the free rule-based path (no provider)', async () => {
    const app = makeApp();
    const before = await usageOf(app);
    const tid = (await (await app.request('/api/bootstrap')).json()).tickets[0].id;
    const r = await (await app.request('/api/ai/draft', json('POST', { ticketId: tid }))).json();
    expect(r.source).toBe('rules');
    expect(await usageOf(app)).toEqual(before); // unchanged — rules are free
  });

  it('seeds the ledger from seeded AI actions', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const sumActions = boot.aiActions.reduce((n: number, a: { promptTokens: number; completionTokens: number }) => n + a.promptTokens + a.completionTokens, 0);
    expect(boot.aiUsage.promptTokens + boot.aiUsage.completionTokens).toBe(sumActions);
    expect(boot.aiUsage.generations).toBeGreaterThan(0);
  });
});
