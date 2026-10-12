import { describe, expect, it } from 'vitest'
import type { CalendarEvent, Habit, Reminder, Task } from '@/lib/db/types'
import { afterFiring, planCustomNext, planEventReminders, planHabitReminders, planTaskReminders, reconcileReminders } from './plan'

const TZ = 'Asia/Kolkata'
const base = { user_id: 'u1', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }

const habit = (over: Partial<Habit> = {}): Habit => ({
  ...base,
  id: 'h1',
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
  ...over,
})

const task = (over: Partial<Task> = {}): Task => ({
  ...base,
  id: 't1',
  parent_id: null,
  title: '5 DSA problems',
  description: '',
  status: 'todo',
  priority: 'normal',
  start_date: '2026-10-01',
  due_date: null,
  deadline: null,
  scheduled_at: '2026-10-01T12:30:00Z', // 18:00 IST
  estimated_minutes: null,
  actual_minutes: null,
  category_id: null,
  project_id: null,
  goal_id: null,
  milestone_id: null,
  tags: [],
  checklist: [],
  links: [],
  notes: '',
  recurrence: { freq: 'daily', interval: 1 },
  reminder_offsets: [30, 0],
  sort_order: 0,
  completed_at: null,
  archived_at: null,
  ...over,
})

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  ...base,
  id: 'r1',
  source_type: 'custom',
  source_id: null,
  occurrence_key: '',
  title: 'Water plants',
  body: '',
  url: '/',
  remind_at: '2026-10-12T03:30:00Z',
  offset_minutes: 0,
  recurrence: null,
  status: 'scheduled',
  snoozed_until: null,
  fired_at: null,
  push_sent_at: null,
  dedupe_key: 'custom:abc:2026-10-12',
  ...over,
})

describe('planHabitReminders', () => {
  it('moves on to tomorrow once today’s reminder has fired', () => {
    const fired = reminder({ remind_at: '2026-10-12T01:30:00Z' }) // 07:00 IST
    const firedAt = Date.parse('2026-10-12T01:30:20Z')
    // Planning from the bare clock would hand back the reminder that just fired.
    expect(planHabitReminders(habit(), TZ, firedAt)[0].remind_at).toBe('2026-10-12T01:30:00.000Z')
    const next = planHabitReminders(habit(), TZ, afterFiring(fired, firedAt))
    expect(next).toHaveLength(1)
    expect(next[0].remind_at).toBe('2026-10-13T01:30:00.000Z')
    expect(next[0].dedupe_key).toBe('habit:h1:2026-10-13')
  })

  it('skips days the habit is not scheduled', () => {
    // 2026-10-12 is a Monday; only Wednesdays (3).
    const next = planHabitReminders(habit({ schedule: { type: 'days', days: [3] } }), TZ, Date.parse('2026-10-12T00:00:00Z'))
    expect(next[0].occurrence_key).toBe('2026-10-14')
  })
})

describe('planTaskReminders', () => {
  it('keeps the same occurrence after the early reminder, then moves to the next day', () => {
    const early = reminder({ source_type: 'task', remind_at: '2026-10-12T12:00:00Z' }) // 17:30 IST
    const afterEarly = planTaskReminders(task(), TZ, afterFiring(early, Date.parse('2026-10-12T12:00:10Z')))
    expect(afterEarly.map((r) => r.remind_at)).toEqual(['2026-10-12T12:30:00.000Z'])

    const onTime = reminder({ source_type: 'task', remind_at: '2026-10-12T12:30:00Z' })
    const afterOnTime = planTaskReminders(task(), TZ, afterFiring(onTime, Date.parse('2026-10-12T12:30:10Z')))
    expect(afterOnTime.map((r) => r.remind_at)).toEqual(['2026-10-13T12:00:00.000Z', '2026-10-13T12:30:00.000Z'])
  })

  it('plans nothing for a finished task', () => {
    expect(planTaskReminders(task({ status: 'done' }), TZ, Date.parse('2026-10-12T00:00:00Z'))).toEqual([])
  })
})

describe('planEventReminders', () => {
  it('moves a weekly event to next week after it fires', () => {
    const ev: CalendarEvent = {
      ...base,
      id: 'e1',
      title: 'OS lab',
      description: '',
      all_day: false,
      start_at: '2026-10-05T08:30:00Z',
      end_at: '2026-10-05T10:00:00Z',
      timezone: TZ,
      location: 'SJT 501',
      meeting_url: '',
      notes: '',
      category_id: null,
      color: null,
      project_id: null,
      goal_id: null,
      tags: [],
      recurrence: { freq: 'weekly', interval: 1 },
      reminder_offsets: [10],
      archived_at: null,
    }
    const fired = reminder({ source_type: 'event', remind_at: '2026-10-12T08:20:00Z' })
    const next = planEventReminders(ev, [], TZ, afterFiring(fired, Date.parse('2026-10-12T08:20:30Z')))
    expect(next.map((r) => r.remind_at)).toEqual(['2026-10-19T08:20:00.000Z'])
    expect(next[0].body).toBe('Starts in 10 min · SJT 501')
  })
})

describe('planCustomNext', () => {
  it('repeats at the same wall-clock time', () => {
    const r = reminder({ recurrence: { freq: 'weekly', interval: 1 }, occurrence_key: '2026-10-12' })
    const next = planCustomNext(r, TZ)
    expect(next?.remind_at).toBe('2026-10-19T03:30:00.000Z')
    expect(next?.dedupe_key).toBe('custom:abc:2026-10-19')
  })

  it('returns nothing for one-off reminders', () => {
    expect(planCustomNext(reminder(), TZ)).toBeNull()
  })
})

describe('reconcileReminders', () => {
  it('never touches reminders that were already pushed or seen', () => {
    const pushed = reminder({ id: 'a', dedupe_key: 'habit:h1:2026-10-12', push_sent_at: '2026-10-12T01:30:00Z' })
    const fired = reminder({ id: 'b', dedupe_key: 'habit:h1:2026-10-11', status: 'fired' })
    const stalePending = reminder({ id: 'c', dedupe_key: 'habit:h1:2026-10-10' })
    const next = planHabitReminders(habit(), TZ, Date.parse('2026-10-12T02:00:00Z'))
    const changes = reconcileReminders([pushed, fired, stalePending], next)
    expect(changes.remove).toEqual(['c'])
    expect(changes.insert.map((r) => r.dedupe_key)).toEqual(['habit:h1:2026-10-13'])
    expect(changes.update).toEqual([])
  })

  it('treats the same instant in a different format as unchanged', () => {
    const existing = reminder({ id: 'a', dedupe_key: 'habit:h1:2026-10-13', remind_at: '2026-10-13T01:30:00+00:00' })
    const next = planHabitReminders(habit(), TZ, Date.parse('2026-10-12T02:00:00Z'))
    expect(reconcileReminders([existing], next)).toEqual({ remove: [], insert: [], update: [] })
  })
})
