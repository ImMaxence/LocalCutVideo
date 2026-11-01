import { defineConfig } from 'vitest/config';

/** Unit tests of the framework-free engine (src/app/engine): run with `npm test`. */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
