import { describe, expect, it } from 'vitest'
import type { Habit, Reminder } from '@/lib/db/types'
import { runReminderJob, type JobDb, type LogEntry, type PushResult, type UserContext } from './reminderJob'

const TZ = 'Asia/Kolkata'
const stamp = { created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }

const gym: Habit = {
  ...stamp,
  id: 'h1',
  user_id: 'u1',
  name: 'Gym',
  description: '',
  color: '#000',
  icon: '',
  kind: 'check',
  schedule: { type: 'daily' },
  target_value: null,
  unit: '',
  start_date: '2026-10-01',
  reminder_time: '07:00:00',
  show_on_dashboard: true,
  show_in_planner: true,
  goal_id: null,
  sort_order: 0,
  archived_at: null,
}

const due = (over: Partial<Reminder> = {}): Reminder => ({
  ...stamp,
  id: 'r1',
  user_id: 'u1',
  source_type: 'habit',
  source_id: 'h1',
  occurrence_key: '2026-10-12',
  title: 'Gym',
  body: 'Time for your habit',
  url: '/habits',
  remind_at: '2026-10-12T01:30:00Z', // 07:00 IST
  offset_minutes: 0,
  recurrence: null,
  status: 'scheduled',
  snoozed_until: null,
  fired_at: null,
  push_sent_at: null,
  dedupe_key: 'habit:h1:2026-10-12',
  ...over,
})

function fakeDb(reminders: Reminder[], ctx: Partial<UserContext> = {}) {
  const logs: LogEntry[] = []
  const deletedSubs: string[] = []
  let n = 0
  const context: UserContext = {
    timezone: TZ,
    quietStart: null,
    quietEnd: null,
    push: true,
    habitReminders: true,
    subscriptions: [{ id: 's1', endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a' }],
    ...ctx,
  }
  const db: JobDb = {
    async dueReminders(now) {
      return reminders.filter((r) => ['scheduled', 'snoozed'].includes(r.status) && !r.push_sent_at && Date.parse(r.remind_at) <= now.getTime())
    },
    async userContext() {
      return context
    },
    async claim(id, now) {
      const r = reminders.find((x) => x.id === id)
      if (!r || r.push_sent_at) return false
      Object.assign(r, { push_sent_at: now.toISOString(), status: 'fired', fired_at: now.toISOString() })
      return true
    },
    async log(e) {
      logs.push(e)
    },
    async deleteSubscription(id) {
      deletedSubs.push(id)
    },
    async getTask() {
      return null
    },
    async getEvent() {
      return null
    },
    async getHabit(userId, id) {
      return userId === gym.user_id && id === gym.id ? gym : null
    },
    async eventExceptions() {
      return []
    },
    async remindersFor(userId, type, id) {
      return reminders.filter((r) => r.user_id === userId && r.source_type === type && r.source_id === id)
    },
    async insertReminders(userId, rows) {
      for (const row of rows) {
        if (reminders.some((r) => r.user_id === userId && r.dedupe_key === row.dedupe_key)) continue
        reminders.push(due({ ...row, id: `new${++n}`, user_id: userId, status: 'scheduled' } as Partial<Reminder>))
      }
    },
    async updateReminder(_userId, id, patch) {
      Object.assign(reminders.find((r) => r.id === id)!, patch)
    },
    async removeReminders(_userId, ids) {
      for (const id of ids) reminders.splice(reminders.findIndex((r) => r.id === id), 1)
    },
  }
  return { db, reminders, logs, deletedSubs }
}

const sendOk = async (): Promise<PushResult> => 'ok'
const at = (iso: string) => new Date(iso)

describe('runReminderJob', () => {
  it('pushes a due habit reminder once and schedules tomorrow’s', async () => {
    const { db, reminders, logs } = fakeDb([due()])
    const sent: string[] = []
    const send = async (_s: unknown, payload: string): Promise<PushResult> => {
      sent.push(JSON.parse(payload).title)
      return 'ok'
    }
    const first = await runReminderJob(db, send, at('2026-10-12T01:30:20Z'))
    expect(first).toEqual({ due: 1, sent: 1, scheduled: 1 })
    expect(sent).toEqual(['Gym'])
    expect(logs.map((l) => l.status)).toEqual(['delivered'])
    expect(reminders.find((r) => r.id === 'r1')?.status).toBe('fired')
    const next = reminders.find((r) => r.dedupe_key === 'habit:h1:2026-10-13')
    expect(next?.remind_at).toBe('2026-10-13T01:30:00.000Z')

    // A minute later nothing is sent again, and the day after it fires and rolls on.
    expect(await runReminderJob(db, send, at('2026-10-12T01:31:20Z'))).toEqual({ due: 0, sent: 0, scheduled: 0 })
    expect(await runReminderJob(db, send, at('2026-10-13T01:30:05Z'))).toEqual({ due: 1, sent: 1, scheduled: 1 })
    expect(reminders.some((r) => r.dedupe_key === 'habit:h1:2026-10-14')).toBe(true)
    expect(sent).toEqual(['Gym', 'Gym'])
  })

  it('stays silent in quiet hours but still schedules the next one', async () => {
    const { db, reminders, logs } = fakeDb([due()], { quietStart: '06:00:00', quietEnd: '08:00:00' })
    const res = await runReminderJob(db, async () => 'ok', at('2026-10-12T01:30:20Z'))
    expect(res).toEqual({ due: 1, sent: 0, scheduled: 1 })
    expect(logs[0]).toMatchObject({ status: 'suppressed', detail: 'Quiet hours' })
    expect(reminders.some((r) => r.dedupe_key === 'habit:h1:2026-10-13')).toBe(true)
  })

  it('leaves users without a push subscription to the app', async () => {
    const { db, reminders } = fakeDb([due()], { subscriptions: [] })
    expect(await runReminderJob(db, sendOk, at('2026-10-12T01:30:20Z'))).toEqual({ due: 1, sent: 0, scheduled: 0 })
    expect(reminders).toHaveLength(1)
    expect(reminders[0].status).toBe('scheduled')
  })

  it('forgets subscriptions the browser has dropped', async () => {
    const { db, logs, deletedSubs } = fakeDb([due()])
    await runReminderJob(db, async () => 'gone', at('2026-10-12T01:30:20Z'))
    expect(deletedSubs).toEqual(['s1'])
    expect(logs[0].status).toBe('failed')
  })

  it('ignores reminders more than six hours late', async () => {
    const { db, reminders } = fakeDb([due()])
    expect(await runReminderJob(db, sendOk, at('2026-10-12T08:00:00Z'))).toEqual({ due: 0, sent: 0, scheduled: 0 })
    expect(reminders[0].status).toBe('scheduled')
  })

  it('repeats a custom reminder', async () => {
    const { db, reminders } = fakeDb([
      due({ source_type: 'custom', source_id: null, recurrence: { freq: 'daily', interval: 1 }, dedupe_key: 'custom:abc:2026-10-12', title: 'Drink water' }),
    ])
    const res = await runReminderJob(db, sendOk, at('2026-10-12T01:30:20Z'))
    expect(res.scheduled).toBe(1)
    expect(reminders.find((r) => r.dedupe_key === 'custom:abc:2026-10-13')?.remind_at).toBe('2026-10-13T01:30:00.000Z')
  })
})
