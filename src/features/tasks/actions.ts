import { useCallback } from 'react'
import { getStore } from '@/lib/db'
import { useInvalidate } from '@/lib/db/hooks'
import type { DateKey, Task, TaskHistoryAction } from '@/lib/db/types'
import { toast } from '@/components/ui/toast'
import { confirm } from '@/components/ui/Dialog'
import { errorMessage } from '@/lib/utils'
import { addDays } from '@/lib/dates'
import type { TaskInstance } from './logic'
import { syncTaskReminders } from '@/features/reminders/sync'
import { useSettings } from '@/settings/SettingsProvider'

async function log(task_id: string, action: TaskHistoryAction, changes: Record<string, unknown> = {}) {
  try {
    await getStore().insert('task_history', { task_id, action, changes })
  } catch {
    /* history is best-effort */
  }
}

function removeTaskReminders(taskId: string) {
  return getStore().removeWhere('reminders', [
    { field: 'source_type', op: 'eq', value: 'task' },
    { field: 'source_id', op: 'eq', value: taskId },
  ])
}

/** Mark one instance done or not done. Recurring tasks only touch that occurrence. */
export async function applyDone(i: TaskInstance, done: boolean, tz: string) {
  const store = getStore()
  const now = new Date().toISOString()
  if (i.occurrenceDate && i.task.recurrence) {
    if (done) {
      await store.upsert(
        'task_occurrences',
        {
          task_id: i.task.id,
          occurrence_date: i.occurrenceDate,
          status: 'done',
          completed_at: now,
          rescheduled_to: i.date !== i.occurrenceDate ? i.date : null,
        },
        ['task_id', 'occurrence_date'],
      )
      await log(i.task.id, 'occurrence_completed', { date: i.occurrenceDate })
    } else {
      const existing = (
        await store.list('task_occurrences', {
          filters: [
            { field: 'task_id', op: 'eq', value: i.task.id },
            { field: 'occurrence_date', op: 'eq', value: i.occurrenceDate },
          ],
        })
      )[0]
      if (existing?.rescheduled_to) await store.update('task_occurrences', existing.id, { status: 'rescheduled', completed_at: null })
      else if (existing) await store.remove('task_occurrences', existing.id)
      await log(i.task.id, 'occurrence_reopened', { date: i.occurrenceDate })
    }
  } else {
    const t = await store.update('tasks', i.task.id, { status: done ? 'done' : 'todo', completed_at: done ? now : null })
    await log(i.task.id, done ? 'completed' : 'reopened')
    // Done drops the task's pending reminders; reopening plans them again.
    await syncTaskReminders(t, tz)
  }
}

