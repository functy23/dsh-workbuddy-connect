import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

/**
 * This package's own manifest, read once.
 *
 * Both the browser module identity and the version stamp come from here rather
 * than from string literals. The client bundle's registration id is not a free
 * choice: the host keys every browser module by the *resolved manifest's package
 * name*, so an id that no longer equals `name` stops matching its row and the
 * entry fails to activate. That is exactly what happened in 0.13.6 — the package
 * was renamed, this constant was not, and the client half vanished from the
 * page. Deriving it makes that class of rename impossible.
 */
const MANIFEST = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { name: string, version: string }

/** Browser module identity; must equal the package name (see {@link MANIFEST}). */
const PLUGIN_ID = MANIFEST.name

/** Build-time define map; `src/version.ts` reads `__DSH_WORKBUDDY_VERSION__`. */
const VERSION_DEFINE = { __DSH_WORKBUDDY_VERSION__: JSON.stringify(MANIFEST.version) }

/**
 * Modules the host loader provides, kept out of the browser bundle. The
 * client's DSH imports are type-only today — they erase at build time, so the
 * emitted bundle only requires React. The list is the guardrail that keeps a
 * future value import `require`d from the host instead of inlined.
 *
 * `react-dom` belongs here because the client half uses a portal to render over
 * the conversation, and bundling a second copy of ReactDOM would give that
 * portal a different reconciler than the one painting the page.
 *
 * `dsh-client-ui-primitives` is here for a sharper reason than size: it is a
 * PLATFORM SEED module the shell installs into the module table, and it ships its
 * own CSS modules. Bundling it would try to inline those stylesheets (which the
 * shell has already applied, from the shell's own copy) and would give the page
 * a second set of component identities — a duplicated `Button` renders under a
 * different CSS-module scope than the one the rest of the settings UI uses. It
 * must be `require`d by name at runtime.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  // Declared by the settings page's slot; keeping it external matches how the
  // other client-only packages are handled.
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-locale/client',
] as const

export default [
  {
    entry: {
      index: 'src/index.ts',
      bin: 'src/bin.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    define: VERSION_DEFINE,
    deps: {
      neverBundle: [
        '@earendil-works/pi-ai',
        '@deepseek-ai/schemastery',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-atomic-write',
        '@deepseek-ai/dsh-attachment',
        '@deepseek-ai/dsh-home-paths',
        '@deepseek-ai/dsh-host-webserver',
        '@deepseek-ai/dsh-llm',
        '@deepseek-ai/dsh-llm-pi-ai',
        '@deepseek-ai/dsh-settings',
      ],
    },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    clean: false,
    define: VERSION_DEFINE,
    deps: { neverBundle: [...CLIENT_EXTERNALS] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
