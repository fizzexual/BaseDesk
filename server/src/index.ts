import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './api.js';

const dataDir = process.env.DATA_DIR ?? './data';
mkdirSync(dataDir, { recursive: true });

const { app } = createApp(dataDir);

// Serve the built SPA when web/dist exists (production); skip silently in dev.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(moduleDir, '../../web/dist');
if (existsSync(distDir)) {
  const root = path.relative(process.cwd(), distDir).split(path.sep).join('/');
  app.get('*', serveStatic({ root }));
  const indexHtml = readFileSync(path.join(distDir, 'index.html'), 'utf8');
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    return c.html(indexHtml);
  });
}

const port = Number(process.env.PORT ?? 4011);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`BaseDesk server listening on http://localhost:${info.port}`);
});

export { app };