/** All task mutations go through here so history, reminders and caches stay consistent. */
export function useTaskActions() {
  const invalidate = useInvalidate()
  const { tz, settings } = useSettings()

  const refresh = useCallback(() => {
    invalidate('tasks')
    invalidate('task_occurrences')
    invalidate('task_history')
    invalidate('reminders')
  }, [invalidate])

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn()
        refresh()
        if (success) toast.success(success)
        return r
      } catch (e) {
        toast.error(errorMessage(e))
        refresh()
        return undefined
      }
    },
    [refresh],
  )

  const create = useCallback(
    (values: Partial<Task>) =>
      run(async () => {
        const t = await getStore().insert('tasks', values as never)
        await log(t.id, 'created')
        await syncTaskReminders(t, tz, settings)
        return t
      }, 'Task added'),
    [run, tz, settings],
  )

  const update = useCallback(
    (task: Task, patch: Partial<Task>, success?: string) =>
      run(async () => {
        const t = await getStore().update('tasks', task.id, patch as never)
        const changed: Record<string, unknown> = {}
        for (const k of Object.keys(patch) as (keyof Task)[]) {
          if (JSON.stringify(task[k]) !== JSON.stringify(t[k])) changed[k] = { from: task[k], to: t[k] }
        }
        if (Object.keys(changed).length) await log(t.id, 'updated', changed)
        await syncTaskReminders(t, tz, settings)
        return t
      }, success),
    [run, tz, settings],
  )

  const setDone = useCallback(
    (i: TaskInstance, done: boolean) =>
      run(async () => {
        await applyDone(i, done, tz)
        if (done) {
          toast.success(`Completed “${i.task.title}”`, {
            label: 'Undo',
            onClick: () => void applyDone(i, false, tz).then(refresh),
          })
        }
      }),
    [run, refresh, tz],
  )

  const skip = useCallback(
    (i: TaskInstance) =>
      run(async () => {
        if (!i.occurrenceDate) return
        await getStore().upsert('task_occurrences', { task_id: i.task.id, occurrence_date: i.occurrenceDate, status: 'skipped' }, ['task_id', 'occurrence_date'])
        await log(i.task.id, 'occurrence_skipped', { date: i.occurrenceDate })
      }, 'Skipped this occurrence'),
    [run],
  )

  const reschedule = useCallback(
    (i: TaskInstance, date: DateKey | null) =>
      run(async () => {
        const store = getStore()
        if (i.occurrenceDate && i.task.recurrence) {
          if (!date) return
          await store.upsert(
            'task_occurrences',
            { task_id: i.task.id, occurrence_date: i.occurrenceDate, status: 'rescheduled', rescheduled_to: date, completed_at: null },
            ['task_id', 'occurrence_date'],
          )
        } else {
          const t = i.task
          const patch: Partial<Task> = { due_date: date }
          if (date && t.start_date && t.start_date > date) patch.start_date = date
          if (t.scheduled_at && date) {
            const old = t.due_date ?? date
            const shift = (Date.parse(date) - Date.parse(old)) || 0
            patch.scheduled_at = new Date(new Date(t.scheduled_at).getTime() + shift).toISOString()
          }
          if (!date) patch.scheduled_at = null
          const updated = await store.update('tasks', t.id, patch as never)
          await syncTaskReminders(updated, tz, settings)
        }
        await log(i.task.id, 'rescheduled', { from: i.date, to: date })
      }, date ? 'Rescheduled' : 'Date removed'),
    [run, tz, settings],
  )

  const postpone = useCallback((i: TaskInstance, days: number, today: DateKey) => reschedule(i, addDays(i.date && i.date > today ? i.date : today, days)), [reschedule])

  const duplicate = useCallback(
    (t: Task) =>
      run(async () => {
        const { id: _id, user_id: _u, created_at: _c, updated_at: _up, ...rest } = t
        void _id
        void _u
        void _c
        void _up
        const copy = await getStore().insert('tasks', { ...rest, title: `${t.title} (copy)`, status: 'todo', completed_at: null, archived_at: null } as never)
        await log(copy.id, 'created', { duplicated_from: t.id })
        return copy
      }, 'Task duplicated'),
    [run],
  )

  const archive = useCallback(
    (t: Task, archived: boolean) =>
      run(async () => {
        const u = await getStore().update('tasks', t.id, { archived_at: archived ? new Date().toISOString() : null })
        await log(t.id, archived ? 'archived' : 'restored')
        await syncTaskReminders(u, tz, settings)
        if (archived) toast.info('Task archived', { label: 'Undo', onClick: () => void getStore().update('tasks', t.id, { archived_at: null }).then(refresh) })
      }),
    [run, refresh, tz, settings],
  )

  const remove = useCallback(
    async (t: Task) => {
      const ok = await confirm({ title: 'Delete this task?', message: `“${t.title}”, its subtasks and history will be permanently deleted. Archive it instead if you might need it later.`, confirmLabel: 'Delete', danger: true })
      if (!ok) return false
      await run(async () => {
        await removeTaskReminders(t.id)
        await getStore().remove('tasks', t.id)
      }, 'Task deleted')
      return true
    },
    [run],
  )

  const bulk = useCallback(
    async (items: TaskInstance[], action: 'done' | 'archive' | 'delete' | 'today' | 'tomorrow', today: DateKey) => {
      if (action === 'delete') {
        const ok = await confirm({ title: `Delete ${items.length} tasks?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })
        if (!ok) return
      }
      await run(async () => {
        const store = getStore()
        for (const i of items) {
          let changed: Task | null = null
          if (action === 'done') {
            if (i.occurrenceDate && i.task.recurrence)
              await store.upsert('task_occurrences', { task_id: i.task.id, occurrence_date: i.occurrenceDate, status: 'done', completed_at: new Date().toISOString() }, ['task_id', 'occurrence_date'])
            else changed = await store.update('tasks', i.task.id, { status: 'done', completed_at: new Date().toISOString() })
          } else if (action === 'archive') changed = await store.update('tasks', i.task.id, { archived_at: new Date().toISOString() })
          else if (action === 'delete') {
            await removeTaskReminders(i.task.id)
            await store.remove('tasks', i.task.id)
          } else {
            const date = action === 'today' ? today : addDays(today, 1)
            if (i.occurrenceDate && i.task.recurrence)
              await store.upsert('task_occurrences', { task_id: i.task.id, occurrence_date: i.occurrenceDate, status: 'rescheduled', rescheduled_to: date }, ['task_id', 'occurrence_date'])
            else changed = await store.update('tasks', i.task.id, { due_date: date })
          }
          if (changed) await syncTaskReminders(changed, tz)
        }
      }, `Updated ${items.length} tasks`)
    },
    [run, tz],
  )

  return { create, update, setDone, skip, reschedule, postpone, duplicate, archive, remove, bulk, refresh }
}
