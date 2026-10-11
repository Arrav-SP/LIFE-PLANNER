const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const env = {
  supabaseUrl: url?.trim() || '',
  supabaseKey: key?.trim() || '',
  vapidPublicKey: ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim(),
  /** Local mode stores everything in this browser and needs no account. */
  mode: (url && key ? 'supabase' : 'local') as 'supabase' | 'local',
}
