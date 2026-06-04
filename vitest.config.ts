import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so the app's node-polyfill plugin doesn't load
// under the unit tests (the pure helpers need no browser/Node shims).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
