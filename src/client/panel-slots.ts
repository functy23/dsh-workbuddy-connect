/**
 * Slot contracts the WorkBuddy dashboard panel registers into.
 *
 * Neither slot belongs to this plugin: `sidebar.footer.action` is declared by
 * `@deepseek-ai/dsh-client-ui-sidebar` and the layout's keyed `main` by
 * `@deepseek-ai/dsh-client-ui-layout`. Both packages ARE dependencies of this
 * bundle (they name the slot types only — neither ships a client module the
 * browser has to resolve), so these declarations would merge with the real ones
 * anyway; restating them here keeps the registration site checked against the
 * exact contract even on a host where the owning package's types resolve to an
 * older shape, and turns an upstream change that invalidates this panel into a
 * compile error rather than a silent mis-registration at runtime.
 *
 * The re-statement must stay structurally identical to upstream's.
 *
 * @module dsh-workbuddy-connect/client/panel-slots
 */

import type { SidebarFooterActionOwnerProps } from './panel-view.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The layout's central panel, keyed by the sidebar entry's id. The reserved
     * `conversation` key hosts the Conversation; the panel this plugin
     * contributes occupies `workbuddy-panel` and receives no Session binding.
     * Its owner props are empty — a global panel is root-scoped chrome.
     */
    'main': { kind: 'keyed', scope: 'root' }
    /**
     * The sidebar-foot action list, rendered in the foot area directly ABOVE
     * the Settings seat. Registering here is what pins a row to the bottom of
     * the sidebar on top of Settings — unlike `sidebar.panellist`, whose rows
     * render as global panel icons at the very top of the column.
     *
     * The shell wraps nothing: the entry owns its whole surface and receives
     * only the column fold state.
     */
    'sidebar.footer.action': { kind: 'list', scope: 'root', owner: SidebarFooterActionOwnerProps }
  }
}

export {}
