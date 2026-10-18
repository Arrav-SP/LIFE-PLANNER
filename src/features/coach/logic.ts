import type { DateKey, Goal, Habit, HabitCheckin, Priority, StudySession, StudyTopic, Subject, Task } from '@/lib/db/types'
import { addDays, dateKey, diffDays, formatKey, weekdayOf } from '@/lib/dates'
import { formatMinutes } from '@/lib/utils'
import type { TaskInstance } from '@/features/tasks/logic'
import { habitRates } from '@/features/analytics/logic'
import { freeSlots } from '@/features/calendar/logic'

/**
 * The coach is plain arithmetic over the user's own data: no network calls, no AI service.
 * Everything here is pure so it can be unit-tested.
 */

// ---------------------------------------------------------------------------
// Ideal tasks for today
// ---------------------------------------------------------------------------

interface SuggestionBase {
  score: number
  minutes: number
  reasons: string[]
  /** Overdue, due today or repeating today: not optional. */
  mustDo: boolean
}

export type TaskSuggestion = SuggestionBase & {
  kind: 'task'
  instance: TaskInstance
  /** Undated, unlinked and low-stakes: only offered when nothing else is pressing. */
  backlog?: boolean
  /** False when `minutes` is only the default task length from Settings. */
  estimated: boolean
}
export type StudySuggestion = SuggestionBase & { kind: 'study'; subject: Subject }
export type Suggestion = TaskSuggestion | StudySuggestion

export const suggestionKey = (s: Suggestion) => (s.kind === 'task' ? s.instance.key : `study-${s.subject.id}`)
export const suggestionTitle = (s: Suggestion) => (s.kind === 'task' ? s.instance.task.title : `Study: ${s.subject.name}`)

const PRIORITY_POINTS: Record<Priority, number> = { urgent: 30, high: 20, normal: 8, low: 0 }

export function scoreInstance(i: TaskInstance, goals: Map<string, Goal>, today: DateKey, tz: string, defaultMinutes: number): TaskSuggestion | null {
  const t = i.task
  if (i.done || i.skipped || t.parent_id || t.archived_at) return null
  if (t.status === 'done' || t.status === 'cancelled') return null
  if (t.start_date && t.start_date > today) return null
  const recurring = !!t.recurrence
  // Missed repeats are not carried forward; only today's occurrence counts.
  if (recurring && i.date !== today) return null

  let score = PRIORITY_POINTS[t.priority]
  const reasons: string[] = []
  let mustDo = false
  if (t.priority === 'urgent' || t.priority === 'high') reasons.push(`${t.priority === 'urgent' ? 'Urgent' : 'High'} priority`)

  if (recurring) {
    score += 30
    mustDo = true
    reasons.unshift('Repeats today')
  } else if (i.date) {
    const d = diffDays(i.date, today)
    if (d < 0) {
      score += 45 + Math.min(15, -d * 2)
      mustDo = true
      reasons.unshift(`Overdue by ${-d} day${d === -1 ? '' : 's'}`)
    } else if (d === 0) {
      score += 40
      mustDo = true
      reasons.unshift('Due today')
    } else if (d <= 3) {
      score += 25
      reasons.unshift(`Due in ${d} day${d === 1 ? '' : 's'}`)
    } else if (d <= 7) {
      score += 12
      reasons.unshift(`Due ${formatKey(i.date, 'EEE d MMM')}`)
    } else if (d > 14 && !t.goal_id && score < 20) return null
  }

  if (i.scheduledAt && dateKey(i.scheduledAt, tz) === today && !recurring) {
    score += 10
    reasons.push('Scheduled today')
  }
  if (t.status === 'in_progress') {
    score += 8
    reasons.push('Already started')
  }
  const goal = t.goal_id ? goals.get(t.goal_id) : undefined
  if (goal && goal.status === 'active') {
    const left = goal.target_date ? diffDays(goal.target_date, today) : null
    if (left !== null && left >= 0 && left <= 45) {
      score += 15
      reasons.push(`Moves “${goal.title}” (due in ${left} day${left === 1 ? '' : 's'})`)
    } else {
      score += 5
      reasons.push(`Moves “${goal.title}”`)
    }
  }
  const minutes = t.estimated_minutes ?? defaultMinutes
  const estimated = t.estimated_minutes != null
  // Undated, unlinked, low-stakes tasks: kept as backlog, offered only on a quiet day.
  if (!i.date && !goal && score < 20) {
    return { kind: 'task', instance: i, score, minutes, estimated, reasons: [`In your backlog since ${formatKey(dateKey(t.created_at, tz), 'd MMM')}`], mustDo: false, backlog: true }
  }

  return { kind: 'task', instance: i, score, minutes, estimated, reasons, mustDo }
}

