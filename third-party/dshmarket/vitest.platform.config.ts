import { defineConfig } from 'vitest/config'

// The embedded source payload omits the external project's network-test fixtures.
export default defineConfig({
  test: {
    include: ['tests/client/gist-result.spec.ts'],
  },
})
