/** Whether refreshed app content may be presented, including surfaces portalled outside the page. */
import { createContext, useContext } from 'react'

export const StartupDataContext = createContext(true)

/** Dialogs and host snapshots wait with the page; surfaces outside a startup gate remain available. */
export function useStartupDataReady(): boolean {
  return useContext(StartupDataContext)
}