export function suggestToday(
  instances: TaskInstance[],
  goals: Goal[],
  opts: {
    today: DateKey
    tz: string
    budgetMinutes: number
    defaultMinutes: number
    max?: number
    /** Study sessions to rank alongside tasks (see studyPicks). */
    study?: StudySuggestion[]
    /** From estimateBias: tasks usually take this many times their estimate. */
    minutesFactor?: number
  },
): { picks: Suggestion[]; extra: Suggestion[]; mustDoMinutes: number } {
  const byId = new Map(goals.map((g) => [g.id, g]))
  const seen = new Set<string>()
  const scored: Suggestion[] = [...(opts.study ?? [])]
  const backlog: TaskSuggestion[] = []
  const factor = opts.minutesFactor && opts.minutesFactor >= 1.15 ? opts.minutesFactor : 1
  for (const i of instances) {
    if (seen.has(i.key)) continue
    seen.add(i.key)
    const s = scoreInstance(i, byId, opts.today, opts.tz, opts.defaultMinutes)
    if (!s) continue
    if (factor > 1) {
      s.minutes = Math.round((s.minutes * factor) / 5) * 5
      s.reasons.push(`Padded: you usually run ~${Math.round((factor - 1) * 100)}% over`)
    }
    if (s.backlog) backlog.push(s)
    else scored.push(s)
  }
  scored.sort((a, b) => b.score - a.score || a.minutes - b.minutes || suggestionTitle(a).localeCompare(suggestionTitle(b)))
  backlog.sort((a, b) => a.instance.task.created_at.localeCompare(b.instance.task.created_at))
  const max = opts.max ?? 8
  const picks: Suggestion[] = []
  const rest: Suggestion[] = []
  let used = 0
  // Backlog only fills the list when nothing ranked does.
  for (const s of scored.length ? scored : backlog) {
    const fits = used + s.minutes <= opts.budgetMinutes
    if (picks.length < max && (fits || picks.length === 0)) {
      picks.push(s)
      used += s.minutes
    } else rest.push(s)
  }
  if (scored.length) rest.push(...backlog)
  const mustDoMinutes = scored.filter((s) => s.mustDo).reduce((t, s) => t + s.minutes, 0)
  return { picks, extra: rest.slice(0, 5), mustDoMinutes }
}

/** A study session for each subject that still needs time today, from its pace (or weekly target). */
export function studyPicks(plan: StudyPlanRow[], studiedToday: Map<string, number>): StudySuggestion[] {
  const out: StudySuggestion[] = []
  for (const p of plan) {
    if (p.status === 'done' || p.status === 'overdue' || !p.neededPerDay) continue
    const left = p.neededPerDay - (studiedToday.get(p.subject.id) ?? 0)
    if (left < 10) continue
    const behind = p.status === 'behind'
    out.push({
      kind: 'study',
      subject: p.subject,
      score: behind ? 35 : p.deadline ? 20 : 12,
      minutes: Math.min(120, Math.max(25, roundTo5(left))),
      reasons: [behind ? 'Behind pace' : p.deadline ? `On pace for ${formatKey(p.deadline, 'd MMM')}` : 'Weekly target'],
      mustDo: false,
    })
  }
  return out
}

