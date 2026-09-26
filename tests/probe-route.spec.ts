import { createServer, request as httpRequest, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createProbeKey, workBuddyProbeHandler, type WorkBuddyProbeRouteOptions } from '../src/probe-route.ts'

/**
 * Offline tests for the probe control route, the plugin's only state-changing
 * endpoint. Two guards must both hold before anything happens: the loopback
 * Host/Origin check (drops DNS-rebinding pages) and the in-process key (proves
 * the caller was the same-origin card, since any local process can write
 * `Host: 127.0.0.1`).
 */

let server: Server | undefined

afterEach(async () => {
  if (server !== undefined) {
    await new Promise<void>(resolve => server?.close(() => resolve()))
    server = undefined
  }
})

/** Mount the handler on an ephemeral port and return its origin + key. */
async function mount(deps?: Partial<WorkBuddyProbeRouteOptions>): Promise<{ origin: string; key: string; calls: string[] }> {
  const key = createProbeKey()
  const calls: string[] = []
  const handler = workBuddyProbeHandler({
    probe: async modelId => {
      calls.push(modelId)
      return { state: 'ok' }
    },
    clear: () => { calls.push('clear') },
    ...deps,
  }, key)
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { origin: `http://127.0.0.1:${address.port}`, key, calls }
}

/** POST one control action. */
async function post(
  origin: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(origin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

/**
 * POST with full control over the request headers, including `Host`, which
 * `fetch` refuses to set. Needed to exercise the rebinding guard.
 */
async function postRaw(
  origin: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(origin)
  const payload = JSON.stringify(body)
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: url.hostname,
      port: url.port,
      path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk as Buffer))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(text) as Record<string, unknown> } catch { /* leave empty */ }
        resolve({ status: response.statusCode ?? 0, body: parsed })
      })
    })
    request.on('error', reject)
    request.end(payload)
  })
}

