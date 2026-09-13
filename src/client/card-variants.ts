/**
 * The browser-visible identity of each WorkBuddy product: its routes, and the
 * copy keys that name it.
 *
 * This lives apart from any component because three of them need it and none of
 * them owns it — the settings page renders both products, the floating window
 * labels both, and the composer control resolves a provider id back to the card
 * that serves it. It is also the one place the two products' route constants are
 * paired, so a variant can never end up reading another's status document.
 *
 * @module dsh-workbuddy-connect/client/card-variants
 */

import {
  WORKBUDDY_ACCOUNT_PATH,
  WORKBUDDY_AI_ACCOUNT_PATH,
  WORKBUDDY_AI_PROBE_PATH,
  WORKBUDDY_AI_STATUS_PATH,
  WORKBUDDY_PROBE_PATH,
  WORKBUDDY_STATUS_PATH,
} from '../status-paths.ts'
import type { WorkBuddySettingsKey } from './locales.ts'

/** The browser-visible half of a variant: identity, routes, and copy keys. */
export interface WorkBuddyCardVariant {
  id: string
  /** Locale key for the product's name in a heading. */
  titleKey: WorkBuddySettingsKey
  /** Locale key for the one-line description. */
  introKey: WorkBuddySettingsKey
  /** Locale key for the not-signed-in hint. */
  signedOutKey: WorkBuddySettingsKey
  statusPath: string
  probePath: string
  /** Write endpoint that manages this variant's account pool. */
  accountPath: string
  /**
   * The web console a user signs into to obtain a pasted token.
   *
   * Not the API host: the CN console is `www.workbuddy.cn` while its API is
   * `copilot.tencent.com`, so pointing the sign-in button at the API host would
   * open a page with nothing to sign into.
   */
  consoleUrl: string
}

/** CN WorkBuddy; the plugin's long-standing product and default. */
export const CN_CARD_VARIANT: WorkBuddyCardVariant = {
  id: 'workbuddy',
  titleKey: 'title',
  introKey: 'intro',
  signedOutKey: 'signedOutHint',
  statusPath: WORKBUDDY_STATUS_PATH,
  probePath: WORKBUDDY_PROBE_PATH,
  accountPath: WORKBUDDY_ACCOUNT_PATH,
  consoleUrl: 'https://www.workbuddy.cn/',
}

/** International WorkBuddy AI. */
export const AI_CARD_VARIANT: WorkBuddyCardVariant = {
  id: 'workbuddy-ai',
  titleKey: 'titleAI',
  introKey: 'introAI',
  signedOutKey: 'signedOutHintAI',
  statusPath: WORKBUDDY_AI_STATUS_PATH,
  probePath: WORKBUDDY_AI_PROBE_PATH,
  accountPath: WORKBUDDY_AI_ACCOUNT_PATH,
  consoleUrl: 'https://www.workbuddy.ai/',
}

/** Both products, in display order. */
export const CARD_VARIANTS: readonly WorkBuddyCardVariant[] = [CN_CARD_VARIANT, AI_CARD_VARIANT]
