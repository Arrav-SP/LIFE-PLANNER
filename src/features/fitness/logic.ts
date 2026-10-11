import type { Exercise, ExerciseMetric, WorkoutSet } from '@/lib/db/types'

/** Epley estimate of a one-rep max. */
export function estimated1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0
  if (reps === 1) return weight
  return Math.round(weight * (1 + reps / 30) * 10) / 10
}

export interface PR {
  label: string
  value: number
  unit: string
  setId: string
}

/** Personal records for one exercise, chosen by its metric type. */
export function personalRecords(metric: ExerciseMetric, sets: WorkoutSet[]): PR[] {
  const best = (score: (s: WorkoutSet) => number, label: string, unit: string): PR | null => {
    let top: WorkoutSet | null = null
    let v = 0
    for (const s of sets) {
      const x = score(s)
      if (x > v) {
        v = x
        top = s
      }
    }
    return top ? { label, value: v, unit, setId: top.id } : null
  }
  const out: (PR | null)[] = []
  switch (metric) {
    case 'weight_reps':
      out.push(best((s) => s.weight ?? 0, 'Heaviest', 'kg'))
      out.push(best((s) => estimated1RM(s.weight ?? 0, s.reps ?? 0), 'Est. 1RM', 'kg'))
      out.push(best((s) => (s.weight ?? 0) * (s.reps ?? 0), 'Best set volume', 'kg'))
      break
    case 'reps':
      out.push(best((s) => s.reps ?? 0, 'Most reps', 'reps'))
      break
    case 'duration':
      out.push(best((s) => s.duration_seconds ?? 0, 'Longest', 's'))
      break
    case 'distance':
      out.push(best((s) => s.distance_km ?? 0, 'Longest', 'km'))
      break
    case 'distance_duration':
      out.push(best((s) => s.distance_km ?? 0, 'Longest', 'km'))
      // Fastest pace = lowest seconds per km, stored as a positive score.
      out.push(best((s) => (s.distance_km && s.duration_seconds ? 1 / (s.duration_seconds / s.distance_km) : 0), 'Fastest pace', 'pace'))
      break
  }
  return out.filter((x): x is PR => !!x)
}

export function formatPR(pr: PR): string {
  if (pr.unit === 'pace') {
    const secPerKm = 1 / pr.value
    return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')} /km`
  }
  if (pr.unit === 's') return formatSeconds(pr.value)
  return `${+pr.value.toFixed(1)} ${pr.unit}`
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return m ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`
}

export function volume(sets: WorkoutSet[]): number {
  return sets.reduce((t, s) => t + (s.weight ?? 0) * (s.reps ?? 0), 0)
}

export const STARTER_EXERCISES: Pick<Exercise, 'name' | 'category' | 'metric_type' | 'muscle_group'>[] = [
  { name: 'Bench press', category: 'strength', metric_type: 'weight_reps', muscle_group: 'Chest' },
  { name: 'Squat', category: 'strength', metric_type: 'weight_reps', muscle_group: 'Legs' },
  { name: 'Deadlift', category: 'strength', metric_type: 'weight_reps', muscle_group: 'Back' },
  { name: 'Overhead press', category: 'strength', metric_type: 'weight_reps', muscle_group: 'Shoulders' },
  { name: 'Barbell row', category: 'strength', metric_type: 'weight_reps', muscle_group: 'Back' },
  { name: 'Lat pulldown', category: 'strength', metric_type: 'weight_reps', muscle_group: 'Back' },
  { name: 'Bicep curl', category: 'strength', metric_type: 'weight_reps', muscle_group: 'Arms' },
  { name: 'Tricep pushdown', category: 'strength', metric_type: 'weight_reps', muscle_group: 'Arms' },
  { name: 'Leg press', category: 'strength', metric_type: 'weight_reps', muscle_group: 'Legs' },
  { name: 'Pull-up', category: 'strength', metric_type: 'reps', muscle_group: 'Back' },
  { name: 'Push-up', category: 'strength', metric_type: 'reps', muscle_group: 'Chest' },
  { name: 'Plank', category: 'mobility', metric_type: 'duration', muscle_group: 'Core' },
  { name: 'Running', category: 'cardio', metric_type: 'distance_duration', muscle_group: '' },
  { name: 'Cycling', category: 'cardio', metric_type: 'distance_duration', muscle_group: '' },
]