describe('probe control route', () => {
  it('accepts a probe carrying the correct key', async () => {
    const { origin, key, calls } = await mount()
    const result = await post(origin, { action: 'probe', model: 'auto' }, { 'X-WorkBuddy-Probe-Key': key })
    expect(result.status).toBe(200)
    expect(result.body['state']).toBe('ok')
    expect(calls).toEqual(['auto'])
  })

  it('rejects a probe with no key', async () => {
    const { origin, calls } = await mount()
    const result = await post(origin, { action: 'probe', model: 'auto' })
    expect(result.status).toBe(403)
    expect(result.body['error']).toBe('invalid-probe-key')
    // Nothing was spent.
    expect(calls).toEqual([])
  })

  /**
   * The sign-in link is not variant-scoped, so its registration accepts either
   * product's key — the dialog may be open for product A while B is the one with
   * a signed-in account and therefore the one that handed out a key.
   */
  it('accepts any key a predicate admits, and still refuses the ones it does not', async () => {
    const keys = [createProbeKey(), createProbeKey()]
    const opened: string[] = []
    const handler = workBuddyProbeHandler({
      probe: async () => ({ state: 'ok' }),
      clear: () => {},
      openExternal: async url => { opened.push(url); return { state: 'opened' } },
    }, presented => keys.includes(presented ?? ''))
    server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    const origin = `http://127.0.0.1:${String(address.port)}`

    for (const key of keys) {
      const result = await post(origin, { action: 'open-link', url: 'https://example.com/login' }, { 'X-WorkBuddy-Probe-Key': key })
      expect(result.status).toBe(200)
    }
    expect(opened).toEqual(['https://example.com/login', 'https://example.com/login'])

    // A key this host never minted is still refused, predicate or not.
    const foreign = await post(origin, { action: 'open-link', url: 'https://example.com/login' }, { 'X-WorkBuddy-Probe-Key': createProbeKey() })
    expect(foreign.status).toBe(403)
    expect((await post(origin, { action: 'open-link', url: 'https://example.com/login' })).status).toBe(403)
    expect(opened).toHaveLength(2)
  })

  it('rejects a wrong key of the same length', async () => {
    const { origin, key, calls } = await mount()
    const wrong = `${key.slice(0, -1)}${key.endsWith('a') ? 'b' : 'a'}`
    const result = await post(origin, { action: 'probe', model: 'auto' }, { 'X-WorkBuddy-Probe-Key': wrong })
    expect(result.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('rejects a non-loopback Host even with the right key', async () => {
    const { origin, key, calls } = await mount()
    // `fetch` refuses to set a `Host` header (it is a forbidden header name),
    // so a spoofed Host has to go through the raw HTTP client — which is
    // exactly what a DNS-rebinding page's request looks like on the wire.
    const result = await postRaw(origin, { action: 'probe', model: 'auto' }, {
      'X-WorkBuddy-Probe-Key': key,
      'Host': 'attacker.example',
    })
    expect(result.status).toBe(403)
    expect(result.body['error']).toBe('request-not-trusted')
    expect(calls).toEqual([])
  })

  it('rejects a non-loopback Origin even with the right key', async () => {
    const { origin, key, calls } = await mount()
    const result = await post(origin, { action: 'probe', model: 'auto' }, {
      'X-WorkBuddy-Probe-Key': key,
      'Origin': 'https://attacker.example',
    })
    expect(result.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('refuses GET', async () => {
    const { origin, key } = await mount()
    const response = await fetch(origin, { headers: { 'X-WorkBuddy-Probe-Key': key } })
    expect(response.status).toBe(405)
  })

  it('rejects a malformed action, and a probe with no model', async () => {
    const { origin, key, calls } = await mount()
    const headers = { 'X-WorkBuddy-Probe-Key': key }
    expect((await post(origin, { action: 'nope' }, headers)).status).toBe(400)
    expect((await post(origin, { action: 'probe' }, headers)).status).toBe(400)
    expect((await post(origin, { action: 'probe', model: '   ' }, headers)).status).toBe(400)
    expect((await post(origin, 'not json', headers)).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('rejects an oversized body', async () => {
    const { origin, key } = await mount()
    const result = await post(origin, { action: 'probe', model: 'x'.repeat(5000) }, { 'X-WorkBuddy-Probe-Key': key })
    expect(result.status).toBe(413)
  })

  it('accepts a clear action', async () => {
    const { origin, key, calls } = await mount()
    const result = await post(origin, { action: 'clear' }, { 'X-WorkBuddy-Probe-Key': key })
    expect(result.status).toBe(200)
    expect(calls).toEqual(['clear'])
  })

  it('accepts the maximum-context preference only when the host supports it', async () => {
    let enabled: boolean | undefined
    const { origin, key } = await mount({
      setMaximumContextWindow: async value => {
        enabled = value
        return { state: 'updated' }
      },
    })
    const result = await post(origin, { action: 'set-maximum-context-window', enabled: true }, { 'X-WorkBuddy-Probe-Key': key })
    expect(result).toMatchObject({ status: 200, body: { state: 'updated' } })
    expect(enabled).toBe(true)
  })

  /**
   * The sidebar's display style: a plugin-wide preference, so this route carries
   * it and validates it against the closed set before it reaches the config.
   */
  it('stores the sidebar credit style, and refuses one that is not in the set', async () => {
    const written: string[] = []
    const { origin, key } = await mount({
      setSidebarCreditStyle: async style => {
        written.push(style)
        return { state: 'updated' }
      },
    })
    const headers = { 'X-WorkBuddy-Probe-Key': key }
    expect((await post(origin, { action: 'set-sidebar-credit-style', creditStyle: 'usage' }, headers)).status).toBe(200)
    expect((await post(origin, { action: 'set-sidebar-credit-style', creditStyle: 'remaining' }, headers)).status).toBe(200)
    // A style nothing renders must not be stored just because it is a string.
    expect((await post(origin, { action: 'set-sidebar-credit-style', creditStyle: 'fancy' }, headers)).status).toBe(400)
    expect((await post(origin, { action: 'set-sidebar-credit-style' }, headers)).status).toBe(400)
    expect(written).toEqual(['usage', 'remaining'])
  })

  it('reports the sidebar style as unsupported when the host cannot store it', async () => {
    const { origin, key } = await mount()
    const result = await post(origin, { action: 'set-sidebar-credit-style', creditStyle: 'usage' }, { 'X-WorkBuddy-Probe-Key': key })
    expect(result).toMatchObject({ status: 404, body: { error: 'sidebar-style-setting-not-supported' } })
  })

  /**
   * Whether the sidebar carries its credit card at all: the same plugin-wide
   * route, a boolean instead of a closed set.
   *
   * `false` is the interesting value — it is what removes the card from the
   * sidebar — so it has to survive the wire intact rather than being dropped as
   * a falsy payload.
   */
  it('stores whether the sidebar carries its credit card', async () => {
    const written: boolean[] = []
    const { origin, key } = await mount({
      setSidebarCreditVisible: async visible => {
        written.push(visible)
        return { state: 'updated' }
      },
    })
    const headers = { 'X-WorkBuddy-Probe-Key': key }
    expect((await post(origin, { action: 'set-sidebar-credit-visible', enabled: false }, headers)).status).toBe(200)
    expect((await post(origin, { action: 'set-sidebar-credit-visible', enabled: true }, headers)).status).toBe(200)
    // A truthiness test would read the string "false" as "keep the card", which
    // is the opposite of what that request plainly means — so it is refused
    // rather than coerced.
    expect((await post(origin, { action: 'set-sidebar-credit-visible', enabled: 'false' }, headers)).status).toBe(400)
    expect((await post(origin, { action: 'set-sidebar-credit-visible' }, headers)).status).toBe(400)
    expect(written).toEqual([false, true])
  })

  it('reports the sidebar visibility as unsupported when the host cannot store it', async () => {
    const { origin, key } = await mount()
    const result = await post(origin, { action: 'set-sidebar-credit-visible', enabled: false }, { 'X-WorkBuddy-Probe-Key': key })
    expect(result).toMatchObject({ status: 404, body: { error: 'sidebar-visible-setting-not-supported' } })
  })

  it('writes the model allowlist, deduped and account-guarded', async () => {
    let written: readonly string[] | undefined
    let guarded: string | undefined
    const { origin, key } = await mount({
      setModelAllowlist: async (ids, expectedAccount) => {
        written = ids
        guarded = expectedAccount
        return { state: 'updated' }
      },
    })
    const result = await post(origin, {
      action: 'set-model-allowlist',
      account: 'uid-a:ent',
      // A duplicate is untrusted input; the wire should not carry it into the file.
      allowlist: ['m1', 'm2', 'm1'],
    }, { 'X-WorkBuddy-Probe-Key': key })
    expect(result).toMatchObject({ status: 200, body: { state: 'updated' } })
    expect(written).toEqual(['m1', 'm2'])
    expect(guarded).toBe('uid-a:ent')
  })

  it('refuses an allowlist write without an account to guard it', async () => {
    // No account means no bucket and no guard, so the write is refused rather
    // than aimed at whichever account happens to be signed in.
    const { origin, key } = await mount({
      setModelAllowlist: async () => ({ state: 'updated' }),
    })
    for (const body of [
      { action: 'set-model-allowlist', allowlist: ['m1'] },
      { action: 'set-model-allowlist', account: '', allowlist: ['m1'] },
      { action: 'set-model-allowlist', account: 'a', allowlist: 'm1' },
      { action: 'set-model-allowlist', account: 'a', allowlist: [''] },
    ]) {
      const result = await post(origin, body, { 'X-WorkBuddy-Probe-Key': key })
      expect(result.status).toBe(400)
    }
  })

  it('reports an unsupported allowlist write instead of silently accepting it', async () => {
    // A host with no visibility store must not answer "updated" for a write it
    // never made.
    const { origin, key } = await mount()
    const result = await post(origin, {
      action: 'set-model-allowlist', account: 'uid-a:ent', allowlist: [],
    }, { 'X-WorkBuddy-Probe-Key': key })
    expect(result.status).toBe(404)
  })

  it('mints a distinct key per call', () => {
    expect(createProbeKey()).not.toBe(createProbeKey())
  })
})
