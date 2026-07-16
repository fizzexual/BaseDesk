import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { detectLanguage } from '../src/detect-language.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-routing-')));
}
const json = (method: string, body: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
type App = ReturnType<typeof makeApp>['app'];
async function portalToken(app: App, email: string): Promise<string> {
  const reg = await (await app.request('/api/portal/register', json('POST', { name: 'Ada', email, password: 'hunter2!' }))).json();
  return reg.token;
}

describe('language detection', () => {
  it('flags a clear non-English language and ignores English', () => {
    expect(detectLanguage('Hola, necesito ayuda con mi cuenta, no puedo pagar')).toBe('Spanish');
    expect(detectLanguage('Hallo, ich brauche Hilfe mit meinem Konto, kann nicht zahlen')).toBe('German');
    expect(detectLanguage('Hi, I need help with my account, I cannot pay')).toBeNull();
  });
});

describe('language-aware routing', () => {
  it('routes a Spanish ticket to a Spanish-speaking coverer', async () => {
    const { app } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const active = boot.agents.filter((a: { status: string }) => a.status === 'active');
    const [es, other] = active as { id: string }[];

    // Both cover Billing; only `es` speaks Spanish.
    await app.request(`/api/agents/${es.id}`, json('PATCH', { categories: ['Billing'], languages: ['Spanish'] }));
    await app.request(`/api/agents/${other.id}`, json('PATCH', { categories: ['Billing'], languages: [] }));
    await app.request('/api/settings/assignment', json('PUT', { enabled: true, strategy: 'least_busy' }));

    const token = await portalToken(app, 'es@example.com');
    const created = await (await app.request('/api/portal/tickets', json('POST', {
      subject: 'Cobro incorrecto', body: 'Hola, necesito ayuda, no puedo pagar mi cuenta, gracias', category: 'Billing',
    }, token))).json();

    expect(created.ticket.assigneeId).toBe(es.id); // routed to the Spanish speaker
  });

  it('falls back to a category coverer when nobody speaks the language', async () => {
    const { app } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const [only] = boot.agents.filter((a: { status: string }) => a.status === 'active') as { id: string }[];
    await app.request(`/api/agents/${only.id}`, json('PATCH', { categories: ['Billing'], languages: [] }));
    await app.request('/api/settings/assignment', json('PUT', { enabled: true, strategy: 'least_busy' }));
    const token = await portalToken(app, 'es2@example.com');
    const created = await (await app.request('/api/portal/tickets', json('POST', {
      subject: 'Cobro', body: 'Hola, necesito ayuda, no puedo pagar, gracias', category: 'Billing',
    }, token))).json();
    expect(created.ticket.assigneeId).toBe(only.id); // language had no speaker → category coverer still wins
  });
});
