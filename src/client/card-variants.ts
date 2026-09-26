/**
 * The browser-visible identity of each WorkBuddy product: its routes, and the
 * copy keys that name it.
 *
 * This lives apart from any component because several of them need it and none
 * of them owns it — the settings page renders both products, the sidebar
 * window labels both, the sidebar footer summarises both, and the composer
 * control resolves a provider id back to the card that serves it. It is also
 * the one place the two products' route constants are paired, so a variant can
 * never end up reading another's status document.
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
   * The product's own name, drawn wherever the UI has to name it rather than
   * paraphrase it. Taken from the variant because the two products fail in the
   * same shapes, so nothing in a failure says which name is right.
   */
  appName: string
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
  appName: 'WorkBuddy',
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
  appName: 'WorkBuddy AI',
}

/** Both products, in display order. */
export const CARD_VARIANTS: readonly WorkBuddyCardVariant[] = [CN_CARD_VARIANT, AI_CARD_VARIANT]
