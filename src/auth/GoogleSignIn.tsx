import { useEffect, useRef, useState } from 'react'
import { env } from '@/lib/env'
import { errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { useAuth } from './AuthProvider'

interface GoogleIdentity {
  accounts: { id: { initialize(options: object): void; renderButton(el: HTMLElement, options: object): void } }
}
declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

let script: Promise<void> | null = null
function loadGoogle(): Promise<void> {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      script = null
      reject(new Error('Could not load Google sign-in.'))
    }
    document.head.appendChild(s)
  })
  return script
}

/** Google gets the SHA-256 of the nonce, Supabase the raw value, so a stolen token can't be replayed. */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return { raw, hashed: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') }
}

/**
 * Google's own button (a popup that hands the ID token straight to Supabase), so Google's
 * screen names this site instead of the Supabase project address. Without a client ID, or
 * when Google's script can't load, it falls back to the redirect sign-in.
 */
export function GoogleSignIn({ onError }: { onError: (message: string | null) => void }) {
  const { signInWithGoogle, signInWithGoogleToken } = useAuth()
  const box = useRef<HTMLDivElement>(null)
  const [fallback, setFallback] = useState(!env.googleClientId)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!env.googleClientId) return
    let cancelled = false
    void (async () => {
      try {
        const [, nonce] = await Promise.all([loadGoogle(), makeNonce()])
        const el = box.current
        if (cancelled || !el || !window.google) return
        window.google.accounts.id.initialize({
          client_id: env.googleClientId,
          nonce: nonce.hashed,
          use_fedcm_for_prompt: true,
          callback: async ({ credential }: { credential: string }) => {
            onError(null)
            try {
              await signInWithGoogleToken(credential, nonce.raw)
            } catch (e) {
              onError(errorMessage(e))
            }
          },
        })
        window.google.accounts.id.renderButton(el, {
          type: 'standard',
          theme: document.documentElement.classList.contains('dark') ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          width: Math.min(400, el.offsetWidth),
        })
      } catch {
        if (!cancelled) setFallback(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onError, signInWithGoogleToken])

  if (!fallback) return <div ref={box} className="flex min-h-10 w-full justify-center" />

  return (
    <Button
      variant="outline"
      className="w-full gap-2.5"
      loading={busy}
      onClick={async () => {
        onError(null)
        setBusy(true)
        try {
          await signInWithGoogle()
        } catch (e) {
          onError(errorMessage(e))
          setBusy(false)
        }
      }}
    >
      {!busy && <GoogleMark />}
      Continue with Google
    </Button>
  )
}

/** Google's own "G" mark, as their branding guidelines require on sign-in buttons. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
