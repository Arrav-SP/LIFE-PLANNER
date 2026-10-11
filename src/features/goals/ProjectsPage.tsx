import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore, ArrowLeft, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { getStore } from '@/lib/db'
import { relativeDay } from '@/lib/dates'
import { cn, errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { confirm } from '@/components/ui/Dialog'
import { Menu } from '@/components/ui/Menu'
import { Badge, ColorDot, EmptyState, ListSkeleton, PageHeader, Panel, ProgressBar, Segmented } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import type { Milestone, Project, Task } from '@/lib/db/types'
import { useTaskData } from '@/features/tasks/useTaskData'
import { sortInstances, viewInstances, type TaskInstance } from '@/features/tasks/logic'
import { TaskItem } from '@/features/tasks/TaskItem'
import { TaskEditor } from '@/features/tasks/TaskEditor'
import { ProjectEditor } from './GoalEditor'
import { Milestones } from './Milestones'
import { projectProgress } from './logic'

const STATUS: Record<Project['status'], string> = { planned: 'Planned', active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' }

export function ProjectsPage() {
  const { today } = useSettings()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('project')
  const [filter, setFilter] = useState<'open' | 'done' | 'archived'>('open')
  const [creating, setCreating] = useState(false)
  const projects = useList('projects', { order: [{ field: 'created_at' }] })
  const milestones = useList('milestones')
  const { tasks } = useTaskData(true)
  const goals = useList('goals')

  const list = (projects.data ?? []).filter((p) =>
    filter === 'archived' ? !!p.archived_at : !p.archived_at && (filter === 'open' ? p.status !== 'completed' && p.status !== 'cancelled' : p.status === 'completed' || p.status === 'cancelled'),
  )
  const selected = (projects.data ?? []).find((p) => p.id === selectedId) ?? null
  const select = (id: string | null) => {
    if (id) params.set('project', id)
    else params.delete('project')
    setParams(params)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Projects"
        subtitle="Bigger pieces of work with their own tasks and milestones."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New project
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className={cn(selected && 'hidden lg:block')}>
          <Segmented
            label="Filter projects"
            className="mb-3"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'done', label: 'Finished' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
          {projects.isLoading ? (
            <ListSkeleton />
          ) : list.length === 0 ? (
            <EmptyState icon={FolderKanban} title="No projects here" action={filter === 'open' && <Button onClick={() => setCreating(true)}>Create a project</Button>} />
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((p) => {
                const pr = projectProgress(p, tasks, milestones.data ?? [])
                const goal = (goals.data ?? []).find((g) => g.id === p.goal_id)
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => select(p.id)}
                      aria-current={p.id === selectedId}
                      className={cn('w-full rounded-xl border bg-surface p-3 text-left transition-colors hover:border-accent/50', p.id === selectedId ? 'border-accent' : 'border-line')}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <ColorDot color={p.color} />
                        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                        {p.status !== 'active' && <Badge>{STATUS[p.status]}</Badge>}
                      </div>
                      <ProgressBar value={pr.ratio} color={p.color} label={`${p.name} progress`} />
                      <p className="mt-1.5 flex justify-between gap-2 text-xs text-muted">
                        <span className="truncate">{goal ? goal.title : pr.label}</span>
                        <span className="shrink-0">{p.target_date ? relativeDay(p.target_date, today) : ''}</span>
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
            <ProjectDetail project={selected} tasks={tasks} milestones={(milestones.data ?? []).filter((m) => m.project_id === selected.id)} allMilestones={milestones.data ?? []} goalTitle={(goals.data ?? []).find((g) => g.id === selected.goal_id)?.title} onBack={() => select(null)} />
          ) : (
            <div className="hidden rounded-xl border border-dashed border-line lg:block">
              <EmptyState icon={FolderKanban} title="Select a project" />
            </div>
          )}
        </div>
      </div>
      <ProjectEditor open={creating} onClose={() => setCreating(false)} onSaved={(p) => select(p.id)} />
    </div>
  )
}

function ProjectDetail({ project: p, tasks, milestones, allMilestones, goalTitle, onBack }: { project: Project; tasks: Task[]; milestones: Milestone[]; allMilestones: Milestone[]; goalTitle?: string; onBack: () => void }) {
  const { today, tz } = useSettings()
  const { occurrences } = useTaskData()
  const invalidate = useInvalidate()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<TaskInstance | null>(null)
  const [showDone, setShowDone] = useState(false)
  const projectTasks = useMemo(() => tasks.filter((t) => t.project_id === p.id && !t.parent_id && !t.archived_at), [tasks, p.id])
  const openList = useMemo(() => sortInstances(viewInstances('all', projectTasks, occurrences, today, tz)), [projectTasks, occurrences, today, tz])
  const doneList = useMemo(() => viewInstances('completed', projectTasks, occurrences, today, tz), [projectTasks, occurrences, today, tz])
  const pr = projectProgress(p, tasks, allMilestones)

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn()
      toast.success(msg)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      invalidate('projects')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Back to projects" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <ColorDot color={p.color} className="h-3 w-3" />
            <span className="break-words">{p.name}</span>
          </h2>
          <p className="mt-1 text-sm text-muted">
            {STATUS[p.status]}
            {p.target_date && ` · target ${relativeDay(p.target_date, today)}`}
            {goalTitle && (
              <>
                {' · '}
                <Link to={`/goals?goal=${p.goal_id}`} className="text-accent hover:underline">
                  {goalTitle}
                </Link>
              </>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" aria-hidden /> Edit
        </Button>
        <Menu
          label="Project actions"
          items={[
            p.archived_at
              ? { label: 'Restore', icon: <ArchiveRestore className="h-4 w-4" />, onSelect: () => void act(() => getStore().update('projects', p.id, { archived_at: null }), 'Project restored') }
              : { label: 'Archive', icon: <Archive className="h-4 w-4" />, onSelect: () => void act(() => getStore().update('projects', p.id, { archived_at: new Date().toISOString() }), 'Project archived') },
            {
              label: 'Delete',
              icon: <Trash2 className="h-4 w-4" />,
              danger: true,
              onSelect: async () => {
                if (await confirm({ title: 'Delete this project?', message: 'Its milestones are deleted. Its tasks are kept and moved out of the project.', confirmLabel: 'Delete', danger: true }))
                  await act(() => getStore().remove('projects', p.id), 'Project deleted').then(onBack)
              },
            },
          ]}
        />
      </div>

      <Panel>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-3xl font-semibold tabular">{Math.round(pr.ratio * 100)}%</span>
          <span className="text-sm text-muted">{pr.label}</span>
        </div>
        <ProgressBar value={pr.ratio} color={p.color} label="Project progress" />
        {p.description && <p className="mt-3 whitespace-pre-wrap text-sm">{p.description}</p>}
      </Panel>

      <Panel title="Milestones">
        <Milestones items={milestones} owner={{ project_id: p.id }} />
      </Panel>

      <Panel
        title={`Tasks · ${openList.length} open`}
        action={
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Task
          </Button>
        }
        bodyClassName="p-2"
      >
        {openList.length === 0 ? (
          <p className="p-2 text-sm text-muted">No open tasks.</p>
        ) : (
          <ul>
            {openList.map((i) => (
              <TaskItem key={i.key} item={i} onOpen={setOpen} />
            ))}
          </ul>
        )}
        {doneList.length > 0 && (
          <>
            <button type="button" className="px-2 py-2 text-xs font-medium text-muted hover:text-fg" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Hide' : 'Show'} {doneList.length} completed
            </button>
            {showDone && (
              <ul>
                {doneList.map((i) => (
                  <TaskItem key={i.key} item={i} onOpen={setOpen} />
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>

      {p.notes && (
        <Panel title="Notes">
          <p className="whitespace-pre-wrap text-sm">{p.notes}</p>
        </Panel>
      )}

      <ProjectEditor open={editing} project={p} onClose={() => setEditing(false)} />
      <TaskEditor open={adding} initial={{ project_id: p.id, goal_id: p.goal_id }} onClose={() => setAdding(false)} />
      <TaskEditor open={!!open} task={open?.task} onClose={() => setOpen(null)} />
    </div>
  )
}
