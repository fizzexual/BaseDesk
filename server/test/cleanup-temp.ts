import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Each test spins up a throwaway SQLite DB via `mkdtempSync(tmpdir(), 'bd-…')` and never
 * removes it. That was harmless with the tiny fixture, but the demo seed makes every DB
 * multi-megabyte, so across many runs they can fill the disk (ENOSPC). This vitest
 * globalSetup purges those temp dirs before the run and again after it finishes.
 */
function purge(): void {
  let root: string;
  try {
    root = tmpdir();
  } catch {
    return;
  }
  for (const name of readdirSync(root)) {
    if (!/^(bd-|basedesk-)/.test(name)) continue;
    try {
      rmSync(join(root, name), { recursive: true, force: true });
    } catch {
      /* still locked by a just-exited process — the next run's pre-purge will get it */
    }
  }
}

export default function (): () => void {
  purge();
  return purge;
}
