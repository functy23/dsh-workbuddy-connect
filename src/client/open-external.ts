/**
 * Opening a sign-in page in the user's own browser, from a browser that may not
 * be allowed to.
 *
 * The problem is a desktop one. In the DSH web GUI this is a plain
 * `window.open` and a new tab appears; inside the desktop shell the same
 * call is answered by the shell, and the current shell answers it with nothing
 * at all — no window, no error, no return value to test. DSH's own links no
 * longer rely on it either: they open in the right sidebar's browser tab, and
 * fall back to `window.open` only when that tab type is not mounted.
 *
 * So this walks a chain and stops at the first strategy that worked. Order is
 * the argument:
 *
 * 1. `window.open` first, because when it works it is the best answer — a
 *    real tab in the real browser, with the user's session and password manager
 *    already in place, which is the whole reason the browser route exists. It is
 *    also the only strategy the web GUI needs, and the shell's silent no-op is
 *    indistinguishable from launching a tab the user has not noticed yet, which
 *    is why the chain continues rather than trusting it.
 * 2. The host's `open-link` action, which spawns the operating system's
 *    own default-browser hand-off. This is the one that works on the desktop:
 *    the host process is outside the WebView and has no sandbox to argue with.
 * 3. The right sidebar's browser tab — DSH's own destination for a Markdown
 *    link, used here as a fallback rather than a first choice: it is a WebView on
 *    a shared profile, so the session the sign-in page needs is usually not the
 *    one that is signed in there.
 * 4. An anchor with `target="_blank"`, clicked programmatically. Same
 *    request as (1) through the other of the two APIs the platform provides for
 *    it; worth trying because a shell that drops one sometimes honours the
 *    other, and because it is the last chance before the caller has to tell the
 *    user to copy the address by hand.
 *
 * Every capability is read reflectively and guarded: this runs in every profile,
 * including ones that mount neither the sidebar nor a host route, and a missing
 * seam must degrade to the next strategy rather than take the dialog down.
 *
 * @module dsh-workbuddy-connect/client/open-external
 */

/** The slice of the right sidebar's tab registry this module uses. */
interface SidebarTabSeam {
  /** The registered tab type for one kind, when one is mounted. */
  get(kind: string): unknown
}

/** The slice of the sidebar's navigation face this module uses. */
interface SidebarSeam {
  openTab(kind: string, options?: { params?: Record<string, unknown>, revealIfOpened?: boolean }): void
}

/** The one method on a cordis context this module needs. */
export interface WorkBuddyExternalLinkContext {
  get(name: string): unknown
}

/** Everything one hand-off needs; all of it optional except the url. */
export interface WorkBuddyExternalOpenOptions {
  /**
   * In-process key for the host's `open-link` action. Absent means the host
   * route is skipped — a signed-out page has no key to send, and asking anyway
   * would only produce a 403.
   */
  key?: string
  /** Route to POST to; the variant's control route. Absent skips the host too. */
  probePath?: string
  /** Cordis context, for the sidebar seam. */
  context?: WorkBuddyExternalLinkContext
  /** Overridable for tests; defaults to the ambient ones. */
  fetch?: typeof fetch
  document?: Document
}

/**
 * Whether a URL is one this module will try to open.
 *
 * Mirrors the host's own rule so a bad link is refused before it travels
 * anywhere: only absolute `http` and `https`, never a custom scheme
 * (an app launcher), never `file:`, never `javascript:`.
 */
export function isExternalWebLink(url: unknown): url is string {
  if (typeof url !== 'string' || url.trim() === '') return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Strategy 1: the platform's window-opening API. */
function viaWindow(win: Window, url: string): boolean {
  try {
    win.open(url, '_blank', 'noopener,noreferrer')
    return true
  } catch {
    return false
  }
}

/**
 * Strategy 4: an anchor with a blank target, clicked on the spot.
 *
 * Created, clicked and removed inside one call so nothing is left in the DOM,
 * and `display:none` rather than a detached node: a detached anchor's click
 * is ignored by some engines. The element is removed on the next turn rather
 * than synchronously, because the navigation it starts is not complete yet.
 */
function viaAnchor(doc: Document, url: string): boolean {
  try {
    const anchor = doc.createElement('a')
    anchor.href = url
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.style.display = 'none'
    const host = doc.body ?? doc.documentElement
    host.appendChild(anchor)
    anchor.click()
    setTimeout(() => { anchor.remove() }, 0)
    return true
  } catch {
    return false
  }
}

/** Strategy 3: DSH's own destination for a link — the right sidebar's browser. */
function viaSidebar(context: WorkBuddyExternalLinkContext | undefined, url: string): boolean {
  if (context === undefined) return false
  try {
    // Reflective on purpose: the sidebar is not a dependency of this bundle, so
    // a static inject would park the whole client fiber on a package some
    // profiles never mount. Both services are read through the same guard.
    const tabs = context.get('sidebarRightTabs') as SidebarTabSeam | undefined
    if (typeof tabs?.get !== 'function' || tabs.get('browser') === undefined) return false
    const sidebar = context.get('sidebarRight') as SidebarSeam | undefined
    if (typeof sidebar?.openTab !== 'function') return false
    sidebar.openTab('browser', { params: { url }, revealIfOpened: true })
    return true
  } catch {
    return false
  }
}

/** Strategy 2: ask the host to hand the link to the operating system. */
async function viaHost(options: WorkBuddyExternalOpenOptions, url: string): Promise<boolean> {
  const { key, probePath } = options
  if (key === undefined || key === '' || probePath === undefined) return false
  const send = options.fetch ?? globalThis.fetch
  if (typeof send !== 'function') return false
  try {
    const response = await send(probePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'open-link', url }),
    })
    if (!response.ok) return false
    const value: unknown = await response.json().catch(() => undefined)
    return typeof value === 'object' && value !== null && (value as { state?: unknown }).state === 'opened'
  } catch {
    // A host that is not there, or a route an older plugin version never
    // registered: both mean "try the next strategy", not "report an error" —
    // there is a working one behind them.
    return false
  }
}

/**
 * Open one link, trying every strategy this build has, in order.
 *
 * @returns whether any strategy claimed the link. `false` means every one
 * failed, which is the caller's cue to show the address, not to claim success.
 */
export async function openExternalLink(url: string, options: WorkBuddyExternalOpenOptions = {}): Promise<boolean> {
  if (!isExternalWebLink(url)) return false
  const win = typeof window === 'undefined' ? undefined : window
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document)
  // Web GUI first: a real tab in the real browser is the outcome the browser
  // route is written for.
  if (win !== undefined && viaWindow(win, url)) return true
  // Desktop: the host is the only process that can reach the operating system.
  if (await viaHost(options, url)) return true
  if (viaSidebar(options.context, url)) return true
  return doc !== undefined && viaAnchor(doc, url)
}
