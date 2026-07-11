// Dev wrapper: launcher harnesses (and shells) sometimes export PORT for the
// whole process tree, which would collide with the web dev server. In dev the
// API always runs on API_PORT (default 4011); production `npm start` still
// honors PORT normally.
import { spawn } from 'node:child_process';

const env = { ...process.env, PORT: process.env.API_PORT ?? '4011' };
const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--watch', 'src/index.ts'],
  { stdio: 'inherit', env },
);
child.on('exit', (code) => process.exit(code ?? 0));
