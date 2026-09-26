import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkBuddyCreditBadge, type WorkBuddyCreditBadgeProps } from '../src/client/credit-badge.tsx'
import { createWorkBuddyPanelStore } from '../src/client/panel-store.ts'
import { panelTranslator } from '../src/client/panel-copy.ts'
import { CARD_VARIANTS } from '../src/client/card-variants.ts'
import type { WorkBuddyWebStatus } from '../src/status-paths.ts'

/**
 * The composer's credit badge: which sessions show it, and what it says.
 *
 * The badge exists to answer "and how much is left" beside the harness's own
 * token readout, so the cases that matter are the NEGATIVE ones — another
 * provider selected, the product signed out, no balance read yet — each of which
 * must render nothing rather than a zero or a stale figure for a quota the
 * running turn cannot spend.
 */

/** One account row as the status document carries it. */
function account(credits: number | undefined): Record<string, unknown> {
  return {
    id: 'a:1', uid: 'u1', name: 'A', origin: 'qr', domain: 'copilot.tencent.com', renewable: true,
    enabled: true, available: true, expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0,
    ...credits === undefined ? {} : { credits },
  }
}

/** A signed-in document for one product. */
function signedIn(credits: number | undefined): WorkBuddyWebStatus {
  return { status: 'signed-in', models: [], accounts: { accounts: [account(credits)] } } as unknown as WorkBuddyWebStatus
}

describe('the composer credit badge', () => {
  let view: ReactTestRenderer | undefined
  let state: { current: { provider: string, model: string } | null }
  const listeners = new Set<() => void>()
  let documents: Record<string, WorkBuddyWebStatus>

  const directory = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  } as unknown as WorkBuddyCreditBadgeProps['directory']

  /** The panel store both other surfaces read, fed a fixed pair of documents. */
  function store() {
    return createWorkBuddyPanelStore({
      intervalMs: 60_000,
      now: () => 1,
      fetch: (async (input: string) => ({
        ok: true,
        json: async () => documents[String(input)],
      })) as unknown as typeof globalThis.fetch,
    })
  }

  function select(provider: string | null): void {
    state = { current: provider === null ? null : { provider, model: 'glm-5.3' } }
    listeners.forEach(listener => listener())
  }

  /** Render the badge against a store that has already swept once. */
  async function mount(): Promise<ReactTestRenderer> {
    const panel = store()
    await panel.refresh()
    const rendered = create(createElement(WorkBuddyCreditBadge, {
      directory,
      panel,
      t: panelTranslator(undefined),
    }))
    return rendered
  }

  beforeEach(() => {
    documents = {
      [CARD_VARIANTS[0]!.statusPath]: signedIn(5266),
      [CARD_VARIANTS[1]!.statusPath]: signedIn(1200),
    }
    select('workbuddy')
  })

  afterEach(() => { act(() => { view?.unmount() }) })

  it('states the active product and its balance, on one line', async () => {
    view = await mount()
    const text = JSON.stringify(view.toJSON())
    expect(text).toContain('WorkBuddy')
    expect(text).toContain('5,266')
    // The accessible name is the whole sentence — the two spans are visual only.
    expect(text).toContain('WorkBuddy: 5,266')
  })

  it('follows the model: the international product states its own balance', async () => {
    select(CARD_VARIANTS[1]!.id)
    view = await mount()
    const text = JSON.stringify(view.toJSON())
    expect(text).toContain('WorkBuddy AI')
    expect(text).toContain('1,200')
  })

  it('renders nothing while another provider is selected', async () => {
    select('deepseek')
    view = await mount()
    // A WorkBuddy quota attached to a session that cannot spend it would be a
    // number about nothing.
    expect(view.toJSON()).toBeNull()
  })

  it('renders nothing when no model is selected yet', async () => {
    select(null)
    view = await mount()
    expect(view.toJSON()).toBeNull()
  })

  it('renders nothing for a signed-out product, and nothing before a balance lands', async () => {
    documents[CARD_VARIANTS[0]!.statusPath] = { status: 'signed-out' } as unknown as WorkBuddyWebStatus
    view = await mount()
    expect(view.toJSON()).toBeNull()

    // Signed in, but the billing read has not answered: an absent figure, never
    // a zero, which would read as "this account is empty".
    documents[CARD_VARIANTS[0]!.statusPath] = signedIn(undefined)
    view = await mount()
    expect(view.toJSON()).toBeNull()
  })
})
