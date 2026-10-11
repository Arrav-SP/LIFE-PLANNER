import type { DateKey, Habit, HabitCheckin } from '@/lib/db/types'
import { addDays, startOfWeek } from '@/lib/dates'
import { habitScheduledOn } from '@/features/reminders/sync'

export { habitScheduledOn }

/** A check-in counts as complete when it meets the habit's target. */
export function isComplete(h: Habit, c: HabitCheckin | undefined): boolean {
  if (!c) return false
  if (h.kind === 'numeric') return c.value >= (h.target_value ?? 1)
  return c.value > 0
}

export function checkinMap(checkins: HabitCheckin[], habitId: string): Map<DateKey, HabitCheckin> {
  const m = new Map<DateKey, HabitCheckin>()
  for (const c of checkins) if (c.habit_id === habitId) m.set(c.date, c)
  return m
}

export interface HabitStats {
  /** Current streak in days (or weeks for "N times per week" habits). */
  current: number
  best: number
  unit: 'day' | 'week'
  /** Share of scheduled days completed in the last 30 days, 0-1. */
  rate30: number
  /** For weekly habits: completions so far this week. */
  thisWeek: number
  doneToday: boolean
  dueToday: boolean
}

/**
 * Schedule-aware streaks. Unscheduled days never break a streak, and today
 * only extends it (an unfinished today is not a miss yet).
 */
export function habitStats(h: Habit, checkins: HabitCheckin[], today: DateKey, weekStart = 1): HabitStats {
  const map = checkinMap(checkins, h.id)
  const done = (d: DateKey) => isComplete(h, map.get(d))
  const start = h.start_date

  if (h.schedule.type === 'weekly') {
    const target = Math.max(1, h.schedule.timesPerWeek)
    const weekCount = (ws: DateKey) => {
      let n = 0
      for (let i = 0; i < 7; i++) if (done(addDays(ws, i))) n++
      return n
    }
    const thisWs = startOfWeek(today, weekStart)
    const firstWs = startOfWeek(start, weekStart)
    const thisWeek = weekCount(thisWs)
    // Walk weeks oldest -> newest to find best and current.
    let best = 0
    let run = 0
    for (let ws = firstWs; ws <= thisWs; ws = addDays(ws, 7)) {
      const ok = weekCount(ws) >= target
      if (ok) run++
      else if (ws !== thisWs) run = 0
      best = Math.max(best, run)
    }
    const current = run
    let scheduled = 0
    let completed = 0
    for (let i = 0; i < 30; i++) {
      const d = addDays(today, -i)
      if (d < start) break
      scheduled++
      if (done(d)) completed++
    }
    // A weekly habit expects target/7 per day.
    const expected = (scheduled * target) / 7
    return { current, best, unit: 'week', rate30: expected ? Math.min(1, completed / expected) : 0, thisWeek, doneToday: done(today), dueToday: thisWeek < target }
  }

  let best = 0
  let run = 0
  let scheduled30 = 0
  let done30 = 0
  const from = start
  for (let d = from; d <= today; d = addDays(d, 1)) {
    if (!habitScheduledOn(h, d)) continue
    if (done(d)) run++
    else if (d !== today) run = 0
    best = Math.max(best, run)
  }
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, -i)
    if (d < start) break
    if (!habitScheduledOn(h, d)) continue
    if (d === today && !done(d)) continue
    scheduled30++
    if (done(d)) done30++
  }
  return {
    current: run,
    best,
    unit: 'day',
    rate30: scheduled30 ? done30 / scheduled30 : 0,
    thisWeek: 0,
    doneToday: done(today),
    dueToday: habitScheduledOn(h, today),
  }
}

export function describeSchedule(h: Habit): string {
  const s = h.schedule
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  switch (s.type) {
    case 'daily':
      return 'Every day'
    case 'days':
      return s.days.length === 7 ? 'Every day' : [...s.days].sort().map((d) => names[d]).join(', ')
    case 'weekly':
      return `${s.timesPerWeek}× a week`
    case 'interval':
      return s.everyDays === 1 ? 'Every day' : `Every ${s.everyDays} days`
  }
}
