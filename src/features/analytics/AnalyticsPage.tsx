import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useSettings } from '@/settings/SettingsProvider'
import { useList } from '@/lib/db/hooks'
import { gte, isNull } from '@/lib/db/store'
import { addDays, dateKey, formatKey, zonedToInstant } from '@/lib/dates'
import { formatMinutes } from '@/lib/utils'
import { linkTo } from '@/lib/links'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader, Panel, ProgressBar, Segmented, Stat } from '@/components/ui/misc'
import { useTaskData } from '@/features/tasks/useTaskData'
import { goalProgress } from '@/features/goals/logic'
import { completionsByDay, habitRates, studyByDay, studyBySubject } from './logic'

const axis = { fontSize: 11, fill: 'rgb(var(--muted))' }
const tooltip = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12 }

export function AnalyticsPage() {
  const { today, tz } = useSettings()
  const [days, setDays] = useState<'7' | '30' | '90'>('30')
  const n = Number(days)
  const from = addDays(today, -(n - 1))
  const since = zonedToInstant(addDays(from, -1), '00:00', tz).toISOString()

  const { tasks, occurrences } = useTaskData(true)
  const sessions = useList('study_sessions', { filters: [gte('started_at', since)] })
  const subjects = useList('subjects')
  const habits = useList('habits', { filters: [isNull('archived_at')] })
  const checkins = useList('habit_checkins', { filters: [gte('date', from)] })
  const workouts = useList('workouts', { filters: [gte('started_at', since)] })
  const blocks = useList('time_blocks', { filters: [gte('start_at', since)] })
  const goals = useList('goals', { filters: [isNull('archived_at')] })
  const projects = useList('projects')
  const milestones = useList('milestones')
  const progress = useList('goal_progress')

  const label = (d: string) => formatKey(d, n > 30 ? 'd MMM' : n > 7 ? 'd' : 'EEE')
  const done = useMemo(() => completionsByDay(tasks, occurrences, from, today, tz).map((x) => ({ ...x, label: label(x.date) })), [tasks, occurrences, from, today, tz]) // eslint-disable-line react-hooks/exhaustive-deps
  const study = useMemo(() => studyByDay(sessions.data ?? [], from, today, tz).map((x) => ({ ...x, label: label(x.date), hours: +(x.value / 60).toFixed(2) })), [sessions.data, from, today, tz]) // eslint-disable-line react-hooks/exhaustive-deps
  const bySubject = useMemo(() => studyBySubject(sessions.data ?? [], subjects.data ?? [], from, today, tz), [sessions.data, subjects.data, from, today, tz])
  const rates = useMemo(() => habitRates(habits.data ?? [], checkins.data ?? [], from, today), [habits.data, checkins.data, from, today])

  const totalDone = done.reduce((s, x) => s + x.value, 0)
  const totalStudy = study.reduce((s, x) => s + x.value, 0)
  const workoutCount = (workouts.data ?? []).filter((w) => dateKey(w.started_at, tz) >= from).length
  const dueInRange = tasks.filter((t) => !t.recurrence && !t.archived_at && t.due_date && t.due_date >= from && t.due_date <= today)
  const onTime = dueInRange.filter((t) => t.status === 'done' && t.completed_at && dateKey(t.completed_at, tz) <= t.due_date!).length
  const plannedBlocks = (blocks.data ?? []).filter((b) => !b.recurrence && dateKey(b.start_at, tz) >= from && b.start_at < new Date().toISOString())
  const blockDone = plannedBlocks.filter((b) => b.status === 'done').length
  const avgHabit = rates.length ? rates.reduce((s, r) => s + r.rate, 0) / rates.length : 0

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Analytics"
        subtitle="How your time and effort are adding up."
        actions={
          <Segmented
            label="Range"
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
            ]}
          />
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tasks completed" value={totalDone} sub={dueInRange.length ? `${Math.round((onTime / dueInRange.length) * 100)}% of due tasks on time` : undefined} />
        <Stat label="Study time" value={formatMinutes(totalStudy) || '0m'} sub={`${formatMinutes(Math.round(totalStudy / n)) || '0m'} a day on average`} />
        <Stat label="Habit consistency" value={`${Math.round(avgHabit * 100)}%`} sub={rates.length ? `${rates.length} habits` : 'No habits yet'} />
        <Stat label="Workouts" value={workoutCount} sub={plannedBlocks.length ? `${blockDone}/${plannedBlocks.length} time blocks kept` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tasks completed">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={done} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid stroke="rgb(var(--line))" vertical={false} />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltip} cursor={{ fill: 'rgb(var(--surface-2))' }} labelFormatter={(_, p) => (p?.[0] ? formatKey(p[0].payload.date, 'EEE d MMM') : '')} />
                <Bar dataKey="value" name="Completed" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Study hours">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={study} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid stroke="rgb(var(--line))" vertical={false} />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={axis} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltip} cursor={{ fill: 'rgb(var(--surface-2))' }} labelFormatter={(_, p) => (p?.[0] ? formatKey(p[0].payload.date, 'EEE d MMM') : '')} />
                <Bar dataKey="hours" name="Hours" fill="#0891b2" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Study by subject">
          {bySubject.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No study sessions in this range.</p>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={bySubject} dataKey="minutes" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2} stroke="none">
                      {bySubject.map((s) => (
                        <Cell key={s.name} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltip} formatter={(v: number) => formatMinutes(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="flex w-full flex-col gap-1.5 text-sm">
                {bySubject.map((s) => (
                  <li key={s.name} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                    <MaybeLink to={s.id ? linkTo.subject(s.id) : null} className="min-w-0 flex-1 truncate">
                      {s.name}
                    </MaybeLink>
                    <span className="tabular text-muted">{formatMinutes(s.minutes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Habit consistency">
          {rates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No habits yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rates.map((r) => (
                <li key={r.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <Link to={linkTo.habit(r.id)} className="truncate hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-xs text-muted">
                      {r.done}/{r.due} · {Math.round(r.rate * 100)}%
                    </span>
                  </div>
                  <ProgressBar value={r.rate} color={r.color} label={`${r.name} consistency`} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Goals" className="lg:col-span-2">
          {(goals.data ?? []).filter((g) => g.status === 'active').length === 0 ? (
            <EmptyState title="No active goals" />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {(goals.data ?? [])
                .filter((g) => g.status === 'active')
                .map((g) => {
                  const p = goalProgress(g, { tasks, projects: projects.data ?? [], milestones: milestones.data ?? [], progress: progress.data ?? [] })
                  return (
                    <li key={g.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <Link to={linkTo.goal(g.id)} className="truncate font-medium hover:underline">
                          {g.title}
                        </Link>
                        <span className="text-xs text-muted">{p.label}</span>
                      </div>
                      <ProgressBar value={p.ratio} color={g.color} label={`${g.title} progress`} />
                    </li>
                  )
                })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function MaybeLink({ to, className, children }: { to: string | null; className?: string; children: React.ReactNode }) {
  return to ? (
    <Link to={to} className={`${className ?? ''} hover:underline`}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  )
}
