import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyVisibilityStore } from '../src/visibility-store.ts'
import { buildPanelView } from '../src/client/panel.ts'
import { CARD_VARIANTS } from '../src/client/card-variants.ts'

const CLEANUP: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(CLEANUP.splice(0).map(clean => clean())) })

async function store(): Promise<WorkBuddyVisibilityStore> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-vis-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  return new WorkBuddyVisibilityStore({ path: join(dir, 'visibility.json') })
}

describe('the model allowlist', () => {
  it('hides everything outside it, and nothing without one', async () => {
    const vis = await store()
    const catalog = ['a', 'b', 'c', 'd']
    // No list at all: nothing is hidden.
    expect(vis.effectiveHidden('acct', catalog)).toEqual([])
    vis.setAllowlist('acct', ['a', 'c'])
    expect(vis.allowlist('acct')).toEqual(['a', 'c'])
    // b and d fall outside the allowed set.
    expect([...vis.effectiveHidden('acct', catalog)].sort()).toEqual(['b', 'd'])
  })

  it('keeps an explicitly hidden model hidden even if it is also allowed', async () => {
    const vis = await store()
    vis.setVisible('acct', 'a', false)
    vis.setAllowlist('acct', ['a', 'b'])
    // The two lists disagree about 'a'; "hidden" has to win, or a model the
    // user turned off would come back the moment it was ticked.
    expect([...vis.effectiveHidden('acct', ['a', 'b', 'c'])].sort()).toEqual(['a', 'c'])
  })

  it('clears back to no filter, and survives a reload', async () => {
    const vis = await store()
    vis.setAllowlist('acct', ['a'])
    expect(vis.allowlist('acct')).toEqual(['a'])
    vis.setAllowlist('acct', [])
    // An empty list is "no filter", not "nothing allowed": the picker must
    // still show the catalog.
    expect(vis.allowlist('acct')).toBeUndefined()
    expect(vis.effectiveHidden('acct', ['a', 'b'])).toEqual([])

    vis.setAllowlist('acct', ['b'])
    const reloaded = new WorkBuddyVisibilityStore({ path: vis.filePath() })
    expect(reloaded.allowlist('acct')).toEqual(['b'])
  })

  it('does not lose a hide-list to an allowlist write', async () => {
    const vis = await store()
    vis.setVisible('acct', 'z', false)
    vis.setAllowlist('acct', ['a'])
    // Writing the filter must not erase the separate hide-list entry.
    expect(vis.disabled('acct')).toEqual(['z'])
    vis.setAllowlist('acct', [])
    expect(vis.disabled('acct')).toEqual(['z'])
  })
})

describe('the footer card figures', () => {
  const statusWith = (credits: { credits?: number, creditsTotal?: number, account?: boolean }): unknown => ({
    status: 'signed-in',
    models: [],
    accounts: {
      accounts: credits.account === false ? [] : [{
        id: 'a:1', uid: 'a', name: 'A', origin: 'qr', domain: 'x', renewable: true,
        enabled: true, available: true, expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0,
        ...credits.credits === undefined ? {} : { credits: credits.credits },
        ...credits.creditsTotal === undefined ? {} : { creditsTotal: credits.creditsTotal },
      }],
    },
  })

  const view = (cn: unknown, ai: unknown) => buildPanelView({
    snapshot: {
      statuses: { [CARD_VARIANTS[0]!.id]: cn as never, [CARD_VARIANTS[1]!.id]: ai as never },
      loading: false,
      fetchedAt: 1,
    },
  })

  it('states used and total when the pool declared a capacity', () => {
    const built = view(statusWith({ credits: 250, creditsTotal: 1000 }), undefined)
    const cn = built.products[0]!
    expect(cn.creditsRemaining).toBe(250)
    expect(cn.creditsCapacity).toBe(1000)
  })

  it('states no capacity when an account answered without one', () => {
    // A partial sum would understate the pool while looking complete, and the
    // used figure derived from it would come out too large.
    const built = view(statusWith({ credits: 250 }), undefined)
    expect(built.products[0]!.creditsRemaining).toBe(250)
    expect(built.products[0]!.creditsCapacity).toBeUndefined()
  })

  it('treats an all-zero capacity as "no cap", not as a zero-sized pool', () => {
    const built = view(statusWith({ credits: 0, creditsTotal: 0 }), undefined)
    expect(built.products[0]!.creditsCapacity).toBeUndefined()
  })
})

describe('which products the card lists', () => {
  it('drops a product with no account, keeps one that is merely set aside', () => {
    const built = buildPanelView({
      snapshot: {
        statuses: {
          [CARD_VARIANTS[0]!.id]: {
            status: 'signed-out',
            reason: 'no account',
            accounts: { accounts: [] },
          } as never,
          [CARD_VARIANTS[1]!.id]: undefined,
        },
        loading: false,
        fetchedAt: 1,
      },
    })
    // Neither product has an account, so the card lists neither — the sign-out
    // prompt belongs to the dashboard, not to a permanent sidebar row.
    expect(built.footProducts).toEqual([])
    // The dashboard still carries both, which is where a product gets set up.
    expect(built.products).toHaveLength(2)
  })

  it('keeps a product whose accounts exist but are all unusable', () => {
    const built = buildPanelView({
      snapshot: {
        statuses: {
          [CARD_VARIANTS[0]!.id]: {
            status: 'signed-in',
            models: [],
            accounts: {
              accounts: [{
                id: 'a:1', uid: 'a', name: 'A', origin: 'qr', domain: 'x', renewable: true,
                enabled: false, available: false, expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0,
              }],
            },
          } as never,
          [CARD_VARIANTS[1]!.id]: undefined,
        },
        loading: false,
        fetchedAt: 1,
      },
    })
    expect(built.footProducts.map(product => product.id)).toEqual([CARD_VARIANTS[0]!.id])
  })
})
