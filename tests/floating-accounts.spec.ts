// @vitest-environment jsdom
//
// The window is positioned from the conversation's own container and rendered
// through a portal, so it needs a real DOM to be tested at all.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyFloatingAccounts } from '../src/client/WorkBuddyFloatingAccounts.tsx'
import { CARD_VARIANTS } from '../src/client/card-variants.ts'
import { en } from '../src/client/locales.ts'
import type { WorkBuddyWebStatus } from '../src/status-paths.ts'

/**
 * The floating account window: what it shows, and where it puts itself.
 *
 * The position is the part worth pinning. It is derived from
 * \`[data-conversation-scroll]\` rather than hardcoded, so a future DSH layout
 * change that removes that anchor has to fail here rather than silently drop the
 * window into a corner of the viewport.
 */

const t = (key: keyof typeof en, params: Record<string, unknown> = {}): string =>
  Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    en[key] as string,
  )

/** A status document for one variant, signed in with one account. */
function signedIn(overrides: Record<string, unknown> = {}): WorkBuddyWebStatus {
  return {
    status: 'signed-in',
    nickname: '昵称',
    accounts: {
      accounts: [{
        id: 'uid-a:ent', uid: 'uid-a', name: '主账号', origin: 'desktop', domain: 'copilot.tencent.com',
        enabled: true, available: true, renewable: true, credits: 9876, expiresAtMs: Date.now() + 3_600_000,
        lastUsedAtMs: 0, addedAtMs: 0,
      }],
      primary: 'uid-a:ent',
      floatingWindow: true,
    },
    ...overrides,
  } as WorkBuddyWebStatus
}

