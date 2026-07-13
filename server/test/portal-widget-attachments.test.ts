import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { getMessages } from '../src/db.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-pwa-')));
}
const json = (method: string, body: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
type App = ReturnType<typeof makeApp>['app'];

async function upload(app: App, name: string, type: string, bytes: string) {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return (await app.request('/api/uploads', { method: 'POST', body: form })).json();
}
async function token(app: App): Promise<string> {
  const reg = await (await app.request('/api/portal/register', json('POST', { name: 'Dana', email: 'dana@acme.com', password: 'sup3rsecret' }))).json();
  return reg.token as string;
}

describe('portal attachments', () => {
  it('attaches a file to a new portal ticket and returns it in the thread', async () => {
    const { app } = makeApp();
    const t = await token(app);
    const att = await upload(app, 'invoice.pdf', 'application/pdf', 'PDF');
    const { ticket } = await (await app.request('/api/portal/tickets', json('POST', {
      subject: 'Bad invoice', body: 'See attached', priority: 'high', attachmentIds: [att.id],
    }, t))).json();

    const detail = await (await app.request(`/api/portal/tickets/${ticket.id}`, { headers: { authorization: `Bearer ${t}` } })).json();
    expect(detail.messages[0].attachments).toHaveLength(1);
    expect(detail.messages[0].attachments[0].filename).toBe('invoice.pdf');
  });

  it('allows an attachment-only portal reply', async () => {
    const { app } = makeApp();
    const t = await token(app);
    const { ticket } = await (await app.request('/api/portal/tickets', json('POST', { subject: 'Q', body: 'hi', priority: 'low' }, t))).json();
    const att = await upload(app, 'shot.png', 'image/png', 'IMG');

    const ok = await app.request(`/api/portal/tickets/${ticket.id}/messages`, json('POST', { body: '', attachmentIds: [att.id] }, t));
    expect(ok.status).toBe(200);
    const bad = await app.request(`/api/portal/tickets/${ticket.id}/messages`, json('POST', { body: '' }, t));
    expect(bad.status).toBe(400);

    const detail = await (await app.request(`/api/portal/tickets/${ticket.id}`, { headers: { authorization: `Bearer ${t}` } })).json();
    expect(detail.messages.some((m: { attachments: unknown[] }) => m.attachments.length === 1)).toBe(true);
  });
});

describe('widget / channel-inbound attachments', () => {
  it('links an attachment sent through the inbound webhook', async () => {
    const { app, db } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const chat = boot.channels.find((ch: { type: string }) => ch.type === 'webchat');
    const token = 'tok_webchat_3f9a2c81'; // seed webchat token
    const att = await upload(app, 'photo.png', 'image/png', 'IMG');

    const res = await (await app.request(`/api/channels/${chat.id}/inbound?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: { email: 'wc@example.com' }, body: 'here it is', attachmentIds: [att.id] }),
    })).json();

    const msgs = getMessages(db, res.ticketId);
    const withFile = msgs.find((m) => (m.attachments ?? []).length > 0);
    expect(withFile).toBeDefined();
    expect(withFile?.attachments?.[0].filename).toBe('photo.png');
  });

  it('thread endpoint returns public replies with attachments, never internal notes', async () => {
    const { app } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const chat = boot.channels.find((ch: { type: string }) => ch.type === 'webchat');
    const token = 'tok_webchat_3f9a2c81';
    // Open a widget conversation.
    const res = await (await app.request(`/api/channels/${chat.id}/inbound?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: { email: 'wc2@example.com' }, body: 'hello' }),
    })).json();
    // An agent adds an internal note — it must not surface to the widget.
    await app.request(`/api/tickets/${res.ticketId}/messages`, json('POST', { kind: 'note', body: 'secret internal note' }));

    const thread = await (await app.request(`/api/channels/${chat.id}/thread?token=${token}&contact=wc2@example.com`)).json();
    expect(thread.every((m: { body: string }) => m.body !== 'secret internal note')).toBe(true);
    expect(thread.every((m: { attachments: unknown }) => Array.isArray(m.attachments))).toBe(true);
  });
});
