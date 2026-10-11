import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarDays, CheckCircle2, Clock, Flame, Inbox, Plus, Settings2, Target, Sparkles } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useList } from '@/lib/db/hooks'
import { gte, isNull, lte } from '@/lib/db/store'
import { addDays, formatKey, formatTime, greeting, relativeDay, zonedToInstant } from '@/lib/dates'
import { cn, formatMinutes, plural } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Field'
import { Badge, ColorDot, EmptyState, ListSkeleton, Panel, ProgressBar } from '@/components/ui/misc'
import { Dialog } from '@/components/ui/Dialog'
import { useTaskData } from '@/features/tasks/useTaskData'
import { expandTasks, overdue, sortInstances, viewInstances, type TaskInstance } from '@/features/tasks/logic'
import { TaskItem } from '@/features/tasks/TaskItem'
import { TaskEditor } from '@/features/tasks/TaskEditor'
import { QuickAddDialog } from '@/features/tasks/QuickAdd'
import { expandBlocks, expandEvents } from '@/features/calendar/logic'
import { checkinMap, habitStats } from '@/features/habits/logic'
import { useHabitActions } from '@/features/habits/actions'
import { goalProgress, onTrack } from '@/features/goals/logic'

export const DASHBOARD_SECTIONS = [
  { id: 'today', label: "Today's tasks" },
  { id: 'schedule', label: 'Schedule' },
  { id: 'habits', label: 'Habits' },
  { id: 'upcoming', label: 'Upcoming deadlines' },
  { id: 'goals', label: 'Goal progress' },
  { id: 'inbox', label: 'Unscheduled tasks' },
] as const
type SectionId = (typeof DASHBOARD_SECTIONS)[number]['id']

