import { habitStats } from './logic'
import type { Habit, HabitCheckin } from '@/lib/db/types'

const base: Habit = {
  id: 'h', user_id: 'u', created_at: '', updated_at: '', name: 'Gym', description: '', color: '#0d9488', icon: '',
  kind: 'check', schedule: { type: 'daily' }, target_value: null, unit: '', start_date: '2026-10-01', reminder_time: null,
  show_on_dashboard: true, show_in_planner: true, goal_id: null, sort_order: 0, archived_at: null,
}
const ci = (date: string, value = 1): HabitCheckin => ({ id: date, user_id: 'u', created_at: '', updated_at: '', habit_id: 'h', date, value, note: '', source: 'manual' })

describe('habitStats', () => {
  it('counts consecutive daily completions and does not break on an unfinished today', () => {
    const s = habitStats(base, ['2026-10-08', '2026-10-09', '2026-10-10'].map((d) => ci(d)), '2026-10-11')
    expect(s.current).toBe(3)
    expect(s.doneToday).toBe(false)
  })

  it('breaks on a missed scheduled day', () => {
    const s = habitStats(base, ['2026-10-07', '2026-10-09', '2026-10-10'].map((d) => ci(d)), '2026-10-11')
    expect(s.current).toBe(2)
    expect(s.best).toBe(2)
  })

  it('skips unscheduled days for weekday habits', () => {
    // Mon/Wed/Fri. 2026-10-05 is a Monday.
    const h: Habit = { ...base, schedule: { type: 'days', days: [1, 3, 5] } }
    const s = habitStats(h, ['2026-10-05', '2026-10-07', '2026-10-09'].map((d) => ci(d)), '2026-10-11')
    expect(s.current).toBe(3)
  })

  it('uses numeric targets', () => {
    const h: Habit = { ...base, kind: 'numeric', target_value: 5 }
    const s = habitStats(h, [ci('2026-10-09', 5), ci('2026-10-10', 3)], '2026-10-11')
    expect(s.current).toBe(0)
    expect(s.best).toBe(1)
  })

  it('counts weekly targets in weeks', () => {
    const h: Habit = { ...base, start_date: '2026-09-28', schedule: { type: 'weekly', timesPerWeek: 2 } }
    // Week of 28 Sep: 2 done. Week of 5 Oct: 2 done. Week of 12 Oct not reached.
    const s = habitStats(h, ['2026-09-29', '2026-10-01', '2026-10-06', '2026-10-08'].map((d) => ci(d)), '2026-10-11', 1)
    expect(s.unit).toBe('week')
    expect(s.current).toBe(2)
  })
})
