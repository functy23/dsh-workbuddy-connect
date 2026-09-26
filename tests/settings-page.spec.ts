// @vitest-environment jsdom
//
// The page renders its dialogs through portals, so it needs a real DOM.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddySettingsPage } from '../src/client/WorkBuddySettingsPage.tsx'
import { AI_CARD_VARIANT, CN_CARD_VARIANT } from '../src/client/card-variants.ts'
import { en } from '../src/client/locales.ts'
import type { WorkBuddyWebStatus } from '../src/status-paths.ts'

/**
 * The WorkBuddy settings page: both products, their accounts, their totals, and
 * the two-step sign-in flow.
 *
 * The assertions deliberately read the *rendered text and the requests sent*,
 * because those are the two halves that can silently disagree: a page can look
 * right while posting to the other product's route, and a route can be right
 * while the heading names the wrong product.
 */

const t = (key: keyof typeof en, params: Record<string, unknown> = {}): string =>
  Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    en[key] as string,
  )

/** One account fixture. */
function account(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'uid-a:ent', uid: 'uid-a', name: '主账号', origin: 'desktop', domain: 'copilot.tencent.com',
    renewable: true, enabled: true, available: true, credits: 1000,
    expiresAtMs: Date.now() + 3_600_000, lastUsedAtMs: 0, addedAtMs: 0,
    ...overrides,
  }
}

/** A signed-in status document for one product. */
function signedIn(accounts: readonly Record<string, unknown>[], probeKey = 'key'): WorkBuddyWebStatus {
  return {
    status: 'signed-in',
    accounts: { accounts },
    probeKey,
  } as unknown as WorkBuddyWebStatus
}

/** One served model row, as the models section renders it. */
function model(id: string, name = id): Record<string, unknown> {
  return { id, name }
}

/** A signed-in document carrying a model list and the visibility section. */
function withModels(
  models: readonly Record<string, unknown>[],
  visibility: Record<string, unknown> | undefined,
): WorkBuddyWebStatus {
  return {
    ...signedIn([account()]),
    models,
    ...visibility === undefined ? {} : { visibility },
  } as unknown as WorkBuddyWebStatus
}

