import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-translate-')));
}
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('AI translate', () => {
  it('falls back to the original text when no model is configured', async () => {
    const { app } = makeApp();
    const res = await (await app.request('/api/ai/translate', post({ text: 'Bonjour, j’ai un problème', targetLang: 'English' }))).json();
    expect(res.source).toBe('rules'); // no provider → graceful fallback
    expect(res.text).toBe('Bonjour, j’ai un problème'); // returned unchanged
    expect(res.reason).toBe('off');
  });

  it('rejects empty text', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/ai/translate', post({ text: '   ' }))).status).toBe(400);
  });
});
