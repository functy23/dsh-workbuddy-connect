import { createServer, request } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyAccountPool } from '../src/account-pool.ts'
import { WorkBuddyAccountService } from '../src/account-service.ts'
import { WorkBuddyCredentialStore } from '../src/auth.ts'
import { WorkBuddyQrLogin } from '../src/qr-login.ts'
import { workBuddyStatusHandler } from '../src/web-status.ts'
import { WORKBUDDY_STATUS_PATH } from '../src/status-paths.ts'
import { CN_VARIANT } from '../src/variants.ts'
import type { WorkBuddyStatusRouteOptions } from '../src/web-status.ts'
import type { WorkBuddyUpstreamModel } from '../src/upstream.ts'

const CLEANUP: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(CLEANUP.splice(0).map(clean => clean()))
})

function nestedDoc(expiresAt: number): string {
  return JSON.stringify({
    auth: { accessToken: 'at', refreshToken: 'rt', expiresAt, domain: 'www.codebuddy.cn' },
    account: { uid: 'uid-1', nickname: '昵称' },
  })
}

/**
 * A status server whose desktop credential cannot be read at all, over an empty
 * pool — the international variant's shape on a machine with no usable
 * decryption binary.
 *
 * The promise under test: this is a SIGNED-OUT document WITH A KEY, not a 500.
 * The key is how the card adds an account by pasting a token, which on that
 * variant is the only way in. The whole route used to fail here, so every action
 * answered "request failed" and the user was never told why.
 */
async function startUnreadableDesktopServer(): Promise<{ port: number, body: Record<string, unknown> }> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-status-nodecrypt-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  const thrown = 'no WorkBuddy Electron binary is configured for this platform; set WORKBUDDY_ELECTRON_BIN to the app\'s Electron binary'
  const accounts = new WorkBuddyAccountService({
    variant: CN_VARIANT,
    pool: new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'accounts.json') }),
    // Every desktop read fails the way the at-rest key provider fails when it
    // has no binary to run.
    store: {
      desktopCredential: async () => { throw new Error(thrown) },
      current: async () => { throw new Error(thrown) },
    },
    client: { fetchCredits: async () => ({ total: 0, accounts: [] }), refreshToken: async () => ({ accessToken: 'at' }) },
    qr: new WorkBuddyQrLogin({ variant: CN_VARIANT }),
  })
  const deps = {
    accounts,
    client: { fetchCredits: async () => ({ total: 0, accounts: [] }) },
    models: () => [],
    emptyReason: () => thrown,
    probeKey: 'key-under-test',
    store: { status: async () => ({ state: 'signed-out', reason: thrown, reasonCode: 'electron-binary-unavailable' }) },
  } as unknown as WorkBuddyStatusRouteOptions
  const server = createServer(workBuddyStatusHandler(deps))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => { resolve() }))
  const { port } = server.address() as { port: number }
  CLEANUP.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const answer = await requestOnce({ port, method: 'GET', headers: { host: `127.0.0.1:${String(port)}` } })
  return { port, body: JSON.parse(answer.body) as Record<string, unknown> }
}

/** Raw HTTP request with full header control (fetch forbids overriding Host). */
function requestOnce(options: {
  port: number
  method: string
  headers: Record<string, string>
}): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      host: '127.0.0.1',
      port: options.port,
      method: options.method,
      path: WORKBUDDY_STATUS_PATH,
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

/**
 * A status server backed by a real pool with one desktop-captured account, so
 * these tests exercise the same shape the plugin serves: "signed in" means the
 * pool has an account, not that the desktop file exists.
 */
async function startStatusServer(overrides: Partial<WorkBuddyStatusRouteOptions> = {}): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-status-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  const desktop = join(dir, 'workbuddy-desktop.info')
  await writeFile(desktop, nestedDoc(Date.now() + 3600_000))
  const store = new WorkBuddyCredentialStore({
    variant: CN_VARIANT,
    desktopPath: desktop,
    ownPath: join(dir, 'own.json'),
    refresh: async credential => ({ accessToken: credential.accessToken }),
  })
  const pool = new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'accounts.json') })
  const accounts = new WorkBuddyAccountService({
    variant: CN_VARIANT,
    pool,
    store,
    client: { fetchCredits: async () => ({ total: 0, accounts: [] }), refreshToken: async () => ({ accessToken: 'at' }) },
    qr: new WorkBuddyQrLogin({ variant: CN_VARIANT }),
  })
  await accounts.captureDesktop()
  const deps: WorkBuddyStatusRouteOptions = {
    accounts,
    client: { fetchCredits: async () => ({ total: 0, accounts: [] }) },
    models: () => [],
    ...overrides,
  }
  const server = createServer(workBuddyStatusHandler(deps))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  CLEANUP.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  return port
}

