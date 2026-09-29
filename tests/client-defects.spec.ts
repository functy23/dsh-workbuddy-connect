import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS } from '../src/catalog.ts'
import { WorkBuddyProbeControl, type WorkBuddyProbeControlProps } from '../src/client/WorkBuddyProbeControl.tsx'
import { en } from '../src/client/locales.ts'

/**
 * Regression tests for the composer control's browser-half defects, plus the
 * fallback roster's display names.
 *
 * Each test is written to *fail before its fix and pass after it*: the defect it
 * names is reachable by driving the control the way a user would, not by
 * asserting an implementation detail. The two defects it pins are an unreadable
 * status body tearing the control down (#2) and a remembered failure outliving
 * the result that superseded it (#7, including the tooltip's precedence order).
 *
 * The control is driven through `react-test-renderer` with a stubbed `fetch`,
 * the same way `tests/client-variants.spec.ts` drives its components. No
 * request leaves the process.
 */

/** Locale lookup mirroring the injected `t` (params substituted, as the host does). */
const t = (key: keyof typeof en, params: Record<string, unknown> = {}): string =>
  Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    en[key] as string,
  )

type Reply = {
  ok?: boolean
  status?: number
  body?: unknown
  /** A 200 whose body is not JSON at all (a proxy page, an HTML fallback). */
  invalidJson?: true
}
/** `{ hang: true }` leaves the request pending, so a test owns when it settles. */
type Step = Reply | { hang: true }

/* -------------------------------------------------------------------------- *
 * Harness: a recording fetch and a controllable `window`
 * -------------------------------------------------------------------------- */

const calls: { url: string, init: RequestInit | undefined }[] = []
const hung = new Map<number, (reply: Reply) => void>()
let statusReply: Step = { ok: true, body: {} }
let writeReply: Step = { ok: true, body: {} }
/** Overrides the default method-based reply, e.g. to answer by arrival order. */
let plan: ((url: string, init: RequestInit | undefined, index: number) => Step) | undefined

const intervals = new Map<number, () => void>()
const clearedHandles: number[] = []
const focusListeners = new Set<() => void>()
let nextHandle = 1

function makeResponse(reply: Reply): Response {
  const ok = reply.ok ?? true
  return {
    ok,
    status: reply.status ?? (ok ? 200 : 500),
    json: async () => {
      if (reply.invalidJson === true) throw new SyntaxError('Unexpected token < in JSON at position 0')
      return reply.body
    },
    text: async () => (reply.invalidJson === true ? '<html>not json</html>' : JSON.stringify(reply.body ?? '')),
  } as unknown as Response
}

/** Record `(url, init)` for every request and answer it in process. */
function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const index = calls.length
    calls.push({ url: String(input), init })
    const step = plan?.(String(input), init, index)
      ?? (init?.method === 'POST' ? writeReply : statusReply)
    if ('hang' in step) {
      return await new Promise<Response>(resolve => {
        hung.set(index, reply => { resolve(makeResponse(reply)) })
      })
    }
    return makeResponse(step)
  }))
}

/** A window stub whose intervals and focus listeners the test can fire itself. */
function stubWindow(): void {
  vi.stubGlobal('window', {
    setInterval: (handler: () => void) => {
      const handle = nextHandle++
      intervals.set(handle, handler)
      return handle
    },
    clearInterval: (handle: number) => {
      clearedHandles.push(handle)
      intervals.delete(handle)
    },
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'focus') focusListeners.add(listener)
    },
    removeEventListener: (type: string, listener: () => void) => {
      focusListeners.delete(listener)
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  })
}

/** Settle a request that was held open, and flush the state it produces. */
async function release(index: number, reply: Reply): Promise<void> {
  const resolve = hung.get(index)
  if (resolve === undefined) throw new Error(`no request held open at index ${index}`)
  hung.delete(index)
  await act(async () => { resolve(reply) })
}

