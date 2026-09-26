import { describe, expect, it, vi } from 'vitest'
import { buildPanelView } from '../src/client/panel.ts'
import { createWorkBuddyPanelStore } from '../src/client/panel-store.ts'
import { panelTranslator, PANEL_COPY_EN, PANEL_COPY_ZH } from '../src/client/panel-copy.ts'
import { CARD_VARIANTS } from '../src/client/card-variants.ts'
import type { WorkBuddyWebStatus } from '../src/status-paths.ts'

/**
 * The dashboard's view layer and its shared store.
 *
 * Both are deliberately DOM-free (the projection is pure; the store takes an
 * injected `fetch`), which is what lets the panel's real logic be tested in the
 * Node project rather than through a renderer. What is pinned here is the set of
 * facts the sidebar card and the centre-column panel both depend on: the two
 * products are never merged into one figure, a read failure preserves the last
 * good document, and a missing host route reads as unavailable rather than as
 * two signed-out products.
 */

/** A signed-in status document carrying one model and one account. */
function signedIn(overrides: Partial<Extract<WorkBuddyWebStatus, { status: 'signed-in' }>> = {}): WorkBuddyWebStatus {
  return {
    status: 'signed-in',
    models: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }],
    accounts: {
      accounts: [{
        id: 'a1',
        uid: 'u1',
        name: 'First',
        origin: 'desktop',
        domain: 'copilot.tencent.com',
        renewable: true,
        enabled: true,
        available: true,
        credits: 100,
        expiresAtMs: 0,
        lastUsedAtMs: 0,
        addedAtMs: 0,
      }],
    },
    ...overrides,
  }
}

/** The empty document a host answers with before any account exists. */
const SIGNED_OUT: WorkBuddyWebStatus = { status: 'signed-out' }

describe('the sidebar credit line', () => {
  /**
   * The card states the BALANCE, named by the product, on ONE line per product —
   * no ring, no "used / total" pair, no bar.
   *
   * The figure that used to dominate was the capacity: with two accounts of
   * 2800 + 3400 the card led with "/ 6200", which is not the number anyone opens
   * the sidebar for. The balance (2373 + 2893) is; the capacity is still on the
   * dashboard, where a bar earns its space.
   */
  it('reports the summed balance per product, with the capacity kept for the dashboard', () => {
    /** One signed-in document whose pool is exactly the given account rows. */
    const withAccounts = (accounts: readonly Record<string, unknown>[]): WorkBuddyWebStatus => ({
      status: 'signed-in',
      models: [],
      accounts: { accounts },
    }) as unknown as WorkBuddyWebStatus
    const base = { uid: 'u', name: 'A', origin: 'desktop', domain: 'copilot.tencent.com', renewable: true, enabled: true, available: true, expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0 }
    const view = buildPanelView({
      snapshot: {
        statuses: {
          [CARD_VARIANTS[0]!.id]: withAccounts([
            { ...base, id: 'a:1', credits: 2373, creditsTotal: 2800 },
            { ...base, id: 'a:2', credits: 2893, creditsTotal: 3400 },
          ]),
          [CARD_VARIANTS[1]!.id]: undefined,
        },
        loading: false,
        fetchedAt: 1,
      },
    })
    const cn = view.footProducts[0]!
    // The line shows this: the sum of the accounts' remaining credit…
    expect(cn.creditsRemaining).toBe(5266)
    // …never the capacities' sum, which is only a dashboard figure.
    expect(cn.creditsCapacity).toBe(6200)
    expect(cn.creditsRemaining).not.toBe(cn.creditsCapacity)
  })

  it('reads the display style from the document, and defaults when it is absent', () => {
    const view = (style?: 'remaining' | 'usage') => buildPanelView({
      snapshot: {
        statuses: {
          [CARD_VARIANTS[0]!.id]: { ...signedIn(), ...style === undefined ? {} : { sidebarCreditStyle: style } } as WorkBuddyWebStatus,
          [CARD_VARIANTS[1]!.id]: undefined,
        },
        loading: false,
        fetchedAt: 1,
      },
    })
    // Absent (an older host, or a document that cannot state it): the card keeps
    // its default shape rather than blanking the line.
    expect(view(undefined).creditStyle).toBe('remaining')
    expect(view('remaining').creditStyle).toBe('remaining')
    expect(view('usage').creditStyle).toBe('usage')
  })

  it('names the figure in the label, in both languages', () => {
    // The label carries the meaning ("WorkBuddy 剩余额度"), which is what lets a
    // bare number sit beside it without a column header. The Chinese side is read
    // through the same translator the card uses, backed by its own dictionary.
    const zh = panelTranslator((key, params = {}) => String(PANEL_COPY_ZH[key as keyof typeof PANEL_COPY_ZH])
      .replace(/\{(\w+)\}/gu, (_match, name: string) => String(params[name as keyof typeof params] ?? '')))
    expect(zh('creditRemainingLabel', { product: 'WorkBuddy AI' })).toBe('WorkBuddy AI 剩余额度')
    expect(panelTranslator(undefined)('creditRemainingLabel', { product: 'WorkBuddy AI' }))
      .toBe('WorkBuddy AI remaining')
  })
})

