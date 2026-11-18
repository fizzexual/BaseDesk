import { describe, expect, it } from 'vitest';
import { isStaticAssetPath } from '../src/spa.js';

describe('SPA fallback: what must 404 instead of returning index.html', () => {
  it('treats build artefacts as assets', () => {
    // The regression that motivated this: after a redeploy a cached index.html asks for
    // the previous content hash. Serving HTML for it white-screens the app silently.
    for (const p of [
      '/assets/index-MD5TH8zc.js',
      '/assets/index-CktboX4i.css',
      '/assets/index-abc.js.map',
      '/assets/inter-latin-wght-normal-Dx4kXJAl.woff2',
      '/widget.js',
      '/favicon.ico',
      '/logo.svg',
      '/site.webmanifest',
      '/robots.txt',
    ]) {
      expect(isStaticAssetPath(p), p).toBe(true);
    }
  });

  it('leaves application routes alone so deep links still render', () => {
    for (const p of [
      '/',
      '/view/all',
      '/ticket/t_9f2c81a04b7e4d1aa3c5e6f70b8d9c12',
      '/portal/tickets',
      '/settings/security',
      '/kb/getting-started',
    ]) {
      expect(isStaticAssetPath(p), p).toBe(false);
    }
  });

  it('does not 404 a route just because a segment contains a dot', () => {
    // Why the extension list is closed rather than /\.\w+$/ — these are real routes.
    expect(isStaticAssetPath('/contacts/dana.reed')).toBe(false);
    expect(isStaticAssetPath('/search/acme.co')).toBe(false);
  });

  it('still routes widget.html as a document', () => {
    // .html is deliberately absent from the extension list: the chat widget is a real
    // page served by serveStatic, and this predicate only gates the *miss* path.
    expect(isStaticAssetPath('/widget.html')).toBe(false);
  });
});

describe('portal port: only the customer-facing API (security finding #2)', () => {
  it('serves what the portal and the chat widget call', async () => {
    const { portalAllows } = await import('../src/spa.js');
    for (const p of [
      '/', '/tickets/t_1', '/assets/index-abc.js', '/widget.html',
      '/api/portal/login', '/api/portal/tickets/t_1/messages', '/api/uploads', '/api/attachments/att_1',
      '/api/status', '/api/health', '/api/channels/ch_1/inbound', '/api/channels/ch_1/thread',
    ]) expect(portalAllows(p), p).toBe(true);
  });

  it('refuses the admin API', async () => {
    const { portalAllows } = await import('../src/spa.js');
    for (const p of [
      '/api/bootstrap', '/api/auth/password', '/api/settings/auth', '/api/agents', '/api/export',
      '/api/channels', '/api/channels/ch_1', '/api/channels/ch_1/command', '/api/status/components',
      '/api/attachments/att_1/extra', '/api/portal', '/api/tickets',
    ]) expect(portalAllows(p), p).toBe(false);
  });
});
