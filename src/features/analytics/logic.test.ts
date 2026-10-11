import { completionsByDay, habitRates, studyByDay } from './logic'
import type { Habit, Task, TaskOccurrence, StudySession } from '@/lib/db/types'

const tz = 'Asia/Kolkata'

describe('analytics', () => {
  it('counts completions by local day', () => {
    const tasks = [{ id: 't', recurrence: null, status: 'done', completed_at: '2026-10-10T20:00:00.000Z' } as unknown as Task]
    const occ = [{ task_id: 'r', status: 'done', completed_at: '2026-10-10T05:00:00.000Z' } as unknown as TaskOccurrence]
    const r = completionsByDay(tasks, occ, '2026-10-10', '2026-10-11', tz)
    // 20:00 UTC on the 10th is 01:30 on the 11th in Kolkata.
    expect(r).toEqual([
      { date: '2026-10-10', value: 1 },
      { date: '2026-10-11', value: 1 },
    ])
  })

  it('sums study minutes', () => {
    const s = [{ started_at: '2026-10-11T04:00:00.000Z', ended_at: 'x', actual_minutes: 50 } as unknown as StudySession]
    expect(studyByDay(s, '2026-10-11', '2026-10-11', tz)[0].value).toBe(50)
  })

  it('computes habit rates over scheduled days', () => {
    const h = { id: 'h', name: 'Gym', color: '#000', kind: 'check', schedule: { type: 'days', days: [1, 3, 5] }, start_date: '2026-01-01', target_value: null } as unknown as Habit
    // 5-11 Oct 2026: Mon 5, Wed 7, Fri 9 are scheduled.
    const c = [{ habit_id: 'h', date: '2026-10-05', value: 1 }, { habit_id: 'h', date: '2026-10-07', value: 1 }] as never
    const [r] = habitRates([h], c, '2026-10-05', '2026-10-11')
    expect(r.due).toBe(3)
    expect(r.done).toBe(2)
  })
})
