// The push server's work, kept free of Deno and Supabase specifics so it can
// be unit-tested. supabase/functions-src/send-due-reminders.ts wires it to the
// database and web-push, and `npm run functions:build` bundles both into the
// single file Supabase runs.
import type { CalendarEvent, EventException, Habit, Reminder, Task } from '@/lib/db/types'
import { afterFiring, planCustomNext, planEventReminders, planHabitReminders, planTaskReminders, reconcileReminders, type PlannedReminder } from '@/features/reminders/plan'

/** Reminders more than this late are left for the app to mark as missed. */
export const STALE_MS = 6 * 3600 * 1000

export interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface UserContext {
  timezone: string
  quietStart: string | null
  quietEnd: string | null
  /** False when the user switched push off in Settings. */
  push: boolean
  habitReminders: boolean
  subscriptions: PushSubscriptionRow[]
}

export interface LogEntry {
  user_id: string
  reminder_id: string
  title: string
  body: string
  url: string
  status: 'delivered' | 'suppressed' | 'failed'
  detail: string
}

/** Everything the job needs from the database. Every call is scoped to one user by the caller's arguments. */
export interface JobDb {
  /** Pending reminders (scheduled or snoozed, not yet pushed) due at or before `now`, for all users. */
  dueReminders(now: Date): Promise<Reminder[]>
  userContext(userId: string): Promise<UserContext>
  /** Mark a reminder as pushed and fired. False when another run already claimed it. */
  claim(reminderId: string, now: Date): Promise<boolean>
  log(entry: LogEntry): Promise<void>
  deleteSubscription(id: string): Promise<void>
  getTask(userId: string, id: string): Promise<Task | null>
  getEvent(userId: string, id: string): Promise<CalendarEvent | null>
  getHabit(userId: string, id: string): Promise<Habit | null>
  eventExceptions(userId: string, eventId: string): Promise<EventException[]>
  remindersFor(userId: string, sourceType: Reminder['source_type'], sourceId: string): Promise<Reminder[]>
  /** Insert, skipping any row whose (user_id, dedupe_key) already exists. */
  insertReminders(userId: string, rows: PlannedReminder[]): Promise<void>
  updateReminder(userId: string, id: string, patch: Partial<Reminder>): Promise<void>
  removeReminders(userId: string, ids: string[]): Promise<void>
}

export type PushResult = 'ok' | 'gone' | 'failed'
export type SendPush = (sub: PushSubscriptionRow, payload: string) => Promise<PushResult>

function minutesIn(tz: string, d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

export function inQuiet(start: string | null, end: string | null, minutes: number): boolean {
  if (!start || !end) return false
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const s = toMin(start)
  const e = toMin(end)
  if (s === e) return false
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e
}

function dueAt(r: Reminder) {
  return Date.parse(r.status === 'snoozed' && r.snoozed_until ? r.snoozed_until : r.remind_at)
}

/** Schedule what comes after `r` for repeating tasks, events, habits and custom reminders. */
export async function scheduleNext(db: JobDb, r: Reminder, tz: string, now: Date): Promise<number> {
  const at = afterFiring(r, now.getTime())
  let source: { type: Reminder['source_type']; id: string; next: PlannedReminder[] } | null = null
  if (r.source_type === 'task' && r.source_id) {
    const t = await db.getTask(r.user_id, r.source_id)
    if (t?.recurrence) source = { type: 'task', id: t.id, next: planTaskReminders(t, tz, at) }
  } else if (r.source_type === 'event' && r.source_id) {
    const e = await db.getEvent(r.user_id, r.source_id)
    if (e?.recurrence) source = { type: 'event', id: e.id, next: planEventReminders(e, await db.eventExceptions(r.user_id, e.id), tz, at) }
  } else if (r.source_type === 'habit' && r.source_id) {
    const h = await db.getHabit(r.user_id, r.source_id)
    if (h) source = { type: 'habit', id: h.id, next: planHabitReminders(h, tz, at) }
  } else if (r.source_type === 'custom') {
    const next = planCustomNext(r, tz)
    if (next) await db.insertReminders(r.user_id, [next])
    return next ? 1 : 0
  }
  if (!source) return 0
  const changes = reconcileReminders(await db.remindersFor(r.user_id, source.type, source.id), source.next)
  if (changes.remove.length) await db.removeReminders(r.user_id, changes.remove)
  if (changes.insert.length) await db.insertReminders(r.user_id, changes.insert)
  for (const u of changes.update) await db.updateReminder(r.user_id, u.id, u.patch)
  return changes.insert.length
}

export interface JobResult {
  due: number
  sent: number
  scheduled: number
}

/** Push every due reminder once, then schedule each repeating reminder's next occurrence. */
export async function runReminderJob(db: JobDb, send: SendPush, now: Date = new Date()): Promise<JobResult> {
  const due = (await db.dueReminders(now)).filter((r) => dueAt(r) <= now.getTime() && now.getTime() - dueAt(r) < STALE_MS)
  const result: JobResult = { due: due.length, sent: 0, scheduled: 0 }

  for (const userId of [...new Set(due.map((r) => r.user_id))]) {
    const ctx = await db.userContext(userId)
    // Without a push subscription nothing can reach this user; the app handles it when opened.
    if (!ctx.subscriptions.length || !ctx.push) continue
    const quiet = inQuiet(ctx.quietStart, ctx.quietEnd, minutesIn(ctx.timezone, now))
    let subs = ctx.subscriptions

    for (const r of due.filter((x) => x.user_id === userId)) {
      // Claim first so overlapping runs never double-send.
      if (!(await db.claim(r.id, now))) continue
      const base = { user_id: userId, reminder_id: r.id, title: r.title, body: r.body, url: r.url }
      if (quiet || (r.source_type === 'habit' && !ctx.habitReminders)) {
        await db.log({ ...base, status: 'suppressed', detail: quiet ? 'Quiet hours' : 'Habit reminders are turned off' })
      } else {
        const payload = JSON.stringify({ title: r.title, body: r.body, url: r.url || '/', tag: r.dedupe_key })
        let delivered = false
        for (const s of subs) {
          const res = await send(s, payload)
          if (res === 'ok') delivered = true
          if (res === 'gone') {
            // The browser dropped this subscription; forget it.
            await db.deleteSubscription(s.id)
            subs = subs.filter((x) => x.id !== s.id)
          }
        }
        if (delivered) result.sent++
        await db.log({ ...base, status: delivered ? 'delivered' : 'failed', detail: delivered ? '' : 'No subscription accepted the message' })
      }
      try {
        result.scheduled += await scheduleNext(db, r, ctx.timezone, now)
      } catch {
        /* the app reschedules it the next time it opens */
      }
    }
  }
  return result
}
