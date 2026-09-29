import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { FakeSettingsService } from './fake-settings.ts'
import * as WorkBuddy from '../src/index.ts'

let context: Context | undefined
let root: string | undefined

/** A desktop-shaped credential document for one upstream region. */
function credentialDocument(domain: string, uid = 'uid-1'): string {
  return JSON.stringify({
    auth: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000, domain },
    account: { uid, nickname: uid, enterpriseId: 'ent-1' },
  })
}

/**
 * Remove a test's temp directory, tolerating a write that outlives disposal.
 *
 * The account pool persists atomically (temp file plus rename), so a sweep that
 * was already in flight when the fiber was disposed can land one more file as
 * \`rm\` walks the tree — which surfaces as ENOTEMPTY, not as a product fault.
 * Retrying past it keeps the assertion that matters (the plugin's behaviour) from
 * failing on filesystem timing.
 */
async function removeRoot(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error: unknown) {
      if (attempt === 4) throw error
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await removeRoot(root)
  root = undefined
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** The profile entry id this plugin's settings live under. */
const ENTRY = WorkBuddy.PROFILE_ENTRY_ID

/**
 * The plugin's own config schema.
 *
 * Passed to the fake service so the reference-carrying config it hands the
 * plugin is built by the SAME schema the real loader validates through — the
 * references then have the loader's own shape, and a schema drift (a field
 * added without marking it volatile) surfaces here rather than in production.
 */
const SCHEMA = WorkBuddy.Config

/**
 * Boot the plugin against the fake 0.1.7 settings service.
 *
 * The plugins are mounted with the reference-carrying config the real loader
 * would hand them, so a write through `settings.update` lands in the same live
 * fields the plugin reads through `current()`.
 */
async function bootWithSettings(values: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FakeSettingsService)
  const settings = FakeSettingsService.current as FakeSettingsService
  settings.declareEntry(ENTRY, values, SCHEMA)
  const fiber = ctx.plugin(WorkBuddy, values)
  await fiber
  // Bind to what the fiber actually received: cordis ran the plugin's schema,
  // so that object holds the references a later write must land in.
  settings.bindFiber(ENTRY, fiber.config)
  return ctx
}

