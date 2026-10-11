import { env } from '../env'
import { getSupabase } from '../supabase'
import { LocalStore } from './localStore'
import type { DataStore } from './store'
import { SupabaseStore } from './supabaseStore'

let store: DataStore | null = null

export function getStore(): DataStore {
  if (!store) {
    const sb = getSupabase()
    store = env.mode === 'supabase' && sb ? new SupabaseStore(sb) : new LocalStore()
  }
  return store
}

/** Tests swap in an isolated store. */
export function setStore(s: DataStore | null) {
  store = s
}

export * from './store'
export * from './types'
