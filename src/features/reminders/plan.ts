// Pure reminder scheduling. Shared by the app (sync.ts) and the push server
// (src/server/reminderJob.ts), so both always agree on what comes next.
// Keep this file free of browser APIs and app-only imports.
import type { CalendarEvent, DateKey, EventException, Habit, Reminder, Task } from '@/lib/db/types'
import type { Insert } from '@/lib/db/store'
import { addDays, dateKey, timeOf, todayKey, weekdayOf, zonedToInstant } from '@/lib/dates'
import { nextOccurrence, timedOccurrences } from '@/lib/recurrence'
import { seriesStart } from '@/features/tasks/logic'

export type PlannedReminder = Insert<'reminders'> & { dedupe_key: string; remind_at: string }

const DEFAULT_TASK_TIME = '09:00'

function startsIn(off: number) {
  return `Starts in ${off >= 60 ? `${off / 60} h` : `${off} min`}`
}

/** A task's reminders. Recurring tasks get their next occurrence only. */
export function planTaskReminders(task: Task, tz: string, now: number = Date.now()): PlannedReminder[] {
  const offsets = task.reminder_offsets ?? []
  const active = !task.archived_at && task.status !== 'done' && task.status !== 'cancelled'
  if (!active || !offsets.length) return []
  let at: Date | null = null
  let occKey = ''
  if (task.recurrence) {
    const start = seriesStart(task, tz)
    const today = todayKey(tz, new Date(now))
    const time = task.scheduled_at ? new Date(task.scheduled_at) : null
    const wall = time ? timeOf(time, tz) : DEFAULT_TASK_TIME
    let d: DateKey | null = nextOccurrence(task.recurrence, start, today)
    // Skip an occurrence once all of its reminder times have passed.
    while (d && zonedToInstant(d, wall, tz).getTime() - Math.min(...offsets) * 60000 < now) {
      d = nextOccurrence(task.recurrence, start, addDays(d, 1))
    }
    if (d) {
      at = zonedToInstant(d, wall, tz)
      occKey = d
    }
  } else if (task.scheduled_at) at = new Date(task.scheduled_at)
  else if (task.deadline) at = new Date(task.deadline)
  else if (task.due_date) at = zonedToInstant(task.due_date, DEFAULT_TASK_TIME, tz)
  if (!at) return []
  const out: PlannedReminder[] = []
  for (const off of offsets) {
    const when = new Date(at.getTime() - off * 60000)
    if (when.getTime() < now - 60000) continue
    out.push({
      source_type: 'task',
      source_id: task.id,
      occurrence_key: occKey,
      title: task.title,
      body: off ? startsIn(off) : 'Due now',
      url: `/tasks?task=${task.id}`,
      remind_at: when.toISOString(),
      offset_minutes: off,
      dedupe_key: `task:${task.id}:${occKey}:${off}`,
    })
  }
  return out
}

/** An event's reminders for its next upcoming occurrence (honouring moved or cancelled occurrences). */
export function planEventReminders(ev: CalendarEvent, exceptions: EventException[], tz: string, now: number = Date.now()): PlannedReminder[] {
  const offsets = ev.reminder_offsets ?? []
  if (ev.archived_at || !offsets.length) return []
  const horizon = new Date(now + 400 * 86400000)
  const minOff = Math.min(...offsets)
  const occs = timedOccurrences(ev.recurrence, ev.start_at, ev.end_at, ev.timezone || tz, new Date(now), horizon)
  const exFor = (start: Date) => exceptions.find((x) => new Date(x.occurrence_start).getTime() === start.getTime())
  const upcoming = occs.find((o) => {
    const ex = exFor(o.start)
    if (ex?.cancelled) return false
    const start = ex?.override.start_at ? new Date(ex.override.start_at) : o.start
    // The first occurrence that still has a reminder ahead of it.
    return start.getTime() - minOff * 60000 >= now - 60000
  })
  if (!upcoming) return []
  const ex = exFor(upcoming.start)
  const start = ex?.override.start_at ? new Date(ex.override.start_at) : upcoming.start
  const occKey = ev.recurrence ? upcoming.start.toISOString() : ''
  const out: PlannedReminder[] = []
  for (const off of offsets) {
    const when = new Date(start.getTime() - off * 60000)
    if (when.getTime() < now - 60000) continue
    out.push({
      source_type: 'event',
      source_id: ev.id,
      occurrence_key: occKey,
      title: ex?.override.title ?? ev.title,
      body: off ? `${startsIn(off)}${ev.location ? ` · ${ev.location}` : ''}` : 'Starting now',
      url: `/calendar?event=${ev.id}`,
      remind_at: when.toISOString(),
      offset_minutes: off,
      dedupe_key: `event:${ev.id}:${occKey}:${off}`,
    })
  }
  return out
}

