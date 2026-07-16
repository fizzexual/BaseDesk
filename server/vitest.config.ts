import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Purge the throwaway per-test SQLite DBs before and after the run so the
    // large demo seed can't accumulate multi-MB temp dirs and fill the disk.
    globalSetup: './test/cleanup-temp.ts',
  },
});