describe('WorkBuddy Host settings integration', () => {
  it('applies a maximum-window write to the very next request, and honors an opt-out', async () => {
    root = await mkdtemp(join(tmpdir(), 'workbuddy-context-restart-'))
    const aiFile = join(root, 'ai.info')
    await writeFile(aiFile, credentialDocument('www.workbuddy.ai', 'uid-ai'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('WORKBUDDY_AUTH_FILE', join(root, 'absent-cn.info'))
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', aiFile)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline in tests') }))
    const ctx = await bootWithSettings()
    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('workbuddy-ai')).length).toBeGreaterThan(0)
    })
    // Nothing written yet: the schema default is on, so the model resolves at
    // its largest declared window.
    expect((await ctx.llm.resolveModelInfo('workbuddy-ai', 'deepseek-v4.1-flash')).context?.contextWindow).toBe(1_000_000)
    await ctx.settings.update(ENTRY, { useMaximumContextWindow: false })
    // The write must reach the NEXT request, not the next restart: the plugin
    // re-applies the frozen catalog flag from the volatile-update notification.
    await vi.waitFor(async () => {
      expect((await ctx.llm.resolveModelInfo('workbuddy-ai', 'deepseek-v4.1-flash')).context?.contextWindow).toBe(300_000)
    })
    expect((ctx.settings as unknown as FakeSettingsService).valueOf(ENTRY, 'useMaximumContextWindow')).toBe(false)
  })

  it('exposes the settings section and the fallback model list', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-settings-'))
    vi.stubEnv('DSH_HOME', root)
    // This case asserts the CN fallback roster, which is served only to a
    // signed-in variant. Pinning a credential of its own keeps that independent
    // of whether this machine happens to have the WorkBuddy desktop app signed
    // in: without it the store probes the ambient desktop file and the group
    // stays hidden (empty model list) on a clean machine and on CI.
    const cnFile = join(root, 'cn.info')
    await writeFile(cnFile, credentialDocument('copilot.tencent.com'))
    vi.stubEnv('WORKBUDDY_AUTH_FILE', cnFile)
    // Signing in would otherwise make this case perform a real request to the CN
    // catalog endpoint. These tests must not touch the network, and the roster
    // asserted below is the compiled-in fallback, so the fetch is stubbed to
    // fail exactly as the sibling case does rather than depending on the remote.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline in tests') }))
    const ctx = await bootWithSettings()

    // Registration rides on the loopback shim's listening event.
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('workbuddy')
    })
    // A configurable-provider directory entry IS made, and it is what puts this
    // provider's row on the Models settings page. The row used to be omitted
    // (the page's own editor has no fields for a WorkBuddy provider), but the
    // row is now the anchor for a surface the page does own: the plugin
    // registers its own card into the row's `settings.models.provider-card`
    // keyed slot, and a keyed slot with no row to dispatch it renders nowhere.
    // The group still serves models through the adapter, which is a separate
    // registration.
    const directoryEntry = ctx.llm.listConfigurableProviders().find(entry => entry.provider === 'workbuddy')
    expect(directoryEntry).toBeDefined()
    // The card registers under this exact string, so the two halves agreeing on
    // it is what makes the card reach its row.
    expect(directoryEntry?.settingsNs).toBe(WorkBuddy.WORKBUDDY_SETTINGS_NS)

    // The fields are still SERVED: on 0.1.7 the plugin's profile entry IS its
    // settings namespace, so the native editor and the settings wire read the
    // same document the plugin reads, independent of the Models page.
    const descriptor = ctx.settings.describe().find(entry => entry.ns === WorkBuddy.WORKBUDDY_SETTINGS_NS)
    expect(descriptor).toBeDefined()

    const models = await ctx.llm.listModels('workbuddy')
    expect(models.map(model => model.id)).toContain('hy3')
    expect(models.map(model => model.id)).toContain('deepseek-v4-pro')
    // The fallback catalog tracks the live `cli` roster, including the newer
    // models the desktop app offers that older builds lacked.
    expect(models.map(model => model.id)).toContain('hy4-preview')
    expect(models.map(model => model.id)).toContain('glm-5.3')

    // The billing rate rides the display name (and the advisory description)
    // so both the /model popup and the composer seat show it; the id and the
    // request path are untouched by this display-only decoration.
    const byId = new Map(models.map(model => [model.id, model]))
    // Since DSH 0.1.2 the composer seat renders the model name only, so the
    // billing rate rides the name itself; description stays untouched
    // everywhere. Promo badges are NOT baked into the static fallback — they
    // are dynamic promotions that only a live refresh may attach.
    expect(byId.get('glm-5.2')?.name).toBe('GLM-5.2 · x0.79')
    expect(byId.get('glm-5.1')?.name).toBe('GLM-5.1 · x0.79')
    expect(byId.get('glm-5v-turbo')?.name).toBe('GLM-5v-Turbo · x0.71')
    expect(byId.get('glm-5.2')?.description).toBeUndefined()
    expect(byId.get('glm-5.3')?.description).toBeUndefined()

    // Thinking controls are declared-set-only: models whose upstream row
    // carries `supportedEfforts` expose exactly those efforts; rows without a
    // list (the older `{effort, summary}` shape) expose no control at all, so
    // requests never carry `reasoning_effort` for them and the upstream
    // default applies — matching the desktop app's own per-model gating.
    const effortOnlyResolved = await ctx.llm.resolveModelInfo('workbuddy', 'hy3')
    expect(effortOnlyResolved.reasoning).toBeUndefined()
    const flashResolved = await ctx.llm.resolveModelInfo('workbuddy', 'glm-5.3-flash')
    expect(flashResolved.reasoning?.efforts.map(effort => effort.id).sort()).toEqual(['high', 'low', 'max', 'off'])

    // Image modalities follow the per-model catalog flag (fallback list here):
    // every row of the current CN roster declares image support.
    const modalities = new Map(models.map(model => [model.id, model.inputModalities]))
    expect(modalities.get('hy3')).toContain('image')
    expect(modalities.get('glm-5.1')).toContain('image')

    // A settings write lands in the live config and persists.
    await ctx.settings.update(WorkBuddy.WORKBUDDY_SETTINGS_NS, { authFile: '/tmp/other-workbuddy.info' })
    expect((ctx.settings as unknown as FakeSettingsService).valueOf(ENTRY, 'authFile'))
      .toBe('/tmp/other-workbuddy.info')
  })

  /**
   * Both providers register from one plugin, unconditionally, and the four
   * credential combinations are expressed through catalog visibility rather
   * than through registration. That is what lets a sign-in that happens while
   * DSH is already running surface without a restart.
   */
  it('registers both variants and keeps each variant identity separate', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-dual-'))
    vi.stubEnv('DSH_HOME', root)
    // Shorten the credential sweep: the assertions below change a setting and
    // then wait for the group to react, which only happens on a sweep.
    vi.stubEnv('DSH_WORKBUDDY_POLL_MS', '100')
    // One real-shaped credential per product, in separate files. The upstream
    // fetch is stubbed to fail so the assertion covers the per-variant fallback
    // rosters rather than depending on the network.
    const cnFile = join(root, 'cn.info')
    const aiFile = join(root, 'ai.info')
    await writeFile(cnFile, credentialDocument('copilot.tencent.com'))
    await writeFile(aiFile, credentialDocument('www.workbuddy.ai', 'uid-ai'))
    vi.stubEnv('WORKBUDDY_AUTH_FILE', cnFile)
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', aiFile)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline in tests') }))

    const ctx = await bootWithSettings()

    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(
        expect.arrayContaining(['workbuddy', 'workbuddy-ai']),
      )
    })

    // One directory entry per variant: these are what the Models settings page
    // joins its provider rows on, and each row is where that variant's card
    // renders. Both address the same settings document (see the namespace
    // contract below) because on 0.1.7 a plugin has exactly one.
    const configurable = ctx.llm.listConfigurableProviders()
    const byProvider = new Map(configurable.map(entry => [entry.provider, entry]))
    expect([...byProvider.keys()]).toEqual(expect.arrayContaining(['workbuddy', 'workbuddy-ai']))
    for (const id of ['workbuddy', 'workbuddy-ai']) {
      expect(byProvider.get(id)?.settingsNs).toBe(WorkBuddy.WORKBUDDY_SETTINGS_NS)
      // `[]` means the whole section is this provider's profile.
      expect(byProvider.get(id)?.settingsPath).toEqual([])
    }

    // THE NAMESPACE CONTRACT (0.1.7). A plugin's composition entry IS its
    // settings namespace there, so both products' fields live in ONE document:
    // the profile row `llm-workbuddy`. `WORKBUDDY_SETTINGS_NS` therefore names
    // that entry, and it is what the native editor and the settings wire read.
    // The per-variant `workbuddy`/`workbuddy-ai` sections do not exist on this
    // generation, and nothing registers one.
    const served = new Set(ctx.settings.describe().map(entry => entry.ns))
    expect(served).toContain(WorkBuddy.WORKBUDDY_SETTINGS_NS)
    expect(WorkBuddy.WORKBUDDY_SETTINGS_NS).toBe(ENTRY)
    expect(served).not.toContain('workbuddy')
    expect(served).not.toContain('workbuddy-ai')

    // Both products' fields are readable from that one document, each under its
    // own field name, so one product's path still cannot be overwritten by the
    // other's control.
    const live = (key: string): unknown => (ctx.settings as unknown as FakeSettingsService).valueOf(ENTRY, key)
    expect(live('authFile')).toBeUndefined()
    expect(live('authFileAI')).toBeUndefined()

    // A write through one section must reach ONLY that variant's store. The
    // schema assertions above prove the two forms are split; this proves the
    // wiring behind them is too. Without it, a section could carry the right
    // field while `onChange` handed it to the wrong store and nothing above
    // would notice.
    //
    // Observable chosen deliberately: point `authFileAI` at a file holding a
    // CN-domain credential. If the write really reached the AI store, that
    // store REFUSES the cross-product credential — so the refused identity must
    // never appear in the AI pool while the CN pool is untouched. A mis-routed
    // write would land a CN-region credential in the CN pool instead, and the
    // CN file would gain it.
    //
    // The refusal no longer EMPTIES the group, and that is deliberate: a bad
    // desktop path must not take away accounts the user added by those other
    // routes. (Emptying it is what the throwing read used to do, and on the
    // international variant the same throw took the whole status route down with
    // it.) The refused credential is reported through the status document's
    // `desktopError` instead, and the pool keeps serving.
    const wrongRegionForAi = join(root, 'cn-credential-for-ai.info')
    await writeFile(wrongRegionForAi, credentialDocument('copilot.tencent.com', 'uid-cn-wrong'))
    await ctx.settings.update(ENTRY, { authFileAI: wrongRegionForAi })
    // A bounded settle rather than waitFor: if the wiring were broken the pool
    // would simply never change, and an assertion states that plainly instead of
    // surfacing as a timeout. Two sweeps at the 100 ms interval above.
    await new Promise(resolve => setTimeout(resolve, 400))
    const poolUids = async (file: string): Promise<string[]> => {
      const parsed = JSON.parse(await readFile(join(root as string, file), 'utf8')) as { accounts?: { uid?: string }[] }
      return (parsed.accounts ?? []).map(account => account.uid ?? '')
    }
    // The refused CN credential is nowhere in the AI pool, and the account that
    // was legitimately captured from the international file is still there.
    expect(await poolUids('.workbuddy-ai-accounts.json')).toEqual(['uid-ai'])
    // The CN pool never saw the mis-routed write at all.
    expect(await poolUids('.workbuddy-accounts.json')).toEqual(['uid-1'])
    expect((await ctx.llm.listModels('workbuddy')).length).toBeGreaterThan(0)
    // The group survives a desktop file it cannot use.
    expect((await ctx.llm.listModels('workbuddy-ai')).length).toBeGreaterThan(0)

    // And the setting is genuinely read back through the merged config: putting
    // a valid international file back restores the group.
    await ctx.settings.update(ENTRY, { authFileAI: aiFile })
    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('workbuddy-ai')).length).toBeGreaterThan(0)
    }, { timeout: 10_000 })

    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('workbuddy')).length).toBeGreaterThan(0)
      expect((await ctx.llm.listModels('workbuddy-ai')).length).toBeGreaterThan(0)
    })

    // The two variants must not share a roster: the international models are
    // not reachable through the CN provider, and vice versa. A shared fallback
    // list would misdescribe one of them (different rates, windows, and
    // declared efforts).
    const cn = (await ctx.llm.listModels('workbuddy')).map(model => model.id)
    const ai = (await ctx.llm.listModels('workbuddy-ai')).map(model => model.id)
    expect(cn).toContain('minimax-m3')
    expect(ai).not.toContain('minimax-m3')
    expect(ai).toContain('gpt-5.6-luna')
    expect(cn).not.toContain('gpt-5.6-luna')

    // The preference is on by default: a profile that never touched the setting
    // gets the largest declared window, and an explicit opt-out restores the
    // upstream's own default.
    expect((await ctx.llm.resolveModelInfo('workbuddy-ai', 'deepseek-v4.1-flash')).context?.contextWindow).toBe(1_000_000)
    await ctx.settings.update(ENTRY, { useMaximumContextWindow: false })
    await vi.waitFor(async () => {
      expect((await ctx.llm.resolveModelInfo('workbuddy-ai', 'deepseek-v4.1-flash')).context?.contextWindow).toBe(300_000)
    })
  })

  /**
   * With no credential present, a variant exposes nothing. This is the
   * deliberate behaviour change the plan calls out: the CN provider used to
   * publish 15 fallback models to a signed-out user, which offered models that
   * could only fail on the first message.
   */
  it('hides a variant with no usable credential while still registering it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-empty-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('WORKBUDDY_AUTH_FILE', join(root, 'absent-cn.info'))
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', join(root, 'absent-ai.info'))
    const ctx = await bootWithSettings()

    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('workbuddy')
    })
    await vi.waitFor(async () => {
      expect(await ctx.llm.listModels('workbuddy')).toEqual([])
    })
    expect(await ctx.llm.listModels('workbuddy-ai')).toEqual([])

    // The provider is still registered: the group is hidden by having no
    // models, not by unregistering the adapter, so a later sign-in needs no
    // restart. (No configurable-provider directory entry is made, by design.)
    expect(ctx.llm.listProviders().map(provider => provider.id))
      .toEqual(expect.arrayContaining(['workbuddy', 'workbuddy-ai']))
    // And the settings section is still there to explain how to sign in.
    expect(ctx.settings.describe().find(entry => entry.ns === WorkBuddy.WORKBUDDY_SETTINGS_NS)).toBeDefined()
  })

  /**
   * A credential for the other product is refused, and the refusal is what the
   * card shows. Silently treating it as "signed out" would send the user to
   * re-authenticate when the actual fix is a file path.
   */
  it('refuses a cross-product credential instead of using it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-cross-'))
    vi.stubEnv('DSH_HOME', root)
    // The CN file is handed to the international provider, which is exactly the
    // misconfiguration a user can produce with authFileAI / the env var.
    const crossFile = join(root, 'wrong.info')
    await writeFile(crossFile, credentialDocument('copilot.tencent.com'))
    vi.stubEnv('WORKBUDDY_AUTH_FILE', join(root, 'absent-cn.info'))
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', crossFile)
    const ctx = await bootWithSettings()

    const models = await (async () => {
      await vi.waitFor(() => {
        expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('workbuddy-ai')
      })
      return ctx.llm.listModels('workbuddy-ai')
    })()
    // Refused, so the group stays hidden rather than serving a roster the token
    // cannot actually reach.
    expect(models).toEqual([])
  })

  /**
   * A host whose settings service lacks the page-policy API must degrade to a
   * provider with a READ-ONLY preference — providers and models still serve,
   * nothing throws mid-inject, and the card's checkbox is withheld rather than
   * offered as a control that could not be saved.
   */
  it('degrades without the configure API while still serving models', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-no-settings-api-'))
    vi.stubEnv('DSH_HOME', root)
    const aiFile = join(root, 'ai.info')
    await writeFile(aiFile, credentialDocument('www.workbuddy.ai', 'uid-ai'))
    vi.stubEnv('WORKBUDDY_AUTH_FILE', join(root, 'absent-cn.info'))
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', aiFile)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline in tests') }))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(FakeSettingsService)
    // The service exists but carries no page-policy API: the plugin must not
    // treat that as a working settings surface.
    ;(ctx.settings as unknown as Record<string, unknown>)['configure'] = undefined
    const settings = FakeSettingsService.current as FakeSettingsService
    settings.declareEntry(ENTRY, {}, SCHEMA)
    const fiber = ctx.plugin(WorkBuddy, {})
    await fiber
    settings.bindFiber(ENTRY, fiber.config)

    // Both providers still register and the signed-in AI variant still serves
    // its fallback catalog.
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id))
        .toEqual(expect.arrayContaining(['workbuddy', 'workbuddy-ai']))
    })
    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('workbuddy-ai')).length).toBeGreaterThan(0)
    })
  })

  /**
   * The image half of the attachment contract (issue #52): the handle text a
   * model is told to `read_image` must carry the path the host fs can re-read,
   * and a host with no fs service must keep the short handle rather than fail.
   * Driven through the real plugin entry so a forgotten wiring in `index.ts`
   * fails here, not only in a live session.
   */
  it('wires image access through the optional fs service in both variants (issue #52)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-image-access-'))
    vi.stubEnv('DSH_HOME', root)
    const cnFile = join(root, 'cn.info')
    const aiFile = join(root, 'ai.info')
    await writeFile(cnFile, credentialDocument('copilot.tencent.com'))
    await writeFile(aiFile, credentialDocument('www.workbuddy.ai', 'uid-ai'))
    vi.stubEnv('WORKBUDDY_AUTH_FILE', cnFile)
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', aiFile)

    const hostPath = 'C:\\Users\\Corrine Hu\\图片\\原图.png'
    const image = { attachmentId: 'sha256:test', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
    const attachmentStore = {
      imageHostPath: () => hostPath,
      readImageRequest: async () => ({
        variantId: 'variant' as never,
        attachment: image,
        data: new Uint8Array([1, 2, 3]),
        mediaType: 'image/png',
        bytes: 3,
        width: 1,
        height: 1,
        depth: 'uchar',
        space: 'srgb',
        hasAlpha: false,
      }),
    }
    const sentBodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        sentBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      }
      throw new Error('offline in tests')
    }))

    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(FakeSettingsService)
    const settings = FakeSettingsService.current as FakeSettingsService
    settings.declareEntry(ENTRY, {}, SCHEMA)
    ctx.provide('attachments', attachmentStore as never)
    const fiber = ctx.plugin(WorkBuddy, {})
    await fiber
    settings.bindFiber(ENTRY, fiber.config)

    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id))
        .toEqual(expect.arrayContaining(['workbuddy', 'workbuddy-ai']))
    })

    const imageMessage = (offloaded = false) => ({
      id: 'image-test' as never,
      role: 'user' as const,
      source: { kind: 'user' as const },
      content: [
        { type: 'text' as const, text: 'describe' },
        { type: 'image' as const, attachment: image, ...(offloaded ? { offloaded: true as const } : {}) },
      ],
    } as never)
    const textFromRequest = (body: Record<string, unknown> | undefined): string => {
      const messages = body?.['messages'] as { content?: string | { text?: string }[] }[] | undefined
      return messages?.map(item => typeof item.content === 'string'
        ? item.content
        : item.content?.map(block => block.text ?? '').join('\n') ?? '').join('\n') ?? ''
    }
    const sendImage = async (provider: string, offloaded = false): Promise<void> => {
      for await (const _chunk of ctx.llm.stream({
        provider,
        model: 'glm-5.3',
        messages: [imageMessage(offloaded)],
      })) {
        // The captured HTTP request is the assertion boundary.
      }
    }

    // Without an fs service the handle keeps its short form, and the bytes
    // still travel — a host that maps no paths must not lose the image.
    await sendImage('workbuddy')
    expect(textFromRequest(sentBodies[0])).not.toContain('Normalized copy (read-only;')
    expect(JSON.stringify(sentBodies[0])).toContain('data:image/png;base64,AQID')

    let mappedPath = 'Z:\\WorkBuddy Data\\模型工具\\图像.png'
    ctx.provide('fs', {
      processPathFromHostPath: (path: string) => path === hostPath ? mappedPath : undefined,
    } as never)
    await sendImage('workbuddy')
    expect(textFromRequest(sentBodies[1])).toContain(JSON.stringify(mappedPath))
    expect(JSON.stringify(sentBodies[1])).toContain('data:image/png;base64,AQID')

    // The international variant shares the wiring, and the host path itself
    // never reaches the model.
    await sendImage('workbuddy-ai')
    const aiText = textFromRequest(sentBodies[2])
    expect(aiText).toContain(JSON.stringify(mappedPath))
    expect(aiText).not.toContain(hostPath)

    // The mapping is consulted per request, so a later change is picked up.
    mappedPath = 'Z:\\new mapping.png'
    await sendImage('workbuddy-ai')
    expect(textFromRequest(sentBodies[3])).toContain(JSON.stringify(mappedPath))
  })
})
