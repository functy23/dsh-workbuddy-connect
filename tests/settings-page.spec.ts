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
    accounts: { accounts, floatingWindow: true },
    probeKey,
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

  async function mount(): Promise<void> {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(WorkBuddySettingsPage, { t }))
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
  const posted = (): { url: string, body: Record<string, unknown> }[] =>
    request.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown> }))

  it('reads both products from their own routes', async () => {
    await mount()
    const urls = request.mock.calls.map(([url]) => String(url)).sort()
    expect(urls).toEqual([AI_CARD_VARIANT.statusPath, CN_CARD_VARIANT.statusPath].sort())
  })

  it('lists each product under its own heading with its own accounts', async () => {
    await mount()
    const rendered = text()
    expect(rendered).toContain(t(CN_CARD_VARIANT.titleKey))
    expect(rendered).toContain(t(AI_CARD_VARIANT.titleKey))
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

  it('shows a limited account by when it returns, not by its balance', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn([
      account({ available: false, cooldown: { untilMs: Date.now() + 7 * 60_000, reason: 'rate', strikes: 1 } }),
    ])
    await mount()
    expect(text()).toContain(t('accountStateWaiting', { reason: t('accountStateLimited'), minutes: 7 }))
  })

  it('reports an expired pasted token, which cannot renew itself', async () => {
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn([
      account({ id: 'ai:ent', name: '过期账号', origin: 'cookie', renewable: false, expiresAtMs: Date.now() - 1_000 }),
    ])
    await mount()
    expect(text()).toContain(t('accountExpired'))
  })

  it('sends the test and remove actions for the account whose button was pressed', async () => {
    await mount()
    const test = buttons().filter(button => button.label === t('accountTest'))
    expect(test).toHaveLength(2)
    await act(async () => { test[1]?.node.click(); await Promise.resolve() })
    const calls = posted()
    // The second row belongs to the international product, so its action must
    // reach that product's route with that account's id.
    expect(calls.some(call => call.url === AI_CARD_VARIANT.accountPath && call.body['action'] === 'test' && call.body['id'] === 'ai:ent')).toBe(true)

    const remove = buttons().filter(button => button.label === t('accountRemove'))
    await act(async () => { remove[0]?.node.click(); await Promise.resolve() })
    expect(posted().some(call => call.url === CN_CARD_VARIANT.accountPath && call.body['action'] === 'remove' && call.body['id'] === 'uid-a:ent')).toBe(true)
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

  it('offers only the token route for the international product', async () => {
    await mount()
    await act(async () => { buttons().find(button => button.label === t('accountAdd'))?.node.click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('accountAddAi'))?.node.click(); await Promise.resolve() })
    const labels = buttons().map(button => button.label)
    // There is nothing on a phone that completes the international QR flow, so
    // offering it would be offering a path that cannot be walked.
    expect(labels).not.toContain(t('accountLoginQr'))
    expect(labels).toContain(t('accountSubmit'))
    expect(posted()).toHaveLength(0)
  })

  it('submits a pasted token to the product whose dialog is open', async () => {
    await mount()
    await act(async () => { buttons().find(button => button.label === t('accountAdd'))?.node.click(); await Promise.resolve() })
    await act(async () => { buttons().find(button => button.label === t('accountAddCn'))?.node.click(); await Promise.resolve() })
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
    expect(call?.url).toBe(CN_CARD_VARIANT.accountPath)
    expect(call?.body['token']).toBe('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig')
  })

  it('opens the sign-in page in the system browser, not in an in-app window', async () => {
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
    await act(async () => { buttons().find(button => button.label === t('accountOpenLink'))?.node.click() })
    expect(window.open).toHaveBeenCalledWith(
      'https://copilot.tencent.com/login?state=st-1',
      '_blank',
      'noopener,noreferrer',
    )
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
})
