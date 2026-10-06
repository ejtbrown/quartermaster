import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep AudioWorklet code on the same origin under a hashed URL; the CSP
  // intentionally does not allow data: script execution.
  build: { assetsInlineLimit: 0 },
  server: { host: '127.0.0.1' },
});
