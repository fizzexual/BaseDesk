// Portal-only public gateway. Fronts the production server but exposes ONLY the customer
// portal: the root and any admin route redirect to /portal, and admin API paths are blocked.
// This is what we tunnel publicly so the login-less admin app is never reachable from outside.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const TARGET = process.env.TARGET ?? 'http://localhost:4011';
const PORT = Number(process.env.PORT ?? 4021);

// Paths the public portal legitimately needs: the portal SPA, its API, uploads, branding,
// health, and the static asset bundle/fonts.
const allowed = (p) =>
  p.startsWith('/portal') ||
  p.startsWith('/api/portal') ||
  p === '/api/uploads' || p.startsWith('/api/uploads/') ||
  p === '/api/branding' ||
  p === '/api/health' ||
  p.startsWith('/assets/') ||
  p === '/favicon.ico' ||
  p === '/robots.txt';

const app = new Hono();

app.all('*', async (c) => {
  const { pathname, search } = new URL(c.req.url);
  if (!allowed(pathname)) {
    if (pathname.startsWith('/api')) return c.json({ error: 'not available on the public portal' }, 404);
    // Root + admin routes → the public help center (content, no login wall) rather than
    // /portal, which bounces an unauthenticated visitor to the sign-in page.
    return c.redirect('/portal/help', 302);
  }
  const method = c.req.method;
  const res = await fetch(TARGET + pathname + search, {
    method,
    headers: c.req.raw.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : c.req.raw.body,
    duplex: 'half',
    redirect: 'manual',
  });
  const headers = new Headers(res.headers);
  // Node's fetch already decodes the body — drop encoding/length so the browser doesn't choke.
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return new Response(res.body, { status: res.status, headers });
});

serve({ fetch: app.fetch, port: PORT }, (i) => console.log(`Portal gateway on http://localhost:${i.port} → ${TARGET}`));
