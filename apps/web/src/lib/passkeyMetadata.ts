/**
 * Describe a passkey for display: map its AAGUID (authenticator model id) to a
 * provider name, and derive a visual kind + transport label. Falls back to
 * sensible labels from backedUp/transports when the AAGUID is unknown. Adapted
 * from printstream's passkeyMetadata.
 */
import type { PasskeyInfo } from '@persistent/shared'

export type PasskeyVisualKind = 'synced' | 'device' | 'phone' | 'security-key' | 'generic'

export interface PasskeyMetadata {
  defaultLabel: string
  providerLabel: string | null
  transportLabel: string
  visualKind: PasskeyVisualKind
}

type KnownEntry = Pick<PasskeyMetadata, 'defaultLabel' | 'providerLabel' | 'visualKind'>

// Well-known AAGUIDs (from the public passkey-authenticator-aaguids dataset).
const KNOWN_AAGUIDS: Record<string, KnownEntry> = {
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': { defaultLabel: 'Google Password Manager', providerLabel: 'Google Password Manager', visualKind: 'synced' },
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': { defaultLabel: 'iCloud Keychain', providerLabel: 'iCloud Keychain', visualKind: 'synced' },
  'd548826e-79b4-db40-a3d8-11116f7e8349': { defaultLabel: 'Bitwarden', providerLabel: 'Bitwarden', visualKind: 'synced' },
  'bada5566-a7aa-401f-bd96-45619a55120d': { defaultLabel: '1Password', providerLabel: '1Password', visualKind: 'synced' },
  'b84e4048-15dc-4dd0-8640-f4f60813c8af': { defaultLabel: 'NordPass', providerLabel: 'NordPass', visualKind: 'synced' },
  '0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6': { defaultLabel: 'Keeper', providerLabel: 'Keeper', visualKind: 'synced' },
  '531126d6-e717-415c-9320-3d9aa6981239': { defaultLabel: 'Dashlane', providerLabel: 'Dashlane', visualKind: 'synced' },
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': { defaultLabel: 'Windows Hello', providerLabel: 'Windows Hello', visualKind: 'device' },
  '08987058-cadc-4b81-b6e1-30de50dcbe96': { defaultLabel: 'Windows Hello', providerLabel: 'Windows Hello', visualKind: 'device' },
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a7': { defaultLabel: 'Windows Hello', providerLabel: 'Windows Hello', visualKind: 'device' },
  'fa2b99dc-9e39-4257-8f92-4a30d23c4118': { defaultLabel: 'YubiKey 5', providerLabel: 'Yubico', visualKind: 'security-key' },
  'cb69481e-8ff7-4039-93ec-0a2729a154a8': { defaultLabel: 'YubiKey 5', providerLabel: 'Yubico', visualKind: 'security-key' }
}

function has(transports: string[], t: string): boolean {
  return transports.includes(t)
}

export function describePasskey(passkey: Pick<PasskeyInfo, 'aaguid' | 'backedUp' | 'transports'>): PasskeyMetadata {
  const transports = passkey.transports ?? []
  const transportLabel = formatTransports(transports)
  const known = passkey.aaguid ? KNOWN_AAGUIDS[passkey.aaguid.toLowerCase()] : undefined
  if (known) return { ...known, transportLabel }

  if (passkey.backedUp) {
    return { defaultLabel: 'Synced passkey', providerLabel: null, transportLabel, visualKind: 'synced' }
  }
  if (transports.some((t) => ['usb', 'nfc', 'ble', 'smart-card'].includes(t))) {
    return { defaultLabel: 'Security key', providerLabel: null, transportLabel, visualKind: 'security-key' }
  }
  if (has(transports, 'hybrid')) {
    return { defaultLabel: 'Nearby phone', providerLabel: null, transportLabel, visualKind: 'phone' }
  }
  if (has(transports, 'internal')) {
    return { defaultLabel: 'This device', providerLabel: null, transportLabel, visualKind: 'device' }
  }
  return { defaultLabel: 'Passkey', providerLabel: null, transportLabel, visualKind: 'generic' }
}

function formatTransports(transports: string[]): string {
  if (transports.length === 0) return ''
  const labels: Record<string, string> = {
    internal: 'Built-in',
    hybrid: 'Hybrid / QR',
    usb: 'USB',
    nfc: 'NFC',
    ble: 'Bluetooth',
    'smart-card': 'Smart card',
    cable: 'Cable'
  }
  return transports.map((t) => labels[t] ?? t).join(', ')
}
