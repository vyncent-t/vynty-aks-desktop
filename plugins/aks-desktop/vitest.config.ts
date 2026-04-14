/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: 'node_modules/@kinvolk/headlamp-plugin/config/setupTests.js',
    clearMocks: true,
  },
});
