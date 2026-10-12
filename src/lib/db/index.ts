import { env } from '../env'
import { getSupabase } from '../supabase'
import { isOnline, storedUser } from '../session'
import { LocalStore } from './localStore'
import { OfflineStore } from './offlineStore'
import { IdbOutbox } from './outbox'
import type { DataStore } from './store'
import { SupabaseStore } from './supabaseStore'

let store: DataStore | null = null

function offlineStore(remote: SupabaseStore): OfflineStore {
  const sb = getSupabase()!
  let userId = storedUser()?.id ?? null
  sb.auth.onAuthStateChange((event, session) => {
    if (session) userId = session.user.id
    else if (event === 'SIGNED_OUT') userId = null
  })
  const mirrors = new Map<string, LocalStore>()
  const outbox = new IdbOutbox()
  return new OfflineStore(remote, {
    userId: async () => userId,
    online: isOnline,
    outbox,
    mirror(id) {
      let m = mirrors.get(id)
      if (!m) mirrors.set(id, (m = new LocalStore(id, 'life-planner-cache')))
      return m
    },
    async refreshAuth() {
      const { data, error } = await sb.auth.refreshSession()
      return !!data.session && !error
    },
  })
}

export function getStore(): DataStore {
  if (!store) {
    const sb = getSupabase()
    store = env.mode === 'supabase' && sb ? offlineStore(new SupabaseStore(sb)) : new LocalStore()
  }
  return store
}

/** The offline layer, when the app syncs with Supabase. */
export function getOfflineStore(): OfflineStore | null {
  const s = getStore()
  return s instanceof OfflineStore ? s : null
}

/** Tests swap in an isolated store. */
export function setStore(s: DataStore | null) {
  store = s
}

export * from './store'
export * from './types'
