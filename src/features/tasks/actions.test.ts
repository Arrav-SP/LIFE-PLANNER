import { afterEach, beforeEach, expect, it } from 'vitest'
import { getStore, setStore } from '@/lib/db'
import { LocalStore } from '@/lib/db/localStore'
import { syncTaskReminders } from '@/features/reminders/sync'
import { applyDone } from './actions'
import type { TaskInstance } from './logic'

const TZ = 'Asia/Kolkata'
let n = 0

beforeEach(() => setStore(new LocalStore('11111111-1111-4111-8111-111111111111', `actions-${++n}`)))
afterEach(() => setStore(null))

it('completing a task cancels its pending reminder, and reopening brings it back', async () => {
  const store = getStore()
  const task = await store.insert('tasks', { title: 'Submit form', due_date: '2099-01-01', reminder_offsets: [0] })
  await syncTaskReminders(task, TZ)
  expect(await store.list('reminders')).toHaveLength(1)

  const i = { key: task.id, task, date: task.due_date, occurrenceDate: null, done: false, skipped: false, scheduledAt: null, completedAt: null } as TaskInstance
  await applyDone(i, true, TZ)
  expect(await store.list('reminders')).toHaveLength(0)
  await applyDone(i, false, TZ)
  expect(await store.list('reminders')).toHaveLength(1)
})