describe('buildPanelView', () => {
  it('reports one block per product, in display order', () => {
    const view = buildPanelView({
      snapshot: { statuses: { [CARD_VARIANTS[0]!.id]: signedIn() }, loading: false, fetchedAt: 1 },
    })
    expect(view.products.map(product => product.id)).toEqual(CARD_VARIANTS.map(variant => variant.id))
    expect(view.products[0]!.name).toBe('WorkBuddy')
    expect(view.products[1]!.name).toBe('WorkBuddy AI')
  })

  it('never sums the two products\' credits together', () => {
    // The two subscriptions' credits are not convertible, so there is no grand
    // total anywhere in the view — only per-product figures.
    const view = buildPanelView({
      snapshot: {
        statuses: {
          workbuddy: signedIn(),
          'workbuddy-ai': signedIn({
            accounts: {
              accounts: [{ ...signedIn().status === 'signed-in' ? {} : {}, id: 'b1', uid: 'u2', name: 'Second', origin: 'desktop', domain: 'x', renewable: true, enabled: true, available: true, credits: 250, expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0 }],

            },
          }),
        },
        loading: false,
        fetchedAt: 1,
      },
    })
    const creditOf = (id: string): string =>
      view.products.find(product => product.id === id)?.stats.find(stat => stat.label === 'creditTotal')?.value ?? ''
    expect(creditOf('workbuddy')).toBe('100')
    expect(creditOf('workbuddy-ai')).toBe('250')
  })

  it('marks a product with no reported balance rather than showing zero', () => {
    // An account whose credit lookup failed must not read as "0 credits": the
    // view says "not reported" so the card can render a dash.
    const view = buildPanelView({
      snapshot: {
        statuses: {
          workbuddy: signedIn({
            accounts: {
              accounts: [{ id: 'a1', uid: 'u1', name: 'First', origin: 'desktop', domain: 'x', renewable: true, enabled: true, available: true, expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0 }],

            },
          }),
        },
        loading: false,
        fetchedAt: 1,
      },
    })
    const credit = view.products[0]!.stats.find(stat => stat.label === 'creditTotal')
    expect(credit?.value).toBe('')
    expect(credit?.pending).toBe('creditPending')
  })

  it('counts a benched account without pretending it is gone', () => {
    const future = Date.now() + 3_600_000
    const view = buildPanelView({
      now: Date.now(),
      snapshot: {
        statuses: {
          workbuddy: signedIn({
            accounts: {
              accounts: [
                { id: 'a1', uid: 'u1', name: 'Benched', origin: 'qr', domain: 'x', renewable: true, enabled: true, available: false, credits: 5, expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0, cooldown: { untilMs: future, reason: 'rate', strikes: 1 } },
              ],

            },
          }),
        },
        loading: false,
        fetchedAt: 1,
      },
    })
    expect(view.products[0]!.benched).toBe(1)
    expect(view.benchedCount).toBe(1)
    // Still an account: the pool has it, it is simply set aside right now.
    expect(view.accountCount).toBe(1)
  })

  it('reads a host that never answered as unavailable, not as two signed-out products', () => {
    const view = buildPanelView({ snapshot: { statuses: {}, loading: false, fetchedAt: 0 } })
    expect(view.available).toBe(false)
    expect(view.products.map(product => product.state)).toEqual(['unknown', 'unknown'])
  })

  it('distinguishes a first read in flight from a host that answered nothing', () => {
    const loading = buildPanelView({ snapshot: { statuses: {}, loading: true, fetchedAt: 0 } })
    expect(loading.loading).toBe(true)
    expect(loading.available).toBe(false)
    // A sweep that has already completed is never "loading", however long it
    // takes the next one to arrive.
    const settled = buildPanelView({ snapshot: { statuses: {}, loading: true, fetchedAt: 5 } })
    expect(settled.loading).toBe(false)
    expect(settled.available).toBe(true)
  })

  it('carries a signed-out product\'s reason into its detail line', () => {
    const view = buildPanelView({
      snapshot: {
        statuses: { workbuddy: { status: 'signed-out', reason: 'the file holds the other product\'s credential' } },
        loading: false,
        fetchedAt: 1,
      },
    })
    expect(view.products[0]!.state).toBe('signed-out')
    expect(view.products[0]!.detail).toContain('other product')
  })

  it('reports a host failure as an error state with its message', () => {
    const view = buildPanelView({
      snapshot: { statuses: { workbuddy: { status: 'error', message: 'loopback refused' } }, loading: false, fetchedAt: 1 },
    })
    expect(view.products[0]!.state).toBe('error')
    expect(view.products[0]!.detail).toBe('loopback refused')
  })

  it('reports where the served model list came from', () => {
    const live = buildPanelView({
      snapshot: { statuses: { workbuddy: signedIn({ catalog: { source: 'live' } }) }, loading: false, fetchedAt: 1 },
    })
    expect(live.products[0]!.catalogSource).toBe('live')
    // A signed-out product serves no list, so it claims no provenance.
    const out = buildPanelView({ snapshot: { statuses: { workbuddy: SIGNED_OUT }, loading: false, fetchedAt: 1 } })
    expect(out.products[0]!.catalogSource).toBe('none')
  })

  it('builds a tooltip carrying both products\' states', () => {
    const view = buildPanelView({
      snapshot: { statuses: { workbuddy: signedIn() }, loading: false, fetchedAt: 1 },
    })
    expect(view.footTitle).toContain('WorkBuddy')
    expect(view.footTitle).toContain('WorkBuddy AI')
  })
})