export function DashboardPage() {
  const { settings, tz, today, update } = useSettings()
  const { tasks, occurrences, isLoading } = useTaskData()
  const [openTask, setOpenTask] = useState<TaskInstance | null>(null)
  const [quick, setQuick] = useState(false)
  const [customize, setCustomize] = useState(false)

  const dayStart = useMemo(() => zonedToInstant(today, '00:00', tz), [today, tz])
  const dayEnd = useMemo(() => zonedToInstant(addDays(today, 1), '00:00', tz), [today, tz])

  const events = useList('events', { filters: [isNull('archived_at')] })
  const exceptions = useList('event_exceptions')
  const blocks = useList('time_blocks', { filters: [lte('start_at', dayEnd.toISOString())] })
  const habits = useList('habits', { filters: [isNull('archived_at')], order: [{ field: 'sort_order' }, { field: 'created_at' }] })
  const checkins = useList('habit_checkins', { filters: [gte('date', addDays(today, -400))] })
  const goals = useList('goals', { filters: [isNull('archived_at')] })
  const projects = useList('projects', { filters: [isNull('archived_at')] })
  const milestones = useList('milestones')
  const progress = useList('goal_progress')

  const todayTasks = useMemo(() => viewInstances('today', tasks, occurrences, today, tz), [tasks, occurrences, today, tz])
  const late = useMemo(() => overdue(tasks, occurrences, today, tz), [tasks, occurrences, today, tz])
  const dueToday = todayTasks.filter((i) => i.date === today)
  const doneToday = dueToday.filter((i) => i.done).length
  const upcoming = useMemo(
    () => sortInstances(expandTasks(tasks, occurrences, addDays(today, 1), addDays(today, 7), tz).filter((i) => !i.done && (i.task.deadline || i.task.priority === 'urgent' || i.task.priority === 'high'))).slice(0, 6),
    [tasks, occurrences, today, tz],
  )
  const unscheduled = useMemo(() => viewInstances('inbox', tasks, occurrences, today, tz).slice(0, 6), [tasks, occurrences, today, tz])

  const schedule = useMemo(() => {
    const ev = expandEvents(events.data ?? [], exceptions.data ?? [], dayStart, dayEnd, tz).map((e) => ({ key: e.key, title: e.title, start: e.start, end: e.end, allDay: e.allDay, color: e.color, kind: 'event' as const, done: false }))
    const bl = expandBlocks(blocks.data ?? [], dayStart, dayEnd, tz).map((b) => ({ key: b.instanceKey, title: b.title, start: b.start, end: b.end, allDay: false, color: b.color, kind: 'block' as const, done: b.status === 'done' }))
    const timedTasks = todayTasks
      .filter((i) => i.scheduledAt && i.date === today)
      .map((i) => {
        const start = new Date(i.scheduledAt!)
        return { key: i.key, title: i.task.title, start, end: new Date(start.getTime() + (i.task.estimated_minutes || settings.default_task_minutes) * 60000), allDay: false, color: null, kind: 'task' as const, done: i.done }
      })
    return [...ev, ...bl, ...timedTasks].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
  }, [events.data, exceptions.data, blocks.data, todayTasks, dayStart, dayEnd, tz, today, settings.default_task_minutes])

  const now = new Date()
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now))
  const plannedMinutes = todayTasks.filter((i) => !i.done && i.date === today).reduce((s, i) => s + (i.task.estimated_minutes ?? 0), 0)

  const order: SectionId[] = (settings.dashboard.order as SectionId[] | undefined)?.filter((id) => DASHBOARD_SECTIONS.some((s) => s.id === id)) ?? DASHBOARD_SECTIONS.map((s) => s.id)
  for (const s of DASHBOARD_SECTIONS) if (!order.includes(s.id)) order.push(s.id)
  const hidden = new Set(settings.dashboard.hidden ?? [])

  const sections: Record<SectionId, JSX.Element> = {
    today: (
      <Panel
        title={
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-accent" aria-hidden /> Today
          </span>
        }
        action={
          <Link to="/tasks?view=today" className="text-xs font-medium text-accent hover:underline">
            Open
          </Link>
        }
        bodyClassName="p-2"
      >
        {isLoading ? (
          <div className="p-2">
            <ListSkeleton rows={3} />
          </div>
        ) : late.length + todayTasks.length === 0 ? (
          <EmptyState icon={Sparkles} title="Nothing due today" action={<Button size="sm" onClick={() => setQuick(true)}>Add a task</Button>}>
            Plan something, or enjoy the free time.
          </EmptyState>
        ) : (
          <>
            {late.length > 0 && (
              <div className="mb-1">
                <p className="flex items-center gap-1.5 px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Overdue · {late.length}
                </p>
                <ul>
                  {late.slice(0, 5).map((i) => (
                    <TaskItem key={i.key} item={i} onOpen={setOpenTask} />
                  ))}
                </ul>
                {late.length > 5 && (
                  <Link to="/tasks?view=overdue" className="block px-2 py-1 text-xs text-muted hover:text-fg">
                    {late.length - 5} more overdue
                  </Link>
                )}
              </div>
            )}
            <ul>
              {todayTasks
                .filter((i) => !late.some((l) => l.key === i.key))
                .map((i) => (
                  <TaskItem key={i.key} item={i} onOpen={setOpenTask} showDate={i.date !== today} />
                ))}
            </ul>
          </>
        )}
      </Panel>
    ),
    schedule: (
      <Panel
        title={
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-accent" aria-hidden /> Schedule
          </span>
        }
        action={
          <Link to="/planner" className="text-xs font-medium text-accent hover:underline">
            Plan day
          </Link>
        }
      >
        {schedule.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No events or time blocks today.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {schedule.map((s) => {
              const current = !s.allDay && s.start <= now && s.end > now
              return (
                <li key={s.key} className={cn('flex items-start gap-3 rounded-lg px-2 py-1.5', current && 'bg-accent-soft/60')}>
                  <span className="w-[4.5rem] shrink-0 pt-0.5 text-xs tabular text-muted">{s.allDay ? 'All day' : formatTime(s.start, tz, settings.time_format)}</span>
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: s.color ?? (s.kind === 'task' ? 'rgb(var(--accent))' : s.kind === 'block' ? 'rgb(var(--warning))' : 'rgb(var(--muted))') }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', s.done && 'text-muted line-through')}>{s.title}</span>
                    {!s.allDay && (
                      <span className="text-xs text-muted">
                        {s.kind === 'event' ? 'Event' : s.kind === 'block' ? 'Time block' : 'Task'} · until {formatTime(s.end, tz, settings.time_format)}
                      </span>
                    )}
                  </span>
                  {current && <Badge color="rgb(var(--accent))">Now</Badge>}
                </li>
              )
            })}
          </ol>
        )}
      </Panel>
    ),
    habits: <HabitsToday habits={(habits.data ?? []).filter((h) => h.show_on_dashboard)} checkins={checkins.data ?? []} loading={habits.isLoading} />,
    upcoming: (
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" aria-hidden /> Next 7 days
          </span>
        }
        action={
          <Link to="/tasks?view=upcoming" className="text-xs font-medium text-accent hover:underline">
            Upcoming
          </Link>
        }
        bodyClassName="p-2"
      >
        {upcoming.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No deadlines or high-priority tasks this week.</p>
        ) : (
          <ul>
            {upcoming.map((i) => (
              <TaskItem key={i.key} item={i} onOpen={setOpenTask} />
            ))}
          </ul>
        )}
      </Panel>
    ),
    goals: (
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Target className="h-4 w-4 text-accent" aria-hidden /> Goals
          </span>
        }
        action={
          <Link to="/goals" className="text-xs font-medium text-accent hover:underline">
            All goals
          </Link>
        }
      >
        {(goals.data ?? []).filter((g) => g.status === 'active').length === 0 ? (
          <EmptyState title="No active goals" action={<Link to="/goals?new=1" className="text-sm font-medium text-accent hover:underline">Create a goal</Link>} />
        ) : (
          <ul className="flex flex-col gap-4">
            {(goals.data ?? [])
              .filter((g) => g.status === 'active')
              .slice(0, 6)
              .map((g) => {
                const p = goalProgress(g, { tasks, projects: projects.data ?? [], milestones: milestones.data ?? [], progress: progress.data ?? [] })
                const track = onTrack(g.created_at, g.target_date, p.ratio, today)
                return (
                  <li key={g.id}>
                    <Link to={`/goals?goal=${g.id}`} className="group block">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <ColorDot color={g.color} />
                          <span className="truncate font-medium group-hover:underline">{g.title}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted">{p.label}</span>
                      </div>
                      <ProgressBar value={p.ratio} color={g.color} label={`${g.title} progress`} />
                      {(g.target_date || track) && (
                        <p className="mt-1 text-xs text-muted">
                          {g.target_date && `Due ${relativeDay(g.target_date, today)}`}
                          {track === 'behind' && <span className="text-warning"> · Behind pace</span>}
                          {track === 'ahead' && <span className="text-success"> · Ahead of pace</span>}
                        </p>
                      )}
                    </Link>
                  </li>
                )
              })}
          </ul>
        )}
      </Panel>
    ),
    inbox: (
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-accent" aria-hidden /> Unscheduled
          </span>
        }
        action={
          <Link to="/tasks?view=inbox" className="text-xs font-medium text-accent hover:underline">
            Inbox
          </Link>
        }
        bodyClassName="p-2"
      >
        {unscheduled.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">Every task has a date.</p>
        ) : (
          <ul>
            {unscheduled.map((i) => (
              <TaskItem key={i.key} item={i} onOpen={setOpenTask} />
            ))}
          </ul>
        )}
      </Panel>
    ),
  }

  const visible = order.filter((id) => !hidden.has(id))

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{formatKey(today, 'EEEE, d MMMM')}</p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[1.7rem]">
            {greeting(hour)}
            {settings.display_name ? `, ${settings.display_name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {dueToday.length ? `${doneToday} of ${plural(dueToday.length, 'task')} done today` : 'No tasks due today'}
            {plannedMinutes > 0 && ` · ${formatMinutes(plannedMinutes)} planned`}
            {late.length > 0 && <span className="text-danger"> · {late.length} overdue</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" aria-label="Customize dashboard" onClick={() => setCustomize(true)}>
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button onClick={() => setQuick(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Quick add
          </Button>
        </div>
      </header>

      {dueToday.length > 0 && <ProgressBar value={doneToday / dueToday.length} className="mb-6" label="Today's progress" />}

      <div className="grid gap-4 lg:grid-cols-2">
        {visible.map((id) => (
          <div key={id} className={cn(id === 'today' && 'lg:row-span-2')}>
            {sections[id]}
          </div>
        ))}
      </div>

      <TaskEditor open={!!openTask} task={openTask?.task} onClose={() => setOpenTask(null)} />
      <QuickAddDialog open={quick} onClose={() => setQuick(false)} />
      <Dialog open={customize} onClose={() => setCustomize(false)} title="Customize dashboard" description="Choose which sections show and their order.">
        <ul className="flex flex-col gap-1">
          {order.map((id, idx) => {
            const s = DASHBOARD_SECTIONS.find((x) => x.id === id)!
            const move = (d: number) => {
              const next = [...order]
              const j = idx + d
              if (j < 0 || j >= next.length) return
              ;[next[idx], next[j]] = [next[j], next[idx]]
              void update({ dashboard: { ...settings.dashboard, order: next } })
            }
            return (
              <li key={id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <Checkbox
                  checked={!hidden.has(id)}
                  label={s.label}
                  onChange={(v) => {
                    const h = new Set(hidden)
                    if (v) h.delete(id)
                    else h.add(id)
                    void update({ dashboard: { ...settings.dashboard, hidden: [...h] } })
                  }}
                />
                <span className="flex-1 text-sm">{s.label}</span>
                <Button size="icon-sm" variant="ghost" aria-label={`Move ${s.label} up`} disabled={idx === 0} onClick={() => move(-1)}>
                  ↑
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Move ${s.label} down`} disabled={idx === order.length - 1} onClick={() => move(1)}>
                  ↓
                </Button>
              </li>
            )
          })}
        </ul>
      </Dialog>
    </div>
  )
}

