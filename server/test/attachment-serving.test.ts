import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentDisposition, createApp } from '../src/api.js';

// Security finding #3 (stored XSS through an SVG upload with a MIME parameter) and the
// correctness finding that a non-Latin filename 500'd the download.

async function upload(app: ReturnType<typeof createApp>['app'], name: string, type: string, body: string) {
  const form = new FormData();
  form.append('file', new File([body], name, { type }));
  const res = await app.request('/api/uploads', { method: 'POST', body: form });
  expect(res.status).toBe(200);
  return (await res.json()).id as string;
}

describe('attachment serving', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>';

  it('never renders an SVG inline, whatever parameters its type carries', async () => {
    const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-att-')));
    for (const type of ['image/svg+xml', 'image/svg+xml; charset=utf-8', 'IMAGE/SVG+XML', 'text/html']) {
      const id = await upload(app, 'x.svg', type, svg);
      const res = await app.request(`/api/attachments/${id}`);
      expect(res.status, type).toBe(200);
      expect(res.headers.get('content-type'), type).toBe('application/octet-stream');
      expect(res.headers.get('content-disposition'), type).toMatch(/^attachment;/);
      expect(res.headers.get('content-security-policy'), type).toContain('sandbox');
    }
  });

  it('still previews raster images inline, with the bare type', async () => {
    const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-att2-')));
    const id = await upload(app, 'shot.png', 'image/png; foo=bar', 'PNGDATA');
    const res = await app.request(`/api/attachments/${id}`);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('downloads a file with a Cyrillic name instead of failing with a 500', async () => {
    const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-att3-')));
    const id = await upload(app, 'отчёт.pdf', 'application/pdf', '%PDF-1.4');
    const res = await app.request(`/api/attachments/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="_____.pdf"; filename*=UTF-8''${encodeURIComponent('отчёт.pdf')}`,
    );
  });

  it('contentDisposition strips quotes, backslashes and control characters', () => {
    expect(contentDisposition('attachment', 'a"b\\c\r\nd.txt')).toBe(`attachment; filename="abcd.txt"; filename*=UTF-8''abcd.txt`);
    expect(contentDisposition('inline', '')).toBe(`inline; filename="file"; filename*=UTF-8''file`);
  });
});
