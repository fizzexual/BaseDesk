// Dev wrapper: launcher harnesses (and shells) sometimes export PORT for the
// whole process tree, which would collide with the web dev servers. In dev the
// API always runs on API_PORT (default 4012 — 4010 is the admin app, 4011 the
// customer portal); production `npm start` still honors PORT normally.
import { spawn } from 'node:child_process';

// BASEDESK_DEV tells index.ts to run API-only on one port (Vite serves the SPA),
// even if a stale web/dist is lying around from a previous build.
const env = { ...process.env, PORT: process.env.API_PORT ?? '4012', BASEDESK_DEV: '1' };
const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--watch', 'src/index.ts'],
  { stdio: 'inherit', env },
);
child.on('exit', (code) => process.exit(code ?? 0));