function HabitsToday({ habits, checkins, loading }: { habits: import('@/lib/db/types').Habit[]; checkins: import('@/lib/db/types').HabitCheckin[]; loading: boolean }) {
  const { today, settings } = useSettings()
  const actions = useHabitActions()
  const rows = habits.map((h) => ({ h, s: habitStats(h, checkins, today, settings.week_start), c: checkinMap(checkins, h.id).get(today) })).filter((r) => r.s.dueToday || r.s.doneToday)
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-accent" aria-hidden /> Habits
        </span>
      }
      action={
        <Link to="/habits" className="text-xs font-medium text-accent hover:underline">
          All habits
        </Link>
      }
    >
      {loading ? (
        <ListSkeleton rows={2} />
      ) : rows.length === 0 ? (
        <EmptyState title={habits.length ? 'No habits due today' : 'No habits yet'} action={!habits.length && <Link to="/habits?new=1" className="text-sm font-medium text-accent hover:underline">Add a habit</Link>} />
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map(({ h, s, c }) => (
            <li key={h.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Checkbox round checked={s.doneToday} label={`${s.doneToday ? 'Undo' : 'Check in'} ${h.name}`} onChange={() => void actions.toggle(h, today, c)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{h.name}</span>
                {h.kind === 'numeric' && (
                  <span className="text-xs text-muted">
                    {c?.value ?? 0} / {h.target_value ?? 1} {h.unit}
                  </span>
                )}
                {s.unit === 'week' && h.schedule.type === 'weekly' && (
                  <span className="text-xs text-muted">
                    {s.thisWeek}/{h.schedule.timesPerWeek} this week
                  </span>
                )}
              </span>
              {s.current > 0 && (
                <span className="flex items-center gap-1 text-xs font-medium text-warning" title={`${s.current} ${s.unit} streak`}>
                  <Flame className="h-3.5 w-3.5" aria-hidden /> {s.current}
                  {s.unit === 'week' ? 'w' : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
