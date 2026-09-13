import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/** Mirror the build-time define from tsdown.config.ts so tests see the same version. */
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string

export default defineConfig({
  define: {
    __DSH_WORKBUDDY_VERSION__: JSON.stringify(PACKAGE_VERSION),
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    // Node by default: the host half is server code and most of the suite
    // exercises it directly. The two specs that render a portal opt into jsdom
    // with their own \`@vitest-environment\` pragma, so the DOM dependency stays
    // scoped to the tests that need it.
    environment: 'node',
  },
})