describe('createWorkBuddyPanelStore', () => {
  /** A fetch that answers a fixed document per route. */
  function routed(answers: Record<string, WorkBuddyWebStatus | 'fail'>): typeof globalThis.fetch {
    return (async (input: string | URL) => {
      const path = String(input)
      const answer = answers[path]
      if (answer === undefined || answer === 'fail') return { ok: false, status: 500, json: async () => undefined }
      return { ok: true, status: 200, json: async () => answer }
    }) as unknown as typeof globalThis.fetch
  }

  it('publishes both products from one sweep', async () => {
    const store = createWorkBuddyPanelStore({
      fetch: routed({
        [CARD_VARIANTS[0]!.statusPath]: signedIn(),
        [CARD_VARIANTS[1]!.statusPath]: SIGNED_OUT,
      }),
      now: () => 42,
    })
    await store.refresh()
    const snapshot = store.getSnapshot()
    expect(snapshot.statuses.workbuddy?.status).toBe('signed-in')
    expect(snapshot.statuses['workbuddy-ai']?.status).toBe('signed-out')
    expect(snapshot.fetchedAt).toBe(42)
    expect(snapshot.loading).toBe(false)
  })

  it('keeps the last good document when a later read fails', async () => {
    // A transient failure must not blank a dashboard the user is looking at.
    let failing = false
    const store = createWorkBuddyPanelStore({
      fetch: (async (input: string | URL) => {
        if (failing) return { ok: false, status: 500, json: async () => undefined }
        return { ok: true, status: 200, json: async () => signedIn() }
      }) as unknown as typeof globalThis.fetch,
    })
    await store.refresh()
    expect(store.getSnapshot().statuses.workbuddy?.status).toBe('signed-in')
    failing = true
    await store.refresh()
    expect(store.getSnapshot().statuses.workbuddy?.status).toBe('signed-in')
  })

  it('rejects a 200 that is not a status document', async () => {
    // A proxy page, an empty body, or literal null must not enter state: the
    // next render dereferences the document's discriminator.
    const store = createWorkBuddyPanelStore({
      fetch: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ nope: true }),
      })) as unknown as typeof globalThis.fetch,
    })
    await store.refresh()
    expect(store.getSnapshot().statuses.workbuddy).toBeUndefined()
  })

  it('shares one sweep between concurrent callers', async () => {
    let calls = 0
    const store = createWorkBuddyPanelStore({
      fetch: (async () => {
        calls += 1
        return { ok: true, status: 200, json: async () => signedIn() }
      }) as unknown as typeof globalThis.fetch,
    })
    await Promise.all([store.refresh(), store.refresh(), store.refresh()])
    // Two routes per sweep, one sweep — the card and the panel mounting
    // together must not double the traffic.
    expect(calls).toBe(CARD_VARIANTS.length)
  })

  it('notifies subscribers once per published change', async () => {
    const store = createWorkBuddyPanelStore({ fetch: routed({}) })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    await store.refresh()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    const before = listener.mock.calls.length
    await store.refresh()
    expect(listener.mock.calls.length).toBe(before)
  })

  it('survives a subscriber that throws', async () => {
    const store = createWorkBuddyPanelStore({
      fetch: routed({ [CARD_VARIANTS[0]!.statusPath]: signedIn() }),
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let notified = 0
    store.subscribe(() => { throw new Error('bad consumer') })
    store.subscribe(() => { notified += 1 })
    await store.refresh()
    // A sweep publishes twice (in-flight, then settled), and BOTH reach the
    // healthy subscriber: one faulty consumer suppresses nobody.
    expect(notified).toBe(2)
    expect(consoleError).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })
})

