/**
 * Opening an HTTP(S) link in the user's own browser, from the host process.
 *
 * Why this exists at all: the plugin's sign-in routes hand the user a URL that
 * lives on the *provider's* site and has to be visited with their existing
 * session and password manager — singling out that browser's storage is the
 * whole reason the browser route is usable. In a desktop WebView the page has
 * no way to do that itself: `window.open` is answered by the shell, which
 * in the current DSH desktop answers nothing at all, and the sidebar browser
 * DSH uses for its own Markdown links is a WebView on a shared profile — the
 * wrong jar for this.
 *
 * The host is the one place that can ask the operating system, so the client
 * asks it over the same key-bearing control route as every other write. The
 * process spawn is deliberately detached and unwaited: the launcher exits long
 * before the user is done reading the page, and `unref` keeps its lifetime
 * from belonging to the plugin's.
 *
 * The URL is validated here, host-side, immediately before it reaches the OS —
 * not in the browser, where the check would only bind well-behaved callers.
 * Only `http:` and `https:` are ever handed to the launcher, so
 * `file:`, `javascript:` and every registered custom scheme (an app
 * launcher on any desktop) are refused rather than passed along to the shell.
 *
 * @module dsh-workbuddy-connect/open-link
 */

import { spawn } from 'node:child_process'

/** The URL shape this module will hand to the operating system. */
export type WorkBuddyOpenLinkResult =
  | { state: 'opened' }
  | { state: 'invalid-link', reason: string }
  | { state: 'failed', reason: string }

/** The narrowest slice of `process` this module reads, injected for tests. */
export interface WorkBuddyOpenLinkHarness {
  /** `process.platform` of the host the link is opened on. */
  platform: NodeJS.Platform
  /**
   * Launch one detached process. Resolves once the launcher has been started,
   * rejects when it could not be — a launcher missing from `PATH` is the
   * one failure worth reporting instead of reporting success.
   */
  spawn: (command: string, args: readonly string[]) => Promise<void>
}

/**
 * How one platform hands a URL to the user's default browser.
 *
 * `open` on macOS and `xdg-open` on Linux are the platform's own
 * "open this with the default handler" entry points. Windows has no equivalent
 * executable: the documented one is `rundll32 url.dll,FileProtocolHandler`,
 * where the comma-joined argument is ONE argument, not two — splitting it asks
 * rundll32 to load a module named `url.dll,`.
 */
export function launcherFor(platform: NodeJS.Platform): { command: string, args: (url: string) => readonly string[] } {
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: url => ['url.dll,FileProtocolHandler', url] }
  }
  if (platform === 'darwin') return { command: 'open', args: url => [url] }
  return { command: 'xdg-open', args: url => [url] }
}

/**
 * Whether a value is a link this module may open.
 *
 * Only `http` and `https`, and only absolute: a scheme-relative or
 * relative address would be resolved by the launcher's own guess about a base,
 * which is not a decision this module is entitled to make for the user.
 */
export function isOpenableLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** The production harness: spawn detached, resolve on `spawn`, reject on `error`. */
const PRODUCTION_HARNESS: WorkBuddyOpenLinkHarness = {
  platform: process.platform,
  spawn: (command, args) => new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { detached: true, stdio: 'ignore', windowsHide: true })
    // `error` fires asynchronously when the launcher cannot be resolved, so
    // it must be handled here: an unhandled one would take the host process
    // down over a link the user could simply click themselves.
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  }),
}

/**
 * Hand one link to the operating system's default browser.
 *
 * Resolves with a state rather than throwing, so the control route can answer
 * the card with a reason it can show: `invalid-link` is the caller's fault
 * and `failed` is the machine's, and the card reports them differently from
 * a successful hand-off.
 */
export async function openWorkBuddyLink(
  url: string,
  harness: WorkBuddyOpenLinkHarness = PRODUCTION_HARNESS,
): Promise<WorkBuddyOpenLinkResult> {
  if (!isOpenableLink(url)) {
    return { state: 'invalid-link', reason: 'only absolute http and https links can be opened' }
  }
  const launcher = launcherFor(harness.platform)
  try {
    await harness.spawn(launcher.command, launcher.args(url))
    return { state: 'opened' }
  } catch (error: unknown) {
    return { state: 'failed', reason: error instanceof Error ? error.message.slice(0, 300) : String(error) }
  }
}
