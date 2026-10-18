import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Bot, CalendarCheck, Check, Copy, Lightbulb, Sparkles, ThumbsUp, Wand2, X } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { getStore } from '@/lib/db'
import { gte, isNull } from '@/lib/db/store'
import { getSupabase } from '@/lib/supabase'
import { env } from '@/lib/env'
import { addDays, dateKey, diffDays, formatKey, startOfWeek, zonedToInstant } from '@/lib/dates'
import { cn, errorMessage, formatMinutes } from '@/lib/utils'
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
import { expandBlocks, expandEvents } from '@/features/calendar/logic'
import { dayWindow, placeAll } from '@/features/planner/logic'
import { habitStats } from '@/features/habits/logic'
import { useHabitActions } from '@/features/habits/actions'
import {
  buildInsights,
  coachSummary,
  estimateBias,
  freeToday,
  roundTo5,
  studyPicks,
  studyPlan,
  suggestionKey,
  suggestionTitle,
  suggestToday,
  type Insight,
  type PlanStatus,
  type Suggestion,
} from './logic'

/** A manual "free time today" override, kept for that day only. */
const HOURS_KEY = 'lp-coach-hours'

function loadOverride(day: string): number | null {
  try {
    const raw = localStorage.getItem(`${HOURS_KEY}-${day}`)
    const v = Number(raw)
    return raw !== null && v >= 0 && v <= 16 ? v : null
  } catch {
    return null
  }
}

function saveOverride(day: string, hours: number | null) {
  try {
    if (hours === null) localStorage.removeItem(`${HOURS_KEY}-${day}`)
    else localStorage.setItem(`${HOURS_KEY}-${day}`, String(hours))
  } catch {
    /* preference only */
  }
}