describe('WorkBuddy settings page', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  /** Status document per route, so each product can answer differently. */
  let byRoute: Record<string, WorkBuddyWebStatus | undefined>
  const request = vi.fn()

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // Real timers on purpose: React's act() flushes through the scheduler, and
    // freezing it makes every interaction wait for a tick that never comes. The
    // page's own intervals are long enough (2s poll, 60s refresh) not to fire
    // inside a test.
    byRoute = {
      [CN_CARD_VARIANT.statusPath]: signedIn([account()]),
      [AI_CARD_VARIANT.statusPath]: signedIn([
        account({ id: 'ai:ent', uid: 'ai', name: '国际账号', origin: 'cookie', renewable: false, credits: 50 }),
      ]),
    }
    request.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ state: 'ok' }) }
      const body = byRoute[url]
      if (body === undefined) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => body }
    })
    vi.stubGlobal('fetch', request)
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** How many times the page asked the sidebar card to re-read. */
  let panelRefreshes = 0

  async function mount(options: { openPanel?: () => void } = {}): Promise<void> {
    panelRefreshes = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(WorkBuddySettingsPage, {
        t,
        // The sidebar card polls on its own minute, so a write that changes how
        // it is drawn has to nudge it — asserted here rather than assumed.
        refreshPanel: () => { panelRefreshes += 1 },
        // The way into the dashboard while the sidebar card is switched off.
        ...options.openPanel === undefined ? {} : { openPanel: options.openPanel },
      }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  /** Every button on the page and in any open portal, by its label. */
  function buttons(): { label: string, node: HTMLButtonElement }[] {
    return [...document.querySelectorAll('button')].map(node => ({
      label: (node.textContent ?? '').trim(),
      node,
    }))
  }

  const text = (): string => document.body.textContent ?? ''

  /**
   * Open every account row.
   *
   * A row's actions live behind its disclosure now — the reference layout hides
   * them until an account is being looked at — so a test that presses one opens
   * the row first, exactly as a user does. Opening EVERY row (rather than
   * guessing an index) keeps the assertion about which route a control posts to
   * where it belongs: in the request, not in the row order.
   */
  async function expandAccountRows(): Promise<void> {
    const toggles = [...document.querySelectorAll('button')]
      .filter(button => button.getAttribute('aria-controls')?.endsWith('-details') === true)
    for (const toggle of toggles) {
      if (toggle.getAttribute('aria-expanded') === 'true') continue
      await act(async () => { toggle.click(); await Promise.resolve() })
    }
  }

  const posted = (): { url: string, body: Record<string, unknown> }[] =>
    request.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown> }))

  /* ------------------------------------------------ the model filter's parts */

  /**
   * A host that reflects its own allowlist writes.
   *
   * The page re-reads after a save, so a mock that kept returning the pre-write
   * document would leave the UI showing the state it just left. Only the
   * allowlist action is intercepted; every other request keeps its default.
   */
  function reflectWrites(): void {
    const defaultImpl = request.getMockImplementation()!
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url) === CN_CARD_VARIANT.probePath) {
        const body = JSON.parse(String(init.body)) as { action?: string, allowlist?: string[] }
        if (body.action === 'set-model-allowlist') {
          byRoute[CN_CARD_VARIANT.statusPath] = {
            ...(byRoute[CN_CARD_VARIANT.statusPath] as object),
            visibility: {
              account: 'uid-a:ent',
              disabled: [],
              ...body.allowlist === undefined || body.allowlist.length === 0
                ? {}
                : { allowlist: body.allowlist },
            },
          } as unknown as WorkBuddyWebStatus
          return { ok: true, json: async () => ({ state: 'updated' }) }
        }
      }
      return defaultImpl(url, init)
    })
  }

  /** The filter's on/off switch for the CN product. */
  const toggle = (): HTMLInputElement =>
    document.querySelector(`#wbp-filter-${CN_CARD_VARIANT.id}`) as HTMLInputElement

  /** The picker's trigger button, which also closes an open menu. */
  const trigger = (): HTMLButtonElement =>
    document.querySelector(`#wbp-filter-models-${CN_CARD_VARIANT.id}`) as HTMLButtonElement

  /** Open the picker's menu. */
  async function openPicker(): Promise<void> {
    await act(async () => { trigger().click(); await Promise.resolve() })
  }

  /** The menu's selectable rows, in catalog order. */
  const rows = (): HTMLButtonElement[] => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')] as HTMLButtonElement[]

  it('reads both products from their own routes', async () => {
    await mount()
    const urls = request.mock.calls.map(([url]) => String(url)).sort()
    expect(urls).toEqual([AI_CARD_VARIANT.statusPath, CN_CARD_VARIANT.statusPath].sort())
  })

  it('lists each product under its own heading with its own accounts', async () => {
    await mount()
    const rendered = text()
    expect(rendered).toContain(CN_CARD_VARIANT.appName)
    expect(rendered).toContain(AI_CARD_VARIANT.appName)
    expect(rendered).toContain('主账号')
    expect(rendered).toContain('国际账号')
  })

  it('totals each product separately rather than summing them together', async () => {
    await mount()
    const totals = [...document.querySelectorAll('*')]
      .filter(node => node.children.length === 0 && (node.textContent ?? '').trim() !== '')
      .map(node => (node.textContent ?? '').trim())
    // 1,000 for the CN account and 50 for the international one.
    expect(totals).toContain('1,000')
    expect(totals).toContain('50')
    // A cross-product sum would be a number that describes nothing: the credits
    // are not convertible and the accounts are not interchangeable.
    expect(totals).not.toContain('1,050')
  })

  it('leaves the total blank when no balance is known', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn([account({ credits: undefined })])
    await mount()
    // An unknown figure is not a zero; showing 0 would claim the account is out.
    expect(document.body.textContent ?? '').toContain('—')
  })

  /**
   * A bench is described by when the account returns, not by its balance: the
   * balance of an account that cannot serve yet is not actionable.
   */
  it('shows a limited account by when it returns, not by its balance', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn([
      account({ available: false, cooldown: { untilMs: Date.now() + 7 * 60_000, reason: 'rate', strikes: 1 } }),
    ])
    await mount()
    // Composed the way the page composes it: the unit is chosen by
    // `describeWait`, the wording is local.
    expect(text()).toContain(t('accountStateWaiting', {
      reason: t('accountStateLimited'),
      when: t('waitMinutes', { value: 7 }),
    }))
  })

  /**
   * An upstream-stated reset can be most of a day away, so the countdown has to
   * change unit rather than report "1078 分钟".
   */
  it('states a long bench in hours', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn([
      account({ available: false, cooldown: { untilMs: Date.now() + 18 * 3_600_000, reason: 'rate', strikes: 1 } }),
    ])
    await mount()
    expect(text()).toContain(t('accountStateWaiting', {
      reason: t('accountStateLimited'),
      when: t('waitHours', { value: 18 }),
    }))
  })

  it('reports an expired pasted token, which cannot renew itself', async () => {
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([
      account({ id: 'ai:ent', name: '过期账号', origin: 'cookie', renewable: false, expiresAtMs: Date.now() - 1_000 }),
    ])
    await mount()
    expect(text()).toContain(t('accountExpired'))
  })

  /**
   * The per-row actions live behind the ⋮ trigger, one per account (the
   * reference implementation's AccountItem shape).
   */
  function accountMenus(): HTMLButtonElement[] {
    return [...document.querySelectorAll('button[aria-haspopup="menu"]')] as HTMLButtonElement[]
  }

  /** Open one account's ⋮ menu by its trigger index. */
  async function openAccountMenu(index: number): Promise<void> {
    await act(async () => { accountMenus()[index]?.click(); await Promise.resolve() })
  }

  it('offers each account its own ⋮ menu, and routes the chosen action to its product', async () => {
    await mount()
    expect(accountMenus()).toHaveLength(2)

    // The second row belongs to the international product, so its action must
    // reach that product's route with that account's id.
    await openAccountMenu(1)
    const testRow = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
      .find(row => row.textContent === t('accountTest')) as HTMLButtonElement | undefined
    await act(async () => { testRow?.click(); await Promise.resolve() })
    const calls = posted()
    expect(calls.some(call => call.url === AI_CARD_VARIANT.accountPath && call.body['action'] === 'test' && call.body['id'] === 'ai:ent')).toBe(true)
    // Choosing a row closes the menu.
    expect(document.querySelector('[role="menu"]')).toBeNull()

    // Removing asks inline first, in the row's own confirm bar.
    await openAccountMenu(0)
    const removeRow = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
      .find(row => row.textContent === t('accountRemoveAction')) as HTMLButtonElement | undefined
    await act(async () => { removeRow?.click(); await Promise.resolve() })
    expect(document.body.textContent ?? '').toContain(t('accountRemoveConfirm', { name: '主账号' }))
    expect(posted().some(call => call.body['action'] === 'remove')).toBe(false)

    await act(async () => { buttons().find(button => button.label === t('accountRemove'))?.node.click(); await Promise.resolve() })
    expect(posted().some(call => call.url === CN_CARD_VARIANT.accountPath && call.body['action'] === 'remove' && call.body['id'] === 'uid-a:ent')).toBe(true)
  })

  /**
   * The sidebar's display style: a row on this page, written immediately, and
   * read back from the status document so the sidebar redraws with it.
   */
  it('offers the sidebar display style and stores the chosen one', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = {
      ...withModels([model('m1')], { account: 'uid-a:ent', disabled: [] }),
      sidebarCreditStyle: 'remaining',
    } as unknown as WorkBuddyWebStatus
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    await mount()

    // The row states the current style and offers the other one.
    expect(text()).toContain(t('sidebarStyleHeading'))
    expect(text()).toContain(t('sidebarStyleRemaining'))
    const options = [...document.querySelectorAll('[role="radio"]')] as HTMLButtonElement[]
    const usage = options.find(option => option.textContent === t('sidebarStyleUsage'))
    expect(usage).toBeDefined()

    await act(async () => { usage?.click(); await Promise.resolve(); await Promise.resolve() })
    const call = posted().find(entry => entry.body['action'] === 'set-sidebar-credit-style')
    expect(call?.url).toBe(CN_CARD_VARIANT.probePath)
    expect(call?.body['creditStyle']).toBe('usage')
    // The card outside this page is told to redraw now, not at its next tick.
    expect(panelRefreshes).toBeGreaterThan(0)
  })

  it('hides the row when the host cannot state the preference', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels([model('m1')], { account: 'uid-a:ent', disabled: [] })
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    await mount()
    // No sidebarCreditStyle in the document: an older host. A control whose
    // write could not be stored is worse than no control.
    expect(text()).not.toContain(t('sidebarStyleHeading'))
    // The same for the switch beside it: a host that cannot state the field
    // renders neither control, rather than a switch that could not be saved.
    expect(document.querySelector('#wbp-sidebar-visible')).toBeNull()
  })

  /**
   * The switch that takes the sidebar card away.
   *
   * Three facts have to hold at once — the switch mirrors the document, the
   * write is immediate, and turning it off leaves the dashboard reachable — so
   * they are asserted together. Individually they would each pass while the
   * combination stranded the user with no way into the panel the card opens.
   */
  it('turns the sidebar card off, yields its style row, and keeps the dashboard reachable', async () => {
    const off = (visible: boolean): WorkBuddyWebStatus => ({
      ...withModels([model('m1')], { account: 'uid-a:ent', disabled: [] }),
      sidebarCreditStyle: 'remaining',
      sidebarCreditVisible: visible,
    }) as unknown as WorkBuddyWebStatus
    byRoute[CN_CARD_VARIANT.statusPath] = off(true)
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    // A host that reflects its own writes: the page re-reads after one, so a
    // mock still answering the pre-write document would leave the switch
    // showing the state it just left.
    const reflected = request.getMockImplementation()!
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ state: 'updated' }) }
      return reflected(url, init)
    })
    let opened = 0
    await mount({ openPanel: () => { opened += 1 } })

    // On: the switch mirrors the document, and the dashboard row is NOT drawn —
    // the sidebar card is that destination, and this page does not duplicate a
    // door that is already open.
    const toggle = document.querySelector('#wbp-sidebar-visible') as HTMLInputElement | null
    expect(toggle?.checked).toBe(true)
    expect(text()).toContain(t('sidebarStyleRemaining'))
    expect(text()).not.toContain(t('sidebarDashboardOpen'))

    byRoute[CN_CARD_VARIANT.statusPath] = off(false)
    await act(async () => { toggle?.click(); await Promise.resolve(); await Promise.resolve() })

    const call = posted().find(entry => entry.body['action'] === 'set-sidebar-credit-visible')
    expect(call?.url).toBe(CN_CARD_VARIANT.probePath)
    // The off value has to travel as `false`, not as an omitted field: the route
    // refuses a payload that does not carry it.
    expect(call?.body['enabled']).toBe(false)
    // The sidebar outside this page is told to redraw now, not at its next tick.
    expect(panelRefreshes).toBeGreaterThan(0)

    // Off: the style row described a card that is no longer drawn, so it goes;
    // the way into the dashboard takes its place.
    expect(text()).not.toContain(t('sidebarStyleRemaining'))
    const open = buttons().find(button => button.label === t('sidebarDashboardOpen'))
    expect(open).toBeDefined()
    await act(async () => { open?.node.click(); await Promise.resolve() })
    expect(opened).toBe(1)
  })

  it('offers the switch alone when the page cannot reach the dashboard', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = {
      ...withModels([model('m1')], { account: 'uid-a:ent', disabled: [] }),
      sidebarCreditVisible: false,
    } as unknown as WorkBuddyWebStatus
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    // No `openPanel`: a profile whose client entry has no layout seam. The
    // switch still works — it is the row that cannot be offered, not the write.
    await mount()
    const toggle = document.querySelector('#wbp-sidebar-visible') as HTMLInputElement | null
    expect(toggle?.checked).toBe(false)
    expect(text()).not.toContain(t('sidebarDashboardOpen'))
  })

  /**
   * The expanded card's usage report — the reference implementation's stat grid,
   * with the figures this plugin actually has: the cycle's used/remaining from
   * the upstream, and the request tally it counted itself.
   */
  it('reports an account cycle figures and request tally when expanded', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn([
      account({ credits: 800, creditsTotal: 1000, creditsUsed: 200, usage: {
        requests: 12,
        reported: 10,
        promptTokens: 1_000_000,
        completionTokens: 25_000,
        cacheReadTokens: 750_000,
        cacheWriteTokens: 0,
        cacheHitRate: 0.75,
        sinceMs: Date.now() - 86_400_000,
        lastAtMs: Date.now(),
      } }),
    ])
    await mount()
    await expandAccountRows()
    const rendered = text()
    expect(rendered).toContain('200')          // used this cycle
    expect(rendered).toContain('800')          // remaining
    expect(rendered).toContain('12')           // requests
    expect(rendered).toContain('1M')           // input tokens, compact
    expect(rendered).toContain('25K')          // output tokens
    expect(rendered).toContain('75.0%')        // cache hit rate
  })

  it('says the cache rate is unreported instead of showing zero, and omits absent tiles', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn([
      account({ credits: 500, usage: {
        requests: 4,
        reported: 4,
        promptTokens: 4_000,
        completionTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        sinceMs: Date.now(),
        lastAtMs: Date.now(),
      } }),
    ])
    await mount()
    await expandAccountRows()
    const rendered = text()
    // The upstream never reported a cache figure, so a 0% would be a claim.
    expect(rendered).toContain(t('usageCacheUnknown'))
    expect(rendered).not.toContain('0.0%')
    // No cap was declared, so the used-this-cycle tile is absent rather than 0.
    expect(rendered).not.toContain(t('usageUsed'))
    expect(rendered).toContain(t('accountCycleUncapped'))
  })

  it('renames an account inline, from the menu entry of the row it belongs to', async () => {
    await mount()
    await openAccountMenu(0)
    const renameRow = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
      .find(row => row.textContent === t('accountRename')) as HTMLButtonElement | undefined
    await act(async () => { renameRow?.click(); await Promise.resolve() })

    // The editor opens in the row, prefilled with the current name.
    const input = document.querySelector('.wbp-inlineForm input') as HTMLInputElement | null
    expect(input?.value).toBe('主账号')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setValue?.call(input, '新名字')
      input?.dispatchEvent(new window.Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => { buttons().find(button => button.label === t('accountApply'))?.node.click(); await Promise.resolve() })
    const call = posted().find(entry => entry.body['action'] === 'label')
    expect(call?.url).toBe(CN_CARD_VARIANT.accountPath)
    expect(call?.body['id']).toBe('uid-a:ent')
    expect(call?.body['label']).toBe('新名字')
  })

  /**
   * The enable/disable entry is the user's override for rotation's own
   * decisions, and the only way back for an account the plugin judged dead.
   */
  it('toggles an account from its menu, wording the entry for its state', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn([account(), account({ id: 'uid-off:ent', name: '停用账号', enabled: false, available: false })])
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    await mount()

    await openAccountMenu(0)
    const disableRow = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
      .find(row => row.textContent === t('accountDisable')) as HTMLButtonElement | undefined
    await act(async () => { disableRow?.click(); await Promise.resolve() })
    expect(posted().some(call => call.body['action'] === 'enable' && call.body['id'] === 'uid-a:ent' && call.body['enabled'] === false)).toBe(true)

    await openAccountMenu(1)
    const enableRow = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
      .find(row => row.textContent === t('accountEnable')) as HTMLButtonElement | undefined
    expect(enableRow).toBeDefined()
    await act(async () => { enableRow?.click(); await Promise.resolve() })
    expect(posted().some(call => call.body['action'] === 'enable' && call.body['id'] === 'uid-off:ent' && call.body['enabled'] === true)).toBe(true)
  })

  it('offers a product picker before any login dialog', async () => {
    await mount()
    const add = buttons().find(button => button.label === t('accountAdd'))
    expect(add).toBeDefined()
    await act(async () => { add?.node.click(); await Promise.resolve() })
    const labels = buttons().map(button => button.label)
    expect(labels).toContain(t('accountAddCn'))
    expect(labels).toContain(t('accountAddAi'))
    // Nothing is minted until a product is chosen.
    expect(posted()).toHaveLength(0)
  })

  it('mints a QR challenge on the chosen product route', async () => {
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            state: 'ok',
            challenge: { state: 'st-1', authUrl: 'https://copilot.tencent.com/login?state=st-1', expiresAtMs: Date.now() + 300_000 },
          }),
        }
      }
      return { ok: true, json: async () => byRoute[url] }
    })
    await mount()
    await act(async () => { buttons().find(button => button.label === t('accountAdd'))?.node.click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('accountAddCn'))?.node.click(); await Promise.resolve() })
    // The dialog shows the segment and mints against the CN route only.
    expect(posted().some(call => call.url === CN_CARD_VARIANT.accountPath && call.body['action'] === 'add')).toBe(true)
    expect(posted().every(call => call.url === CN_CARD_VARIANT.accountPath)).toBe(true)
    expect(buttons().map(button => button.label)).toContain(t('accountLoginQr'))
    expect(buttons().map(button => button.label)).toContain(t('accountLoginToken'))
  })

  it('offers the web route, not a scannable code, for the international product', async () => {
    await mount()
    await act(async () => { buttons().find(button => button.label === t('accountAdd'))?.node.click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('accountAddAi'))?.node.click(); await Promise.resolve() })
    const labels = buttons().map(button => button.label)
    // There is nothing on a phone that completes the international QR flow, so
    // offering a code would be offering a path that cannot be walked.
    expect(labels).not.toContain(t('accountLoginQr'))
    // It offers the browser route instead: the international token has to be
    // obtained somewhere, and that page is where.
    expect(labels).toContain(t('accountLoginWeb'))
    expect(labels).toContain(t('accountLoginToken'))
    // The browser route mints its challenge on open, exactly as the code route
    // does, so the login URL it opens is one the host is already polling.
    const calls = posted()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body['action']).toBe('add')
    expect(calls[0]?.url).toBe(AI_CARD_VARIANT.accountPath)
  })

  /**
   * The browser route must reach the product's *login* page, not its marketing
   * site — and it must get there through the host, because the login URL is the
   * `authUrl` the host mints alongside the state it is polling.
   *
   * This is the assertion that would have caught the earlier version of this
   * route, which opened a hardcoded home page and therefore never actually
   * signed anybody in.
   */
  it('mints a challenge and opens the minted login URL for the browser route', async () => {
    const loginUrl = 'https://www.workbuddy.ai/login?platform=CLI&state=st-ai'
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            state: 'ok',
            challenge: { state: 'st-ai', authUrl: loginUrl, expiresAtMs: Date.now() + 300_000 },
          }),
        }
      }
      return { ok: true, json: async () => byRoute[url] }
    })
    await mount()
    await act(async () => { buttons().find(button => button.label === t('accountAdd'))?.node.click(); await Promise.resolve() })
    await act(async () => {
      buttons().find(button => button.label === t('accountAddAi'))?.node.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    // The challenge is minted against the international route, exactly as the
    // code route would.
    expect(posted().some(call => call.url === AI_CARD_VARIANT.accountPath && call.body['action'] === 'add')).toBe(true)
    // And the login page opens on its own, without a second click.
    expect(window.open).toHaveBeenCalledWith(
      loginUrl,
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('shows the browser route waiting, so the user knows the tab is not the end of it', async () => {
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            state: 'ok',
            challenge: { state: 'st-ai', authUrl: 'https://www.workbuddy.ai/login?state=st-ai', expiresAtMs: Date.now() + 300_000 },
          }),
        }
      }
      return { ok: true, json: async () => byRoute[url] }
    })
    await mount()
    await act(async () => { buttons().find(button => button.label === t('accountAdd'))?.node.click(); await Promise.resolve() })
    await act(async () => {
      buttons().find(button => button.label === t('accountAddAi'))?.node.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    // The account lands on its own, so the dialog has to say it is waiting —
    // otherwise the browser tab reads as the whole flow and the user never
    // learns the plugin finished it for them.
    expect(text()).toContain(t('accountWebWaiting', { seconds: 300 }))
  })

  it('submits a pasted token to the product whose dialog is open', async () => {
    await mount()
    await act(async () => { buttons().find(button => button.label === t('accountAdd'))?.node.click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('accountAddAi'))?.node.click(); await Promise.resolve() })
    // The international dialog opens on the web route, so the token half has to
    // be selected before the field exists.
    await act(async () => { buttons().find(button => button.label === t('accountLoginToken'))?.node.click(); await Promise.resolve() })

    const area = document.querySelector('textarea')
    expect(area).not.toBeNull()
    // React tracks the value internally, so the change must go through the
    // native setter before the event, or the component never sees the text.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(area, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig')
      area?.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      buttons().find(button => button.label === t('accountSubmit'))?.node.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const call = posted().find(entry => entry.body['action'] === 'add-cookie')
    expect(call).toBeDefined()
    // The international dialog's token must reach the international pool.
    expect(call?.url).toBe(AI_CARD_VARIANT.accountPath)
    expect(call?.body['token']).toBe('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig')
  })

  /** A host that mints one sign-in challenge and then answers the link POST too. */
  function challengeHost(link: { state: string, ok?: boolean, authUrl?: string }): void {
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { action?: string }
        if (body.action === 'open-link') {
          const ok = link.ok !== false
          return { ok, status: ok ? 200 : 500, json: async () => ({ state: link.state }) }
        }
        return {
          ok: true,
          json: async () => ({
            state: 'ok',
            challenge: { state: 'st-1', authUrl: link.authUrl ?? AUTH_URL, expiresAtMs: Date.now() + 300_000 },
          }),
        }
      }
      return { ok: true, json: async () => byRoute[url] }
    })
  }

  const AUTH_URL = 'https://copilot.tencent.com/login?state=st-1'

  /** Open the CN sign-in dialog, which mints the challenge. */
  async function openAddDialog(): Promise<void> {
    await act(async () => { buttons().find(button => button.label === t('accountAdd'))?.node.click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('accountAddCn'))?.node.click(); await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
  }

  it('opens the sign-in page in the system browser, not in an in-app window', async () => {
    challengeHost({ state: 'opened' })
    await mount()
    await openAddDialog()
    await act(async () => { buttons().find(button => button.label === t('accountOpenLink'))?.node.click() })
    expect(window.open).toHaveBeenCalledWith(
      'https://copilot.tencent.com/login?state=st-1',
      '_blank',
      'noopener,noreferrer',
    )
  })

  /**
   * The desktop case, and the defect this covers: the shell answers
   * `window.open` with nothing, so the page has to route the link through the
   * host — the one process that can reach the operating system.
   */
  it('routes a sign-in link through the host when the shell swallows window.open', async () => {
    vi.stubGlobal('open', vi.fn(() => { throw new Error('blocked by the shell') }))
    challengeHost({ state: 'opened' })
    await mount()
    await openAddDialog()
    await act(async () => { buttons().find(button => button.label === t('accountOpenLink'))?.node.click(); await Promise.resolve(); await Promise.resolve() })
    const call = posted().find(entry => entry.body['action'] === 'open-link')
    expect(call).toBeDefined()
    // The CN dialog posts to the CN route, keyed with the key the host handed
    // this page — the same guard every other write on that route uses.
    expect(call?.url).toBe(CN_CARD_VARIANT.probePath)
    expect(call?.body['url']).toBe(AUTH_URL)
    expect(request.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')?.[1])
      .toBeDefined()
  })

  it('tries the host before giving up, and does not claim the failure case is a success', async () => {
    vi.stubGlobal('open', vi.fn(() => { throw new Error('blocked by the shell') }))
    challengeHost({ state: 'failed', ok: false, authUrl: 'file:///etc/passwd' })
    await mount()
    await openAddDialog()
    await act(async () => { buttons().find(button => button.label === t('accountOpenLink'))?.node.click(); await Promise.resolve(); await Promise.resolve() })
    // A link no strategy will touch (not http/https) has to reach the user as
    // the address itself: the input is the one place the dialog can put text
    // that can be selected and copied.
    const shown = [...document.querySelectorAll('input')].map(node => (node as HTMLInputElement).value)
    expect(shown).toContain('file:///etc/passwd')
    // The non-web link never reached the host, which only opens http(s).
    expect(posted().some(entry => entry.body['action'] === 'open-link')).toBe(false)
  })

  it('shows each product\'s model list with its promotions and context length', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = {
      ...signedIn([account()]),
      models: [
        { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000, credits: 'x0.79', badges: ['限时免费'] },
        { id: 'glm-5.1', name: 'GLM-5.1', contextWindow: 200_000, credits: 'x0.79' },
      ],
      catalog: { source: 'live', fetchedAt: Date.now() },
    } as unknown as WorkBuddyWebStatus
    await mount()
    const rendered = text()
    expect(rendered).toContain(t('modelsHeading'))
    expect(rendered).toContain('GLM-5.3')
    // The promotion rides the row beside the name: it is part of what the row
    // is offering, not a separate section.
    expect(rendered).toContain('限时免费')
    expect(rendered).toContain(t('rate', { rate: 'x0.79' }))
    expect(rendered).toContain('1M')
  })

  it('offers a context switch only where the model declares a choice', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = {
      ...signedIn([account()]),
      models: [
        // Two declared windows: a switch.
        { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', contextWindow: 1_000_000, contextChoices: [200_000, 1_000_000], contextChoice: 1_000_000 },
        // One window: a fact, not a control.
        { id: 'glm-5.1', name: 'GLM-5.1', contextWindow: 200_000 },
      ],
    } as unknown as WorkBuddyWebStatus
    await mount()
    const groups = [...document.querySelectorAll('[role="radiogroup"]')]
    // Only the model with something to choose gets a radiogroup.
    expect(groups).toHaveLength(1)
    expect(groups[0]?.getAttribute('aria-label')).toContain('GPT-5.6-Sol')
    const radios = [...(groups[0]?.querySelectorAll('[role="radio"]') ?? [])]
    expect(radios.map(node => (node.textContent ?? '').trim())).toEqual(['200K', '1M'])
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true')
  })

  it('posts the chosen context length for the right product', async () => {
    byRoute[AI_CARD_VARIANT.statusPath] = {
      ...signedIn([account({ id: 'ai:ent', name: '国际账号' })], 'ai-key'),
      models: [
        { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', contextWindow: 1_000_000, contextChoices: [300_000, 1_000_000], contextChoice: 1_000_000 },
      ],
    } as unknown as WorkBuddyWebStatus
    await mount()
    const radios = [...document.querySelectorAll('[role="radio"]')]
    await act(async () => { (radios[0] as HTMLElement | undefined)?.click(); await Promise.resolve() })
    const call = posted().find(entry => entry.body['action'] === 'context')
    expect(call).toBeDefined()
    // The international model's choice must reach the international route, with
    // the length that was clicked.
    expect(call?.url).toBe(AI_CARD_VARIANT.accountPath)
    expect(call?.body['model']).toBe('gpt-5.6-luna')
    expect(call?.body['length']).toBe(300_000)
  })

  it('refreshes the model list through the probe route', async () => {
    await mount()
    const refresh = buttons().find(button => button.label === t('modelsRefresh'))
    expect(refresh).toBeDefined()
    await act(async () => { refresh?.node.click(); await Promise.resolve() })
    const call = posted().find(entry => entry.body['action'] === 'refresh')
    expect(call).toBeDefined()
    // A catalog fetch is what the probe route already does; the account route
    // owns the pool.
    expect(call?.url).toBe(CN_CARD_VARIANT.probePath)
  })

  it('lists both products\' accounts in one block, each labelled with its product', async () => {
    await mount()
    // The two pools are shown as one list, and this is the assertion that would
    // fail if they were split back into two blocks: both account names must be
    // siblings in the same container.
    const rendered = text()
    expect(rendered).toContain('主账号')
    expect(rendered).toContain('国际账号')
    // Each row states its product, in the upper case the label is rendered in.
    const labels = [...document.querySelectorAll('*')]
      .filter(node => node.children.length === 0)
      .map(node => (node.textContent ?? '').trim())
    expect(labels).toContain(CN_CARD_VARIANT.appName)
    expect(labels).toContain(AI_CARD_VARIANT.appName)
  })

  it('keeps the two products\' totals separate', async () => {
    await mount()
    const leaves = [...document.querySelectorAll('*')]
      .filter(node => node.children.length === 0)
      .map(node => (node.textContent ?? '').trim())
    // 1,000 for the CN account and 50 for the international one — reported
    // side by side, never added.
    expect(leaves).toContain('1,000')
    expect(leaves).toContain('50')
    expect(leaves).not.toContain('1,050')
  })

  it('routes each merged row\'s action to its own product', async () => {
    await mount()
    await expandAccountRows()
    // The rows are interleaved by product now, so the second Test button is the
    // international account's; its request must go to the international route.
    const test = buttons().filter(button => button.label === t('accountTest'))
    expect(test).toHaveLength(2)
    await act(async () => { test[1]?.node.click(); await Promise.resolve() })
    const call = posted().find(entry => entry.body['action'] === 'test')
    expect(call?.url).toBe(AI_CARD_VARIANT.accountPath)
    expect(call?.body['id']).toBe('ai:ent')
  })

  it('shows the upstream\'s own promotion wording without repeating "free"', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = {
      ...signedIn([account()]),
      models: [
        // The international catalog's shape: a badge naming the promotion *and*
        // the derived free flag. Both facts, one claim.
        { id: 'a', name: 'Free Model', free: true, badges: ['Free now'] },
        // A free model whose catalog declares no badge at all: the derived chip
        // is the only thing that can say so.
        { id: 'b', name: 'Quiet Free', free: true },
        // A promotion that is not about being free must survive untouched.
        { id: 'c', name: 'Night', badges: ['夜间折扣'] },
      ],
    } as unknown as WorkBuddyWebStatus
    await mount()
    const chips = [...document.querySelectorAll('span')]
      .map(node => (node.textContent ?? '').trim())
      .filter(label => label !== '')
    // The upstream's wording, verbatim — not translated and not doubled.
    expect(chips).toContain('Free now')
    expect(chips.filter(chip => chip === 'Free now')).toHaveLength(1)
    // The derived label still covers the model that has no badge.
    expect(chips).toContain(t('freeModel'))
    expect(chips.filter(chip => chip === t('freeModel'))).toHaveLength(1)
    // An unrelated promotion is left alone.
    expect(chips).toContain('夜间折扣')
  })

  it('offers a detection button only for models the host lists as candidates', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = {
      ...signedIn([account()]),
      models: [
        { id: 'probe-me', name: 'Probe Me' },
        { id: 'declared', name: 'Already Declared' },
      ],
      probe: { consent: true, running: false, candidates: ['probe-me'], results: [] },
    } as unknown as WorkBuddyWebStatus
    await mount()
    const detect = buttons().filter(button => button.label === t('probeStart'))
    // One button, on the candidate row only: a model that already states its
    // levels has nothing to discover, and probing it would spend credit for it.
    expect(detect).toHaveLength(1)
    expect(text()).toContain('Probe Me')
  })

  it('asks before spending credit, then probes the model it asked about', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = {
      ...signedIn([account()]),
      models: [{ id: 'probe-me', name: 'Probe Me' }],
      probe: { consent: true, running: false, candidates: ['probe-me'], results: [] },
    } as unknown as WorkBuddyWebStatus
    await mount()
    await act(async () => { buttons().find(button => button.label === t('probeStart'))?.node.click(); await Promise.resolve() })
    // Nothing is sent until the user agrees: a detection is real traffic against
    // their own quota.
    expect(posted()).toHaveLength(0)
    expect(text()).toContain(t('probeConfirmBody', { model: 'Probe Me' }))

    await act(async () => {
      buttons().find(button => button.label === t('probeConfirmAction'))?.node.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const call = posted().find(entry => entry.body['action'] === 'probe')
    expect(call).toBeDefined()
    expect(call?.url).toBe(CN_CARD_VARIANT.probePath)
    expect(call?.body['model']).toBe('probe-me')
  })

  it('reports why a detection could not finish', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = {
      ...signedIn([account()]),
      models: [{ id: 'probe-me', name: 'Probe Me' }],
      probe: { consent: false, running: false, candidates: ['probe-me'], results: [] },
    } as unknown as WorkBuddyWebStatus
    // The probe route answers a refusal with `unavailable`, not `failed` —
    // a state name worth pinning, because reading for the wrong one turns every
    // refusal into silence.
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ state: 'unavailable', reason: 'no WorkBuddy credential' }) }
      }
      return { ok: true, json: async () => byRoute[url] }
    })
    await mount()
    await act(async () => { buttons().find(button => button.label === t('probeStart'))?.node.click(); await Promise.resolve() })
    await act(async () => {
      buttons().find(button => button.label === t('probeConfirmAction'))?.node.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(text()).toContain('no WorkBuddy credential')
  })

  it('shows a recorded detection beside the model it belongs to', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = {
      ...signedIn([account()]),
      models: [{ id: 'probe-me', name: 'Probe Me' }],
      probe: {
        consent: true,
        running: false,
        candidates: ['probe-me'],
        results: [{ id: 'probe-me', name: 'Probe Me', validation: 'validating', efforts: ['low', 'high'], probedAt: Date.now() }],
      },
    } as unknown as WorkBuddyWebStatus
    await mount()
    // The recorded answer is visible without re-running anything, and the button
    // switches to re-detection.
    expect(text()).toContain('low / high')
    expect(buttons().some(button => button.label === t('probeRedetect'))).toBe(true)
  })

  it('surfaces a refusal from the host instead of failing silently', async () => {
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ state: 'failed', reason: 'that is a WorkBuddy (CN) token' }) }
      }
      return { ok: true, json: async () => byRoute[url] }
    })
    await mount()
    await act(async () => { buttons().find(button => button.label === t('accountAdd'))?.node.click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('accountAddAi'))?.node.click(); await Promise.resolve() })
    // The international dialog opens on the web route; the token field lives
    // behind the other segment.
    await act(async () => { buttons().find(button => button.label === t('accountLoginToken'))?.node.click(); await Promise.resolve() })
    const area = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(area, 'token')
      area?.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      buttons().find(button => button.label === t('accountSubmit'))?.node.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(text()).toContain('that is a WorkBuddy (CN) token')
  })

  /**
   * The model filter, as the reference implementation shapes it: a picker row
   * whose switch governs a selection made in a dropdown, with the write staged
   * until Save.
   *
   * Regression guard for the reported defect — the switch used to promise a
   * choice the list gave no way to make.
   */
  it('offers a model filter only when the account can store one', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels([model('m1'), model('m2')], undefined)
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    await mount()
    // No visibility section (an account with no stable uid): no filter control,
    // because there is no bucket to key the preference by.
    expect(document.querySelector('#wbp-filter-workbuddy')).toBeNull()
    expect(document.querySelector('#wbp-filter-models-workbuddy')).toBeNull()
  })

  it('opens a searchable picker over the catalog, and stages the picks', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels(
      [model('m1', 'Model One'), model('m2', 'Model Two'), model('m3', 'Model Three')],
      { account: 'uid-a:ent', disabled: [] },
    )
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    await mount()

    // Off: nothing is filtered, so the trigger says nothing about models.
    expect(trigger().textContent).toBe(t('modelPick'))
    expect(toggle().checked).toBe(false)

    await openPicker()
    // Every model the catalog offers is a row in the menu.
    expect(rows().map(row => row.textContent)).toEqual(['Model One', 'Model Two', 'Model Three'])

    // Search narrows the rows without touching the selection.
    const search = document.querySelector('.wbp-modelSearch') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setValue?.call(search, 'Three')
      search.dispatchEvent(new window.Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    expect(rows().map(row => row.textContent)).toEqual(['Model Three'])
    // Pick the model the search narrowed to: with the filter off the menu edits
    // the whole catalog, so this one click also decides what stays visible.
    await act(async () => { rows()[0]!.click(); await Promise.resolve() })

    // Closing commits the visit's picks as a STAGED edit: one write per visit,
    // and nothing at all until Save.
    await act(async () => { trigger().click(); await Promise.resolve() })
    const staged = posted().filter(call => call.body['action'] === 'set-model-allowlist')
    expect(staged).toEqual([])
    // Picking is what turns the filter on, and the label now names what it
    // keeps: the catalog minus the model that was unticked.
    expect(trigger().textContent).toBe(t('modelPickCount', { count: 2 }))
    expect(toggle().checked).toBe(true)
    expect(document.body.textContent ?? '').toContain(t('saveBarUnsaved'))
  })

  it('writes the staged selection on Save, and discards it on Discard', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels(
      [model('m1', 'Model One'), model('m2', 'Model Two')],
      { account: 'uid-a:ent', disabled: [] },
    )
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    reflectWrites()
    await mount()

    // Seed the stage: switch on (whole catalog), then drop the second model.
    await act(async () => { toggle().click(); await Promise.resolve() })
    await openPicker()
    await act(async () => { rows()[1]!.click(); await Promise.resolve() })
    await act(async () => { trigger().click(); await Promise.resolve() })
    expect(posted().filter(call => call.body['action'] === 'set-model-allowlist')).toEqual([])

    // Discard puts the row back where the host says it is.
    await act(async () => { buttons().find(button => button.label === t('saveBarDiscard'))?.node.click(); await Promise.resolve() })
    expect(toggle().checked).toBe(false)
    expect(trigger().textContent).toBe(t('modelPick'))
    expect(document.body.textContent ?? '').not.toContain(t('saveBarUnsaved'))

    // Stage again and save: one write, naming the account the row belongs to.
    await act(async () => { toggle().click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('saveBarSave'))?.node.click(); await Promise.resolve(); await Promise.resolve() })
    const written = posted().filter(call => call.body['action'] === 'set-model-allowlist')
    expect(written).toHaveLength(1)
    expect(written[0]?.url).toBe(CN_CARD_VARIANT.probePath)
    expect(written[0]?.body['allowlist']).toEqual(['m1', 'm2'])
    expect(written[0]?.body['account']).toBe('uid-a:ent')
    // The bar acknowledges the save, then retires: unsaved copy is gone and the
    // staged edit is no longer pending.
    expect(document.body.textContent ?? '').not.toContain(t('saveBarUnsaved'))
    expect(document.body.textContent ?? '').toContain(t('saveBarSaved'))
    // Nothing is staged any more, so the bar has nothing to act on: its buttons
    // are gone rather than offering an action that would do nothing.
    expect(buttons().some(button => button.label === t('saveBarSave'))).toBe(false)
  })

  it('seeds the whole catalog when the switch goes on with nothing picked', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels(
      [model('m1', 'Model One'), model('m2', 'Model Two'), model('m3', 'Model Three')],
      { account: 'uid-a:ent', disabled: [] },
    )
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    reflectWrites()
    await mount()

    await act(async () => { toggle().click(); await Promise.resolve() })
    expect(trigger().textContent).toBe(t('modelPickCount', { count: 3 }))
    await act(async () => { buttons().find(button => button.label === t('saveBarSave'))?.node.click(); await Promise.resolve(); await Promise.resolve() })
    expect(posted().filter(call => call.body['action'] === 'set-model-allowlist').at(-1)?.body['allowlist'])
      .toEqual(['m1', 'm2', 'm3'])
  })

  it('marks the models the filter excludes, and only while it is on', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels(
      [model('m1', 'Model One'), model('m2', 'Model Two')],
      { account: 'uid-a:ent', disabled: [], allowlist: ['m1'] },
    )
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    await mount()

    // One row marked: the model outside the filter. The other keeps its row.
    expect(document.querySelectorAll('.wbp-modelFiltered')).toHaveLength(1)
    expect(document.querySelectorAll('.wbp-modelRow')).toHaveLength(2)

    // Switch off stages the clear, so nothing is excluded any more and the
    // marks go with it.
    await act(async () => { toggle().click(); await Promise.resolve() })
    expect(document.querySelectorAll('.wbp-modelFiltered')).toHaveLength(0)
  })

  it('shows the whole catalog as picked when the host reports no filter', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels(
      [model('m1', 'Model One'), model('m2', 'Model Two')],
      { account: 'uid-a:ent', disabled: [] },
    )
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    await mount()

    // Off means "everything visible", so the row claims no selection — and the
    // list shows no model as excluded, because none is.
    expect(toggle().checked).toBe(false)
    expect(trigger().textContent).toBe(t('modelPick'))
    expect(document.querySelectorAll('.wbp-modelFiltered')).toHaveLength(0)

    // The menu still opens over the whole catalog: that is what makes the first
    // pick possible without turning the switch on first.
    await openPicker()
    expect(rows()).toHaveLength(2)
    expect(rows().every(row => row.dataset['checked'] === 'true')).toBe(true)
  })

  it('refuses the pick that would empty the filter', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels(
      [model('m1', 'Model One'), model('m2', 'Model Two')],
      { account: 'uid-a:ent', disabled: [], allowlist: ['m1'] },
    )
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    reflectWrites()
    await mount()

    await openPicker()
    // Only m1 is picked; dropping it would mean "no filter" and reopen the
    // whole catalog, so the pick is refused and the row stays checked.
    await act(async () => { rows()[0]!.click(); await Promise.resolve() })
    expect(trigger().textContent).toBe(t('modelPickCount', { count: 1 }))
  })

  /**
   * A host built before the allowlist action existed — the state this was
   * reported from — answers 400. The filter still has to work, so the save
   * falls back to the per-model hide list (which every host build has) and says
   * so, instead of parking a save bar over a switch that never lands.
   */
  it('applies the filter through the hide list when the host does not know the write', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels(
      [model('m1', 'Model One'), model('m2', 'Model Two')],
      { account: 'uid-a:ent', disabled: [] },
    )
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    const defaultImpl = request.getMockImplementation()!
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url) === CN_CARD_VARIANT.probePath) {
        const body = JSON.parse(String(init.body)) as { action?: string }
        if (body.action === 'set-model-allowlist') {
          return { ok: false, status: 400, json: async () => ({ error: 'invalid action' }) }
        }
        if (body.action === 'set-model-visibility') return { ok: true, json: async () => ({ state: 'updated' }) }
      }
      return defaultImpl(url, init)
    })
    await mount()

    await act(async () => { toggle().click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('saveBarSave'))?.node.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    // The same filter, expressed as visibility writes: everything the switch
    // keeps is shown, everything else hides.
    const visibility = posted().filter(call => call.body['action'] === 'set-model-visibility')
    expect(visibility.map(call => [call.body['model'], call.body['visible']])).toEqual([
      ['m1', true],
      ['m2', true],
    ])
    // And the save is reported as landed, with the note that it took the old
    // route — not left standing as unsaved work.
    expect(document.body.textContent ?? '').toContain(t('filterModelsFallback'))
    expect(document.body.textContent ?? '').not.toContain(t('saveBarUnsaved'))
    expect(document.body.textContent ?? '').toContain(t('saveBarSaved'))
  })

  it('hides exactly the models the filter leaves out, on an old host', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = withModels(
      [model('m1', 'Model One'), model('m2', 'Model Two'), model('m3', 'Model Three')],
      { account: 'uid-a:ent', disabled: [], allowlist: ['m1', 'm3'] },
    )
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([])
    const defaultImpl = request.getMockImplementation()!
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url) === CN_CARD_VARIANT.probePath) {
        const body = JSON.parse(String(init.body)) as { action?: string }
        if (body.action === 'set-model-allowlist') {
          return { ok: false, status: 400, json: async () => ({ error: 'invalid action' }) }
        }
        if (body.action === 'set-model-visibility') return { ok: true, json: async () => ({ state: 'updated' }) }
      }
      return defaultImpl(url, init)
    })
    await mount()

    // m2 is outside the filter, so its row is the unchecked one — ticking it
    // brings it INTO the filter, and the save has to reflect that.
    await openPicker()
    expect(rows().map(row => row.dataset['checked'] === 'true')).toEqual([true, false, true])
    await act(async () => { rows()[1]!.click(); await Promise.resolve() })
    await act(async () => { trigger().click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('saveBarSave'))?.node.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    // All three are kept now, so nothing hides: the hide list is exactly the
    // complement of the tick list, one write per catalog model.
    const visibility = posted().filter(call => call.body['action'] === 'set-model-visibility')
    expect(visibility.map(call => [call.body['model'], call.body['visible']])).toEqual([
      ['m1', true],
      ['m2', true],
      ['m3', true],
    ])
  })

  /**
   * Every key the page can render has a Chinese translation.
   *
   * Typing already makes a MISSING key a compile error (the Chinese record is
   * keyed by the English dictionary); what it cannot see is a key that was added
   * to both records but never actually translated, which renders English text on
   * a Chinese page. The three exceptions are product names — "WorkBuddy" is
   * spelled the same in both languages by design.
   */
  it('translates every settings key', async () => {
    const { en: english, zh: chinese } = await import('../src/client/locales.ts')
    const untranslated = Object.keys(english).filter(key =>
      chinese[key as keyof typeof english] === english[key as keyof typeof english]
      && !['title', 'titleAI', 'navWorkBuddy'].includes(key))
    expect(untranslated).toEqual([])
  })
})
