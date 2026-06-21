/**
 * "Continue with Google" — native uses Credential Manager (the GoogleAuth
 * plugin) to get an ID token; web uses Google Identity Services' rendered button.
 * Both hand the ID token to useAuth().loginWithGoogle. Only shown when the server
 * reports a configured Google client id.
 */
import { useEffect, useRef } from 'react'
import Button from '@mui/joy/Button'
import GoogleIcon from '@mui/icons-material/Google'
import { extractErrorMessage } from '@persistent/shared'
import { useAuth } from '../auth/useAuth.js'
import { GoogleAuthNative, isNative } from '../native/alarmBridge.js'

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void
      renderButton: (el: HTMLElement, options: Record<string, unknown>) => void
    }
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'

function loadGis(): Promise<GoogleIdentityServices> {
  return new Promise((resolve, reject) => {
    const existing = (window as unknown as { google?: GoogleIdentityServices }).google
    if (existing?.accounts?.id) {
      resolve(existing)
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => {
      const g = (window as unknown as { google?: GoogleIdentityServices }).google
      if (g?.accounts?.id) resolve(g)
      else reject(new Error('Google sign-in failed to load.'))
    }
    script.onerror = () => reject(new Error('Google sign-in failed to load.'))
    document.head.appendChild(script)
  })
}

export function GoogleSignInButton({ clientId, onError }: { clientId: string; onError: (message: string) => void }) {
  const { loginWithGoogle } = useAuth()
  const webButtonRef = useRef<HTMLDivElement>(null)
  const native = isNative()

  useEffect(() => {
    if (native || !webButtonRef.current) return
    let cancelled = false
    loadGis()
      .then((gis) => {
        if (cancelled || !webButtonRef.current) return
        gis.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            loginWithGoogle(credential).catch((err) => onError(extractErrorMessage(err, "Couldn't sign in with Google.")))
          }
        })
        const width = Math.min(400, Math.max(200, Math.floor(webButtonRef.current.clientWidth) || 320))
        gis.accounts.id.renderButton(webButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          logo_alignment: 'left',
          width
        })
      })
      .catch((err) => onError(extractErrorMessage(err, "Couldn't load Google sign-in.")))
    return () => {
      cancelled = true
    }
  }, [native, clientId, loginWithGoogle, onError])

  if (native) {
    return (
      <Button
        variant="outlined"
        color="neutral"
        fullWidth
        startDecorator={<GoogleIcon />}
        onClick={async () => {
          try {
            const { idToken } = await GoogleAuthNative.signIn({ serverClientId: clientId })
            await loginWithGoogle(idToken)
          } catch (err) {
            onError(extractErrorMessage(err, "Couldn't sign in with Google."))
          }
        }}
      >
        Continue with Google
      </Button>
    )
  }

  // Web: GIS renders its own button into this full-width element.
  return <div ref={webButtonRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }} />
}