/** The function's own error text when it sent one, else a plain reason. */
async function aiErrorMessage(e: unknown): Promise<string> {
  const res = (e as { context?: Response }).context
  if (res && typeof res.json === 'function') {
    try {
      const j = (await res.json()) as { error?: string; message?: string }
      if (res.status === 404) return 'The coach function is not deployed yet. See "AI coach" in the README.'
      if (j.error || j.message) return (j.error ?? j.message)!
    } catch {
      /* not JSON */
    }
  }
  return errorMessage(e)
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
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const [override, setOverride] = useState<number | null>(() => loadOverride(today))
  const [openTask, setOpenTask] = useState<TaskInstance | null>(null)
  const [planning, setPlanning] = useState(false)
  const [ai, setAi] = useState<{ loading: boolean; text: string }>({ loading: false, text: '' })
  const weekStart = startOfWeek(today, settings.week_start)

  const { tasks, occurrences, isLoading } = useTaskData()
  const goals = useList('goals', { filters: [isNull('archived_at')] })
  const projects = useList('projects')
  const milestones = useList('milestones')
  const progress = useList('goal_progress')
  const subjects = useList('subjects', { filters: [isNull('archived_at')] })
  const topics = useList('study_topics')
  const sessions = useList('study_sessions')
  const habits = useList('habits', { filters: [isNull('archived_at')], order: [{ field: 'sort_order' }] })
  const checkins = useList('habit_checkins', { filters: [gte('date', addDays(today, -28))] })
  const events = useList('events', { filters: [isNull('archived_at')] })
  const exceptions = useList('event_exceptions')
  const blocks = useList('time_blocks')
  const { bulk } = useTaskActions()
  const habitActions = useHabitActions()

  // Free time: the gaps left today between events and planner blocks, within the day hours in Settings.
  const now = new Date()
  const { dayStart, dayEnd } = dayWindow(today, settings.day_start_hour, settings.day_end_hour, tz)
  const todayBlocks = useMemo(() => {
    const from = zonedToInstant(today, '00:00', tz)
    return expandBlocks(blocks.data ?? [], from, zonedToInstant(addDays(today, 1), '00:00', tz), tz)
  }, [blocks.data, today, tz])
  const busy = useMemo(() => {
    const from = zonedToInstant(today, '00:00', tz)
    const to = zonedToInstant(addDays(today, 1), '00:00', tz)
    return [
      ...expandEvents(events.data ?? [], exceptions.data ?? [], from, to, tz).map((e) => ({ key: e.key, start: e.start, end: e.end, allDay: e.allDay })),
      ...todayBlocks.map((b) => ({ key: b.instanceKey, start: b.start, end: b.end, planned: !!b.task_id || b.title.startsWith('Study: ') })),
    ]
  }, [events.data, exceptions.data, todayBlocks, today, tz])
  // Blocks made for tasks or study are the plan itself, so they don't shrink the free time the plan is fitted into.
  const free = freeToday(busy.filter((b) => !('planned' in b && b.planned)), dayStart, dayEnd, now)
  const budget = override !== null ? Math.round(override * 60) : free.minutes

  const goalList = useMemo(() => (goals.data ?? []).filter((g) => g.status === 'active'), [goals.data])
  const instances = useMemo(() => expandTasks(tasks, occurrences, addDays(today, -90), addDays(today, 14), tz), [tasks, occurrences, today, tz])
  const plan = useMemo(
    () => studyPlan(subjects.data ?? [], topics.data ?? [], sessions.data ?? [], goals.data ?? [], today, tz),
    [subjects.data, topics.data, sessions.data, goals.data, today, tz],
  )
  const finished = (sessions.data ?? []).filter((s) => s.ended_at)
  const studiedToday = new Map<string, number>()
  for (const s of finished) if (s.subject_id && dateKey(s.started_at, tz) === today) studiedToday.set(s.subject_id, (studiedToday.get(s.subject_id) ?? 0) + (s.actual_minutes ?? 0))
  const study = studyPicks(plan, studiedToday)
  const studyKey = study.map((s) => `${s.subject.id}:${s.minutes}`).join()
  const bias = estimateBias(tasks)
  const suggestions = useMemo(
    () => suggestToday(instances, goalList, { today, tz, budgetMinutes: budget, defaultMinutes: settings.default_task_minutes, study, minutesFactor: bias ?? undefined }),
    [instances, goalList, today, tz, budget, settings.default_task_minutes, studyKey, bias], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const goalRows = useMemo(
    () =>
      goalList.map((g) => {
        const p = goalProgress(g, { tasks, projects: projects.data ?? [], milestones: milestones.data ?? [], progress: progress.data ?? [] })
        return { goal: g, p, track: onTrack(g.created_at, g.target_date, p.ratio, today) }
      }),
    [goalList, tasks, projects.data, milestones.data, progress.data, today],
  )

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

  const habitsLeft = (habits.data ?? []).filter((h) => {
    const st = habitStats(h, checkins.data ?? [], today, settings.week_start)
    return st.dueToday && !st.doneToday
  })

  const picksMinutes = suggestions.picks.reduce((t, s) => t + s.minutes, 0)
  const movable = suggestions.picks.flatMap((s) => (s.kind === 'task' && !s.instance.task.recurrence && s.instance.date !== today ? [s.instance] : []))

  const changeHours = (v: number | null) => {
    const h = v === null ? null : Math.max(0, Math.min(16, v))
    setOverride(h)
    saveOverride(today, h)
  }

  const summary = () =>
    coachSummary({
      today,
      budgetMinutes: budget,
      suggestions,
      plan,
      insights,
      goals: goalRows.map((r) => ({ title: r.goal.title, target: r.goal.target_date, progress: r.p.label })),
      habits: habitRates(habits.data ?? [], checkins.data ?? [], addDays(today, -6), today).map((r) => ({ name: r.name, rate: r.rate })),
      studyThisWeek,
    })

  const copyForClaude = async () => {
    try {
      await navigator.clipboard.writeText(summary())
      toast.success('Copied. Paste it into a chat with Claude for a deeper plan.')
    } catch {
      toast.error('Could not copy. Your browser blocked clipboard access.')
    }
  }

  const askCoach = async () => {
    const sb = getSupabase()
    if (!sb) return
    setAi({ loading: true, text: '' })
    try {
      const { data, error } = await sb.functions.invoke<{ text: string }>('coach', { body: { summary: summary() } })
      if (error) throw error
      setAi({ loading: false, text: data?.text ?? '' })
    } catch (e) {
      setAi({ loading: false, text: '' })
      toast.error(await aiErrorMessage(e))
    }
  }

  /** Put today's picks into the free gaps as planner blocks; skip what already has a time. */
  const planMyDay = async () => {
    const blockedTasks = new Set(todayBlocks.map((b) => b.task_id).filter(Boolean))
    const blockedTitles = new Set(todayBlocks.map((b) => b.title))
    const todo = suggestions.picks.filter((s) => (s.kind === 'study' ? !blockedTitles.has(suggestionTitle(s)) : !s.instance.scheduledAt && !blockedTasks.has(s.instance.task.id)))
    if (!todo.length) return toast.info('Everything on the list already has a time today.')
    const { placed, unplaced } = placeAll(freeToday(busy, dayStart, dayEnd, now).slots, todo, now)
    if (!placed.length) return toast.info('No free gap is long enough today. Lower the list or plan tomorrow.')
    setPlanning(true)
    try {
      for (const p of placed) {
        await getStore().insert('time_blocks', {
          title: suggestionTitle(p),
          start_at: p.start.toISOString(),
          end_at: p.end.toISOString(),
          task_id: p.kind === 'task' ? p.instance.task.id : null,
          task_occurrence_date: p.kind === 'task' ? p.instance.occurrenceDate : null,
          category_id: p.kind === 'task' ? p.instance.task.category_id : null,
          color: p.kind === 'study' ? p.subject.color : null,
          status: 'planned',
          notes: '',
          recurrence: null,
        })
      }
      toast.success(`Planned ${placed.length} item${placed.length === 1 ? '' : 's'} into today${unplaced.length ? `; ${unplaced.length} didn't fit` : ''}.`, {
        label: 'Open planner',
        onClick: () => navigate(`/planner?date=${today}`),
      })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setPlanning(false)
      invalidate('time_blocks')
    }
  }

  const openPick = (s: Suggestion) => (s.kind === 'task' ? setOpenTask(s.instance) : navigate(linkTo.subject(s.subject.id)))

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Coach"
        subtitle="Suggestions worked out from your own tasks, study and habits."
        actions={
          <div className="flex flex-wrap gap-2">
            {env.mode === 'supabase' && (
              <Button onClick={() => void askCoach()} disabled={ai.loading}>
                <Bot className="h-4 w-4" /> {ai.loading ? 'Thinking…' : 'Ask the coach'}
              </Button>
            )}
            <Button variant="outline" onClick={() => void copyForClaude()}>
              <Copy className="h-4 w-4" /> Copy for Claude
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="coach-hours" className="text-muted">
          Free time today
        </label>
        <input
          id="coach-hours"
          type="number"
          min={0}
          max={16}
          step={0.5}
          value={Math.round((budget / 60) * 10) / 10}
          onChange={(e) => changeHours(Number(e.target.value) || 0)}
          className="h-9 w-20 rounded-lg border border-line bg-surface px-2 tabular"
        />
        <span className="text-muted">hours</span>
        {override === null ? (
          <span className="text-xs text-subtle">from your calendar and planner</span>
        ) : (
          <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => changeHours(null)}>
            Use my calendar ({formatMinutes(free.minutes) || '0m'})
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(ai.loading || ai.text) && (
          <Panel
            className="lg:col-span-2"
            title={
              <span className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-accent" aria-hidden /> The coach's plan
              </span>
            }
            action={
              !ai.loading && (
                <button type="button" aria-label="Close" className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface-2" onClick={() => setAi({ loading: false, text: '' })}>
                  <X className="h-4 w-4" />
                </button>
              )
            }
          >
            {ai.loading ? <p className="text-sm text-muted">Reading your week…</p> : <p className="whitespace-pre-wrap text-sm leading-relaxed">{ai.text}</p>}
            <p className="mt-3 text-xs text-subtle">Written by a free AI model on Groq from the same summary as Copy for Claude. Check it before acting on it.</p>
          </Panel>
        )}

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Ideal plan for today
            </span>
          }
          action={suggestions.picks.length > 0 && <span className="text-xs text-muted">{formatMinutes(picksMinutes)} of {formatMinutes(budget) || '0m'}</span>}
        >
          {isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : suggestions.picks.length === 0 ? (
            <EmptyState title="Nothing pressing">Add tasks, or give a subject an exam date or weekly target, and the coach will plan your day here.</EmptyState>
          ) : (
            <>
              {suggestions.picks.every((s) => s.kind === 'task' && s.backlog) && <p className="mb-2 text-xs text-muted">Nothing is due, so here is the oldest work in your backlog.</p>}
              <ol className="flex flex-col">
                {suggestions.picks.map((s, n) => (
                  <li key={suggestionKey(s)} className="flex gap-3 border-b border-line py-2 last:border-0">
                    <span className="mt-0.5 w-4 shrink-0 text-xs font-semibold text-subtle tabular">{n + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <button type="button" onClick={() => openPick(s)} className="truncate text-left text-sm font-medium hover:underline">
                          {suggestionTitle(s)}
                        </button>
                        <span className="shrink-0 text-xs text-muted tabular">{formatMinutes(s.minutes)}</span>
                      </div>
                      {s.reasons.length > 0 && <p className="text-xs text-muted">{s.reasons.join(' · ')}</p>}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={() => void planMyDay()} disabled={planning}>
                  <Wand2 className="h-4 w-4" /> {planning ? 'Planning…' : 'Plan my day'}
                </Button>
                {movable.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => void bulk(movable, 'today', today)}>
                    <CalendarCheck className="h-4 w-4" /> Move {movable.length === 1 ? 'it' : `these ${movable.length}`} to today
                  </Button>
                )}
                <Link to={`/planner?date=${today}`} className="text-sm font-medium text-accent hover:underline">
                  Open planner
                </Link>
              </div>
              {suggestions.extra.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted">If you have extra time ({suggestions.extra.length})</summary>
                  <ul className="mt-1">
                    {suggestions.extra.map((s) => (
                      <li key={suggestionKey(s)} className="flex justify-between gap-2 py-1">
                        <button type="button" onClick={() => openPick(s)} className="truncate text-left hover:underline">
                          {suggestionTitle(s)}
                        </button>
                        <span className="shrink-0 text-xs text-muted">{s.reasons[0] ?? formatMinutes(s.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          {habitsLeft.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-subtle">Habits left today</p>
              <ul className="flex flex-wrap gap-2">
                {habitsLeft.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => void habitActions.toggle(h, today, undefined)}
                      className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm hover:bg-surface-2"
                      title="Mark done for today"
                    >
                      <Check className="h-3.5 w-3.5 text-subtle" aria-hidden /> {h.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
              Add subjects with topics and an exam date (for example your FAT exam or the ML course deadline).
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
                        <span className="tabular">{formatMinutes(Math.round(p.recentPerDay)) || '0m'}/day</span>
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
        The plan and warnings are worked out in the app. "Ask the coach" sends a summary of your data to a free AI model (Groq) for a written plan; "Copy for Claude" lets you paste it into a chat yourself.
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
