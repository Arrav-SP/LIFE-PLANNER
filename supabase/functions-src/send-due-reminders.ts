// Supabase Edge Function (Deno): sends Web Push for reminders that are due and
// schedules the next one for anything that repeats. Optional. Runs on the
// Supabase Free plan; schedule it every minute with supabase/optional/push_cron.sql.
// Secrets (never shipped to the browser):
//   CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// This is the source. `npm run functions:build` bundles it with the shared
// scheduling code into supabase/functions/send-due-reminders/index.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1'
import webpush from 'npm:web-push@3.6.7'
import { runReminderJob, type JobDb } from '../../src/server/reminderJob'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 })

  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return new Response('VAPID keys are not configured', { status: 500 })
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:owner@example.com', pub, priv)

  // The service role bypasses row-level security, so every query below names its user.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const must = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message)
    return data
  }

  const db: JobDb = {
    async dueReminders(now) {
      const rows = must(
        await sb
          .from('reminders')
          .select('*')
          .in('status', ['scheduled', 'snoozed'])
          .is('push_sent_at', null)
          .lte('remind_at', now.toISOString())
          .gte('remind_at', new Date(now.getTime() - 7 * 86400000).toISOString())
          .limit(500),
      )
      return rows ?? []
    },
    async userContext(userId) {
      const [settings, subs] = await Promise.all([
        sb.from('user_settings').select('timezone,quiet_hours_start,quiet_hours_end,notifications').eq('user_id', userId).maybeSingle(),
        sb.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', userId),
      ])
      const s = must(settings)
      const prefs = (s?.notifications ?? {}) as { push?: boolean; habit_reminders?: boolean }
      return {
        timezone: s?.timezone || 'UTC',
        quietStart: s?.quiet_hours_start ?? null,
        quietEnd: s?.quiet_hours_end ?? null,
        push: prefs.push !== false,
        habitReminders: prefs.habit_reminders !== false,
        subscriptions: must(subs) ?? [],
      }
    },
    async claim(id, now) {
      const at = now.toISOString()
      const rows = must(await sb.from('reminders').update({ push_sent_at: at, status: 'fired', fired_at: at }).eq('id', id).is('push_sent_at', null).in('status', ['scheduled', 'snoozed']).select('id'))
      return !!rows?.length
    },
    async log(e) {
      await sb.from('notification_log').insert({ ...e, channel: 'push' })
    },
    async deleteSubscription(id) {
      await sb.from('push_subscriptions').delete().eq('id', id)
    },
    async getTask(userId, id) {
      return must(await sb.from('tasks').select('*').eq('user_id', userId).eq('id', id).maybeSingle())
    },
    async getEvent(userId, id) {
      return must(await sb.from('events').select('*').eq('user_id', userId).eq('id', id).maybeSingle())
    },
    async getHabit(userId, id) {
      return must(await sb.from('habits').select('*').eq('user_id', userId).eq('id', id).maybeSingle())
    },
    async eventExceptions(userId, eventId) {
      return must(await sb.from('event_exceptions').select('*').eq('user_id', userId).eq('event_id', eventId)) ?? []
    },
    async remindersFor(userId, sourceType, sourceId) {
      return must(await sb.from('reminders').select('*').eq('user_id', userId).eq('source_type', sourceType).eq('source_id', sourceId)) ?? []
    },
    async insertReminders(userId, rows) {
      must(await sb.from('reminders').upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }))
    },
    async updateReminder(userId, id, patch) {
      must(await sb.from('reminders').update(patch).eq('user_id', userId).eq('id', id))
    },
    async removeReminders(userId, ids) {
      must(await sb.from('reminders').delete().eq('user_id', userId).in('id', ids))
    },
  }

  // High urgency: Android otherwise holds pushes back while the phone is idle.
  const result = await runReminderJob(db, async (sub, payload) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: 'high' })
      return 'ok'
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string }
      if (err.statusCode === 404 || err.statusCode === 410) return 'gone'
      // 401/403 almost always means the app's public key and the function's VAPID keys are not a pair.
      const hint = err.statusCode === 401 || err.statusCode === 403 ? ' (VAPID keys do not match the app key)' : ''
      return { failed: `Push service said ${err.statusCode ?? 'error'}${hint}: ${String(err.body || err.message || '').slice(0, 160)}` }
    }
  })
  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
})