/** Free gaps left today between busy items, from now (or the day start) to the day end. */
export function freeToday(busy: { key: string; start: Date; end: Date; allDay?: boolean }[], dayStart: Date, dayEnd: Date, now: Date) {
  const from = now > dayStart ? new Date(Math.min(now.getTime(), dayEnd.getTime())) : dayStart
  const slots = freeSlots(busy, from, dayEnd, 15)
  return { slots, minutes: Math.round(slots.reduce((t, s) => t + (s.end.getTime() - s.start.getTime()) / 60000, 0)) }
}

// ---------------------------------------------------------------------------
// Study plan
// ---------------------------------------------------------------------------

export type PlanStatus = 'ahead' | 'on_track' | 'behind' | 'overdue' | 'done' | 'no_deadline' | 'unknown'

export interface StudyPlanRow {
  subject: Subject
  deadline: DateKey | null
  goalTitle: string | null
  daysLeft: number | null
  topicsTotal: number
  topicsLeft: number
  /** Average study minutes a day over the recent window. */
  recentPerDay: number
  /** Minutes a day needed to finish the remaining topics by the deadline, when it can be estimated. */
  neededPerDay: number | null
  topicsPerDay: number | null
  status: PlanStatus
  note: string
}

export function studyPlan(
  subjects: Subject[],
  topics: StudyTopic[],
  sessions: StudySession[],
  goals: Goal[],
  today: DateKey,
  tz: string,
  windowDays = 14,
): StudyPlanRow[] {
  const goalById = new Map(goals.map((g) => [g.id, g]))
  const from = addDays(today, -(windowDays - 1))
  return subjects
    .filter((s) => !s.archived_at)
    .map((subject) => {
      const own = topics.filter((t) => t.subject_id === subject.id)
      const done = own.filter((t) => t.status === 'done').length
      const topicsLeft = own.length - done
      const mine = sessions.filter((x) => x.subject_id === subject.id && x.ended_at)
      const totalMinutes = mine.reduce((t, x) => t + (x.actual_minutes ?? 0), 0)
      const recentMinutes = mine.filter((x) => dateKey(x.started_at, tz) >= from).reduce((t, x) => t + (x.actual_minutes ?? 0), 0)
      const recentPerDay = recentMinutes / windowDays
      const goal = subject.goal_id ? goalById.get(subject.goal_id) : undefined
      // The subject's own exam date wins over its goal's target date.
      const deadline = subject.target_date ?? goal?.target_date ?? null
      const goalTitle = subject.target_date ? 'Exam' : goal?.title ?? null
      const daysLeft = deadline ? diffDays(deadline, today) + 1 : null // the deadline day itself counts
      const base = { subject, deadline, goalTitle, daysLeft, topicsTotal: own.length, topicsLeft, recentPerDay }

      if (own.length > 0 && topicsLeft === 0) return { ...base, neededPerDay: 0, topicsPerDay: 0, status: 'done' as const, note: 'All topics done. Switch to revision.' }
      if (!deadline || daysLeft === null) {
        const target = subject.weekly_target_minutes
        return {
          ...base,
          neededPerDay: target ? target / 7 : null,
          topicsPerDay: null,
          status: 'no_deadline' as const,
          note: target ? 'Add an exam date to the subject for a pace to its deadline.' : 'Add an exam date or a weekly target to the subject to get a pace.',
        }
      }
      if (daysLeft <= 0) return { ...base, neededPerDay: null, topicsPerDay: null, status: 'overdue' as const, note: `The deadline (${formatKey(deadline, 'd MMM')}) has passed with ${topicsLeft} topics left.` }

      const topicsPerDay = own.length ? topicsLeft / daysLeft : null
      // Minutes per topic from history, once there's enough of it; otherwise fall back to the weekly target.
      const perTopic = done >= 2 && totalMinutes > 0 ? totalMinutes / done : null
      const neededPerDay = perTopic && topicsLeft ? (perTopic * topicsLeft) / daysLeft : subject.weekly_target_minutes ? subject.weekly_target_minutes / 7 : null

      let status: PlanStatus = 'unknown'
      let note = ''
      if (neededPerDay !== null && neededPerDay > 0) {
        const ratio = recentPerDay / neededPerDay
        status = ratio >= 1.15 ? 'ahead' : ratio >= 0.9 ? 'on_track' : 'behind'
        note =
          status === 'behind'
            ? `Needs about ${formatMinutes(roundTo5(neededPerDay))} a day; you've averaged ${formatMinutes(Math.round(recentPerDay)) || '0m'} lately.`
            : `About ${formatMinutes(roundTo5(neededPerDay))} a day keeps you on pace.`
      } else if (topicsPerDay !== null) {
        note = `${fmtRate(topicsPerDay)} topics a day to finish by ${formatKey(deadline, 'd MMM')}.`
        if (perTopic === null) note += ' Log study time against it to estimate the hours needed.'
      } else {
        note = 'Add topics or a weekly target so the pace can be worked out.'
      }
      return { ...base, neededPerDay, topicsPerDay, status, note }
    })
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999))
}

