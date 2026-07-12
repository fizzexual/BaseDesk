import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-ai-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** A stand-in OpenAI-compatible provider. `handler` shapes each response. */
let mock: Server | null = null;
function mockProvider(handler: (body: { messages: { role: string; content: string }[] }) => { status?: number; json: unknown }): Promise<string> {
  return new Promise((resolve) => {
    mock = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const out = handler(JSON.parse(data || '{}'));
        res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.json));
      });
    });
    mock.listen(0, '127.0.0.1', () => {
      const addr = mock!.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}/v1`);
    });
  });
}
const completion = (content: string) => ({ json: { choices: [{ message: { content } }] } });

afterEach(() => {
  mock?.close();
  mock = null;
});

async function firstTicketId(app: ReturnType<typeof makeApp>): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.tickets[0].id as string;
}

describe('provider config', () => {
  it('defaults to disabled with DeepSeek prefilled and no key', async () => {
    const app = makeApp();
    const p = await (await app.request('/api/ai/provider')).json();
    expect(p.enabled).toBe(false);
    expect(p.hasKey).toBe(false);
    expect(p.model).toBe('deepseek-chat');
    expect('apiKey' in p).toBe(false); // the key is never sent to the client
  });

  it('stores a key, masks it, and keeps it when omitted on a later save', async () => {
    const app = makeApp();
    const saved = await (await app.request('/api/ai/provider', json('PUT', {
      enabled: true, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-secret',
    }))).json();
    expect(saved.hasKey).toBe(true);
    expect('apiKey' in saved).toBe(false);

    // A save without apiKey must keep the stored key.
    const again = await (await app.request('/api/ai/provider', json('PUT', { model: 'deepseek-reasoner' }))).json();
    expect(again.hasKey).toBe(true);
    expect(again.model).toBe('deepseek-reasoner');

    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.aiProvider.hasKey).toBe(true);
    expect('apiKey' in boot.aiProvider).toBe(false);
  });

  it('clears the key when apiKey is an empty string', async () => {
    const app = makeApp();
    await app.request('/api/ai/provider', json('PUT', { enabled: true, apiKey: 'sk-secret' }));
    const cleared = await (await app.request('/api/ai/provider', json('PUT', { apiKey: '' }))).json();
    expect(cleared.hasKey).toBe(false);
  });
});

describe('copilot fallback (no provider)', () => {
  it('draft, triage, and summarize return rule-based results', async () => {
    const app = makeApp();
    const ticketId = await firstTicketId(app);
    const draft = await (await app.request('/api/ai/draft', json('POST', { ticketId }))).json();
    expect(draft.source).toBe('rules');
    expect(typeof draft.body).toBe('string');
    expect(draft.body.length).toBeGreaterThan(0);

    const triage = await (await app.request('/api/ai/triage', json('POST', { ticketId }))).json();
    expect(triage.source).toBe('rules');

    const summary = await (await app.request('/api/ai/summarize', json('POST', { ticketId }))).json();
    expect(summary.source).toBe('rules');
    expect(summary.summary.length).toBeGreaterThan(0);
  });
});

describe('copilot with a model provider', () => {
  it('drafts through the provider', async () => {
    const app = makeApp();
    const ticketId = await firstTicketId(app);
    const url = await mockProvider(() => completion('Hi there — the model wrote this reply.'));
    await app.request('/api/ai/provider', json('PUT', { enabled: true, baseUrl: url, model: 'm', apiKey: 'k' }));

    const draft = await (await app.request('/api/ai/draft', json('POST', { ticketId }))).json();
    expect(draft.source).toBe('model');
    expect(draft.body).toBe('Hi there — the model wrote this reply.');
  });

  it('clamps model triage to raise-only, deduped tags', async () => {
    const app = makeApp();
    const { ticket } = await (await app.request('/api/tickets', json('POST', {
      subject: 'Plan question', body: 'How do I upgrade my plan tier for more seats?',
      requesterId: (await (await app.request('/api/bootstrap')).json()).contacts[0].id, priority: 'high',
    }))).json();
    // Model wants to LOWER priority (must be ignored) and returns a duplicate tag.
    const url = await mockProvider(() => completion('{"priority":"low","tags":["billing","billing","api"],"reason":"plan change"}'));
    await app.request('/api/ai/provider', json('PUT', { enabled: true, baseUrl: url, model: 'm', apiKey: 'k' }));

    const triage = await (await app.request('/api/ai/triage', json('POST', { ticketId: ticket.id }))).json();
    expect(triage.source).toBe('model');
    expect(triage.priority).toBeNull(); // low < high, never lower
    expect(triage.tags).toEqual(['billing', 'api']); // deduped, order preserved
  });

  it('falls back to rules when the provider errors', async () => {
    const app = makeApp();
    const ticketId = await firstTicketId(app);
    const url = await mockProvider(() => ({ status: 500, json: { error: { message: 'boom' } } }));
    await app.request('/api/ai/provider', json('PUT', { enabled: true, baseUrl: url, model: 'm', apiKey: 'k' }));

    const draft = await (await app.request('/api/ai/draft', json('POST', { ticketId }))).json();
    expect(draft.source).toBe('rules');
  });

  it('falls back to rules when the model returns empty text', async () => {
    const app = makeApp();
    const ticketId = await firstTicketId(app);
    const url = await mockProvider(() => ({ json: { choices: [{ message: { content: '' } }] } }));
    await app.request('/api/ai/provider', json('PUT', { enabled: true, baseUrl: url, model: 'm', apiKey: 'k' }));

    const draft = await (await app.request('/api/ai/draft', json('POST', { ticketId }))).json();
    expect(draft.source).toBe('rules');
  });

  it('reads reasoning_content when a reasoning model leaves content empty', async () => {
    const app = makeApp();
    const ticketId = await firstTicketId(app);
    const url = await mockProvider(() => ({ json: { choices: [{ message: { content: '', reasoning_content: 'Reasoned reply.' } }] } }));
    await app.request('/api/ai/provider', json('PUT', { enabled: true, baseUrl: url, model: 'm', apiKey: 'k' }));

    const draft = await (await app.request('/api/ai/draft', json('POST', { ticketId }))).json();
    expect(draft.source).toBe('model');
    expect(draft.body).toBe('Reasoned reply.');
  });
});

describe('test connection', () => {
  it('reports failure with no key', async () => {
    const app = makeApp();
    const noKey = await app.request('/api/ai/provider/test', json('POST', {}));
    expect(noKey.status).toBe(400);
  });

  it('succeeds against a live provider', async () => {
    const app = makeApp();
    const url = await mockProvider(() => completion('ok'));
    const ok = await (await app.request('/api/ai/provider/test', json('POST', { baseUrl: url, model: 'm', apiKey: 'k' }))).json();
    expect(ok.ok).toBe(true);
    expect(ok.model).toBe('m');
    expect(ok.empty).toBe(false);
  });

  it('tolerates a reasoning model that returns no visible text', async () => {
    const app = makeApp();
    const url = await mockProvider(() => ({ json: { choices: [{ message: { content: '' } }] } }));
    const res = await (await app.request('/api/ai/provider/test', json('POST', { baseUrl: url, model: 'm', apiKey: 'k' }))).json();
    expect(res.ok).toBe(true);
    expect(res.empty).toBe(true);
  });

  it('fails when the provider returns no chat completion', async () => {
    const app = makeApp();
    const url = await mockProvider(() => ({ json: { id: 'x', choices: [] } }));
    const res = await (await app.request('/api/ai/provider/test', json('POST', { baseUrl: url, model: 'm', apiKey: 'k' }))).json();
    expect(res.ok).toBe(false);
  });
});
