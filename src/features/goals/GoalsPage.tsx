import { useEffect, useMemo, useState } from 'react'
import { HubTabs } from '@/components/ui/HubTabs'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Archive, BookOpen, CalendarDays, Flag, Pencil, Plus, StickyNote, Target, Trash2 } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { eq, isNull } from '@/lib/db/store'
import { getStore } from '@/lib/db'
import { dateKey, formatInstant, relativeDay } from '@/lib/dates'
import { cn, errorMessage } from '@/lib/utils'
import { linkTo } from '@/lib/links'
import { Button } from '@/components/ui/Button'
import { confirm } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { Badge, ColorDot, EmptyState, ListSkeleton, PageHeader, Panel, ProgressBar, Segmented } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import type { Goal } from '@/lib/db/types'
import { useTaskData } from '@/features/tasks/useTaskData'
import { sortInstances, viewInstances, type TaskInstance } from '@/features/tasks/logic'
import { TaskItem } from '@/features/tasks/TaskItem'
import { TaskEditor } from '@/features/tasks/TaskEditor'
import { GoalEditor, ProjectEditor } from './GoalEditor'
import { Milestones } from './Milestones'
import { goalMilestones, goalProgress, goalTasks, onTrack, projectProgress } from './logic'

const STATUS_LABEL: Record<Goal['status'], string> = { active: 'Active', paused: 'Paused', completed: 'Completed', abandoned: 'Abandoned' }