describe('WorkBuddy floating account window', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let scroll: HTMLDivElement | undefined
  const request = vi.fn()

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    // The conversation's scroll container, which the window anchors to.
    scroll = document.createElement('div')
    scroll.setAttribute('data-conversation-scroll', '')
    scroll.getBoundingClientRect = () => ({ top: 120, right: 900, left: 200, bottom: 700, width: 700, height: 580, x: 200, y: 120, toJSON: () => ({}) }) as DOMRect
    document.body.appendChild(scroll)
    vi.stubGlobal('innerWidth', 1000)
    request.mockReset()
    vi.stubGlobal('fetch', request)
  })

  afterEach(() => {
    act(() => { root?.unmount() })
    container?.remove()
    scroll?.remove()
    root = undefined
    container = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Mount the window, with each variant's status answered by \`statusFor\`. */
  async function mount(statusFor: (variantId: string) => WorkBuddyWebStatus | undefined): Promise<void> {
    request.mockImplementation(async (url: string) => {
      const variant = CARD_VARIANTS.find(candidate => url.includes(candidate.statusPath))
      const body = variant === undefined ? undefined : statusFor(variant.id)
      if (body === undefined) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => body }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(WorkBuddyFloatingAccounts, { t }))
      // Two awaits: one for the fetches, one for the state update they trigger.
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  /** The window, found by its own marker attribute. */
  function window_(): HTMLElement | null {
    return document.querySelector('[data-workbuddy-floating-accounts]')
  }

  it('shows both variants with each account and its balance', async () => {
    await mount(() => signedIn())
    const panel = window_()
    expect(panel).not.toBeNull()
    const text = panel?.textContent ?? ''
    expect(text).toContain('主账号')
    // Credits are compacted for a narrow floating panel.
    expect(text).toContain('9.9K')
    // Both providers' titles appear, because the window reports both pools.
    expect(text).toContain(t(CARD_VARIANTS[0]!.titleKey))
    expect(text).toContain(t(CARD_VARIANTS[1]!.titleKey))
  })

  it('uses the panel radius and puts no status dot beside the product headings', async () => {
    await mount(() => signedIn())
    const panel = window_() as HTMLElement
    // DSH's own panels are noticeably rounder than a button; the window is a
    // panel, so it follows them rather than the 10px it started at.
    expect(panel.style.borderRadius).toBe('14px')
    // The dot belongs beside an account name, where it answers "can this
    // account serve". On a heading it would repeat the same signal one level up
    // and read as decoration.
    const dots = [...panel.querySelectorAll('[aria-hidden="true"]')]
    for (const dot of dots) {
      const parent = dot.parentElement
      // Every dot that is rendered must sit inside a row that also names an
      // account; the heading span holds text only.
      if (parent !== null) expect(parent.textContent ?? '').not.toBe(t(CARD_VARIANTS[0]!.titleKey))
    }
    // The account row's own dot is still there.
    expect(dots.length).toBeGreaterThan(0)
  })

  it('anchors itself to the conversation container, not to the viewport edge', async () => {
    await mount(() => signedIn())
    const panel = window_() as HTMLElement
    // right = viewport width - container.right + inset = 1000 - 900 + 16
    expect(panel.style.right).toBe('116px')
    // top = container.top + inset = 120 + 16
    expect(panel.style.top).toBe('136px')
    // Fixed, so the transcript scrolls underneath it.
    expect(panel.style.position).toBe('fixed')
  })

  it('reports a limited account by when it returns, not by its balance', async () => {
    await mount(() => signedIn({
      accounts: {
        accounts: [{
          id: 'uid-b:ent', uid: 'uid-b', name: '小号', origin: 'qr', domain: 'copilot.tencent.com',
          enabled: true, available: false, renewable: true, credits: 500, expiresAtMs: Date.now() + 3_600_000,
          lastUsedAtMs: 0, addedAtMs: 0,
          cooldown: { untilMs: Date.now() + 7 * 60_000, reason: 'rate', strikes: 1 },
        }],
        floatingWindow: true,
      },
    }))
    const text = window_()?.textContent ?? ''
    expect(text).toContain(t('floatingRetryIn', { when: t('waitMinutes', { value: 7 }) }))
    // The balance of an account that cannot serve yet is not what the reader
    // needs, so it is replaced rather than shown beside the wait.
    expect(text).not.toContain('500')
  })

  it('hides itself when the setting is off', async () => {
    await mount(() => signedIn({
      accounts: { accounts: [], floatingWindow: false },
    }))
    expect(window_()).toBeNull()
  })

  it('renders nothing when no variant is signed in', async () => {
    await mount(() => undefined)
    expect(window_()).toBeNull()
  })

  it('offers a way in when a variant has no account', async () => {
    await mount(() => signedIn({ accounts: { accounts: [], floatingWindow: true } }))
    expect(window_()?.textContent ?? '').toContain(t('floatingNoAccount'))
  })

  it('collapses on request and remembers it', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    })
    await mount(() => signedIn())
    const toggle = window_()?.querySelector('button')
    expect(toggle).not.toBeNull()
    await act(async () => { toggle?.click() })
    // The preference is what makes the collapsed state survive a reload.
    expect([...store.values()]).toContain('1')
    // Collapsed: the header stays, the account rows do not.
    expect(window_()?.textContent ?? '').not.toContain('主账号')
    expect(window_()?.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('starts collapsed when the preference says so', async () => {
    // jsdom's localStorage is present but Node warns it has no backing file;
    // a stub keeps the preference path exercised without that noise.
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key.endsWith('floating-collapsed') ? '1' : null,
      setItem: () => {},
      removeItem: () => {},
    })
    await mount(() => signedIn())
    expect(window_()?.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('leaves out accounts the user switched off', async () => {
    await mount(() => signedIn({
      accounts: {
        accounts: [
          {
            id: 'uid-on:ent', uid: 'uid-on', name: '在用的', origin: 'desktop', domain: 'copilot.tencent.com',
            enabled: true, available: true, renewable: true, credits: 10, expiresAtMs: Date.now() + 3_600_000, lastUsedAtMs: 0, addedAtMs: 0,
          },
          {
            id: 'uid-off:ent', uid: 'uid-off', name: '停用的', origin: 'qr', domain: 'copilot.tencent.com',
            enabled: false, available: false, renewable: false, credits: 20, expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0,
          },
        ],
        floatingWindow: true,
      },
    }))
    const text = window_()?.textContent ?? ''
    expect(text).toContain('在用的')
    // Rotation will not use it, so a window about "what is serving me" omits it.
    expect(text).not.toContain('停用的')
  })
})
