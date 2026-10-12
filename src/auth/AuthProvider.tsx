import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import { getSupabase } from '@/lib/supabase'
import { LOCAL_USER_ID } from '@/lib/db/localStore'
import { getOfflineStore } from '@/lib/db'
import { isOnline, storedUser } from '@/lib/session'

export interface AuthUser {
  id: string
  email: string | null
}

interface AuthState {
  mode: 'supabase' | 'local'
  ready: boolean
  user: AuthUser | null
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>
  sendReset(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
  signOut(): Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

function friendly(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return 'Email or password is incorrect.'
  if (m.includes('email not confirmed')) return 'Confirm your email first. Check your inbox for the link.'
  if (m.includes('already registered')) return 'An account with this email already exists. Sign in instead.'
  if (m.includes('rate limit')) return 'Too many attempts. Wait a few minutes and try again.'
  if (m.includes('fetch')) return 'Could not reach the server. Check your connection.'
  return msg
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  // Signed in on this device but the session can't be refreshed (offline): keep using the app.
  const [offlineUser, setOfflineUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(env.mode === 'local')

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) return
    let alive = true
    let settled = false
    const load = () =>
      sb.auth.getSession().then(({ data, error }) => {
        settled = true
        if (!alive) return
        setSession(data.session)
        const offline = !data.session && error ? storedUser() : null
        setOfflineUser(offline)
        if (offline) getOfflineStore()?.markUnreachable()
        setReady(true)
      })
    void load()
    // Refreshing an expired session keeps retrying for a while without internet.
    // Don't make the user wait for it: open the app with the saved session.
    const fallback = setTimeout(
      () => {
        if (settled || !alive) return
        const saved = storedUser()
        if (!saved) return
        setOfflineUser(saved)
        getOfflineStore()?.markUnreachable()
        setReady(true)
      },
      isOnline() ? 2500 : 0,
    )
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (s || event === 'SIGNED_OUT') setOfflineUser(null)
    })
    // Back online: refresh the saved session.
    const onOnline = () => void load()
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      clearTimeout(fallback)
      data.subscription.unsubscribe()
      window.removeEventListener('online', onOnline)
    }
  }, [])

  const value = useMemo<AuthState>(() => {
    const sb = getSupabase()
    const user: AuthUser | null =
      env.mode === 'local' ? { id: LOCAL_USER_ID, email: null } : session?.user ? { id: session.user.id, email: session.user.email ?? null } : offlineUser
    return {
      mode: env.mode,
      ready,
      user,
      async signIn(email, password) {
        if (!sb) return
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw new Error(friendly(error.message))
      },
      async signUp(email, password) {
        if (!sb) return { needsConfirmation: false }
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
        if (error) throw new Error(friendly(error.message))
        return { needsConfirmation: !data.session }
      },
      async sendReset(email) {
        if (!sb) return
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
        if (error) throw new Error(friendly(error.message))
      },
      async updatePassword(password) {
        if (!sb) return
        const { error } = await sb.auth.updateUser({ password })
        if (error) throw new Error(friendly(error.message))
      },
      async signOut() {
        if (!sb) return
        const id = user?.id
        // Offline, the server can't be told; forget the session on this device only.
        const { error } = await sb.auth.signOut(isOnline() ? undefined : { scope: 'local' })
        if (error) await sb.auth.signOut({ scope: 'local' })
        setOfflineUser(null)
        // Keep this device's copy only if it still has changes to upload.
        if (id) await getOfflineStore()?.forgetDevice(id).catch(() => undefined)
      },
    }
  }, [session, offlineUser, ready])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
