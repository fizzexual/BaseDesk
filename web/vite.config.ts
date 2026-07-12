/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Default port is the admin app (4010); the portal runs `vite --port 4011`.
    // Both proxy the API, which in dev lives on 4012.
    port: 4010,
    proxy: {
      '/api': `http://localhost:${process.env.VITE_API_PORT ?? 4012}`,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
