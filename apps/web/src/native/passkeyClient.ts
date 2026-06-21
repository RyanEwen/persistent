/**
 * Passkey ceremonies that work on web and native. On the web they use
 * @simplewebauthn/browser (navigator.credentials); in the Capacitor app they go
 * through the native Credential Manager bridge (the WebView has no WebAuthn).
 * Both return the response object the server verifies.
 */
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/browser'
import { PasskeyNative, isNative } from './alarmBridge.js'

export async function passkeyRegister(options: PublicKeyCredentialCreationOptionsJSON): Promise<unknown> {
  if (isNative()) {
    const { response } = await PasskeyNative.createPasskey({ options: JSON.stringify(options) })
    return JSON.parse(response)
  }
  return startRegistration({ optionsJSON: options })
}

export async function passkeyAuthenticate(options: PublicKeyCredentialRequestOptionsJSON): Promise<unknown> {
  if (isNative()) {
    const { response } = await PasskeyNative.getPasskey({ options: JSON.stringify(options) })
    return JSON.parse(response)
  }
  return startAuthentication({ optionsJSON: options })
}
