import { getStore } from '@/lib/db'
import type { CalendarEvent, Habit, Reminder, Task, UserSettings } from '@/lib/db'
import { afterFiring, planCustomNext, planEventReminders, planHabitReminders, planTaskReminders, reconcileReminders, type PlannedReminder } from './plan'

export { habitScheduledOn } from './plan'

async function replaceScheduled(source_type: Reminder['source_type'], source_id: string, next: PlannedReminder[]) {
  const store = getStore()
  const existing = await store.list('reminders', {
    filters: [
      { field: 'source_type', op: 'eq', value: source_type },
      { field: 'source_id', op: 'eq', value: source_id },
    ],
  })
  const changes = reconcileReminders(existing, next)
  for (const id of changes.remove) await store.remove('reminders', id)
  for (const n of changes.insert) {
    try {
      await store.insert('reminders', n)
    } catch {
      /* already scheduled by the push server or another tab */
    }
  }
  for (const u of changes.update) await store.update('reminders', u.id, u.patch)
}

/** Keep a task's reminders in step with its schedule. Recurring tasks get their next occurrence only. */
export async function syncTaskReminders(task: Task, tz: string, _settings?: UserSettings) {
  await replaceScheduled('task', task.id, planTaskReminders(task, tz))
}

export async function syncEventReminders(ev: CalendarEvent, tz: string, now?: number) {
  const exceptions = ev.reminder_offsets?.length ? await getStore().list('event_exceptions', { filters: [{ field: 'event_id', op: 'eq', value: ev.id }] }) : []
  await replaceScheduled('event', ev.id, planEventReminders(ev, exceptions, tz, now))
}

export async function syncHabitReminders(h: Habit, tz: string, now?: number) {
  await replaceScheduled('habit', h.id, planHabitReminders(h, tz, now))
}

/** After a reminder for a repeating source fires, schedule the next one. */
export async function rollForward(r: Reminder, tz: string) {
  const store = getStore()
  const now = afterFiring(r)
  if (r.source_type === 'task' && r.source_id) {
    const t = await store.get('tasks', r.source_id)
    if (t?.recurrence) await replaceScheduled('task', t.id, planTaskReminders(t, tz, now))
  } else if (r.source_type === 'event' && r.source_id) {
    const e = await store.get('events', r.source_id)
    if (e?.recurrence) await syncEventReminders(e, tz, now)
  } else if (r.source_type === 'habit' && r.source_id) {
    const h = await store.get('habits', r.source_id)
    if (h) await syncHabitReminders(h, tz, now)
  } else if (r.source_type === 'custom') {
    const next = planCustomNext(r, tz)
    if (next) {
      try {
        await store.insert('reminders', next)
      } catch {
        /* already scheduled by the push server or another tab */
      }
    }
  }
}
