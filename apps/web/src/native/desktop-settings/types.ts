/**
 * What each card in this folder is handed. The hook is called once by
 * `DesktopSettings` and the result passed down, so the two cards can never be
 * showing settings from two different reads of the host.
 */
import type { HostSettings, HostSettingsPatch } from '../desktopBridge.js'

export interface HostSettingsProps {
  settings: HostSettings
  update: (patch: HostSettingsPatch) => void
}