export function habitScheduledOn(h: Habit, day: DateKey): boolean {
  if (day < h.start_date) return false
  const s = h.schedule
  if (s.type === 'daily' || s.type === 'weekly') return true
  if (s.type === 'days') return s.days.includes(weekdayOf(day))
  if (s.type === 'interval') {
    const diff = Math.round((Date.parse(day) - Date.parse(h.start_date)) / 86400000)
    return diff % Math.max(1, s.everyDays) === 0
  }
  return true
}

/** A habit's next reminder on a day it is scheduled. */
export function planHabitReminders(h: Habit, tz: string, now: number = Date.now()): PlannedReminder[] {
  if (h.archived_at || !h.reminder_time) return []
  let d = todayKey(tz, new Date(now))
  for (let i = 0; i < 400; i++, d = addDays(d, 1)) {
    if (!habitScheduledOn(h, d)) continue
    const at = zonedToInstant(d, h.reminder_time.slice(0, 5), tz)
    if (at.getTime() < now - 60000) continue
    return [
      {
        source_type: 'habit',
        source_id: h.id,
        occurrence_key: d,
        title: h.name,
        body: 'Time for your habit',
        url: '/habits',
        remind_at: at.toISOString(),
        offset_minutes: 0,
        dedupe_key: `habit:${h.id}:${d}`,
      },
    ]
  }
  return []
}

/** The next occurrence of a repeating stand-alone reminder, at the same wall-clock time in `tz`. */
export function planCustomNext(r: Reminder, tz: string): PlannedReminder | null {
  if (r.source_type !== 'custom' || !r.recurrence) return null
  const fired = new Date(r.remind_at)
  const startKey = r.occurrence_key || dateKey(fired, tz)
  const next = nextOccurrence(r.recurrence, startKey, addDays(dateKey(fired, tz), 1))
  if (!next) return null
  return {
    source_type: 'custom',
    source_id: null,
    occurrence_key: startKey,
    title: r.title,
    body: r.body,
    url: r.url,
    remind_at: zonedToInstant(next, timeOf(fired, tz), tz).toISOString(),
    recurrence: r.recurrence,
    dedupe_key: `custom:${r.dedupe_key.split(':')[1] ?? r.id}:${next}`,
  }
}

/**
 * The clock to plan the next reminder with, right after `r` went off. Planning
 * from "now" alone would hand back the reminder that just fired when it ran
 * within its one-minute grace period.
 */
export function afterFiring(r: Pick<Reminder, 'remind_at'>, now: number = Date.now()): number {
  return Math.max(now, Date.parse(r.remind_at) + 61_000)
}

export interface ReminderChanges {
  remove: string[]
  insert: PlannedReminder[]
  update: { id: string; patch: Pick<Reminder, 'remind_at' | 'title' | 'body' | 'status' | 'snoozed_until'> }[]
}

/**
 * What to change so a source's pending reminders match `next`. Reminders the
 * user already saw, dismissed, or that were already pushed are never touched.
 */
export function reconcileReminders(existing: Reminder[], next: PlannedReminder[]): ReminderChanges {
  const pending = (r: Reminder) => (r.status === 'scheduled' || r.status === 'snoozed') && !r.push_sent_at
  const keep = new Set(next.map((n) => n.dedupe_key))
  const changes: ReminderChanges = { remove: [], insert: [], update: [] }
  for (const r of existing) if (pending(r) && !keep.has(r.dedupe_key)) changes.remove.push(r.id)
  for (const n of next) {
    const prior = existing.find((r) => r.dedupe_key === n.dedupe_key)
    if (!prior) changes.insert.push(n)
    else if (pending(prior) && Date.parse(prior.remind_at) !== Date.parse(n.remind_at))
      changes.update.push({ id: prior.id, patch: { remind_at: n.remind_at, title: n.title ?? prior.title, body: n.body ?? '', status: 'scheduled', snoozed_until: null } })
  }
  return changes
}
