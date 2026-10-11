import { getStore } from '@/lib/db'
import type { CalendarEvent, DateKey, Habit, Insert, Reminder, Task, UserSettings } from '@/lib/db'
import { addDays, todayKey, weekdayOf, zonedToInstant } from '@/lib/dates'
import { nextOccurrence, timedOccurrences } from '@/lib/recurrence'
import { seriesStart } from '@/features/tasks/logic'

const DEFAULT_TASK_TIME = '09:00'

async function replaceScheduled(source_type: Reminder['source_type'], source_id: string, next: Insert<'reminders'>[]) {
  const store = getStore()
  const existing = await store.list('reminders', {
    filters: [
      { field: 'source_type', op: 'eq', value: source_type },
      { field: 'source_id', op: 'eq', value: source_id },
    ],
  })
  const keep = new Set(next.map((n) => n.dedupe_key))
  for (const r of existing) {
    // Never resurrect a reminder the user already saw or dismissed.
    if ((r.status === 'scheduled' || r.status === 'snoozed') && !keep.has(r.dedupe_key)) await store.remove('reminders', r.id)
  }
  for (const n of next) {
    const prior = existing.find((r) => r.dedupe_key === n.dedupe_key)
    if (!prior) await store.insert('reminders', n)
    else if ((prior.status === 'scheduled' || prior.status === 'snoozed') && prior.remind_at !== n.remind_at)
      await store.update('reminders', prior.id, { remind_at: n.remind_at, title: n.title, body: n.body ?? '', status: 'scheduled', snoozed_until: null })
  }
}

/** Keep a task's reminders in step with its schedule. Recurring tasks get their next occurrence only. */
export async function syncTaskReminders(task: Task, tz: string, _settings?: UserSettings) {
  const offsets = task.reminder_offsets ?? []
  const active = !task.archived_at && task.status !== 'done' && task.status !== 'cancelled'
  const next: Insert<'reminders'>[] = []
  if (active && offsets.length) {
    const now = Date.now()
    let at: Date | null = null
    let occKey = ''
    if (task.recurrence) {
      const start = seriesStart(task, tz)
      const today = todayKey(tz)
      const time = task.scheduled_at ? new Date(task.scheduled_at) : null
      const wall = time ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(time) : DEFAULT_TASK_TIME
      let d: DateKey | null = nextOccurrence(task.recurrence, start, today)
      // Skip today's occurrence if all its reminder times have passed.
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
    if (at) {
      for (const off of offsets) {
        const when = new Date(at.getTime() - off * 60000)
        if (when.getTime() < now - 60000) continue
        next.push({
          source_type: 'task',
          source_id: task.id,
          occurrence_key: occKey,
          title: task.title,
          body: off ? `Starts in ${off >= 60 ? `${off / 60} h` : `${off} min`}` : 'Due now',
          url: `/tasks?task=${task.id}`,
          remind_at: when.toISOString(),
          offset_minutes: off,
          dedupe_key: `task:${task.id}:${occKey}:${off}`,
        })
      }
    }
  }
  await replaceScheduled('task', task.id, next)
}

export async function syncEventReminders(ev: CalendarEvent, tz: string) {
  const offsets = ev.reminder_offsets ?? []
  const next: Insert<'reminders'>[] = []
  if (!ev.archived_at && offsets.length) {
    const now = new Date()
    const horizon = new Date(now.getTime() + 400 * 86400000)
    const maxOff = Math.max(...offsets)
    const occs = timedOccurrences(ev.recurrence, ev.start_at, ev.end_at, ev.timezone || tz, new Date(now.getTime()), horizon)
    const exceptions = await getStore().list('event_exceptions', { filters: [{ field: 'event_id', op: 'eq', value: ev.id }] })
    const upcoming = occs.find((o) => {
      const ex = exceptions.find((x) => new Date(x.occurrence_start).getTime() === o.start.getTime())
      if (ex?.cancelled) return false
      const start = ex?.override.start_at ? new Date(ex.override.start_at) : o.start
      return start.getTime() - maxOff * 60000 > now.getTime() - 60000 || start.getTime() > now.getTime()
    })
    if (upcoming) {
      const ex = exceptions.find((x) => new Date(x.occurrence_start).getTime() === upcoming.start.getTime())
      const start = ex?.override.start_at ? new Date(ex.override.start_at) : upcoming.start
      const occKey = ev.recurrence ? upcoming.start.toISOString() : ''
      for (const off of offsets) {
        const when = new Date(start.getTime() - off * 60000)
        if (when.getTime() < now.getTime() - 60000) continue
        next.push({
          source_type: 'event',
          source_id: ev.id,
          occurrence_key: occKey,
          title: ex?.override.title ?? ev.title,
          body: off ? `Starts in ${off >= 60 ? `${off / 60} h` : `${off} min`}${ev.location ? ` · ${ev.location}` : ''}` : 'Starting now',
          url: `/calendar?event=${ev.id}`,
          remind_at: when.toISOString(),
          offset_minutes: off,
          dedupe_key: `event:${ev.id}:${occKey}:${off}`,
        })
      }
    }
  }
  await replaceScheduled('event', ev.id, next)
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

export async function syncHabitReminders(h: Habit, tz: string) {
  const next: Insert<'reminders'>[] = []
  if (!h.archived_at && h.reminder_time) {
    const now = Date.now()
    let d = todayKey(tz)
    for (let i = 0; i < 400; i++, d = addDays(d, 1)) {
      if (!habitScheduledOn(h, d)) continue
      const at = zonedToInstant(d, h.reminder_time.slice(0, 5), tz)
      if (at.getTime() < now - 60000) continue
      next.push({
        source_type: 'habit',
        source_id: h.id,
        occurrence_key: d,
        title: h.name,
        body: 'Time for your habit',
        url: '/habits',
        remind_at: at.toISOString(),
        offset_minutes: 0,
        dedupe_key: `habit:${h.id}:${d}`,
      })
      break
    }
  }
  await replaceScheduled('habit', h.id, next)
}
