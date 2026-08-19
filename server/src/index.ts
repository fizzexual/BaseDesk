import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp, refreshModelCache } from './api.js';
import { isStaticAssetPath } from './spa.js';

const dataDir = process.env.DATA_DIR ?? './data';
mkdirSync(dataDir, { recursive: true });

const { app, db, flushScheduled } = createApp(dataDir);

// The model "addresser": re-check the provider's available models once a day
// (createApp already refreshes on boot). unref() so it never blocks shutdown.
setInterval(() => void refreshModelCache(db), 24 * 60 * 60 * 1000).unref();

// Fire due scheduled sends every 30s (also flushed opportunistically on bootstrap).
setInterval(() => {
  try {
    flushScheduled(Date.now());
  } catch {
    /* keep the timer alive across a transient failure */
  }
}, 30_000).unref();

// Serve the built SPA in production (web/dist present). In dev (BASEDESK_DEV=1)
// the two Vite servers serve the SPA, so the API stays API-only even if a stale
// web/dist exists from an earlier build.
const isDev = process.env.BASEDESK_DEV === '1';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(moduleDir, '../../web/dist');
const hasDist = !isDev && existsSync(distDir);

const log = (label: string) => (info: { port: number }) =>
  console.log(`BaseDesk ${label} on http://localhost:${info.port}`);

if (hasDist) {
  // Production: the same SPA + API is served on two ports. The client renders the
  // admin dashboard on the admin port and the customer portal on the portal port;
  // the injected portal port lets it work with custom ports too.
  const adminPort = Number(process.env.ADMIN_PORT ?? process.env.PORT ?? 4010);
  const portalPort = Number(process.env.PORTAL_PORT ?? 4011);
  const root = path.relative(process.cwd(), distDir).split(path.sep).join('/');
  const indexHtml = readFileSync(path.join(distDir, 'index.html'), 'utf8').replace(
    '</head>',
    `<script>window.__PORTAL_PORT__=${JSON.stringify(String(portalPort))}</script></head>`,
  );
  // index.html is the map to the content-hashed asset filenames, so a cached copy goes
  // stale the moment we redeploy and points at files that no longer exist. The hashed
  // assets themselves are immutable and stay cacheable; only this document must not be.
  const INDEX_HEADERS = { 'Cache-Control': 'no-cache, must-revalidate' };

  app.get('/', (c) => c.html(indexHtml, 200, INDEX_HEADERS));
  app.get('*', serveStatic({ root }));
  app.get('*', (c) => {
    const p = c.req.path;
    // A missing build artefact must 404, never fall through to the SPA shell: handing
    // back HTML for a .js request makes the browser execute markup as JavaScript and
    // white-screen with nothing in the console. See isStaticAssetPath.
    if (p.startsWith('/api/') || isStaticAssetPath(p)) return c.json({ error: 'not found' }, 404);
    return c.html(indexHtml, 200, INDEX_HEADERS);
  });

  serve({ fetch: app.fetch, port: adminPort }, log('admin'));
  if (portalPort !== adminPort) serve({ fetch: app.fetch, port: portalPort }, log('portal'));
} else {
  // Dev: just the API (the two Vite servers serve the SPA and proxy here).
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4012) }, log('API'));
}

export { app };
