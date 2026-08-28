import { defineConfig } from 'vitest/config';

// Deliberately separate from vite.config.ts: the DSP tests are pure functions
// over Float32Arrays and have no business booting the React or PWA plugins.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
