// Supabase Edge Function (Deno): sends Web Push for reminders that are due.
// Optional. Runs on the Supabase Free plan; schedule it every minute with
// supabase/optional/push_cron.sql. Secrets (never shipped to the browser):
//   CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1'
import webpush from 'npm:web-push@3.6.7'

const STALE_MS = 6 * 3600 * 1000

function minutesIn(tz: string, d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

function inQuiet(start: string | null, end: string | null, minutes: number): boolean {
  if (!start || !end) return false
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const s = toMin(start)
  const e = toMin(end)
  return s <= e ? minutes >= s && minutes < e : minutes >= s || minutes < e
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 })

  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return new Response('VAPID keys are not configured', { status: 500 })
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:owner@example.com', pub, priv)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const now = new Date()
  const { data: reminders, error } = await db
    .from('reminders')
    .select('id,user_id,title,body,url,remind_at,snoozed_until,status,source_type,dedupe_key')
    .in('status', ['scheduled', 'snoozed'])
    .is('push_sent_at', null)
    .lte('remind_at', now.toISOString())
    .gte('remind_at', new Date(now.getTime() - 7 * 86400000).toISOString())
    .limit(500)
  if (error) return new Response(error.message, { status: 500 })

  const due = (reminders ?? []).filter((r) => {
    const at = Date.parse(r.status === 'snoozed' && r.snoozed_until ? r.snoozed_until : r.remind_at)
    return at <= now.getTime() && now.getTime() - at < STALE_MS
  })
  const users = [...new Set(due.map((r) => r.user_id))]
  let sent = 0

  for (const userId of users) {
    const [{ data: settings }, { data: subs }] = await Promise.all([
      db.from('user_settings').select('timezone,quiet_hours_start,quiet_hours_end,notifications').eq('user_id', userId).maybeSingle(),
      db.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', userId),
    ])
    if (!subs?.length) continue
    const prefs = (settings?.notifications ?? {}) as { push?: boolean; habit_reminders?: boolean }
    if (prefs.push === false) continue
    const quiet = inQuiet(settings?.quiet_hours_start ?? null, settings?.quiet_hours_end ?? null, minutesIn(settings?.timezone ?? 'UTC', now))

    for (const r of due.filter((x) => x.user_id === userId)) {
      // Mark first so overlapping runs never double-send.
      const { data: claimed } = await db.from('reminders').update({ push_sent_at: now.toISOString() }).eq('id', r.id).is('push_sent_at', null).select('id')
      if (!claimed?.length) continue
      if (quiet || (r.source_type === 'habit' && prefs.habit_reminders === false)) {
        await db.from('notification_log').insert({ user_id: userId, reminder_id: r.id, channel: 'push', title: r.title, body: r.body, url: r.url, status: 'suppressed', detail: quiet ? 'Quiet hours' : 'Habit reminders are turned off' })
        continue
      }
      const payload = JSON.stringify({ title: r.title, body: r.body, url: r.url || '/', tag: r.dedupe_key })
      let delivered = false
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
          delivered = true
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode
          // The browser dropped this subscription; forget it.
          if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id)
        }
      }
      if (delivered) sent++
      await db.from('notification_log').insert({ user_id: userId, reminder_id: r.id, channel: 'push', title: r.title, body: r.body, url: r.url, status: delivered ? 'delivered' : 'failed', detail: delivered ? '' : 'No subscription accepted the message' })
    }
  }

  return new Response(JSON.stringify({ due: due.length, sent }), { headers: { 'content-type': 'application/json' } })
})
