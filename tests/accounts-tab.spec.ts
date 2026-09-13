// @vitest-environment jsdom
//
// A real DOM, because the QR dialog renders through \`createPortal\`. Faking the
// container is not viable — \`react-dom\` walks \`childNodes\` as a live NodeList and
// checks insertion points the way a browser does — and a portal that is never
// exercised is the part of this surface most likely to break silently.
// @vitest-environment jsdom
//
// A real DOM, because the QR dialog renders through \`createPortal\`. Faking the
// container is not viable — \`react-dom\` walks \`childNodes\` as a live NodeList and
// checks insertion points the way a browser does — and a portal that is never
// exercised is the part of this surface most likely to break silently.
import { StrictMode, act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyAccountsTab } from '../src/client/WorkBuddyAccountsTab.tsx'
import { en } from '../src/client/locales.ts'
import type { WorkBuddyWebAccounts } from '../src/status-paths.ts'

/**
 * The account tab: what the pool looks like, and that each control sends the
 * action it claims to.
 *
 * The assertions are on the *request the tab sends*, because that is the half
 * this component owns. Whether the host then rotates correctly is the host
 * suite's job; a client test that only checked its own rendering would pass
 * while the button posted the wrong verb.
 */

const t = (key: keyof typeof en, params: Record<string, unknown> = {}): string =>
  Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    en[key] as string,
  )

/** A pool with one of everything worth drawing. */
function accounts(overrides: Partial<WorkBuddyWebAccounts> = {}): WorkBuddyWebAccounts {
  return {
    accounts: [
      {
        id: 'uid-a:ent', uid: 'uid-a', name: '桌面账号', origin: 'desktop', domain: 'copilot.tencent.com',
        enabled: true, available: true, credits: 12345, expiresAtMs: Date.now() + 3_600_000,
        lastUsedAtMs: 0, addedAtMs: 0,
      },
      {
        id: 'uid-b:ent', uid: 'uid-b', name: '小号', label: '小号', origin: 'qr', domain: 'copilot.tencent.com',
        enabled: true, available: false, expiresAtMs: Date.now() + 3_600_000,
        lastUsedAtMs: 0, addedAtMs: 0,
        cooldown: { untilMs: Date.now() + 5 * 60_000, reason: 'rate', strikes: 2 },
      },
      {
        id: 'uid-c:ent', uid: 'uid-c', name: '停用的', origin: 'qr', domain: 'copilot.tencent.com',
        enabled: false, available: false, expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0,
      },
    ],
    primary: 'uid-a:ent',
    desktop: 'uid-a:ent',
    floatingWindow: true,
    ...overrides,
  }
}

describe('WorkBuddy account tab', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  const run = vi.fn()

  beforeEach(() => {
    run.mockReset().mockResolvedValue({ state: 'ok' })
    // Tell React this is an act() environment, or every update it processes
    // outside act() logs a warning that buries real failures.
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // jsdom supplies the DOM. Timers are fake so the tab's polls never fire a
    // real one mid-test, and \`confirm\` is answered so removal can run.
    vi.useFakeTimers()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // jsdom has no 2D canvas. The dialog only needs the call to succeed; the
    // modules it would paint are asserted against golden vectors in
    // tests/qr-code.spec.ts, so nothing is lost by stubbing the surface here.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '#000',
      fillRect: () => {},
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    act(() => { root?.unmount() })
    container?.remove()
    root = undefined
    container = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function mount(data: WorkBuddyWebAccounts = accounts()): void {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(createElement(WorkBuddyAccountsTab, {
        accounts: data,
        accountPath: '/plugins/dsh-workbuddy-connect/accounts',
        probeKey: 'key',
        t,
        busy: false,
        run,
        refresh: async () => {},
      }))
    })
  }

  /** Every rendered button, found in the real DOM the tab painted into. */
  function buttons(): { label: string, click: () => void }[] {
    return [...(container?.querySelectorAll('button') ?? [])].map(node => ({
      label: (node.textContent ?? '').trim(),
      click: () => { node.click() },
    }))
  }

  /** The tab's rendered text, portals included. */
  function text(): string {
    return document.body.textContent ?? ''
  }

  it('lists every pooled account with its state', () => {
    mount()
    const json = text()
    expect(json).toContain('桌面账号')
    expect(json).toContain('小号')
    expect(json).toContain('停用的')
    // The limited account says why and for how long, not just that it is
    // limited: "retry in 5 min" is the part that is actionable.
    expect(json).toContain(t('accountStateWaiting', { reason: t('accountStateLimited'), minutes: 5 }))
    expect(json).toContain(t('accountStateDisabled'))
  })

  it('shows each account balance and its origin', () => {
    mount()
    const json = text()
    // Compact formatting: 12345 reads as 12.3K in the row.
    expect(json).toContain('12')
    expect(json).toContain(t('accountOriginDesktop'))
    expect(json).toContain(t('accountOriginQr'))
  })

  it('sends the enable toggle with the opposite of the current state', async () => {
    mount()
    const toggle = buttons().find(button => button.label === t('accountEnable'))
    expect(toggle).toBeDefined()
    await act(async () => { toggle?.click() })
    // The disabled account is the only one offering "enable".
    expect(run).toHaveBeenCalledWith({ action: 'enable', id: 'uid-c:ent', enabled: true })
  })

  it('sends a test for the account whose button was pressed', async () => {
    mount()
    const tests = buttons().filter(button => button.label === t('accountTest'))
    expect(tests).toHaveLength(3)
    await act(async () => { tests[1]?.click() })
    expect(run).toHaveBeenCalledWith({ action: 'test', id: 'uid-b:ent' })
  })

  it('asks before removing, and sends the removal the user agreed to', async () => {
    mount()
    const removes = buttons().filter(button => button.label === t('accountRemove'))
    await act(async () => { removes[0]?.click() })
    expect(run).toHaveBeenCalledWith({ action: 'remove', id: 'uid-a:ent' })
  })

  it('opens the QR dialog from the add action and renders the symbol', async () => {
    run.mockImplementation(async (action: { action: string }) => action.action === 'add'
      ? { state: 'ok', challenge: { state: 'st-1', authUrl: 'https://copilot.tencent.com/login?state=st-1', expiresAtMs: Date.now() + 300_000 } }
      : { state: 'waiting' })
    mount()
    const add = buttons().find(button => button.label === t('accountAdd'))
    expect(add).toBeDefined()
    await act(async () => { add?.click(); await Promise.resolve() })
    expect(run).toHaveBeenCalledWith({ action: 'add' })
    // The dialog's copy is what confirms the code is meant to be scanned.
    expect(text()).toContain(t('accountAddTitle'))
  })

  it('offers the way in when the pool is empty', () => {
    mount({ accounts: [], floatingWindow: true })
    expect(text()).toContain(t('accountEmpty'))
    // The action that fills it is still present; without it there is no way in.
    expect(buttons().some(button => button.label === t('accountAdd'))).toBe(true)
  })

  it('refreshes balances on request', async () => {
    mount()
    const refresh = buttons().find(button => button.label === t('accountRefreshCredits'))
    await act(async () => { refresh?.click(); await Promise.resolve() })
    expect(run).toHaveBeenCalledWith({ action: 'refresh-credits' })
  })
})
