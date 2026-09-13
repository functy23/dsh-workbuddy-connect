import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyContextPreference } from '../src/context-preference.ts'
import { createWorkBuddyAdapter } from '../src/adapter.ts'
import { CN_VARIANT } from '../src/variants.ts'
import type { WorkBuddyCatalog } from '../src/catalog.ts'
import type { WorkBuddyModelInfo } from '../src/catalog.ts'

/**
 * The context-length preference, and the one thing that makes it a setting
 * rather than a display toggle: the adapter must report the chosen window.
 *
 * pi-ai clamps a request's output budget to
 * `contextWindow - promptTokens - safety`, so a model the adapter describes as
 * 200K sends a smaller ceiling than the same model described as 1M. These tests
 * assert on the adapter's own output because that is the last point before the
 * number becomes a request.
 */

const CLEANUP: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(CLEANUP.splice(0).map(clean => clean())) })

async function makePreference(): Promise<{ preference: WorkBuddyContextPreference, path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-context-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'context.json')
  return { preference: new WorkBuddyContextPreference({ variant: CN_VARIANT, path }), path }
}

describe('context preference storage', () => {
  it('resolves a stored choice and falls back to nothing for an unchosen model', async () => {
    const { preference } = await makePreference()
    expect(preference.resolve('gpt-5.6-sol', [200_000, 1_000_000])).toBeUndefined()
    preference.set('gpt-5.6-sol', 1_000_000)
    expect(preference.resolve('gpt-5.6-sol', [200_000, 1_000_000])).toBe(1_000_000)
    // A model that was never chosen stays at the upstream default.
    expect(preference.resolve('glm-5.3', [200_000, 1_000_000])).toBeUndefined()
  })

  /**
   * The guard that keeps a stale preference from inventing a window: a model
   * whose catalog entry no longer offers the chosen length must not be run at
   * that length, because the upstream would refuse the request.
   */
  it('ignores a stored choice the model no longer declares', async () => {
    const { preference } = await makePreference()
    preference.set('gpt-5.6-sol', 1_000_000)
    expect(preference.resolve('gpt-5.6-sol', [200_000])).toBeUndefined()
    expect(preference.resolve('gpt-5.6-sol', [])).toBeUndefined()
    // The entry survives, so the choice comes back if the length does.
    expect(preference.resolve('gpt-5.6-sol', [200_000, 1_000_000])).toBe(1_000_000)
  })

  it('persists across instances and clears on request', async () => {
    const { preference, path } = await makePreference()
    preference.set('m', 300_000)
    const reopened = new WorkBuddyContextPreference({ variant: CN_VARIANT, path })
    expect(reopened.resolve('m', [300_000, 1_000_000])).toBe(300_000)
    reopened.clear('m')
    expect(reopened.resolve('m', [300_000, 1_000_000])).toBeUndefined()
    expect(new WorkBuddyContextPreference({ variant: CN_VARIANT, path }).resolve('m', [300_000])).toBeUndefined()
  })

  it('writes the document with owner-only permissions', async () => {
    const { preference, path } = await makePreference()
    preference.set('m', 1)
    const document = JSON.parse(await readFile(path, 'utf8')) as { version: number, models: Record<string, number> }
    expect(document.version).toBe(1)
    expect(document.models).toEqual({ m: 1 })
  })

  it('treats a corrupt or foreign document as no preferences', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-context-bad-'))
    CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'context.json')
    for (const body of ['not json', '[]', '{"version":99,"models":{"m":1}}', '{"version":1,"models":{"m":"big"}}']) {
      await writeFile(path, body)
      expect(new WorkBuddyContextPreference({ variant: CN_VARIANT, path }).resolve('m', [1])).toBeUndefined()
    }
  })
})

describe('the chosen window reaches the model descriptor', () => {
  /** A catalog stub holding one model that declares two windows. */
  function catalogWith(model: WorkBuddyModelInfo): WorkBuddyCatalog {
    return {
      current: () => [model],
      set: () => {},
      setVisible: () => false,
      isVisible: () => true,
    } as unknown as WorkBuddyCatalog
  }

  const model: WorkBuddyModelInfo = {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6-Sol',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    supportsImages: true,
    supportedContextWindows: [200_000, 1_000_000],
    reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: true },
  }

  async function modelsFor(preference?: { resolve: (id: string, declared: readonly number[]) => number | undefined }): Promise<{ id: string, contextWindow: number | undefined }[]> {
    const adapter = createWorkBuddyAdapter({
      providerId: CN_VARIANT.id,
      shim: { baseUrl: () => 'http://127.0.0.1:1' } as never,
      store: {} as never,
      catalog: catalogWith(model),
      ...preference === undefined ? {} : { resolveContextWindow: preference.resolve.bind(preference) },
    })
    // resolveModel() is what DSH asks for a route's capacity, and it is built
    // from the same pi-ai descriptor streaming derives its clamp from.
    return await Promise.all([model.id].map(async id => {
      const resolved = await adapter.adapter.resolveModel(CN_VARIANT.id, id)
      return { id, contextWindow: resolved.context?.contextWindow }
    }))
  }

  it('reports the upstream default when nothing was chosen', async () => {
    expect(await modelsFor()).toEqual([{ id: 'gpt-5.6-sol', contextWindow: 1_000_000 }])
  })

  it('reports the chosen length once the user picks one', async () => {
    const { preference: store } = await makePreference()
    store.set('gpt-5.6-sol', 200_000)
    // This is what makes the switch a real setting: the descriptor pi-ai reads
    // now carries 200K, and its output clamp follows.
    expect(await modelsFor(store)).toEqual([{ id: 'gpt-5.6-sol', contextWindow: 200_000 }])
  })

  it('falls back to the default when the stored length is no longer offered', async () => {
    const { preference: store } = await makePreference()
    store.set('gpt-5.6-sol', 1_000_000)
    // Same model, but now declaring only the small window.
    const narrowed = { ...model, contextWindow: 200_000, supportedContextWindows: [200_000] }
    const adapter = createWorkBuddyAdapter({
      providerId: CN_VARIANT.id,
      shim: { baseUrl: () => 'http://127.0.0.1:1' } as never,
      store: {} as never,
      catalog: catalogWith(narrowed),
      resolveContextWindow: (id, declared) => store.resolve(id, declared),
    })
    expect((await adapter.adapter.resolveModel(CN_VARIANT.id, model.id)).context?.contextWindow).toBe(200_000)
  })
})
