import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { sendToChannel } from '../src/channel-send.js';
import { assertOutboundUrl, isBlockedAddress } from '../src/net-guard.js';
import type { ChannelConn } from '../src/types.js';

// Security finding #6: admin-set URLs could reach cloud metadata, follow redirects, echo
// response bodies, and the AI test buttons sent the stored key to any URL in the request.

describe('outbound URL guard', () => {
  it('blocks link-local / metadata and "this host"; allows loopback, LAN and public', () => {
    for (const ip of ['169.254.169.254', '169.254.0.1', '0.0.0.0', '::ffff:169.254.169.254', 'fe80::1', 'fd00:ec2::254', '100.100.100.200', '::']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.20', '172.16.0.1', '8.8.8.8', '::1']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it('refuses non-http schemes, URL credentials and metadata hosts', async () => {
    await expect(assertOutboundUrl('file:///etc/passwd')).rejects.toThrow(/http/);
    await expect(assertOutboundUrl('http://user:pw@127.0.0.1/')).rejects.toThrow(/credentials/);
    await expect(assertOutboundUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/not allowed/);
    await expect(assertOutboundUrl('http://[fe80::1]/')).rejects.toThrow(/not allowed/);
    await expect(assertOutboundUrl('http://localhost:11434/v1')).resolves.toBeInstanceOf(URL); // a local Ollama is fine
  });
});

function server(handler: http.RequestListener): Promise<{ url: string; close: () => void; hits: string[] }> {
  const hits: string[] = [];
  const s = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? ''}`);
    handler(req, res);
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => s.close(), hits })));
}

describe('channel outbound', () => {
  const channel = (outboundUrl: string) => ({ id: 'ch', type: 'webhook', name: 'x', enabled: true, inboundToken: 't', address: null, createdAt: '', outboundUrl } as unknown as ChannelConn);
  const msg = { ticketNumber: 1, subject: 's', body: 'b', toName: null, fromName: 'Support' };

  it('does not follow a redirect and does not echo the response body', async () => {
    const target = await server((_q, res) => { res.writeHead(200); res.end('SECRET PAGE'); });
    const bouncer = await server((_q, res) => { res.writeHead(302, { location: target.url }); res.end(); });
    try {
      const r = await sendToChannel(channel(bouncer.url), msg);
      expect(r.ok).toBe(false);
      expect(target.hits).toHaveLength(0);
      const failing = await server((_q, res) => { res.writeHead(500); res.end('internal secret stack trace'); });
      const r2 = await sendToChannel(channel(failing.url), msg);
      expect(r2.error).toBe('HTTP 500');
      failing.close();
    } finally {
      target.close();
      bouncer.close();
    }
  });

  it('refuses a metadata URL before sending anything', async () => {
    const r = await sendToChannel(channel('http://169.254.169.254/latest/'), msg);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not allowed/);
  });
});

describe('AI provider test buttons', () => {
  it('never send the saved key to an unsaved URL from the request', async () => {
    const saved = await server((_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"m1"}]}'); });
    const evil = await server((_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); });
    try {
      const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-ai-')));
      await app.request('/api/ai/provider', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseUrl: saved.url, apiKey: 'sk-saved-secret', model: 'm1' }),
      });
      const post = (body: unknown) => app.request('/api/ai/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

      await post({ baseUrl: evil.url });
      expect(evil.hits.join('\n')).not.toContain('sk-saved-secret');
      await post({}); // the saved provider still gets its key
      expect(saved.hits.join('\n')).toContain('auth=Bearer sk-saved-secret');
    } finally {
      saved.close();
      evil.close();
    }
  });
});
