/**
 * Doubles for the plugin's OWN interfaces.
 *
 * A double that implements one method of eight and is then cast past the
 * interface is a lie the type system was talked into: if production starts
 * calling the missing method, the test does not fail at the assertion it was
 * written for — it fails a frame later with a TypeError, or it passes without
 * having exercised anything. That is the failure mode this module removes.
 *
 * `WorkBuddyCredentialStore` cannot be satisfied by an object literal at all: it
 * is a class with private state, so structural typing demands the private fields
 * too, and every hand-written double therefore reached for `as unknown as`.
 * {@link credentialStoreDouble} subclasses the real class instead — the private
 * half comes for free, and a later change to the class's own interface breaks
 * this file rather than the test that happened to cast past it.
 *
 * Platform types are a different case and are not here: `Response`, `Document`
 * and `fetch` have structure no object literal can satisfy honestly, so a
 * bridge to them is unavoidable — and unlike a plugin interface, it cannot hide
 * a disagreement about this plugin's own contracts.
 *
 * @module dsh-workbuddy-connect/tests/doubles
 */

import { WorkBuddyCredentialStore } from '../src/auth.ts'
import type { WorkBuddyAuthStatus, WorkBuddyCredential } from '../src/auth.ts'
import type { WorkBuddyShim } from '../src/shim.ts'

/** The members of {@link WorkBuddyCredentialStore} a test may state. */
export interface CredentialStoreAnswers {
  status?: () => Promise<WorkBuddyAuthStatus>
  current?: () => Promise<WorkBuddyCredential | undefined>
  desktopCredential?: () => Promise<WorkBuddyCredential | undefined>
  resolve?: () => Promise<WorkBuddyCredential>
  logout?: () => Promise<void>
}

/**
 * A credential store that answers exactly what a test states.
 *
 * `status()` defaults to the signed-out shape and `current()` to "no usable
 * credential", because that is what the production class answers on a machine
 * with no desktop app — the double states the same fact the real store would.
 * `resolve()` throws unless a test set it: production calls it only when it
 * intends to spend a credential, so a silent default there would hide the very
 * dependency a test should have been told about.
 *
 * The refresh callback is the identity: a double holds no credential to renew,
 * and every method that could renew one is overridden.
 */
export function credentialStoreDouble(answers: CredentialStoreAnswers = {}): WorkBuddyCredentialStore {
  return new (class extends WorkBuddyCredentialStore {
    constructor() {
      super({ refresh: async credential => credential })
    }

    async status(): Promise<WorkBuddyAuthStatus> {
      return answers.status === undefined ? { state: 'signed-out' } : await answers.status()
    }

    async current(): Promise<WorkBuddyCredential | undefined> {
      return answers.current === undefined ? undefined : await answers.current()
    }

    async desktopCredential(): Promise<WorkBuddyCredential | undefined> {
      return answers.desktopCredential === undefined ? undefined : await answers.desktopCredential()
    }

    async resolve(): Promise<WorkBuddyCredential> {
      if (answers.resolve === undefined) {
        throw new Error(
          'WorkBuddyCredentialStore double: resolve() was not set up. Add it beside the test that needs it, '
          + 'rather than letting the double claim a credential it does not have.',
        )
      }
      return await answers.resolve()
    }

    async logout(): Promise<void> {
      await answers.logout?.()
    }
  })()
}

/** The members of {@link WorkBuddyShim} a test may state. */
export interface ShimAnswers {
  baseUrl?: string
  token?: string
  ready?: Promise<void>
}

/**
 * A shim handle that never listens on a socket.
 *
 * The adapter only ever asks one for its origin and its token, so the double
 * states those and keeps `ready` already resolved — the alternative, a real
 * listener, costs a port and proves nothing the adapter's own contract test does
 * not.
 */
export function shimDouble(answers: ShimAnswers = {}): WorkBuddyShim {
  return {
    ready: answers.ready ?? Promise.resolve(),
    baseUrl: () => answers.baseUrl ?? 'http://127.0.0.1:1',
    token: () => answers.token ?? 'test-token',
    close: async () => {},
  }
}
