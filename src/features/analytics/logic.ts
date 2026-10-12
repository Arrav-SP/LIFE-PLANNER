import type { DateKey, Habit, HabitCheckin, StudySession, Subject, Task, TaskOccurrence } from '@/lib/db/types'
import { dateKey, daysInRange } from '@/lib/dates'
import { checkinMap, habitScheduledOn, isComplete } from '@/features/habits/logic'

export interface DayCount {
  date: DateKey
  value: number
}

/** Tasks and recurring occurrences completed on each day of the range. */
export function completionsByDay(tasks: Task[], occurrences: TaskOccurrence[], from: DateKey, to: DateKey, tz: string): DayCount[] {
  const counts = new Map<DateKey, number>(daysInRange(from, to).map((d) => [d, 0]))
  for (const t of tasks) {
    if (t.recurrence || t.status !== 'done' || !t.completed_at) continue
    const d = dateKey(t.completed_at, tz)
    if (counts.has(d)) counts.set(d, counts.get(d)! + 1)
  }
  for (const o of occurrences) {
    if (o.status !== 'done' || !o.completed_at) continue
    const d = dateKey(o.completed_at, tz)
    if (counts.has(d)) counts.set(d, counts.get(d)! + 1)
  }
  return [...counts].map(([date, value]) => ({ date, value }))
}

export function studyByDay(sessions: StudySession[], from: DateKey, to: DateKey, tz: string): DayCount[] {
  const m = new Map<DateKey, number>(daysInRange(from, to).map((d) => [d, 0]))
  for (const s of sessions) {
    if (!s.ended_at) continue
    const d = dateKey(s.started_at, tz)
    if (m.has(d)) m.set(d, m.get(d)! + (s.actual_minutes ?? 0))
  }
  return [...m].map(([date, value]) => ({ date, value }))
}

export function studyBySubject(sessions: StudySession[], subjects: Subject[], from: DateKey, to: DateKey, tz: string): { id: string | null; name: string; color: string; minutes: number }[] {
  const m = new Map<string, number>()
  for (const s of sessions) {
    if (!s.ended_at) continue
    const d = dateKey(s.started_at, tz)
    if (d < from || d > to) continue
    const k = s.subject_id ?? ''
    m.set(k, (m.get(k) ?? 0) + (s.actual_minutes ?? 0))
  }
  return [...m]
    .map(([id, minutes]) => {
      const sub = subjects.find((x) => x.id === id)
      return { id: sub?.id ?? null, name: sub?.name ?? 'General', color: sub?.color ?? '#64748b', minutes }
    })
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
}

/** Share of scheduled days each habit was completed in the range (weekly habits: completions / expected). */
export function habitRates(habits: Habit[], checkins: HabitCheckin[], from: DateKey, to: DateKey): { id: string; name: string; color: string; rate: number; done: number; due: number }[] {
  const days = daysInRange(from, to)
  return habits.map((h) => {
    const map = checkinMap(checkins, h.id)
    const active = days.filter((d) => d >= h.start_date)
    let due = 0
    let done = 0
    if (h.schedule.type === 'weekly') {
      due = Math.round((active.length / 7) * h.schedule.timesPerWeek)
      done = active.filter((d) => isComplete(h, map.get(d))).length
    } else {
      for (const d of active) {
        if (!habitScheduledOn(h, d)) continue
        due++
        if (isComplete(h, map.get(d))) done++
      }
    }
    return { id: h.id, name: h.name, color: h.color, rate: due ? Math.min(1, done / due) : 0, done, due }
  })
}