export function GoalsPage() {
  const { today, tz } = useSettings()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('goal')
  const [filter, setFilter] = useState<'active' | 'done' | 'all'>('active')
  const [creating, setCreating] = useState(false)
  const goals = useList('goals', { filters: [isNull('archived_at')], order: [{ field: 'created_at' }] })
  const projects = useList('projects', { filters: [isNull('archived_at')] })
  const milestones = useList('milestones')
  const progress = useList('goal_progress', { order: [{ field: 'recorded_at' }] })
  const { tasks, occurrences } = useTaskData()

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreating(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const data = { tasks, projects: projects.data ?? [], milestones: milestones.data ?? [], progress: progress.data ?? [] }
  const list = (goals.data ?? []).filter((g) => (filter === 'all' ? true : filter === 'active' ? g.status === 'active' || g.status === 'paused' : g.status === 'completed' || g.status === 'abandoned'))
  const selected = (goals.data ?? []).find((g) => g.id === selectedId) ?? null
  const select = (id: string | null) => {
    if (id) params.set('goal', id)
    else params.delete('goal')
    setParams(params)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Goals"
        subtitle="Long-term outcomes, broken into projects, milestones and tasks."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New goal
          </Button>
        }
      />
      <HubTabs hub="goals" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className={cn(selected && 'hidden lg:block')}>
          <Segmented
            label="Filter goals"
            className="mb-3"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'done', label: 'Finished' },
              { value: 'all', label: 'All' },
            ]}
          />
          {goals.isLoading ? (
            <ListSkeleton />
          ) : list.length === 0 ? (
            <EmptyState icon={Target} title="No goals here" action={<Button onClick={() => setCreating(true)}>Create a goal</Button>}>
              Goals like “Finish all NCERTs by February” keep the bigger picture visible.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((g) => {
                const p = goalProgress(g, data)
                const track = g.status === 'active' ? onTrack(g.created_at, g.target_date, p.ratio, today) : null
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => select(g.id)}
                      aria-current={g.id === selectedId}
                      className={cn('w-full rounded-xl border bg-surface p-3 text-left transition-colors hover:border-accent/50', g.id === selectedId ? 'border-accent' : 'border-line')}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <ColorDot color={g.color} />
                        <span className="min-w-0 flex-1 truncate font-medium">{g.title}</span>
                        {g.status !== 'active' && <Badge>{STATUS_LABEL[g.status]}</Badge>}
                      </div>
                      <ProgressBar value={p.ratio} color={g.color} label={`${g.title} progress`} />
                      <p className="mt-1.5 flex justify-between text-xs text-muted">
                        <span>{p.label}</span>
                        <span className={cn(track === 'behind' && 'text-warning', track === 'ahead' && 'text-success')}>
                          {g.target_date ? relativeDay(g.target_date, today) : 'No target date'}
                        </span>
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className={cn(!selected && 'hidden lg:block')}>
          {selected ? (
            <GoalDetail goal={selected} data={data} tasks={viewInstances('all', goalTasks(selected, tasks, data.projects), occurrences, today, tz)} onBack={() => select(null)} />
          ) : (
            <div className="hidden rounded-xl border border-dashed border-line lg:block">
              <EmptyState icon={Flag} title="Select a goal">
                Pick a goal to see its projects, milestones and tasks.
              </EmptyState>
            </div>
          )}
        </div>
      </div>
      <GoalEditor open={creating} onClose={() => setCreating(false)} onSaved={(g) => select(g.id)} />
    </div>
  )
}

function GoalDetail({ goal, data, tasks, onBack }: { goal: Goal; data: Parameters<typeof goalProgress>[1]; tasks: TaskInstance[]; onBack: () => void }) {
  const { today, tz } = useSettings()
  const invalidate = useInvalidate()
  const [editing, setEditing] = useState(false)
  const [newProject, setNewProject] = useState(false)
  const [taskOpen, setTaskOpen] = useState<TaskInstance | null>(null)
  const [addingTask, setAddingTask] = useState(false)
  const [metricValue, setMetricValue] = useState('')
  const habits = useList('habits', { filters: [eq('goal_id', goal.id), isNull('archived_at')] })
  const subjects = useList('subjects', { filters: [eq('goal_id', goal.id), isNull('archived_at')] })
  const events = useList('events', { filters: [eq('goal_id', goal.id), isNull('archived_at')], order: [{ field: 'start_at' }] })
  const notes = useList('notes', { filters: [eq('goal_id', goal.id)], order: [{ field: 'created_at', ascending: false }] })
  const nowIso = new Date().toISOString()
  const linkedEvents = (events.data ?? []).filter((e) => e.recurrence || e.end_at >= nowIso).slice(0, 8)
  const linkedNotes = (notes.data ?? []).filter((n) => n.status !== 'archived').slice(0, 8)
  const p = goalProgress(goal, data)
  const track = goal.status === 'active' ? onTrack(goal.created_at, goal.target_date, p.ratio, today) : null
  const projects = data.projects.filter((x) => x.goal_id === goal.id)
  const ms = goalMilestones(goal, data.milestones, data.projects).filter((m) => m.goal_id === goal.id)
  const entries = data.progress.filter((x) => x.goal_id === goal.id)
  const openTasks = useMemo(() => sortInstances(tasks), [tasks])

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn()
      if (msg) toast.success(msg)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      invalidate('goals')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Back to goals" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <ColorDot color={goal.color} className="h-3 w-3" />
            <span className="break-words">{goal.title}</span>
          </h2>
          <p className="mt-1 text-sm text-muted">
            {STATUS_LABEL[goal.status]}
            {goal.target_date && ` · target ${relativeDay(goal.target_date, today)}`}
            {track === 'behind' && <span className="text-warning"> · behind pace</span>}
            {track === 'ahead' && <span className="text-success"> · ahead of pace</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" aria-hidden /> Edit
        </Button>
        <Menu
          label="Goal actions"
          items={[
            { label: 'Mark complete', icon: <Flag className="h-4 w-4" />, hidden: goal.status === 'completed', onSelect: () => void act(() => getStore().update('goals', goal.id, { status: 'completed', completed_at: new Date().toISOString() }), 'Goal completed. Well done!') },
            { label: 'Archive', icon: <Archive className="h-4 w-4" />, onSelect: () => void act(() => getStore().update('goals', goal.id, { archived_at: new Date().toISOString() }), 'Goal archived').then(onBack) },
            {
              label: 'Delete',
              icon: <Trash2 className="h-4 w-4" />,
              danger: true,
              onSelect: async () => {
                if (await confirm({ title: 'Delete this goal?', message: 'Its milestones and progress log are deleted. Linked projects and tasks are kept and unlinked.', confirmLabel: 'Delete', danger: true }))
                  await act(() => getStore().remove('goals', goal.id), 'Goal deleted').then(onBack)
              },
            },
          ]}
        />
      </div>

      <Panel>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-3xl font-semibold tabular">{Math.round(p.ratio * 100)}%</span>
          <span className="text-sm text-muted">{p.label}</span>
        </div>
        <ProgressBar value={p.ratio} color={goal.color} label="Goal progress" />
        {goal.description && <p className="mt-3 whitespace-pre-wrap text-sm">{goal.description}</p>}
        {goal.progress_mode === 'metric' && (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const v = Number(metricValue)
              if (metricValue.trim() === '' || !Number.isFinite(v)) return
              void act(() => getStore().insert('goal_progress', { goal_id: goal.id, value: v, note: '', recorded_at: new Date().toISOString() }), 'Progress logged').then(() => setMetricValue(''))
            }}
          >
            <Input aria-label={`New value${goal.metric_unit ? ` in ${goal.metric_unit}` : ''}`} inputMode="decimal" placeholder={`Current value${goal.metric_unit ? ` (${goal.metric_unit})` : ''}`} value={metricValue} onChange={(e) => setMetricValue(e.target.value)} />
            <Button type="submit" variant="secondary">
              Log
            </Button>
          </form>
        )}
        {goal.progress_mode === 'metric' && entries.length > 0 && (
          <ul className="mt-3 max-h-40 overflow-y-auto text-sm">
            {[...entries].reverse().map((x) => (
              <li key={x.id} className="flex justify-between border-b border-line py-1 last:border-0">
                <span className="text-muted">{formatInstant(x.recorded_at, tz, 'd MMM yyyy')}</span>
                <span className="tabular">
                  {x.value} {goal.metric_unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Projects"
        action={
          <Button size="sm" variant="ghost" onClick={() => setNewProject(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Project
          </Button>
        }
      >
        {projects.length === 0 ? (
          <p className="text-sm text-muted">No projects linked yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {projects.map((pr) => {
              const pp = projectProgress(pr, data.tasks, data.milestones)
              return (
                <li key={pr.id}>
                  <Link to={linkTo.project(pr.id)} className="group block">
                    <div className="mb-1 flex justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <ColorDot color={pr.color} />
                        <span className="truncate group-hover:underline">{pr.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{pp.label}</span>
                    </div>
                    <ProgressBar value={pp.ratio} color={pr.color} label={`${pr.name} progress`} />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Milestones">
        <Milestones items={ms} owner={{ goal_id: goal.id }} />
      </Panel>

      <Panel
        title={`Tasks · ${openTasks.length} open`}
        action={
          <Button size="sm" variant="ghost" onClick={() => setAddingTask(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Task
          </Button>
        }
        bodyClassName="p-2"
      >
        {openTasks.length === 0 ? (
          <p className="p-2 text-sm text-muted">Link tasks to this goal from the task editor, or add one here.</p>
        ) : (
          <ul>
            {openTasks.map((i) => (
              <TaskItem key={i.key} item={i} onOpen={setTaskOpen} />
            ))}
          </ul>
        )}
      </Panel>

      {(habits.data ?? []).length > 0 && (
        <Panel title="Supporting habits">
          <ul className="flex flex-wrap gap-2">
            {(habits.data ?? []).map((h) => (
              <li key={h.id}>
                <Link to={linkTo.habit(h.id)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm hover:bg-surface-2">
                  <ColorDot color={h.color} /> {h.name}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {(subjects.data ?? []).length > 0 && (
        <Panel title="Study subjects">
          <ul className="flex flex-wrap gap-2">
            {(subjects.data ?? []).map((s) => (
              <li key={s.id}>
                <Link to={linkTo.subject(s.id)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm hover:bg-surface-2">
                  <BookOpen className="h-3.5 w-3.5" style={{ color: s.color }} aria-hidden /> {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {linkedEvents.length > 0 && (
        <Panel title="Events">
          <ul className="flex flex-col gap-1 text-sm">
            {linkedEvents.map((e) => (
              <li key={e.id}>
                <Link to={linkTo.event(e.id)} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="shrink-0 text-xs text-muted">{e.recurrence ? 'Repeats' : relativeDay(dateKey(e.start_at, tz), today)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {linkedNotes.length > 0 && (
        <Panel title="Linked notes">
          <ul className="flex flex-col gap-1 text-sm">
            {linkedNotes.map((n) => (
              <li key={n.id}>
                <Link to={linkTo.note(n.id)} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
                  <StickyNote className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{n.title || 'Untitled'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {goal.notes && (
        <Panel title="Notes">
          <p className="whitespace-pre-wrap text-sm">{goal.notes}</p>
        </Panel>
      )}

      <GoalEditor open={editing} goal={goal} onClose={() => setEditing(false)} />
      <ProjectEditor open={newProject} goalId={goal.id} onClose={() => setNewProject(false)} />
      <TaskEditor open={addingTask} initial={{ goal_id: goal.id }} onClose={() => setAddingTask(false)} />
      <TaskEditor open={!!taskOpen} task={taskOpen?.task} onClose={() => setTaskOpen(null)} />
    </div>
  )
}