/** Fire the window focus listeners, which is how the control re-reads state. */
async function fireFocus(): Promise<void> {
  const listeners = [...focusListeners]
  await act(async () => { for (const listener of listeners) listener() })
}

/** One signed-in status document, as the host sends it. */
function signedInStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'signed-in',
    nickname: 'nick',
    probeKey: 'test-key',
    credits: { total: 15, accounts: [] },
    models: [],
    ...overrides,
  }
}

beforeEach(() => {
  calls.length = 0
  hung.clear()
  intervals.clear()
  clearedHandles.length = 0
  focusListeners.clear()
  nextHandle = 1
  plan = undefined
  statusReply = { ok: true, body: signedInStatus() }
  writeReply = { ok: true, body: {} }
  stubFetch()
  stubWindow()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* -------------------------------------------------------------------------- *
 * The composer control
 * -------------------------------------------------------------------------- */

describe('WorkBuddyProbeControl', () => {
  let view: ReactTestRenderer | undefined
  let state: ReturnType<WorkBuddyProbeControlProps['directory']['getSnapshot']>
  const listeners = new Set<() => void>()
  const directory = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    // The store's write half. The control only ever reads, but the double
    // IMPLEMENTS it instead of asserting past it: the cast that used to stand
    // here is what let a guard against the wrong falsy value survive its own
    // typecheck (see the null-selection case below).
    update: (mutator: (snapshot: typeof state) => void) => { mutator(state); listeners.forEach(listener => listener()) },
    set: (next: typeof state) => { state = next; listeners.forEach(listener => listener()) },
  } as WorkBuddyProbeControlProps['directory']

  beforeEach(() => {
    state = { current: { provider: 'workbuddy', model: 'glm-5.2' }, pending: null, status: 'ready', groups: [], failures: [], error: null, routable: true }
  })

  afterEach(() => {
    act(() => { view?.unmount() })
    view = undefined
    listeners.clear()
  })

  async function mount(): Promise<void> {
    await act(async () => {
      view = create(createElement(WorkBuddyProbeControl, { directory, t: t as WorkBuddyProbeControlProps['t'] }))
    })
  }

  const controlButton = () => view!.root.findAllByType('button')[0]!

  it('#2 survives a status body of literal null without tearing the control down', async () => {
    // `resultFor` dereferences `status.status` on every render, so a null body
    // stored unchecked threw inside the composer slot. A crashed render unmounts
    // the root and leaves `toJSON()` null as well, so liveness — not the null
    // output — is what this pins.
    statusReply = { ok: true, body: null }
    await mount()

    expect(view!.toJSON()).toBeNull()
    expect(() => view!.root).not.toThrow()
  })

  it('#2 recovers on the next readable document', async () => {
    statusReply = { ok: true, body: null }
    await mount()
    expect(view!.toJSON()).toBeNull()

    statusReply = {
      ok: true,
      body: signedInStatus({
        probe: { consent: true, running: false, candidates: ['glm-5.2'], results: [] },
      }),
    }
    await fireFocus()

    // A control that had crashed on the bad document could never get here: the
    // failed render unmounts the tree and every later read is dropped.
    expect(view!.toJSON()).not.toBeNull()
    expect(controlButton().props['aria-label']).toBe(t('probeTooltipIdle', { model: 'glm-5.2' }))
  })

  it('#7 reports a recorded result instead of a remembered failure', async () => {
    statusReply = {
      ok: true,
      body: signedInStatus({
        probe: { consent: true, running: false, candidates: ['glm-5.2'], results: [] },
      }),
    }
    // The detection this control starts fails.
    writeReply = { ok: false, status: 500, body: { error: 'probe failed' } }
    await mount()
    expect(controlButton().props['aria-label']).toBe(t('probeTooltipIdle', { model: 'glm-5.2' }))

    await act(async () => { controlButton().props.onClick() })
    const confirm = view!.root.findAllByType('button').find(node => node.children.join('') === en.probeConfirmAction)!
    await act(async () => { confirm.props.onClick() })
    expect(controlButton().props['aria-label']).toBe(en.probeTooltipRetry)

    // A status read now carries a recorded, verified result for the same model
    // (a detection run from the settings card, or a finished sweep). The levels
    // the user paid for outrank the stale failure.
    statusReply = {
      ok: true,
      body: signedInStatus({
        probe: {
          consent: true,
          running: false,
          candidates: ['glm-5.2'],
          results: [{
            id: 'glm-5.2',
            name: 'GLM-5.2',
            validation: 'validating',
            efforts: ['low', 'high'],
            probedAt: Date.now(),
          }],
        },
      }),
    }
    await fireFocus()

    const label = t('probeTooltipVerified', { levels: 'low / high' })
    expect(controlButton().props['aria-label']).toBe(label)
    // The same string is the button's accessible name, so it must not still
    // announce the failure.
    expect(controlButton().props['aria-label']).not.toBe(en.probeTooltipRetry)
  })

  it('#7 clears the remembered failure once a result lands, so it cannot resurface', async () => {
    // §7.2: the flag is dropped when a read supplies a result, so it can never
    // outlive the state it contradicts. This is the half of the fix that the
    // tooltip ordering cannot compensate for on its own — the host clearing its
    // recorded results must not resurrect a failure the user already resolved.
    statusReply = {
      ok: true,
      body: signedInStatus({ probe: { consent: true, running: false, candidates: ['glm-5.2'], results: [] } }),
    }
    writeReply = { ok: false, status: 500, body: { error: 'probe failed' } }
    await mount()
    await act(async () => { controlButton().props.onClick() })
    const confirm = view!.root.findAllByType('button').find(node => node.children.join('') === en.probeConfirmAction)!
    await act(async () => { confirm.props.onClick() })
    expect(controlButton().props['aria-label']).toBe(en.probeTooltipRetry)

    const recorded = {
      id: 'glm-5.2',
      name: 'GLM-5.2',
      validation: 'validating',
      efforts: ['low', 'high'],
      probedAt: Date.now(),
    }
    statusReply = {
      ok: true,
      body: signedInStatus({ probe: { consent: true, running: false, candidates: ['glm-5.2'], results: [recorded] } }),
    }
    await fireFocus()
    expect(controlButton().props['aria-label']).toBe(t('probeTooltipVerified', { levels: 'low / high' }))

    // The host clears its results again. The failure was about a run whose
    // answer has since arrived, so the control goes back to idle, not to retry.
    statusReply = {
      ok: true,
      body: signedInStatus({ probe: { consent: true, running: false, candidates: ['glm-5.2'], results: [] } }),
    }
    await fireFocus()
    expect(controlButton().props['aria-label']).toBe(t('probeTooltipIdle', { model: 'glm-5.2' }))
  })

  describe('#7.1 tooltip precedence order', () => {
    /** A signed-in document whose probe section carries `results` for the selected model. */
    const withResults = (results: unknown[]): { ok: true, body: unknown } => ({
      ok: true,
      body: signedInStatus({
        probe: { consent: true, running: false, candidates: ['glm-5.2'], results },
      }),
    })

    const recorded = (validation: string, efforts: string[]): Record<string, unknown> => ({
      id: 'glm-5.2', name: 'GLM-5.2', validation, efforts, probedAt: Date.now(),
    })

    /** The two clicks that start a detection: the control, then the bubble's Confirm. */
    async function detect(): Promise<void> {
      await act(async () => { controlButton().props.onClick() })
      const confirm = view!.root.findAllByType('button')
        .find(node => node.children.join('') === en.probeConfirmAction)!
      await act(async () => { confirm.props.onClick() })
    }

    it('ranks busy above a recorded result, and the result above a stale failure', async () => {
      // §7.1 (normative order): `busy` → recorded `result` → `failed` → idle.
      // The reachable state the order decides: a result is ALREADY on screen
      // when a fresh detection of the same model fails. No read intervenes, so
      // `result` never changes identity, the clearing effect never runs, and
      // `failed && result !== undefined` holds — nothing but the branch order
      // can keep the levels on screen.
      statusReply = withResults([recorded('validating', ['low', 'high'])])
      await mount()

      const verified = t('probeTooltipVerified', { levels: 'low / high' })
      // Rung 2: a recorded result is described, not the idle copy.
      expect(controlButton().props['aria-label']).toBe(verified)
      expect(controlButton().props['aria-label']).not.toBe(t('probeTooltipIdle', { model: 'glm-5.2' }))

      // Hold the POST open so the busy rung is observable with a result present:
      // §7.1 puts `busy` above the recorded result, so the running copy wins.
      plan = (_url, init) => (init?.method === 'POST' ? { hang: true } : statusReply)
      await detect()
      expect(controlButton().props['aria-label']).toBe(t('probeRunning', { model: 'glm-5.2' }))
      expect(controlButton().props['aria-label']).not.toBe(verified)

      // The run fails. Before §7.1 the failure copy was returned first and the
      // levels the user had already paid for disappeared behind
      // "Detection did not complete · click to retry".
      await release(1, { ok: false, status: 500, body: { error: 'probe failed' } })

      expect(controlButton().props['aria-label']).toBe(verified)
      expect(controlButton().props['aria-label']).not.toBe(en.probeTooltipRetry)
    })

    it('ranks a non-validating result above the remembered failure too', async () => {
      // The result rung outranks `failed` as a whole, not only its verified
      // sub-branch: swapping those two branches must fail here as well.
      statusReply = withResults([recorded('non-validating', [])])
      writeReply = { ok: false, status: 500, body: { error: 'probe failed' } }
      await mount()
      expect(controlButton().props['aria-label']).toBe(en.probeTooltipNotValidating)

      await detect()

      expect(controlButton().props['aria-label']).toBe(en.probeTooltipNotValidating)
      expect(controlButton().props['aria-label']).not.toBe(en.probeTooltipRetry)
    })

    it('keeps the failure copy for a failure with no result, and the idle copy for neither', async () => {
      // Rungs 3 and 4: the failure copy is what remains when there is no result
      // to report (§7.1.4), and idle is what remains when nothing happened.
      statusReply = withResults([])
      await mount()
      expect(controlButton().props['aria-label']).toBe(t('probeTooltipIdle', { model: 'glm-5.2' }))

      writeReply = { ok: false, status: 500, body: { error: 'probe failed' } }
      await detect()

      expect(controlButton().props['aria-label']).toBe(en.probeTooltipRetry)
      expect(controlButton().props['aria-label']).not.toBe(t('probeTooltipIdle', { model: 'glm-5.2' }))
    })
  })
})

/* -------------------------------------------------------------------------- *
 * The fallback catalog
 * -------------------------------------------------------------------------- */

describe('#8 fallback catalog display names', () => {
  it('gives every CN fallback row a distinct name and keeps both hybrid ids', () => {
    const names = FALLBACK_WORKBUDDY_MODELS.map(model => model.name)
    // Before the fix `hy3` and `hy3-x` both read "Hy3": the picker showed one
    // bare and one suffixed entry, and the context table two identical rows.
    expect(new Set(names).size).toBe(names.length)

    const byId = new Map(FALLBACK_WORKBUDDY_MODELS.map(model => [model.id, model]))
    // The ids are the wire contract and must not move.
    expect(byId.has('hy3')).toBe(true)
    expect(byId.has('hy3-x')).toBe(true)
    expect(byId.get('hy3')?.name).toBe('Hy3')
    expect(byId.get('hy3-x')?.name).toBe('Hy3-X')
  })

  it('leaves the international fallback names alone', () => {
    const names = FALLBACK_WORKBUDDY_AI_MODELS.map(model => model.name)
    expect(new Set(names).size).toBe(names.length)
    expect(FALLBACK_WORKBUDDY_AI_MODELS.find(model => model.id === 'hy3')?.name).toBe('Hy3')
  })
})
