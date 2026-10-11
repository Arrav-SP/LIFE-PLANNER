import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import { getSupabase } from '@/lib/supabase'
import { LOCAL_USER_ID } from '@/lib/db/localStore'

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
  const [ready, setReady] = useState(env.mode === 'local')

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) return
    let alive = true
    sb.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setReady(true)
    })
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(() => {
    const sb = getSupabase()
    const user: AuthUser | null =
      env.mode === 'local' ? { id: LOCAL_USER_ID, email: null } : session?.user ? { id: session.user.id, email: session.user.email ?? null } : null
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
        await sb.auth.signOut()
      },
    }
  }, [session, ready])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
