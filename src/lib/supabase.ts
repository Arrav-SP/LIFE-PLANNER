import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (env.mode !== 'supabase') return null
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      // A weak connection can hang a request indefinitely; give up so the offline copy is used instead.
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }) },
    })
  }
  return client
}
