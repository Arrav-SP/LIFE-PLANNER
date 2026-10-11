import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (env.mode !== 'supabase') return null
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  }
  return client
}