describe('an unreadable desktop credential', () => {
  it('answers a signed-out document carrying the key, not a 500', async () => {
    const { body } = await startUnreadableDesktopServer()
    // The document, not an error payload: the card needs the key to add an
    // account at all.
    expect(body['status']).toBe('signed-out')
    expect(body['probeKey']).toBe('key-under-test')
    // And it says what is wrong, in the host's own words.
    expect(String(body['reason'])).toContain('no WorkBuddy Electron binary is configured')
    // The empty pool rides along, because this is the state accounts are ADDED from.
    expect(body['accounts']).toEqual({ accounts: [] })
  })
})

describe('context capacity reporting', () => {
  /**
   * The card needs every model's capacity, not only the promoted ones: the
   * models where capacity matters (a 200k model beside 1M siblings) carry no
   * promo, so a payload filtered down to discounts would hide exactly the fact
   * worth showing. The discount list filters at render time instead.
   */
  it('reports capacity for un-promoted models, verbatim and unfiltered', async () => {
    const port = await startStatusServer({
      models: (): readonly WorkBuddyUpstreamModel[] => [
        {
          id: 'glm-5.1', name: 'GLM-5.1', contextWindow: 200_000, maxTokens: 48_000, supportsImages: false,
          reasoning: { supports: true, onlyReasoning: true, canDisableThinking: false },
          billing: { credits: 'x0.79 credits', free: false },
        },
        {
          id: 'hy3', name: 'Hy3', contextWindow: 192_000, maxTokens: 64_000, supportsImages: true,
          reasoning: { supports: true, onlyReasoning: true, canDisableThinking: false },
          billing: { credits: 'x0.00', free: true, badges: ['限时免费'] },
        },
        {
          id: 'plain', name: 'Plain', contextWindow: 1_000_000, maxTokens: 32_000, supportsImages: true,
          reasoning: { supports: true, onlyReasoning: true, canDisableThinking: false },
          billing: { free: false },
        },
      ],
    })
    const response = await requestOnce({ port, method: 'GET', headers: { host: `127.0.0.1:${String(port)}` } })
    const body = JSON.parse(response.body) as { models?: readonly { id: string; contextWindow?: number }[] }
    const models = body.models ?? []
    // Verbatim from upstream: no rounding, and no tier of the plugin's own.
    expect(models.find(model => model.id === 'glm-5.1')?.contextWindow).toBe(200_000)
    expect(models.find(model => model.id === 'hy3')?.contextWindow).toBe(192_000)
    // A model with no promo and no rate is still reported: capacity is the one
    // fact the card needs for every model, not just the discounted ones.
    expect(models.find(model => model.id === 'plain')?.contextWindow).toBe(1_000_000)
  })

  /**
   * The pool is what "signed in" means now. The desktop app's session is only
   * one way an account gets in, so the status document must describe the pool
   * even when the app is signed out — which is the whole point of capturing the
   * credential at all.
   */
  it('reports signed-in from the pool even with no desktop file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-status-'))
    CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
    const store = new WorkBuddyCredentialStore({
      variant: CN_VARIANT,
      desktopPath: join(dir, 'absent.info'),
      ownPath: join(dir, 'own.json'),
      refresh: async credential => ({ accessToken: credential.accessToken }),
    })
    const pool = new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'accounts.json') })
    const accounts = new WorkBuddyAccountService({
      variant: CN_VARIANT,
      pool,
      store,
      client: { fetchCredits: async () => ({ total: 12, accounts: [] }), refreshToken: async () => ({ accessToken: 'at' }) },
      qr: new WorkBuddyQrLogin({ variant: CN_VARIANT }),
    })
    // Capture once while the app is "signed in", then remove the file: the
    // captured account must keep the variant alive.
    const desktop = join(dir, 'absent.info')
    await writeFile(desktop, nestedDoc(Date.now() + 3600_000))
    await accounts.captureDesktop()
    await rm(desktop, { force: true })

    const deps: WorkBuddyStatusRouteOptions = {
      accounts,
      client: { fetchCredits: async () => ({ total: 12, accounts: [] }) },
      models: () => [],
    }
    const server = createServer(workBuddyStatusHandler(deps))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    CLEANUP.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    const response = await requestOnce({ port, method: 'GET', headers: { host: `127.0.0.1:${String(port)}` } })
    const body = JSON.parse(response.body) as {
      status: string
      credits?: { total: number }
      accounts?: { accounts: readonly { origin: string }[] }
    }
    expect(body.status).toBe('signed-in')
    expect(body.credits?.total).toBe(12)
    expect(body.accounts?.accounts).toHaveLength(1)
    expect(body.accounts?.accounts[0]?.origin).toBe('desktop')
  })

  it('reports signed-out with a reason when the pool is empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-status-'))
    CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
    const store = new WorkBuddyCredentialStore({
      variant: CN_VARIANT,
      desktopPath: join(dir, 'absent.info'),
      ownPath: join(dir, 'own.json'),
      refresh: async credential => ({ accessToken: credential.accessToken }),
    })
    const pool = new WorkBuddyAccountPool({ variant: CN_VARIANT, path: join(dir, 'accounts.json') })
    const accounts = new WorkBuddyAccountService({
      variant: CN_VARIANT,
      pool,
      store,
      client: { fetchCredits: async () => ({ total: 0, accounts: [] }), refreshToken: async () => ({ accessToken: 'at' }) },
      qr: new WorkBuddyQrLogin({ variant: CN_VARIANT }),
    })
    const deps: WorkBuddyStatusRouteOptions = {
      accounts,
      client: { fetchCredits: async () => ({ total: 0, accounts: [] }) },
      models: () => [],
    }
    const server = createServer(workBuddyStatusHandler(deps))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    CLEANUP.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    const response = await requestOnce({ port, method: 'GET', headers: { host: `127.0.0.1:${String(port)}` } })
    const body = JSON.parse(response.body) as { status: string, reason?: string }
    expect(body.status).toBe('signed-out')
    expect(body.reason).toContain('no account')
  })
})