const STATUS_ORDER: PlanStatus[] = ['overdue', 'behind', 'unknown', 'on_track', 'ahead', 'no_deadline', 'done']
const statusRank = (s: PlanStatus) => STATUS_ORDER.indexOf(s)
export const roundTo5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)
const fmtRate = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''))

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export interface Insight {
  id: string
  tone: 'warn' | 'good' | 'info'
  title: string
  detail: string
  to?: string
}

/** The two-hour window where most study minutes started, over sessions with an end. */
export function bestFocusWindow(sessions: StudySession[], tz: string, minSessions = 5): { start: number; share: number } | null {
  const done = sessions.filter((s) => s.ended_at && (s.actual_minutes ?? 0) > 0)
  if (done.length < minSessions) return null
  const byHour = new Array<number>(24).fill(0)
  let total = 0
  for (const s of done) {
    const h = Number(timeHour(s.started_at, tz))
    byHour[h] += s.actual_minutes ?? 0
    total += s.actual_minutes ?? 0
  }
  const pair = (h: number) => byHour[h] + byHour[(h + 1) % 24]
  let best = 0
  // On a tie, start the window at the busier hour so it doesn't begin an hour early.
  for (let h = 1; h < 24; h++) if (pair(h) > pair(best) || (pair(h) === pair(best) && byHour[h] > byHour[best])) best = h
  return { start: best, share: pair(best) / total }
}

function timeHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(iso))
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Completed tasks per weekday over the last four weeks. */
export function weekdayPattern(tasks: Task[], today: DateKey, tz: string): { best: string; worst: string; counts: number[] } | null {
  const from = addDays(today, -27)
  const counts = new Array<number>(7).fill(0)
  let n = 0
  for (const t of tasks) {
    if (!t.completed_at || t.status !== 'done') continue
    const d = dateKey(t.completed_at, tz)
    if (d < from || d > today) continue
    counts[weekdayOf(d)]++
    n++
  }
  if (n < 10) return null
  const max = Math.max(...counts)
  const min = Math.min(...counts)
  if (max - min < 3) return null
  return { best: WEEKDAYS[counts.indexOf(max)], worst: WEEKDAYS[counts.indexOf(min)], counts }
}

/** Median of actual ÷ estimated minutes over finished tasks that recorded both. */
export function estimateBias(tasks: Task[]): number | null {
  const ratios = tasks
    .filter((t) => t.status === 'done' && t.estimated_minutes && t.actual_minutes)
    .map((t) => t.actual_minutes! / t.estimated_minutes!)
    .sort((a, b) => a - b)
  if (ratios.length < 5) return null
  const mid = Math.floor(ratios.length / 2)
  return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2
}

/** Habits whose last 7 days fell well below the 21 days before. */
export function slippingHabits(habits: Habit[], checkins: HabitCheckin[], today: DateKey): { name: string; before: number; now: number }[] {
  const now = habitRates(habits, checkins, addDays(today, -6), today)
  const before = habitRates(habits, checkins, addDays(today, -27), addDays(today, -7))
  return now
    .map((r, i) => ({ name: r.name, now: r.rate, before: before[i]?.rate ?? 0, due: before[i]?.due ?? 0 }))
    .filter((r) => r.due >= 3 && r.before >= 0.5 && r.before - r.now >= 0.25)
    .map(({ name, before, now }) => ({ name, before, now }))
}

