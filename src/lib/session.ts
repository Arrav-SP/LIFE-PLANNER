import { env } from './env'

/** Where supabase-js keeps the session in localStorage. */
export function authStorageKey(): string | null {
  if (!env.supabaseUrl) return null
  try {
    return `sb-${new URL(env.supabaseUrl).hostname.split('.')[0]}-auth-token`
  } catch {
    return null
  }
}

/**
 * The user of the session saved on this device, without contacting the
 * server. Offline, supabase-js reports no session once the access token
 * expires (it can't refresh it), but the saved session is still there and is
 * refreshed as soon as the device is back online.
 */
export function storedUser(): { id: string; email: string | null } | null {
  const key = authStorageKey()
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    const user = raw ? (JSON.parse(raw) as { user?: { id?: string; email?: string } }).user : undefined
    return user?.id ? { id: user.id, email: user.email ?? null } : null
  } catch {
    return null
  }
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
