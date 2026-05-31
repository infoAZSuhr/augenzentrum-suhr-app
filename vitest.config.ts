import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',     // schnell — keine jsdom für reine Helper-Tests
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    reporters: 'default',
  },
})
