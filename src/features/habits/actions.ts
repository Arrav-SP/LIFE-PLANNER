import { getStore } from '@/lib/db'
import { eq } from '@/lib/db/store'
import { useInvalidate } from '@/lib/db/hooks'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/lib/utils'
import type { DateKey, Habit, HabitCheckin } from '@/lib/db/types'

/** Check-in writes shared by the dashboard, planner and habits page. */
export function useHabitActions() {
  const invalidate = useInvalidate()
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      invalidate('habit_checkins')
    }
  }
  return {
    /** Set the value for a day. 0 removes the check-in. */
    setValue: (h: Habit, date: DateKey, value: number, note = '') =>
      run(async () => {
        if (value <= 0) await getStore().removeWhere('habit_checkins', [eq('habit_id', h.id), eq('date', date)])
        else await getStore().upsert('habit_checkins', { habit_id: h.id, date, value, note, source: 'manual' }, ['habit_id', 'date'])
      }),
    toggle: (h: Habit, date: DateKey, current: HabitCheckin | undefined) =>
      run(async () => {
        if (current && current.value > 0) await getStore().removeWhere('habit_checkins', [eq('habit_id', h.id), eq('date', date)])
        else await getStore().upsert('habit_checkins', { habit_id: h.id, date, value: h.kind === 'numeric' ? h.target_value ?? 1 : 1, note: '', source: 'manual' }, ['habit_id', 'date'])
      }),
  }
}
