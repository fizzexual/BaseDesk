import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-cite-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
async function firstTicketId(app: ReturnType<typeof makeApp>): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.tickets[0].id;
}
/** Create + publish an article so it can be cited (only published articles are citable). */
async function publishedArticle(app: ReturnType<typeof makeApp>) {
  const a = await (await app.request('/api/kb', json('POST', { title: 'Rate limits', category: 'API', body: 'Passage one.\n\nPassage two.' }))).json();
  return (await app.request(`/api/kb/${a.id}`, json('PATCH', { status: 'published' }))).json();
}

describe('KB citations attach to a message as a built-in embed', () => {
  it('stores a cited passage as a structured embed that survives a fresh read', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const article = await publishedArticle(app);
    const res = await app.request(`/api/tickets/${id}/messages`, json('POST', {
      kind: 'reply',
      body: 'See our docs:',
      embeds: [{ type: 'kb_citation', articleId: article.id, passage: 'Passage one.' }],
    }));
    expect(res.status).toBe(200);
    const { message } = await res.json();
    expect(message.embeds).toHaveLength(1);
    expect(message.embeds[0]).toMatchObject({
      type: 'kb_citation',
      articleId: article.id,
      title: 'Rate limits',
      category: 'API',
      slug: article.slug,
      passage: 'Passage one.',
    });

    const thread = await (await app.request(`/api/tickets/${id}/messages`)).json();
    const found = thread.find((m: { id: string }) => m.id === message.id);
    expect(found.embeds[0].articleId).toBe(article.id);
    expect(found.body).toBe('See our docs:'); // the quote text is NOT dumped into the body
  });

  it('re-resolves title/slug from the store, ignoring client-supplied spoofs', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const article = await publishedArticle(app);
    const { message } = await (await app.request(`/api/tickets/${id}/messages`, json('POST', {
      kind: 'reply',
      body: 'ref',
      embeds: [{ type: 'kb_citation', articleId: article.id, title: 'FAKE TITLE', slug: 'fake', category: 'Fake', passage: 'Passage two.' }],
    }))).json();
    expect(message.embeds[0].title).toBe('Rate limits'); // canonical, not the spoofed value
    expect(message.embeds[0].slug).toBe(article.slug);
    expect(message.embeds[0].category).toBe('API');
  });

  it('drops citations for unknown or unpublished articles', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    // Unknown article, empty body, no attachment → nothing to post → 400.
    const unknown = await app.request(`/api/tickets/${id}/messages`, json('POST', {
      kind: 'reply', body: '', embeds: [{ type: 'kb_citation', articleId: 'kb_nope', passage: 'x' }],
    }));
    expect(unknown.status).toBe(400);
    // A draft (unpublished) article can't be cited — the embed is dropped but the reply still sends.
    const draft = await (await app.request('/api/kb', json('POST', { title: 'Draft only', category: 'X', body: 'hidden' }))).json();
    const { message } = await (await app.request(`/api/tickets/${id}/messages`, json('POST', {
      kind: 'reply', body: 'hi', embeds: [{ type: 'kb_citation', articleId: draft.id, passage: 'hidden' }],
    }))).json();
    expect(message.embeds).toBeUndefined();
  });

  it('allows a citation-only reply and previews it by article title', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const article = await publishedArticle(app);
    const res = await app.request(`/api/tickets/${id}/messages`, json('POST', {
      kind: 'reply', body: '', embeds: [{ type: 'kb_citation', articleId: article.id, passage: 'Passage one.' }],
    }));
    expect(res.status).toBe(200);
    const { ticket } = await res.json();
    expect(ticket.lastMessagePreview).toContain('Rate limits');
  });

  it('stores agent highlight ranges on the cited passage', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const article = await publishedArticle(app);
    const { message } = await (await app.request(`/api/tickets/${id}/messages`, json('POST', {
      kind: 'reply',
      body: 'note the first word',
      embeds: [{ type: 'kb_citation', articleId: article.id, passage: 'Passage one.', highlights: [{ start: 0, end: 7, color: 'yellow' }] }],
    }))).json();
    expect(message.embeds[0].highlights).toEqual([{ start: 0, end: 7, color: 'yellow' }]);

    // Survives a fresh read from the DB.
    const thread = await (await app.request(`/api/tickets/${id}/messages`)).json();
    const found = thread.find((m: { id: string }) => m.id === message.id);
    expect(found.embeds[0].highlights).toEqual([{ start: 0, end: 7, color: 'yellow' }]);
  });

  it('normalizes highlights: merges touching runs, clamps out-of-range, drops bad colors', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const article = await publishedArticle(app);
    const { message } = await (await app.request(`/api/tickets/${id}/messages`, json('POST', {
      kind: 'reply',
      body: 'x',
      embeds: [{
        type: 'kb_citation', articleId: article.id, passage: 'Passage one.', // length 12
        highlights: [
          { start: 0, end: 4, color: 'green' },
          { start: 4, end: 7, color: 'green' }, // touches the previous green → merges to [0,7)
          { start: 50, end: 99, color: 'blue' }, // out of range → dropped
          { start: 8, end: 11, color: 'orange' }, // invalid color → dropped
        ],
      }],
    }))).json();
    expect(message.embeds[0].highlights).toEqual([{ start: 0, end: 7, color: 'green' }]);
  });
});
