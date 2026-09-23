/**
 * The two WorkBuddy desktop apps this one plugin serves.
 *
 * Both products are the same client framework in different regions, and both
 * write their sign-in into the *same* shared `CodeBuddyExtension` auth
 * directory — they differ by file basename, base URL, catalog endpoint, and
 * display identity. Everything that varies between them is collected here as
 * one descriptor, so no module has to carry its own `if (international)`
 * branch and a third variant would be a data change rather than a refactor.
 *
 * This module is host-side (it names files and env vars). The browser half
 * takes the same ids and routes from the Node-free `status-paths.ts`, which
 * stays the single source shared by both halves.
 *
 * @module dsh-workbuddy-connect/variants
 */

import {
  WORKBUDDY_ACCOUNT_PATH,
  WORKBUDDY_AI_ACCOUNT_PATH,
  WORKBUDDY_AI_PROBE_PATH,
  WORKBUDDY_AI_STATUS_PATH,
  WORKBUDDY_PROBE_PATH,
  WORKBUDDY_STATUS_PATH,
} from './status-paths.ts'
import type { WorkBuddyRegion } from './upstream.ts'

/** One WorkBuddy product variant. */
export interface WorkBuddyVariant {
  /** Provider id registered with DSH, e.g. `workbuddy-ai`. */
  id: string
  /** Model-group heading and card title stem, e.g. `WorkBuddy AI`. */
  displayName: string
  /** Desktop app name as users know it, for diagnostics and error copy. */
  appName: string
  /** Which upstream region this variant's credentials must belong to. */
  region: WorkBuddyRegion
  /** Env var overriding the desktop auth-file location. */
  env: string
  /** Basename of the desktop app's own auth file in the shared auth directory. */
  desktopFilename: string
  /** Basename of the plugin-owned credential copy under `$DSH_HOME`. */
  ownFilename: string
  /**
   * Basename of the plugin-owned account-pool file under `$DSH_HOME`.
   *
   * One pool per variant, for the same reason the catalogs are split: the two
   * products are separate subscriptions, and an account signed into one has no
   * meaning for the other. The pool holds that variant's desktop-app account
   * plus every account added by QR, so a user signed into both apps gets two
   * independent rotations.
   */
  accountFilename: string
  /**
   * Basename of the plugin-owned context-length preference file under
   * `$DSH_HOME`.
   *
   * One per variant for the same reason as the pools: the two products declare
   * different windows for the same model id, so a length chosen for one must not
   * be applied to the other.
   */
  contextFilename: string
  /** Basename of the plugin-owned probe-record file under `$DSH_HOME`. */
  probeFilename: string
  /**
   * Basename of the plugin-owned saved-catalog file under `$DSH_HOME`.
   *
   * One per variant, like the probe records: the two endpoints disagree about
   * rates, windows, and even which models exist for a shared id, so a catalog
   * saved from one must never be served as the other's.
   */
  catalogFilename: string
  /**
   * Basename of the plugin-owned per-account model-visibility file under
   * `$DSH_HOME`.
   *
   * One per variant, for the same reason as the catalogs and probe records:
   * the two endpoints share model ids, so one variant's hidden list must never
   * answer for the other's picker.
   */
  visibilityFilename: string
  /** Same-origin status route consumed by this variant's card. */
  statusPath: string
  /** Same-origin account-control route consumed by this variant's card. */
  accountPath: string
  /** Same-origin probe-control route consumed by this variant's card. */
  probePath: string
}

/** CN WorkBuddy first: the existing provider keeps its id, paths, and copy. */
export const WORKBUDDY_VARIANTS: readonly WorkBuddyVariant[] = [
  {
    id: 'workbuddy',
    displayName: 'WorkBuddy',
    appName: 'WorkBuddy',
    region: 'cn',
    env: 'WORKBUDDY_AUTH_FILE',
    desktopFilename: 'workbuddy-desktop.info',
    ownFilename: '.workbuddy-auth.json',
    accountFilename: '.workbuddy-accounts.json',
    contextFilename: '.workbuddy-context.json',
    probeFilename: '.workbuddy-probe.json',
    catalogFilename: '.workbuddy-catalog.json',
    visibilityFilename: '.workbuddy-model-visibility.json',
    statusPath: WORKBUDDY_STATUS_PATH,
    accountPath: WORKBUDDY_ACCOUNT_PATH,
    probePath: WORKBUDDY_PROBE_PATH,
  },
  {
    id: 'workbuddy-ai',
    displayName: 'WorkBuddy AI',
    appName: 'WorkBuddy AI',
    region: 'global',
    env: 'WORKBUDDY_AI_AUTH_FILE',
    desktopFilename: 'workbuddy-desktop-ai.info',
    ownFilename: '.workbuddy-ai-auth.json',
    accountFilename: '.workbuddy-ai-accounts.json',
    contextFilename: '.workbuddy-ai-context.json',
    probeFilename: '.workbuddy-ai-probe.json',
    catalogFilename: '.workbuddy-ai-catalog.json',
    visibilityFilename: '.workbuddy-ai-model-visibility.json',
    statusPath: WORKBUDDY_AI_STATUS_PATH,
    accountPath: WORKBUDDY_AI_ACCOUNT_PATH,
    probePath: WORKBUDDY_AI_PROBE_PATH,
  },
]

/** The CN variant; the plugin's long-standing default and compatibility anchor. */
export const CN_VARIANT: WorkBuddyVariant = WORKBUDDY_VARIANTS[0]!

/** The international variant. */
export const AI_VARIANT: WorkBuddyVariant = WORKBUDDY_VARIANTS[1]!

/** Look up a variant by provider id. */
export function variantFor(id: string): WorkBuddyVariant | undefined {
  return WORKBUDDY_VARIANTS.find(variant => variant.id === id)
}