export interface InsightInput {
  today: DateKey
  tz: string
  budgetMinutes: number
  suggestions: ReturnType<typeof suggestToday>
  overdueCount: number
  plan: StudyPlanRow[]
  sessions: StudySession[]
  tasks: Task[]
  habits: Habit[]
  checkins: HabitCheckin[]
  goalsBehind: { title: string; id: string }[]
  weekStudy: { name: string; minutes: number; target: number; expected: number }[]
  studyThisWeek: number
  studyLastWeek: number
}

export function buildInsights(x: InsightInput): Insight[] {
  const out: Insight[] = []
  const hours = (m: number) => formatMinutes(Math.round(m)) || '0m'

  if (x.suggestions.mustDoMinutes > x.budgetMinutes) {
    out.push({
      id: 'overcommitted',
      tone: 'warn',
      title: 'Today is overbooked',
      detail: `Overdue, due-today and repeating tasks add up to ${hours(x.suggestions.mustDoMinutes)}, more than your ${hours(x.budgetMinutes)} of free time. Move the lowest-priority ones to later this week.`,
      to: '/tasks?view=today',
    })
  }
  if (x.overdueCount >= 3) {
    out.push({
      id: 'overdue',
      tone: 'warn',
      title: `${x.overdueCount} tasks are overdue`,
      detail: 'A backlog makes every day feel behind. Give each one a new realistic date, or drop the ones that no longer matter.',
      to: '/tasks?view=overdue',
    })
  }

  const behind = x.plan.filter((p) => p.status === 'behind' || p.status === 'overdue')
  for (const p of behind.slice(0, 3)) {
    out.push({ id: `study-${p.subject.id}`, tone: 'warn', title: `${p.subject.name} is behind pace`, detail: p.note, to: '/study' })
  }
  const neededStudy = x.plan.filter((p) => p.status !== 'done' && p.status !== 'overdue' && p.deadline).reduce((t, p) => t + (p.neededPerDay ?? 0), 0)
  if (neededStudy > x.budgetMinutes * 0.9) {
    out.push({
      id: 'study-load',
      tone: 'warn',
      title: 'Your deadlines need more time than you have',
      detail: `Finishing everything on time needs about ${hours(neededStudy)} of study a day against ${hours(x.budgetMinutes)} free. Move a deadline, trim scope, or protect more hours.`,
      to: '/goals',
    })
  }

  for (const s of x.weekStudy.filter((w) => w.expected >= 30 && w.minutes < w.expected * 0.7).slice(0, 2)) {
    out.push({
      id: `target-${s.name}`,
      tone: 'info',
      title: `${s.name} is under its weekly target`,
      detail: `${hours(s.minutes)} so far this week; about ${hours(s.expected)} would be on track for ${hours(s.target)}.`,
      to: '/study',
    })
  }

  for (const g of x.goalsBehind.slice(0, 2)) {
    out.push({ id: `goal-${g.id}`, tone: 'warn', title: `“${g.title}” is behind schedule`, detail: 'Progress is below where it should be for its target date. Break the next step into a task for this week.', to: `/goals?goal=${g.id}` })
  }

  for (const h of slippingHabits(x.habits, x.checkins, x.today).slice(0, 2)) {
    out.push({
      id: `habit-${h.name}`,
      tone: 'info',
      title: `${h.name} is slipping`,
      detail: `${Math.round(h.now * 100)}% this week against ${Math.round(h.before * 100)}% before. Try a smaller version or a fixed time.`,
      to: '/habits',
    })
  }

  const focus = bestFocusWindow(x.sessions, x.tz)
  if (focus && focus.share >= 0.25) {
    out.push({
      id: 'focus',
      tone: 'info',
      title: `You study best around ${hourLabel(focus.start)}–${hourLabel((focus.start + 2) % 24)}`,
      detail: `${Math.round(focus.share * 100)}% of your study time starts in that window. Put the hardest subject there.`,
      to: '/calendar?view=day',
    })
  }

  const pattern = weekdayPattern(x.tasks, x.today, x.tz)
  if (pattern) {
    out.push({ id: 'weekday', tone: 'info', title: `${pattern.worst}s are your slowest day`, detail: `You finish the most on ${pattern.best}s. Keep ${pattern.worst}s light, or plan only one key task for them.` })
  }

  const bias = estimateBias(x.tasks)
  if (bias && bias >= 1.3) {
    out.push({ id: 'estimates', tone: 'info', title: `Tasks take about ${Math.round((bias - 1) * 100)}% longer than you estimate`, detail: 'Pad new estimates by that much so your days stop overflowing.' })
  }

  if (x.studyThisWeek > 0 && x.studyLastWeek > 0 && x.studyThisWeek >= x.studyLastWeek * 1.2) {
    out.push({ id: 'study-up', tone: 'good', title: 'More study than last week', detail: `${hours(x.studyThisWeek)} so far against ${hours(x.studyLastWeek)} in all of last week.` })
  }
  const ahead = x.plan.filter((p) => p.status === 'ahead')
  if (ahead.length) {
    out.push({ id: 'ahead', tone: 'good', title: `Ahead of pace: ${ahead.map((p) => p.subject.name).join(', ')}`, detail: 'You could shift some time from these to subjects that are behind.' })
  }
  return out
}

