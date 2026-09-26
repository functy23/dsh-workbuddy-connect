import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/** Mirror the build-time define from tsdown.config.ts so tests see the same version. */
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string

/**
 * Resolve a module to the double used in place of it.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is a PLATFORM SEED module: the browser
 * shell seeds it into the module table and satisfies its bare dependencies
 * (clsx, katex, shiki, micromark…). This repo has no shell, so importing the npm
 * package under vitest dies on the first bare specifier. The alias substitutes
 * the plugin's own double, which supplies the members the components use.
 */
const TEST_ALIASES: Record<string, string> = {
  '@deepseek-ai/dsh-client-ui-primitives': new URL('./tests/primitives-stub.tsx', import.meta.url).pathname,
}

export default defineConfig({
  define: {
    __DSH_WORKBUDDY_VERSION__: JSON.stringify(PACKAGE_VERSION),
  },
  resolve: {
    alias: TEST_ALIASES,
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
