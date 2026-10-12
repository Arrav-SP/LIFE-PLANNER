import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Trophy, AlertTriangle } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { gte, isNull } from '@/lib/db/store'
import { getStore } from '@/lib/db'
import { addDays, dateKey, formatKey, startOfWeek, zonedToInstant } from '@/lib/dates'
import { errorMessage, formatMinutes, plural } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'
import { PageHeader, Panel, ProgressBar, Stat } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import { useTaskData } from '@/features/tasks/useTaskData'
import { expandTasks, type TaskInstance } from '@/features/tasks/logic'
import { TaskEditor } from '@/features/tasks/TaskEditor'
import { linkTo } from '@/lib/links'
import { habitRates, studyBySubject } from './logic'

const PROMPTS = [
  { key: 'wins', label: 'What went well?' },
  { key: 'misses', label: 'What got in the way?' },
  { key: 'next', label: 'Top 3 priorities for next week' },
] as const
type Answers = Record<(typeof PROMPTS)[number]['key'], string>

/** Reviews are stored as notes tagged "weekly-review" so they sync and export like any note. */
const reviewTitle = (weekStart: string) => `Weekly review · week of ${weekStart}`

export function WeeklyReviewPage() {
  const { today, tz, settings } = useSettings()
  const thisWeek = startOfWeek(today, settings.week_start)
  // Default to last week until the weekend, then the current week.
  const defaultWeek = addDays(thisWeek, ['Sat', 'Sun'].includes(formatKey(today, 'EEE')) ? 0 : -7)
  // Deep link: /review?week=<week start> opens that week (used by saved reviews in Inbox & notes).
  const [params] = useSearchParams()
  const linkedWeek = params.get('week')
  const [week, setWeek] = useState(() => (linkedWeek && /^\d{4}-\d{2}-\d{2}$/.test(linkedWeek) ? linkedWeek : defaultWeek))
  useEffect(() => {
    if (linkedWeek && /^\d{4}-\d{2}-\d{2}$/.test(linkedWeek)) setWeek(linkedWeek)
  }, [linkedWeek])
  const [openTask, setOpenTask] = useState<TaskInstance | null>(null)
  const end = addDays(week, 6)
  const since = zonedToInstant(week, '00:00', tz).toISOString()

  const { tasks, occurrences } = useTaskData(true)
  const sessions = useList('study_sessions', { filters: [gte('started_at', since)] })
  const subjects = useList('subjects', { filters: [isNull('archived_at')] })
  const habits = useList('habits', { filters: [isNull('archived_at')] })
  const checkins = useList('habit_checkins', { filters: [gte('date', week)] })
  const workouts = useList('workouts', { filters: [gte('started_at', since)] })
  const notes = useList('notes')
  const invalidate = useInvalidate()

  const inWeek = (iso: string | null) => !!iso && dateKey(iso, tz) >= week && dateKey(iso, tz) <= end
  const instances = useMemo(() => expandTasks(tasks.filter((t) => !t.parent_id), occurrences, week, end, tz), [tasks, occurrences, week, end, tz])
  const completed = instances.filter((i) => i.done && (i.completedAt ? inWeek(i.completedAt) : true))
  const missed = instances.filter((i) => !i.done && !i.skipped && i.date && i.date <= end && i.date < today)
  const studyMins = (sessions.data ?? []).filter((s) => s.ended_at && inWeek(s.started_at)).reduce((t, s) => t + (s.actual_minutes ?? 0), 0)
  const bySubject = studyBySubject(sessions.data ?? [], subjects.data ?? [], week, end, tz)
  const rates = habitRates(habits.data ?? [], checkins.data ?? [], week, end < today ? end : today)
  const workoutCount = (workouts.data ?? []).filter((w) => inWeek(w.started_at)).length

  const existing = (notes.data ?? []).find((n) => n.tags.includes('weekly-review') && n.title === reviewTitle(week))
  const [answers, setAnswers] = useState<Answers>({ wins: '', misses: '', next: '' })
  useEffect(() => {
    if (existing) {
      try {
        setAnswers({ wins: '', misses: '', next: '', ...(JSON.parse(existing.content) as Partial<Answers>) })
        return
      } catch {
        /* older free-text review */
      }
    }
    setAnswers({ wins: '', misses: '', next: '' })
  }, [existing?.id, week]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try {
      const content = JSON.stringify(answers)
      if (existing) await getStore().update('notes', existing.id, { content })
      else await getStore().insert('notes', { kind: 'other', title: reviewTitle(week), content, tags: ['weekly-review'], status: 'processed', pinned: false })
      invalidate('notes')
      toast.success('Review saved')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Weekly review"
        subtitle={`${formatKey(week, 'd MMM')} – ${formatKey(end, 'd MMM yyyy')}`}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeek(defaultWeek)}>
              Latest
            </Button>
            <Button variant="outline" size="icon" aria-label="Next week" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tasks done" value={completed.length} />
        <Stat label="Missed" value={missed.length} />
        <Stat label="Study" value={formatMinutes(studyMins) || '0m'} />
        <Stat label="Workouts" value={workoutCount} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-warning" aria-hidden /> Completed
            </span>
          }
        >
          {completed.length === 0 ? (
            <p className="text-sm text-muted">Nothing completed this week.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto text-sm">
              {completed.map((i) => (
                <li key={i.key} className="border-b border-line py-1.5 last:border-0">
                  <button type="button" onClick={() => setOpenTask(i)} className="block w-full truncate text-left hover:underline">
                    {i.task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-danger" aria-hidden /> Still open from this week
            </span>
          }
          action={
            missed.length > 0 && (
              <Link to="/tasks?view=overdue" className="text-xs font-medium text-accent hover:underline">
                Reschedule
              </Link>
            )
          }
        >
          {missed.length === 0 ? (
            <p className="text-sm text-muted">Nothing left behind. Nice.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto text-sm">
              {missed.map((i) => (
                <li key={i.key} className="flex justify-between gap-2 border-b border-line py-1.5 last:border-0">
                  <button type="button" onClick={() => setOpenTask(i)} className="truncate text-left hover:underline">
                    {i.task.title}
                  </button>
                  <span className="shrink-0 text-xs text-muted">{formatKey(i.date!, 'EEE')}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Study against targets">
          {(subjects.data ?? []).length === 0 && bySubject.length === 0 ? (
            <p className="text-sm text-muted">No subjects yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(subjects.data ?? []).map((s) => {
                const mins = bySubject.find((b) => b.id === s.id)?.minutes ?? 0
                return (
                  <li key={s.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <Link to={linkTo.subject(s.id)} className="truncate hover:underline">
                        {s.name}
                      </Link>
                      <span className="text-xs text-muted">
                        {formatMinutes(mins) || '0m'}
                        {s.weekly_target_minutes ? ` / ${formatMinutes(s.weekly_target_minutes)}` : ''}
                      </span>
                    </div>
                    {s.weekly_target_minutes ? <ProgressBar value={mins / s.weekly_target_minutes} color={s.color} label={`${s.name} target`} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Habits">
          {rates.length === 0 ? (
            <p className="text-sm text-muted">No habits yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rates.map((r) => (
                <li key={r.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <Link to={linkTo.habit(r.id)} className="truncate hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-xs text-muted">
                      {r.done} of {plural(r.due, 'time')}
                    </span>
                  </div>
                  <ProgressBar value={r.rate} color={r.color} label={`${r.name} this week`} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Reflect" className="lg:col-span-2">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            {PROMPTS.map((p) => (
              <Field key={p.key} label={p.label} htmlFor={`wr-${p.key}`}>
                <Textarea id={`wr-${p.key}`} rows={3} value={answers[p.key]} onChange={(e) => setAnswers({ ...answers, [p.key]: e.target.value })} />
              </Field>
            ))}
            <div className="flex items-center gap-3">
              <Button type="submit">Save review</Button>
              <Link to={`/planner?mode=week&date=${addDays(week, 7)}`} className="text-sm font-medium text-accent hover:underline">
                Plan next week
              </Link>
            </div>
          </form>
        </Panel>
      </div>
      <TaskEditor open={!!openTask} task={openTask?.task} onClose={() => setOpenTask(null)} />
    </div>
  )
}
