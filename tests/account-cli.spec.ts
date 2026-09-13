import { describe, expect, it } from 'vitest'
import { describeWait } from '../src/status-paths.ts'
import { formatAccounts } from '../src/account-cli.ts'
import { CN_VARIANT } from '../src/variants.ts'
import type { WorkBuddyAccountPool } from '../src/account-pool.ts'
import type { WorkBuddyAccountSnapshot } from '../src/account-service.ts'

/**
 * How a wait is described.
 *
 * The unit choice is shared by the CLI and the settings page, so it is asserted
 * once here rather than trusted twice. It matters because an upstream-stated
 * reset can be most of a day away: reporting that as "1078 分钟" states the right
 * instant in a form nobody reads.
 */

describe('describeWait', () => {
  const now = 1_700_000_000_000

  it('counts in minutes below an hour', () => {
    expect(describeWait(now + 60_000, now)).toEqual({ unit: 'minute', value: 1 })
    expect(describeWait(now + 45 * 60_000, now)).toEqual({ unit: 'minute', value: 45 })
    expect(describeWait(now + 59 * 60_000, now)).toEqual({ unit: 'minute', value: 59 })
  })

  it('switches to hours at the hour mark', () => {
    expect(describeWait(now + 60 * 60_000, now)).toEqual({ unit: 'hour', value: 1 })
    expect(describeWait(now + 18 * 3_600_000, now)).toEqual({ unit: 'hour', value: 18 })
  })

  it('rounds up, so a bench never reads as already over', () => {
    // One second left is still a wait: "0 分钟" would invite an immediate retry.
    expect(describeWait(now + 1_000, now)).toEqual({ unit: 'minute', value: 1 })
    expect(describeWait(now + 60 * 60_000 + 1, now)).toEqual({ unit: 'hour', value: 2 })
  })

  it('treats a passed deadline as the shortest wait rather than a negative one', () => {
    expect(describeWait(now - 60_000, now)).toEqual({ unit: 'minute', value: 1 })
  })
})

describe('the CLI listing', () => {
  /**
   * A pool stub carrying only what the listing reads: the account records, so
   * the disabled/benched tally lines up with the rows above them.
   */
  function poolWith(cooldown: { untilMs: number, reason: 'rate' | 'credit' | 'session', strikes: number }): WorkBuddyAccountPool {
    return {
      list: () => [{
        id: 'u:e', uid: 'u', nickname: 'A', domain: 'copilot.tencent.com',
        accessToken: 'at', refreshToken: 'rt', expiresAtMs: 0, origin: 'desktop',
        enabled: true, lastUsedAtMs: 0, addedAtMs: 0, updatedAtMs: 0, cooldown,
      }],
      isAvailable: () => false,
    } as unknown as WorkBuddyAccountPool
  }

  function snapshotWith(cooldown: { untilMs: number, reason: 'rate' | 'credit' | 'session', strikes: number }): WorkBuddyAccountSnapshot {
    return {
      accounts: [{
        id: 'u:e', uid: 'u', name: 'A', origin: 'desktop', domain: 'copilot.tencent.com',
        renewable: true, enabled: true, available: false,
        expiresAtMs: 0, lastUsedAtMs: 0, addedAtMs: 0,
        cooldown,
      }],
    }
  }

  it('states a short bench in minutes and a long one in hours', () => {
    const now = 1_700_000_000_000
    const shortCooldown = { untilMs: now + 7 * 60_000, reason: 'rate' as const, strikes: 1 }
    const short = formatAccounts({
      variant: CN_VARIANT, now, pool: poolWith(shortCooldown),
      snapshot: snapshotWith(shortCooldown),
    })
    expect(short).toContain('限流，7 分钟后重试')

    // The case an upstream-stated reset produces: hours, not minutes.
    const longCooldown = { untilMs: now + 18 * 3_600_000, reason: 'rate' as const, strikes: 1 }
    const long = formatAccounts({
      variant: CN_VARIANT, now, pool: poolWith(longCooldown),
      snapshot: snapshotWith(longCooldown),
    })
    expect(long).toContain('限流，18 小时后重试')
  })

  it('names the reason a bench was earned for', () => {
    const now = 1_700_000_000_000
    const creditCooldown = { untilMs: now + 3_600_000, reason: 'credit' as const, strikes: 1 }
    const credit = formatAccounts({
      variant: CN_VARIANT, now, pool: poolWith(creditCooldown),
      snapshot: snapshotWith(creditCooldown),
    })
    expect(credit).toContain('额度耗尽，1 小时后重试')
  })
})