export function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm'
  const n = h % 12 === 0 ? 12 : h % 12
  return `${n}${suffix}`
}

// ---------------------------------------------------------------------------
// "Copy for Claude" summary
// ---------------------------------------------------------------------------

export function coachSummary(x: {
  today: DateKey
  budgetMinutes: number
  suggestions: ReturnType<typeof suggestToday>
  plan: StudyPlanRow[]
  insights: Insight[]
  goals: { title: string; target: DateKey | null; progress: string }[]
  habits: { name: string; rate: number }[]
  studyThisWeek: number
}): string {
  const h = (m: number) => formatMinutes(Math.round(m)) || '0m'
  const lines: string[] = []
  lines.push(`I use a personal planner app. Here is my current data (today is ${formatKey(x.today, 'EEEE d MMM yyyy')}; I have about ${h(x.budgetMinutes)} free a day).`)
  lines.push('Please suggest a realistic plan for today and this week, what to drop or move, and how to balance my study subjects against their deadlines.')
  lines.push('', '## Active goals')
  for (const g of x.goals) lines.push(`- ${g.title}${g.target ? ` (target ${formatKey(g.target, 'd MMM yyyy')})` : ''}: ${g.progress}`)
  if (!x.goals.length) lines.push('- none')
  lines.push('', '## Study subjects')
  for (const p of x.plan) {
    const parts = [`${p.topicsLeft}/${p.topicsTotal} topics left`, `recent ${h(p.recentPerDay)}/day`]
    if (p.deadline) parts.push(`deadline ${formatKey(p.deadline, 'd MMM yyyy')}`)
    if (p.neededPerDay) parts.push(`needs ~${h(p.neededPerDay)}/day`)
    lines.push(`- ${p.subject.name}: ${parts.join(', ')} [${p.status.replace('_', ' ')}]`)
  }
  if (!x.plan.length) lines.push('- none')
  lines.push(`- Total study this week: ${h(x.studyThisWeek)}`)
  lines.push('', "## Today's candidate tasks (highest priority first)")
  for (const s of [...x.suggestions.picks, ...x.suggestions.extra]) {
    const time = s.kind === 'task' && !s.estimated ? `no estimate, assumed ${h(s.minutes)}` : h(s.minutes)
    lines.push(`- ${suggestionTitle(s)} (${time}; ${s.reasons.join(', ') || 'no date'})`)
  }
  if (!x.suggestions.picks.length) lines.push('- none')
  lines.push('', '## Habits (last 7 days)')
  for (const r of x.habits) lines.push(`- ${r.name}: ${Math.round(r.rate * 100)}%`)
  if (!x.habits.length) lines.push('- none')
  if (x.insights.length) {
    lines.push('', '## Patterns the app noticed')
    for (const i of x.insights) lines.push(`- ${i.title}. ${i.detail}`)
  }
  return lines.join('\n')
}
