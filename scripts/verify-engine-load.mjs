/**
 * Engine-load verification for the installed WorkBuddy plugin.
 *
 * Run this from a profile directory (where `dsh-workbuddy-connect` resolves)
 * to answer the question a build-and-test pass cannot: does the HOST actually
 * boot the plugin on this engine, and do the surfaces register?
 *
 * It composes a real cordis context with the engine's own services and mounts
 * the plugin the way the loader does, then asserts the facts the UI depends on:
 * the provider registers, the settings service receives the page policy, and
 * the two marked-volatile config fields really resolve into references.
 *
 * @module scripts/verify-engine-load
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as WorkBuddy from 'dsh-workbuddy-connect'

/** Minimal settings service exposing only the 0.1.7 face the plugin writes through. */
class SettingsStub extends Service {
  static current
  constructor(ctx) {
    super(ctx, 'settings')
    SettingsStub.current = this
    this.policies = []
    this.writes = []
  }
  configure(presentation) {
    this.policies.push(presentation)
    return () => {}
  }
  update(ns, patch) {
    this.writes.push({ ns, patch })
    return Promise.resolve()
  }
}

const failures = []
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
    failures.push(label)
  }
}

const root = await mkdtemp(join(tmpdir(), 'wb-engine-load-'))
process.env['DSH_HOME'] = root
process.env['WORKBUDDY_AUTH_FILE'] = join(root, 'absent-cn.info')
process.env['WORKBUDDY_AI_AUTH_FILE'] = join(root, 'absent-ai.info')
// No network: this checks the wiring, not the upstream.
globalThis.fetch = async () => { throw new Error('offline') }

const ctx = new Context()
await ctx.plugin(LlmRuntime)
await ctx.plugin(SettingsStub)
const settings = SettingsStub.current

console.log('engine-load verification')
check('plugin exposes apply()', typeof WorkBuddy.apply === 'function')
check('plugin names its llm dependency', !WorkBuddy.inject || WorkBuddy.inject.includes('llm'), String(WorkBuddy.inject))

// Every field must be marked volatile: that is what 0.1.7's settings forms
// project and what makes a write commit in place.
check('every field is marked volatile',
  Object.values(WorkBuddy.Config.dict).every(node => node.meta?.volatile === true))

// Hand over the RAW config, exactly as the loader does — cordis validates once
// through the plugin's schema, which is what creates the references. Passing an
// already-parsed config would make cordis re-validate references as plain
// objects and throw `expected string but got [object Object]`.
const fiber = ctx.plugin(WorkBuddy, {})
await fiber
// One field stands in for all of them: the point is that the loader's parse
// produced live references rather than frozen values, which is what makes a
// settings write commit in place. (This used to read `floatingAccounts`, a
// setting the plugin no longer has.)
check('the parsed config holds volatile references',
  typeof fiber.config?.sidebarCreditStyle?.get === 'function'
  && fiber.config.sidebarCreditStyle.get() === 'remaining')

await new Promise(resolve => setTimeout(resolve, 250))
const providers = ctx.llm.listProviders().map(provider => provider.id)
check('both providers register', providers.includes('workbuddy') && providers.includes('workbuddy-ai'), providers.join(','))
check('the settings page policy was declared', settings.policies.some(policy => policy.auto === false))
check('the config entry id is the profile row', WorkBuddy.PROFILE_ENTRY_ID === 'llm-workbuddy', WorkBuddy.PROFILE_ENTRY_ID)

if (typeof WorkBuddy.applyMaximumContextWindow === 'function') {
  check('maximum-window application is exported', true)
}

await ctx.fiber.dispose()
await rm(root, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nall checks passed')