describe('maximum-context preference capability', () => {
  /**
   * The field's presence is the card's capability signal: the host includes it
   * only when the preference can actually be persisted, so a host whose
   * settings service lost the 0.1.2-era section API (DSH 0.1.7) answers
   * `undefined` from the getter and the document stays silent — the card then
   * renders no preference control at all.
   */
  it('carries the field when the getter answers a value', async () => {
    const port = await startStatusServer({
      probe: () => ({ consent: true, running: false, candidates: [], results: [] }),
      useMaximumContextWindow: () => true,
    })
    const response = await requestOnce({ port, method: 'GET', headers: { host: '127.0.0.1' } })
    const document = JSON.parse(response.body) as Record<string, unknown>
    expect(document['useMaximumContextWindow']).toBe(true)
  })

  it('omits the field when the getter answers undefined, keeping the rest of the document', async () => {
    const port = await startStatusServer({
      probe: () => ({ consent: true, running: false, candidates: [], results: [] }),
      useMaximumContextWindow: () => undefined,
    })
    const response = await requestOnce({ port, method: 'GET', headers: { host: '127.0.0.1' } })
    const document = JSON.parse(response.body) as Record<string, unknown>
    expect(document).not.toHaveProperty('useMaximumContextWindow')
    expect(document).toHaveProperty('probe')
  })
})

describe('sidebar credit card capability', () => {
  /**
   * The sidebar's two display preferences ride the document together, and both
   * must be readable before any other surface has run — the sidebar card draws
   * itself from this read alone.
   *
   * `false` is what has to survive JSON here: it is the value that removes the
   * card, and a getter whose answer was dropped as falsy would leave a card the
   * user had switched off sitting in the sidebar until the next restart.
   */
  it('carries both display preferences, including an off card', async () => {
    const port = await startStatusServer({
      sidebarCreditStyle: () => 'usage',
      sidebarCreditVisible: () => false,
    })
    const response = await requestOnce({ port, method: 'GET', headers: { host: '127.0.0.1' } })
    const document = JSON.parse(response.body) as Record<string, unknown>
    expect(document['sidebarCreditStyle']).toBe('usage')
    expect(document['sidebarCreditVisible']).toBe(false)
  })

  it('omits the field when the getter answers undefined, leaving the card to its default', async () => {
    const port = await startStatusServer({
      sidebarCreditStyle: () => 'remaining',
      sidebarCreditVisible: () => undefined,
    })
    const response = await requestOnce({ port, method: 'GET', headers: { host: '127.0.0.1' } })
    const document = JSON.parse(response.body) as Record<string, unknown>
    expect(document).not.toHaveProperty('sidebarCreditVisible')
    // The style beside it is unaffected: one absent preference must not take the
    // other with it.
    expect(document['sidebarCreditStyle']).toBe('remaining')
  })
})
