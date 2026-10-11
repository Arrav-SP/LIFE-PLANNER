import { estimated1RM, formatPR, personalRecords, volume } from './logic'
import type { WorkoutSet } from '@/lib/db/types'

const set = (id: string, v: Partial<WorkoutSet>): WorkoutSet => ({ id, user_id: 'u', created_at: '', updated_at: '', workout_id: 'w', exercise_id: 'e', set_index: 0, reps: null, weight: null, distance_km: null, duration_seconds: null, notes: '', ...v })

describe('fitness logic', () => {
  it('estimates 1RM', () => {
    expect(estimated1RM(100, 1)).toBe(100)
    expect(estimated1RM(100, 5)).toBeCloseTo(116.7, 1)
  })
  it('finds weight PRs', () => {
    const prs = personalRecords('weight_reps', [set('a', { weight: 80, reps: 8 }), set('b', { weight: 90, reps: 3 })])
    expect(prs.find((p) => p.label === 'Heaviest')?.setId).toBe('b')
    expect(prs.find((p) => p.label === 'Best set volume')?.setId).toBe('a')
  })
  it('finds the fastest pace', () => {
    const prs = personalRecords('distance_duration', [set('a', { distance_km: 5, duration_seconds: 1500 }), set('b', { distance_km: 3, duration_seconds: 840 })])
    const pace = prs.find((p) => p.label === 'Fastest pace')!
    expect(pace.setId).toBe('b')
    expect(formatPR(pace)).toBe('4:40 /km')
  })
  it('sums volume', () => {
    expect(volume([set('a', { weight: 50, reps: 10 }), set('b', { reps: 10 })])).toBe(500)
  })
})
