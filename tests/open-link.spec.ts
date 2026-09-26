/**
 * The system-browser hand-off, and the control route that carries it.
 *
 * The behaviour under test is the part a browser cannot verify: opening a link
 * is a process spawn on the machine running the host, and the promise the card
 * depends on is "either the OS was told to show this page, or the answer says
 * why not" — never a silent success.
 */
import { describe, expect, it, vi } from 'vitest'
import { isOpenableLink, launcherFor, openWorkBuddyLink } from '../src/open-link.ts'

/** A harness that records launches instead of making them. */
function recorder(platform: NodeJS.Platform = 'darwin') {
  const calls: { command: string, args: readonly string[] }[] = []
  let failure: Error | undefined
  const harness = {
    platform,
    spawn: async (command: string, args: readonly string[]) => {
      calls.push({ command, args })
      if (failure !== undefined) throw failure
    },
  }
  return { harness, calls, failWith: (error: Error) => { failure = error } }
}

describe('launcherFor', () => {
  it('uses each platform\'s own default-handler entry point', () => {
    expect(launcherFor('darwin').command).toBe('open')
    expect(launcherFor('linux').command).toBe('xdg-open')
    // rundll32 takes the comma-joined handler spec as ONE argument: splitting it
    // asks Windows to load a module literally named "url.dll,".
    expect(launcherFor('win32').command).toBe('rundll32.exe')
    expect(launcherFor('win32').args('https://example.com/a')).toEqual([
      'url.dll,FileProtocolHandler',
      'https://example.com/a',
    ])
  })
})

describe('isOpenableLink', () => {
  it('admits absolute http(s) links only', () => {
    expect(isOpenableLink('https://copilot.tencent.com/login?platform=CLI&state=x')).toBe(true)
    expect(isOpenableLink('http://127.0.0.1:3080/settings')).toBe(true)
    // Every one of these would otherwise reach a launcher that hands the string
    // to whatever the OS registered for the scheme.
    expect(isOpenableLink('file:///etc/passwd')).toBe(false)
    expect(isOpenableLink('javascript:alert(1)')).toBe(false)
    expect(isOpenableLink('ms-msdt:/id')).toBe(false)
    expect(isOpenableLink('//example.com/login')).toBe(false)
    expect(isOpenableLink('/login')).toBe(false)
    expect(isOpenableLink('')).toBe(false)
    expect(isOpenableLink(undefined)).toBe(false)
    expect(isOpenableLink(42)).toBe(false)
  })
})

describe('openWorkBuddyLink', () => {
  it('hands an accepted link to the launcher, once', async () => {
    const { harness, calls } = recorder()
    await expect(openWorkBuddyLink('https://www.workbuddy.ai/login?state=abc', harness))
      .resolves.toEqual({ state: 'opened' })
    expect(calls).toEqual([{ command: 'open', args: ['https://www.workbuddy.ai/login?state=abc'] }])
  })

  it('refuses a non-web scheme without launching anything', async () => {
    const { harness, calls } = recorder()
    const result = await openWorkBuddyLink('file:///etc/passwd', harness)
    expect(result.state).toBe('invalid-link')
    expect(calls).toEqual([])
  })

  it('reports a launcher that could not be started instead of claiming success', async () => {
    const { harness, failWith } = recorder()
    failWith(new Error('spawn open ENOENT'))
    const result: { state: string, reason?: string } = await openWorkBuddyLink('https://example.com/login', harness)
    expect(result.state).toBe('failed')
    expect(result.reason).toContain('ENOENT')
  })
})

describe('the open-link action on the control route', () => {
  /** The handler under test, built from the same seam the host registers. */
  async function handler(openExternal: ((url: string) => Promise<{ state: string, reason?: string }>) | undefined) {
    const { workBuddyProbeHandler } = await import('../src/probe-route.ts')
    return workBuddyProbeHandler({
      probe: async () => ({ state: 'ok' }),
      clear: () => {},
      ...openExternal === undefined ? {} : { openExternal },
    } as never, 'k')
  }

  /**
   * A minimal same-origin POST carrying the in-process key.
   *
   * The key is an explicit option rather than a defaulted parameter: the
   * "carries no key at all" case is a distinct assertion, and an omitted
   * argument would make it impossible to write that call deliberately.
   */
  async function post(
    run: (req: never, res: never) => Promise<void>,
    body: unknown,
    options: { key?: string, withKey?: boolean } = {},
  ): Promise<{ status: number, body: Record<string, unknown> }> {
    const headers: Record<string, string> = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }
    if (options.withKey !== false) headers['x-workbuddy-probe-key'] = options.key ?? 'k'
    const req = {
      method: 'POST',
      headers,
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) },
    }
    let status = 0
    let payload = ''
    const res = {
      writeHead: (code: number) => { status = code },
      end: (text: string) => { payload = text },
    }
    await run(req as never, res as never)
    return { status, body: JSON.parse(payload) as Record<string, unknown> }
  }

  it('opens the link and answers with the opener\'s state', async () => {
    const opened: string[] = []
    const run = await handler(async url => { opened.push(url); return { state: 'opened' } })
    const answer = await post(run, { action: 'open-link', url: 'https://copilot.tencent.com/login?state=abc' })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ state: 'opened' })
    expect(opened).toEqual(['https://copilot.tencent.com/login?state=abc'])
  })

  it('refuses a request with no url, and one with no opener mounted', async () => {
    const run = await handler(async () => ({ state: 'opened' }))
    expect((await post(run, { action: 'open-link' })).status).toBe(400)
    expect((await post(run, { action: 'open-link', url: '   ' })).status).toBe(400)

    const without = await handler(undefined)
    expect((await post(without, { action: 'open-link', url: 'https://example.com' })).status).toBe(404)
  })

  it('still answers 403 without a key this host minted', async () => {
    const run = await handler(async () => ({ state: 'opened' }))
    expect((await post(run, { action: 'open-link', url: 'https://example.com' }, { withKey: false })).status).toBe(403)
    // A key from the other product's page is still a key this host minted, so
    // the link action accepts either — refusing one would break the product the
    // user is actually signed in to.
    expect((await post(run, { action: 'open-link', url: 'https://example.com' }, { key: 'nope' })).status).toBe(403)
  })
})
