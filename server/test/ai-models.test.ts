import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, refreshModelCache } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-models-'))).app;
}
function makeAppFull() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-models-')));
}
const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let mock: Server | null = null;
/** A stand-in provider whose GET /models lists the given ids (OpenAI shape), or
 *  returns `status` when it's not 200 (to exercise 401/etc. handling). */
function mockModelsServer(ids: string[], status = 200): Promise<string> {
  return new Promise((resolve) => {
    mock = createServer((req, res) => {
      if (req.url?.endsWith('/models')) {
        if (status !== 200) {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'nope' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    mock.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(mock!.address() as { port: number }).port}/v1`));
  });
}
afterEach(() => {
  mock?.close();
  mock = null;
});

describe('live model list', () => {
  it('lists (deduped, sorted) whatever the provider currently offers', async () => {
    const app = makeApp();
    const base = await mockModelsServer(['deepseek-reasoner', 'deepseek-chat', 'deepseek-v4-flash', 'deepseek-chat']);
    const r = await (await app.request('/api/ai/models', json('POST', { baseUrl: base, apiKey: 'sk-test' }))).json();
    expect(r.models).toEqual(['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash']); // a new model shows up automatically
    expect(r.error).toBeUndefined();
  });

  it('returns an error field (never throws) when the provider is unreachable', async () => {
    const app = makeApp();
    const r = await (await app.request('/api/ai/models', json('POST', { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'x' }))).json();
    expect(typeof r.error).toBe('string');
    expect(r.models).toBeUndefined();
  });

  it('asks for a key before making a doomed unauthenticated request', async () => {
    const app = makeApp();
    // Stored config defaults to the DeepSeek URL with no key → guard, no network call.
    const r = await (await app.request('/api/ai/models', json('POST', {}))).json();
    expect(r.error).toMatch(/API key/i);
    expect(r.models).toBeUndefined();
  });

  it('turns a 401 into an actionable message about the key', async () => {
    const app = makeApp();
    const base = await mockModelsServer([], 401);
    const r = await (await app.request('/api/ai/models', json('POST', { baseUrl: base, apiKey: 'sk-bad' }))).json();
    expect(r.error).toMatch(/401/);
    expect(r.error).toMatch(/key/i);
  });
});

describe('model addresser (boot/daily refresh)', () => {
  it('ships no cache for a fresh, unconfigured install', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.availableModels).toBeNull(); // never reaches out without a configured provider
  });

  it('caches the provider model list and ships it in bootstrap', async () => {
    const { app, db } = makeAppFull();
    const base = await mockModelsServer(['deepseek-chat', 'deepseek-v4-flash']);
    await app.request('/api/ai/provider', json('PUT', { enabled: true, baseUrl: base, model: 'deepseek-chat', apiKey: 'sk-test' }));
    await refreshModelCache(db); // the daily/boot job

    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.availableModels.baseUrl).toBe(base);
    expect(boot.availableModels.models).toContain('deepseek-v4-flash');
    expect(typeof boot.availableModels.fetchedAt).toBe('string');
  });
});
