import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-att-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function upload(app: ReturnType<typeof makeApp>, name: string, type: string, bytes: string) {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return (await app.request('/api/uploads', { method: 'POST', body: form })).json();
}
async function firstTicketId(app: ReturnType<typeof makeApp>): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.tickets[0].id;
}

describe('attachment upload + link', () => {
  it('uploads a file and returns its metadata, unlinked', async () => {
    const app = makeApp();
    const att = await upload(app, 'notes.txt', 'text/plain', 'hello world');
    expect(att.id).toMatch(/^at_/);
    expect(att.filename).toBe('notes.txt');
    expect(att.mimeType).toBe('text/plain');
    expect(att.size).toBe(11);
    expect(att.messageId).toBeNull();
  });

  it('links an upload to a reply and returns it in the thread', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const att = await upload(app, 'screenshot.png', 'image/png', 'PNGDATA');

    const { message } = await (await app.request(`/api/tickets/${id}/messages`, json('POST', {
      kind: 'reply', body: 'Here is the screenshot', attachmentIds: [att.id],
    }))).json();
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].id).toBe(att.id);

    const thread = await (await app.request(`/api/tickets/${id}/messages`)).json();
    const withFile = thread.find((m: { id: string }) => m.id === message.id);
    expect(withFile.attachments[0].filename).toBe('screenshot.png');
  });

  it('allows an attachment-only reply (empty body) but not an empty one', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const att = await upload(app, 'file.pdf', 'application/pdf', 'PDF');
    const ok = await app.request(`/api/tickets/${id}/messages`, json('POST', { kind: 'reply', body: '', attachmentIds: [att.id] }));
    expect(ok.status).toBe(200);
    const bad = await app.request(`/api/tickets/${id}/messages`, json('POST', { kind: 'reply', body: '' }));
    expect(bad.status).toBe(400);
  });
});

describe('attachment serving', () => {
  it('serves an image inline and a document as a download', async () => {
    const app = makeApp();
    const img = await upload(app, 'pic.png', 'image/png', 'IMG');
    const doc = await upload(app, 'report.pdf', 'application/pdf', 'DOC');

    const imgRes = await app.request(`/api/attachments/${img.id}`);
    expect(imgRes.headers.get('content-type')).toBe('image/png');
    expect(imgRes.headers.get('content-disposition')).toContain('inline');
    expect(await imgRes.text()).toBe('IMG');

    const docRes = await app.request(`/api/attachments/${doc.id}`);
    expect(docRes.headers.get('content-disposition')).toContain('attachment');
  });

  it('never serves SVG inline (script vector)', async () => {
    const app = makeApp();
    const svg = await upload(app, 'x.svg', 'image/svg+xml', '<svg></svg>');
    const res = await app.request(`/api/attachments/${svg.id}`);
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('404s an unknown attachment', async () => {
    const app = makeApp();
    expect((await app.request('/api/attachments/at_nope')).status).toBe(404);
  });
});
