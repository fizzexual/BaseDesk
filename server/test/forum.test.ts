import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-forum-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const authed = (method: string, token: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function portalToken(app: ReturnType<typeof makeApp>, email: string): Promise<string> {
  const r = await (await app.request('/api/portal/register', json('POST', { name: 'Ada', email, password: 'password123' }))).json();
  return r.token as string;
}

describe('community forum', () => {
  it('seeds showcase topics, pinned first, with categories', async () => {
    const app = makeApp();
    const list = await (await app.request('/api/forum/topics')).json();
    expect(list.categories).toContain('how-to');
    expect(list.topics.length).toBeGreaterThanOrEqual(5);
    expect(list.topics[0].pinned).toBe(true); // the welcome topic is pinned to the top
    // The forwarding question has an accepted answer, so it reads as solved.
    const forward = list.topics.find((t: { id: string }) => t.id === 'ft_forward');
    expect(forward.solved).toBe(true);
    expect(forward.replyCount).toBe(1);
  });

  it('filters by category', async () => {
    const app = makeApp();
    const list = await (await app.request('/api/forum/topics?category=bugs')).json();
    expect(list.topics.length).toBeGreaterThanOrEqual(1);
    expect(list.topics.every((t: { category: string }) => t.category === 'bugs')).toBe(true);
  });

  it('a customer starts a topic, an agent replies, and the asker accepts the answer', async () => {
    const app = makeApp();
    const token = await portalToken(app, 'ada@example.com');
    const created = await (await app.request('/api/portal/forum/topics', authed('POST', token, { title: 'Where are my exports?', body: 'Cannot find the CSV export', category: 'how-to' }))).json();
    expect(created.title).toBe('Where are my exports?');
    expect(created.authorIsAgent).toBe(false);
    expect(created.solved).toBe(false);

    const withReply = await (await app.request(`/api/forum/topics/${created.id}/replies`, json('POST', { body: 'Reports → Export gives you a CSV.' }))).json();
    expect(withReply.replies.length).toBe(1);
    expect(withReply.replies[0].authorIsAgent).toBe(true);

    const accepted = await (await app.request(`/api/portal/forum/topics/${created.id}/accept`, authed('POST', token, { replyId: withReply.replies[0].id }))).json();
    expect(accepted.solved).toBe(true);
    expect(accepted.replies[0].accepted).toBe(true);
  });

  it('only the asker can accept, and a locked topic refuses new replies', async () => {
    const app = makeApp();
    const asker = await portalToken(app, 'asker@example.com');
    const other = await portalToken(app, 'other@example.com');
    const topic = await (await app.request('/api/portal/forum/topics', authed('POST', asker, { title: 'Q', body: 'x' }))).json();
    const detail = await (await app.request(`/api/forum/topics/${topic.id}/replies`, json('POST', { body: 'answer' }))).json();
    const replyId = detail.replies[0].id;

    expect((await app.request(`/api/portal/forum/topics/${topic.id}/accept`, authed('POST', other, { replyId }))).status).toBe(403);

    await app.request(`/api/forum/topics/${topic.id}`, json('PATCH', { locked: true }));
    expect((await app.request(`/api/portal/forum/topics/${topic.id}/replies`, authed('POST', asker, { body: 'more' }))).status).toBe(409);
  });

  it('agents moderate — pin a topic and delete topics and replies', async () => {
    const app = makeApp();
    await app.request('/api/forum/topics/ft_safari', json('PATCH', { pinned: true }));
    let list = await (await app.request('/api/forum/topics')).json();
    expect(list.topics.filter((t: { pinned: boolean }) => t.pinned).length).toBe(2); // welcome + safari
    expect(list.topics[0].pinned).toBe(true);

    expect((await app.request('/api/forum/topics/ft_tips', { method: 'DELETE' })).status).toBe(200);
    list = await (await app.request('/api/forum/topics')).json();
    expect(list.topics.find((t: { id: string }) => t.id === 'ft_tips')).toBeUndefined();

    const before = await (await app.request('/api/forum/topics/ft_darkmode')).json();
    await app.request(`/api/forum/replies/${before.replies[0].id}`, { method: 'DELETE' });
    const after = await (await app.request('/api/forum/topics/ft_darkmode')).json();
    expect(after.replies.length).toBe(before.replies.length - 1);
  });

  it('validates input and counts views', async () => {
    const app = makeApp();
    const token = await portalToken(app, 'ada@example.com');
    expect((await app.request('/api/portal/forum/topics', authed('POST', token, { title: '   ', body: 'x' }))).status).toBe(400);

    const topic = await (await app.request('/api/portal/forum/topics', authed('POST', token, { title: 'Cat test', body: 'x', category: 'not-real' }))).json();
    expect(topic.category).toBe('general'); // unknown category falls back

    const v1 = await (await app.request(`/api/portal/forum/topics/${topic.id}`, authed('GET', token))).json();
    const v2 = await (await app.request(`/api/portal/forum/topics/${topic.id}`, authed('GET', token))).json();
    expect(v2.views).toBeGreaterThan(v1.views);
  });
});
