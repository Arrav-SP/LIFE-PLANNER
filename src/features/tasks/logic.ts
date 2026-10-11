import { addDays, dateKey, diffDays } from '@/lib/dates'
import { nextOccurrence, occurrenceDates } from '@/lib/recurrence'
import type { DateKey, Priority, Task, TaskOccurrence } from '@/lib/db/types'

/** One actionable appearance of a task: the task itself, or one occurrence of a recurring task. */
export interface TaskInstance {
  key: string
  task: Task
  /** The day this instance belongs to (due date, or occurrence date). */
  date: DateKey | null
  /** For recurring tasks: the rule's original date for this occurrence. */
  occurrenceDate: DateKey | null
  done: boolean
  skipped: boolean
  scheduledAt: string | null
  completedAt: string | null
  occurrence?: TaskOccurrence
}

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
export const PRIORITY_COLOR: Record<Priority, string> = { urgent: '#dc2626', high: '#ea580c', normal: '#64748b', low: '#94a3b8' }

export function isRecurring(t: Task) {
  return !!t.recurrence
}

/** The date a recurring series is anchored to. */
export function seriesStart(t: Task, tz: string): DateKey {
  return t.start_date ?? t.due_date ?? (t.scheduled_at ? dateKey(t.scheduled_at, tz) : dateKey(t.created_at, tz))
}

export function taskDate(t: Task, tz: string): DateKey | null {
  return t.due_date ?? (t.scheduled_at ? dateKey(t.scheduled_at, tz) : null) ?? t.start_date
}

function shiftScheduled(t: Task, occDate: DateKey, tz: string): string | null {
  if (!t.scheduled_at) return null
  const base = dateKey(t.scheduled_at, tz)
  return new Date(new Date(t.scheduled_at).getTime() + diffDays(occDate, base) * 86400000).toISOString()
}

/**
 * Expand tasks into instances within [from, to]. Non-recurring tasks appear
 * once on their date (or undated). Recurring tasks appear once per occurrence;
 * completing one occurrence never completes the series.
 */
export function expandTasks(tasks: Task[], occurrences: TaskOccurrence[], from: DateKey, to: DateKey, tz: string): TaskInstance[] {
  const byTask = new Map<string, Map<DateKey, TaskOccurrence>>()
  for (const o of occurrences) {
    if (!byTask.has(o.task_id)) byTask.set(o.task_id, new Map())
    byTask.get(o.task_id)!.set(o.occurrence_date, o)
  }
  const out: TaskInstance[] = []
  for (const t of tasks) {
    if (t.archived_at) continue
    if (!t.recurrence) {
      const date = taskDate(t, tz)
      out.push({
        key: t.id,
        task: t,
        date,
        occurrenceDate: null,
        done: t.status === 'done',
        skipped: t.status === 'cancelled',
        scheduledAt: t.scheduled_at,
        completedAt: t.completed_at,
      })
      continue
    }
    if (t.status === 'done' || t.status === 'cancelled') continue // series ended manually
    const occMap = byTask.get(t.id) ?? new Map<DateKey, TaskOccurrence>()
    const start = seriesStart(t, tz)
    for (const d of occurrenceDates(t.recurrence, start, from, to)) {
      const occ = occMap.get(d)
      const effective = occ?.status === 'rescheduled' && occ.rescheduled_to ? occ.rescheduled_to : d
      if (effective < from || effective > to) continue // moved elsewhere; shown on its new date
      out.push(instanceFor(t, d, effective, occ, tz))
    }
    // Moved-in occurrences whose original date is outside the window.
    for (const occ of occMap.values()) {
      if (occ.status !== 'rescheduled' || !occ.rescheduled_to) continue
      if (occ.occurrence_date >= from && occ.occurrence_date <= to) continue
      if (occ.rescheduled_to >= from && occ.rescheduled_to <= to) out.push(instanceFor(t, occ.occurrence_date, occ.rescheduled_to, occ, tz))
    }
  }
  return out
}

function instanceFor(t: Task, occDate: DateKey, effective: DateKey, occ: TaskOccurrence | undefined, tz: string): TaskInstance {
  return {
    key: `${t.id}:${occDate}`,
    task: t,
    date: effective,
    occurrenceDate: occDate,
    done: occ?.status === 'done',
    skipped: occ?.status === 'skipped',
    scheduledAt: occ?.scheduled_at ?? shiftScheduled(t, effective, tz),
    completedAt: occ?.completed_at ?? null,
    occurrence: occ,
  }
}

/**
 * The most recent missed occurrence of each recurring task before `today`.
 * Only one per series is surfaced, so a missed daily task does not flood the
 * overdue list.
 */
