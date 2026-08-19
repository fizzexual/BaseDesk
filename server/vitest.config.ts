import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Purge the throwaway per-test SQLite DBs before and after the run so the
    // large demo seed can't accumulate multi-MB temp dirs and fill the disk.
    globalSetup: './test/cleanup-temp.ts',
    // Nearly every test builds a fresh SQLite DB and loads the ~3.5k-ticket demo seed.
    // That takes well over vitest's 5s default on Windows and on cold CI runners, which
    // made `npm test` fail out of the box there while passing on Linux.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