describe('panel copy', () => {
  it('keeps both dictionaries in step', () => {
    // A missing translation is a compile error (the record is keyed by the
    // English dictionary), so this only guards the ONE case typing cannot see:
    // a key present in both but left as its English text on purpose is fine,
    // while a key that was never translated shows up as identical AND is not a
    // product name.
    const untranslated = Object.keys(PANEL_COPY_EN).filter(key =>
      PANEL_COPY_ZH[key as keyof typeof PANEL_COPY_EN] === PANEL_COPY_EN[key as keyof typeof PANEL_COPY_EN]
      // Exempt: product names spelled the same in both languages, and
      // language-neutral numeric formats (a "used / total" pair carries no words
      // to translate — translating it would mean inventing a different
      // separator per language for no reader's benefit).
      && ![
        'nav', 'accountCount', 'creditTotal', 'modelCount', 'creditPending', 'creditUsed',
        // The composer badge is "product: figure" in both languages: a colon and
        // a grouped number carry no words, and translating the separator would
        // mean inventing a different punctuation per language for no reader.
        'creditBadgeLabel',
      ].includes(key))
    expect(untranslated).toEqual([])
  })

  it('interpolates named parameters', () => {
    const t = panelTranslator(undefined)
    expect(t('benched', { count: 3 })).toBe('3 set aside')
    // A placeholder with no matching parameter stays literal rather than
    // rendering "undefined".
    expect(t('benched')).toBe('{count} set aside')
  })

  it('falls back to English for a namespace that misses the key', () => {
    // A namespace-bound `t` answers the key itself when the namespace has no
    // entry; the panel must render readable English instead of the key name.
    const t = panelTranslator((key: string) => key)
    expect(t('refresh')).toBe(PANEL_COPY_EN.refresh)
  })

  it('uses the harness translation when the namespace answers', () => {
    const t = panelTranslator((key: string) => (key === 'refresh' ? '刷新' : key))
    expect(t('refresh')).toBe('刷新')
  })
})
