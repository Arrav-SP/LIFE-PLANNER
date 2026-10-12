import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarCheck, Copy, Lightbulb, Sparkles, ThumbsUp } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useList } from '@/lib/db/hooks'
import { gte, isNull } from '@/lib/db/store'
import { addDays, dateKey, diffDays, formatKey, startOfWeek, zonedToInstant } from '@/lib/dates'
import { cn, formatMinutes } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Badge, EmptyState, PageHeader, Panel, ProgressBar } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import { useTaskData } from '@/features/tasks/useTaskData'
import { useTaskActions } from '@/features/tasks/actions'
import { expandTasks, type TaskInstance } from '@/features/tasks/logic'
import { TaskEditor } from '@/features/tasks/TaskEditor'
import { linkTo } from '@/lib/links'
import { goalProgress, onTrack } from '@/features/goals/logic'
import { habitRates } from '@/features/analytics/logic'
import { buildInsights, coachSummary, roundTo5, studyPlan, suggestToday, type Insight, type PlanStatus } from './logic'

const HOURS_KEY = 'lp-coach-hours'

function loadHours(): number {
  try {
    const v = Number(localStorage.getItem(HOURS_KEY))
    return v > 0 && v <= 16 ? v : 5
  } catch {
    return 5
  }
}

const STATUS: Record<PlanStatus, { label: string; color?: string }> = {
  overdue: { label: 'Past deadline', color: '#dc2626' },
  behind: { label: 'Behind', color: '#dc2626' },
  unknown: { label: 'Needs data' },
  on_track: { label: 'On track', color: '#0f766e' },
  ahead: { label: 'Ahead', color: '#2563eb' },
  no_deadline: { label: 'No deadline' },
  done: { label: 'Done', color: '#0f766e' },
}

const TONE_ICON = { warn: AlertTriangle, info: Lightbulb, good: ThumbsUp } as const
const TONE_CLASS = { warn: 'text-danger', info: 'text-accent', good: 'text-success' } as const

