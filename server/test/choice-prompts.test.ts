import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-choice-'))).app;
}
type App = ReturnType<typeof makeApp>;
const json = (method: string, body: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

/** A registered customer with an open ticket they can be prompted on. */
async function customerTicket(app: App) {
  const reg = await (await app.request('/api/portal/register', json('POST', { name: 'Dana Lux', email: 'dana@acme.com', password: 'sup3rsecret' }))).json();
  const t = await (await app.request('/api/portal/tickets', json('POST', { subject: 'Need help', body: 'hello' }, reg.token))).json();
  return { token: reg.token as string, ticketId: t.ticket.id as string };
}

const PROMPT = {
  type: 'choice_prompt',
  question: 'Which refund method?',
  layout: 'buttons',
  options: [{ id: 'x1', label: 'Original payment' }, { id: 'x2', label: 'Store credit' }],
};

async function askChoice(app: App, ticketId: string) {
  const { message } = await (await app.request(`/api/tickets/${ticketId}/messages`, json('POST', {
    kind: 'reply', body: 'Please choose:', embeds: [PROMPT],
  }))).json();
  return message;
}

describe('choice prompts', () => {
  it('stores an agent choice prompt with server-assigned option ids and no answer', async () => {
    const app = makeApp();
    const { ticketId } = await customerTicket(app);
    const message = await askChoice(app, ticketId);
    expect(message.embeds[0]).toMatchObject({ type: 'choice_prompt', question: 'Which refund method?', layout: 'buttons' });
    expect(message.embeds[0].options).toEqual([
      { id: 'o1', label: 'Original payment' },
      { id: 'o2', label: 'Store credit' },
    ]);
    expect(message.embeds[0].answer ?? null).toBeNull();
  });

  it('drops a half-built prompt (no question / no options)', async () => {
    const app = makeApp();
    const { ticketId } = await customerTicket(app);
    const { message } = await (await app.request(`/api/tickets/${ticketId}/messages`, json('POST', {
      kind: 'reply', body: 'hi', embeds: [{ type: 'choice_prompt', question: '', layout: 'buttons', options: [] }],
    }))).json();
    expect(message.embeds).toBeUndefined();
  });

  it('lets the customer answer: locks the prompt and posts the pick as a reply', async () => {
    const app = makeApp();
    const { token, ticketId } = await customerTicket(app);
    const mid = (await askChoice(app, ticketId)).id;

    const res = await app.request(`/api/portal/tickets/${ticketId}/messages/${mid}/answer`, json('POST', { optionIds: ['o1'] }, token));
    expect(res.status).toBe(200);

    const thread = await (await app.request(`/api/portal/tickets/${ticketId}`, auth(token))).json();
    const prompt = thread.messages.find((m: { id: string }) => m.id === mid);
    expect(prompt.embeds[0].answer.optionIds).toEqual(['o1']);
    const reply = thread.messages.find((m: { authorKind: string; body: string }) => m.authorKind === 'contact' && m.body === 'Original payment');
    expect(reply).toBeTruthy();

    // Answering again is rejected — the prompt is locked.
    expect((await app.request(`/api/portal/tickets/${ticketId}/messages/${mid}/answer`, json('POST', { optionIds: ['o2'] }, token))).status).toBe(409);
  });

  it('rejects an invalid option id and blocks a foreign customer', async () => {
    const app = makeApp();
    const { token, ticketId } = await customerTicket(app);
    const mid = (await askChoice(app, ticketId)).id;
    expect((await app.request(`/api/portal/tickets/${ticketId}/messages/${mid}/answer`, json('POST', { optionIds: ['nope'] }, token))).status).toBe(400);

    const intruder = await (await app.request('/api/portal/register', json('POST', { name: 'Mal', email: 'mal@x.com', password: 'passwordlong' }))).json();
    expect((await app.request(`/api/portal/tickets/${ticketId}/messages/${mid}/answer`, json('POST', { optionIds: ['o1'] }, intruder.token))).status).toBe(404);
  });

  it('answering twice at once records exactly one answer and one reply', async () => {
    const app = makeApp();
    const { token, ticketId } = await customerTicket(app);
    const mid = (await askChoice(app, ticketId)).id;
    // Two concurrent answers (e.g. the customer double-taps / two tabs): exactly one wins.
    const [a, b] = await Promise.all([
      app.request(`/api/portal/tickets/${ticketId}/messages/${mid}/answer`, json('POST', { optionIds: ['o1'] }, token)),
      app.request(`/api/portal/tickets/${ticketId}/messages/${mid}/answer`, json('POST', { optionIds: ['o1'] }, token)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const thread = await (await app.request(`/api/portal/tickets/${ticketId}`, auth(token))).json();
    const replies = thread.messages.filter((m: { authorKind: string; body: string }) => m.authorKind === 'contact' && m.body === 'Original payment');
    expect(replies.length).toBe(1);
  });
});
