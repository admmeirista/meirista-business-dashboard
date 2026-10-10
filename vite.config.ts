import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' agar build bisa disajikan dari sub-path GitHub Pages (https://<user>.github.io/<repo>/)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  test: { globals: true, environment: 'node', testTimeout: 300000, hookTimeout: 300000 },
});
