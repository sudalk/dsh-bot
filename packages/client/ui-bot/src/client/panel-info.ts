/** Shared opener for the panel's right-hand info drawer. */

import { createContext, useContext } from 'react'

/**
 * Opens the info drawer for the current selection. Provided by the Bots
 * panel so a nested conversation view (rendered through the `bot.chat` slot)
 * can offer the same affordance as the room pane.
 */
export const PanelInfoContext = createContext<() => void>(() => {})

/**
 * Read the info-drawer opener from the surrounding Bots panel.
 * @returns the opener; a no-op outside the panel.
 */
export function useOpenPanelInfo(): () => void {
  return useContext(PanelInfoContext)
}