export function CoachPage() {
  const { today, tz, settings } = useSettings()
  const [hours, setHours] = useState(loadHours)
  const [openTask, setOpenTask] = useState<TaskInstance | null>(null)
  const budget = Math.round(hours * 60)
  const weekStart = startOfWeek(today, settings.week_start)

  const { tasks, occurrences, isLoading } = useTaskData()
  const goals = useList('goals', { filters: [isNull('archived_at')] })
  const projects = useList('projects')
  const milestones = useList('milestones')
  const progress = useList('goal_progress')
  const subjects = useList('subjects', { filters: [isNull('archived_at')] })
  const topics = useList('study_topics')
  const sessions = useList('study_sessions')
  const habits = useList('habits', { filters: [isNull('archived_at')] })
  const checkins = useList('habit_checkins', { filters: [gte('date', addDays(today, -28))] })
  const { bulk } = useTaskActions()

  const goalList = useMemo(() => (goals.data ?? []).filter((g) => g.status === 'active'), [goals.data])
  const instances = useMemo(() => expandTasks(tasks, occurrences, addDays(today, -90), addDays(today, 14), tz), [tasks, occurrences, today, tz])
  const suggestions = useMemo(
    () => suggestToday(instances, goalList, { today, tz, budgetMinutes: budget, defaultMinutes: settings.default_task_minutes }),
    [instances, goalList, today, tz, budget, settings.default_task_minutes],
  )
  const plan = useMemo(
    () => studyPlan(subjects.data ?? [], topics.data ?? [], sessions.data ?? [], goals.data ?? [], today, tz),
    [subjects.data, topics.data, sessions.data, goals.data, today, tz],
  )

  const goalRows = useMemo(
    () =>
      goalList.map((g) => {
        const p = goalProgress(g, { tasks, projects: projects.data ?? [], milestones: milestones.data ?? [], progress: progress.data ?? [] })
        return { goal: g, p, track: onTrack(g.created_at, g.target_date, p.ratio, today) }
      }),
    [goalList, tasks, projects.data, milestones.data, progress.data, today],
  )

  const finished = (sessions.data ?? []).filter((s) => s.ended_at)
  const minutesBetween = (from: string, to: string, subjectId?: string) =>
    finished.filter((s) => (!subjectId || s.subject_id === subjectId) && dateKey(s.started_at, tz) >= from && dateKey(s.started_at, tz) <= to).reduce((t, s) => t + (s.actual_minutes ?? 0), 0)
  const studyThisWeek = minutesBetween(weekStart, today)
  const studyLastWeek = minutesBetween(addDays(weekStart, -7), addDays(weekStart, -1))
  const elapsed = diffDays(today, weekStart) + 1
  const weekStudy = (subjects.data ?? [])
    .filter((s) => s.weekly_target_minutes)
    .map((s) => ({ name: s.name, minutes: minutesBetween(weekStart, today, s.id), target: s.weekly_target_minutes!, expected: (s.weekly_target_minutes! * elapsed) / 7 }))

  const insights = buildInsights({
    today,
    tz,
    budgetMinutes: budget,
    suggestions,
    overdueCount: instances.filter((i) => !i.done && !i.skipped && !i.task.recurrence && !i.task.parent_id && i.date && i.date < today).length,
    plan,
    sessions: finished.filter((s) => s.started_at >= zonedToInstant(addDays(today, -60), '00:00', tz).toISOString()),
    tasks,
    habits: habits.data ?? [],
    checkins: checkins.data ?? [],
    goalsBehind: goalRows.filter((r) => r.track === 'behind').map((r) => ({ id: r.goal.id, title: r.goal.title })),
    weekStudy,
    studyThisWeek,
    studyLastWeek,
  })

  const picksMinutes = suggestions.picks.reduce((t, s) => t + s.minutes, 0)
  const movable = suggestions.picks.filter((s) => !s.instance.task.recurrence && s.instance.date !== today)

  const changeHours = (v: number) => {
    const h = Math.max(0.5, Math.min(16, v))
    setHours(h)
    try {
      localStorage.setItem(HOURS_KEY, String(h))
    } catch {
      /* preference only */
    }
  }

  const copyForClaude = async () => {
    const text = coachSummary({
      today,
      budgetMinutes: budget,
      suggestions,
      plan,
      insights,
      goals: goalRows.map((r) => ({ title: r.goal.title, target: r.goal.target_date, progress: r.p.label })),
      habits: habitRates(habits.data ?? [], checkins.data ?? [], addDays(today, -6), today).map((r) => ({ name: r.name, rate: r.rate })),
      studyThisWeek,
    })
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied. Paste it into a chat with Claude for a deeper plan.')
    } catch {
      toast.error('Could not copy. Your browser blocked clipboard access.')
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Coach"
        subtitle="Suggestions worked out from your own tasks, study and habits."
        actions={
          <Button variant="outline" onClick={() => void copyForClaude()}>
            <Copy className="h-4 w-4" /> Copy for Claude
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="coach-hours" className="text-muted">
          Free time today
        </label>
        <input
          id="coach-hours"
          type="number"
          min={0.5}
          max={16}
          step={0.5}
          value={hours}
          onChange={(e) => changeHours(Number(e.target.value) || 0.5)}
          className="h-9 w-20 rounded-lg border border-line bg-surface px-2 tabular"
        />
        <span className="text-muted">hours</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Ideal tasks for today
            </span>
          }
          action={suggestions.picks.length > 0 && <span className="text-xs text-muted">{formatMinutes(picksMinutes)} of {formatMinutes(budget)}</span>}
        >
          {isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : suggestions.picks.length === 0 ? (
            <EmptyState title="Nothing pressing">Add tasks with due dates, priorities or goals and the coach will rank them here.</EmptyState>
          ) : (
            <>
              <ol className="flex flex-col">
                {suggestions.picks.map((s, n) => (
                  <li key={s.instance.key} className="flex gap-3 border-b border-line py-2 last:border-0">
                    <span className="mt-0.5 w-4 shrink-0 text-xs font-semibold text-subtle tabular">{n + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <button type="button" onClick={() => setOpenTask(s.instance)} className="truncate text-left text-sm font-medium hover:underline">
                          {s.instance.task.title}
                        </button>
                        <span className="shrink-0 text-xs text-muted tabular">{formatMinutes(s.minutes)}</span>
                      </div>
                      {s.reasons.length > 0 && <p className="text-xs text-muted">{s.reasons.join(' · ')}</p>}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {movable.length > 0 && (
                  <Button size="sm" onClick={() => void bulk(movable.map((s) => s.instance), 'today', today)}>
                    <CalendarCheck className="h-4 w-4" /> Move {movable.length === 1 ? 'it' : `these ${movable.length}`} to today
                  </Button>
                )}
                <Link to={`/planner?date=${today}`} className="text-sm font-medium text-accent hover:underline">
                  Plan the day
                </Link>
              </div>
              {suggestions.extra.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted">If you have extra time ({suggestions.extra.length})</summary>
                  <ul className="mt-1">
                    {suggestions.extra.map((s) => (
                      <li key={s.instance.key} className="flex justify-between gap-2 py-1">
                        <button type="button" onClick={() => setOpenTask(s.instance)} className="truncate text-left hover:underline">
                          {s.instance.task.title}
                        </button>
                        <span className="shrink-0 text-xs text-muted">{s.reasons[0] ?? formatMinutes(s.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </Panel>

        <Panel title="What to change">
          {insights.length === 0 ? (
            <p className="text-sm text-muted">No warnings right now. As you log tasks, study and habits, patterns will show up here.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {insights.map((i) => (
                <InsightRow key={i.id} insight={i} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Study plan" className="lg:col-span-2" action={<span className="text-xs text-muted">Pace from the last 14 days</span>}>
          {plan.length === 0 ? (
            <EmptyState title="No subjects yet" action={<Link to="/study" className="text-sm font-medium text-accent hover:underline">Add a subject</Link>}>
              Add subjects with topics, and link each to a goal with a target date (for example your FAT exam or the ML course deadline).
            </EmptyState>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {plan.map((p) => {
                const st = STATUS[p.status]
                return (
                  <li key={p.subject.id} className="rounded-xl border border-line p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <Link to={linkTo.subject(p.subject.id)} className="truncate font-medium hover:underline">
                        {p.subject.name}
                      </Link>
                      <Badge color={st.color}>{st.label}</Badge>
                    </div>
                    <p className="mb-2 text-xs text-muted">
                      {p.topicsTotal > 0 ? `${p.topicsTotal - p.topicsLeft}/${p.topicsTotal} topics` : 'No topics'}
                      {p.deadline && ` · ${p.goalTitle} by ${formatKey(p.deadline, 'd MMM')}${p.daysLeft !== null && p.daysLeft > 0 ? ` (${p.daysLeft} days)` : ''}`}
                    </p>
                    {p.topicsTotal > 0 && <ProgressBar value={(p.topicsTotal - p.topicsLeft) / p.topicsTotal} color={p.subject.color} label={`${p.subject.name} topics done`} className="mb-2" />}
                    <div className="mb-1 flex gap-4 text-xs">
                      <span>
                        <span className="text-muted">Lately </span>
                        <span className="tabular">{formatMinutes(Math.round(p.recentPerDay))}/day</span>
                      </span>
                      {p.neededPerDay ? (
                        <span>
                          <span className="text-muted">Suggested </span>
                          <span className={cn('font-medium tabular', p.status === 'behind' && 'text-danger')}>{formatMinutes(roundTo5(p.neededPerDay))}/day</span>
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted">{p.note}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
      <TaskEditor open={!!openTask} task={openTask?.task} onClose={() => setOpenTask(null)} />
      <p className="mt-4 text-xs text-subtle">
        The coach runs entirely in the app, with no AI service. For a deeper plan, use Copy for Claude and paste the result into a chat.
      </p>
    </div>
  )
}

function InsightRow({ insight: i }: { insight: Insight }) {
  const Icon = TONE_ICON[i.tone]
  const body = (
    <>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_CLASS[i.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{i.title}</p>
        <p className="text-xs text-muted">{i.detail}</p>
      </div>
      {i.to && <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />}
    </>
  )
  return <li>{i.to ? <Link to={i.to} className="-m-1.5 flex gap-3 rounded-lg p-1.5 hover:bg-surface-2">{body}</Link> : <div className="flex gap-3">{body}</div>}</li>
}