export function missedRecurring(tasks: Task[], occurrences: TaskOccurrence[], today: DateKey, tz: string): TaskInstance[] {
  const out: TaskInstance[] = []
  for (const t of tasks) {
    if (!t.recurrence || t.archived_at || t.status === 'done' || t.status === 'cancelled') continue
    const start = seriesStart(t, tz)
    const yesterday = addDays(today, -1)
    if (start > yesterday) continue
    const dates = occurrenceDates(t.recurrence, start, addDays(today, -60) < start ? start : addDays(today, -60), yesterday)
    const last = dates[dates.length - 1]
    if (!last) continue
    const occ = occurrences.find((o) => o.task_id === t.id && o.occurrence_date === last)
    if (occ) continue // done, skipped or rescheduled
    out.push(instanceFor(t, last, last, undefined, tz))
  }
  return out
}

export function sortInstances(list: TaskInstance[]): TaskInstance[] {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    const ad = a.date ?? '9999'
    const bd = b.date ?? '9999'
    if (ad !== bd) return ad < bd ? -1 : 1
    const as = a.scheduledAt ?? ''
    const bs = b.scheduledAt ?? ''
    if (as !== bs) return !as ? 1 : !bs ? -1 : as < bs ? -1 : 1
    const p = PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority]
    if (p) return p
    return a.task.sort_order - b.task.sort_order || a.task.created_at.localeCompare(b.task.created_at)
  })
}

export type TaskView = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'all' | 'completed'

export interface ViewFilter {
  search?: string
  priority?: Priority | ''
  projectId?: string
  categoryId?: string
  tag?: string
  goalId?: string
}

export function matchesFilter(i: TaskInstance, f: ViewFilter): boolean {
  const t = i.task
  if (f.priority && t.priority !== f.priority) return false
  if (f.projectId && t.project_id !== f.projectId) return false
  if (f.categoryId && t.category_id !== f.categoryId) return false
  if (f.goalId && t.goal_id !== f.goalId) return false
  if (f.tag && !t.tags.includes(f.tag)) return false
  if (f.search) {
    const s = f.search.toLowerCase()
    const hay = `${t.title} ${t.description} ${t.notes} ${t.tags.join(' ')}`.toLowerCase()
    if (!hay.includes(s)) return false
  }
  return true
}

/** Build the instance list for a named view. Subtasks are shown under their parent, not here. */
export function viewInstances(view: TaskView, tasks: Task[], occurrences: TaskOccurrence[], today: DateKey, tz: string): TaskInstance[] {
  const top = tasks.filter((t) => !t.parent_id)
  switch (view) {
    case 'inbox':
      return expandTasks(
        top.filter((t) => !t.recurrence && !t.due_date && !t.start_date && !t.scheduled_at && !t.project_id && t.status !== 'done' && t.status !== 'cancelled'),
        [],
        today,
        today,
        tz,
      )
    case 'today': {
      const todays = expandTasks(top, occurrences, today, today, tz).filter((i) => i.date === today && !i.skipped)
      return [...overdue(top, occurrences, today, tz), ...todays]
    }
    case 'upcoming':
      return expandTasks(top, occurrences, addDays(today, 1), addDays(today, 30), tz).filter((i) => i.date && i.date > today && !i.done && !i.skipped)
    case 'overdue':
      return overdue(top, occurrences, today, tz)
    case 'all':
      return top
        .filter((t) => !t.archived_at && t.status !== 'done' && t.status !== 'cancelled')
        .map((t) => {
          if (!t.recurrence) return expandTasks([t], [], today, today, tz)[0]
          const next = nextOccurrence(t.recurrence, seriesStart(t, tz), today)
          return { ...instanceFor(t, next ?? today, next ?? today, undefined, tz), key: t.id, occurrenceDate: null }
        })
    case 'completed': {
      const done: TaskInstance[] = top
        .filter((t) => !t.recurrence && t.status === 'done' && !t.archived_at)
        .map((t) => expandTasks([t], [], today, today, tz)[0])
      for (const o of occurrences) {
        if (o.status !== 'done') continue
        const t = top.find((x) => x.id === o.task_id)
        if (t) done.push(instanceFor(t, o.occurrence_date, o.rescheduled_to ?? o.occurrence_date, o, tz))
      }
      return done.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    }
  }
}

export function overdue(tasks: Task[], occurrences: TaskOccurrence[], today: DateKey, tz: string): TaskInstance[] {
  const single = tasks
    .filter((t) => !t.recurrence && !t.archived_at && t.status !== 'done' && t.status !== 'cancelled')
    .map((t) => expandTasks([t], [], today, today, tz)[0])
    .filter((i) => i.date && i.date < today)
  const moved = expandTasks(
    tasks.filter((t) => t.recurrence),
    occurrences,
    addDays(today, -60),
    addDays(today, -1),
    tz,
  ).filter((i) => i.occurrence?.status === 'rescheduled' && !i.done)
  return [...single, ...moved, ...missedRecurring(tasks, occurrences, today, tz)]
}

export function checklistProgress(t: Task): { done: number; total: number } {
  return { done: t.checklist.filter((c) => c.done).length, total: t.checklist.length }
}
