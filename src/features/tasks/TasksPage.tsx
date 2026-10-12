import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckSquare, ListFilter, Plus, X } from 'lucide-react'
import { PageHeader, EmptyState, ListSkeleton, Segmented } from '@/components/ui/misc'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { useSettings } from '@/settings/SettingsProvider'
import { useLookups } from '@/lib/lookups'
import { relativeDay } from '@/lib/dates'
import type { Priority, Task } from '@/lib/db/types'
import { matchesFilter, PRIORITY_RANK, sortInstances, viewInstances, type TaskInstance, type TaskView, type ViewFilter } from './logic'
import { useTaskData } from './useTaskData'
import { TaskItem } from './TaskItem'
import { TaskEditor } from './TaskEditor'
import { useTaskActions } from './actions'
import { parseQuickEntry } from './parse'

type ViewKey = TaskView | 'archived'
const VIEWS: { value: ViewKey; label: string }[] = [
  { value: 'inbox', label: 'No date' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
]
type GroupBy = 'none' | 'date' | 'project' | 'priority'
type SortBy = 'smart' | 'priority' | 'title' | 'created'

const EMPTY: Record<ViewKey, string> = {
  inbox: 'Your inbox is clear. Tasks without a date or project land here.',
  today: 'Nothing due today. Enjoy it, or pull something forward from Upcoming.',
  upcoming: 'Nothing scheduled for the next 30 days.',
  overdue: 'Nothing overdue. Nice work.',
  all: 'No open tasks yet. Add your first one above.',
  completed: 'Completed tasks will show up here.',
  archived: 'Archived tasks can be restored from here.',
}

export function TasksPage() {
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as ViewKey) || 'today'
  const openId = params.get('task')
  const { tz, today, settings } = useSettings()
  const lookups = useLookups()
  const { tasks, archived, occurrences, isLoading, error } = useTaskData()
  const actions = useTaskActions()
  const [filter, setFilter] = useState<ViewFilter>({})
  const [showFilters, setShowFilters] = useState(false)
  const [groupBy, setGroupBy] = useState<GroupBy>('date')
  const [sortBy, setSortBy] = useState<SortBy>('smart')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [quick, setQuick] = useState('')

  const allTags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags))].sort(), [tasks])

  const items = useMemo(() => {
    let list: TaskInstance[]
    if (view === 'archived') list = archived.filter((t) => !t.parent_id).map((t) => ({ key: t.id, task: t, date: t.due_date, occurrenceDate: null, done: t.status === 'done', skipped: false, scheduledAt: t.scheduled_at, completedAt: t.completed_at }))
    else list = viewInstances(view, tasks, occurrences, today, tz)
    list = list.filter((i) => matchesFilter(i, filter))
    if (view === 'completed') return list
    if (sortBy === 'priority') return [...list].sort((a, b) => PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority])
    if (sortBy === 'title') return [...list].sort((a, b) => a.task.title.localeCompare(b.task.title))
    if (sortBy === 'created') return [...list].sort((a, b) => b.task.created_at.localeCompare(a.task.created_at))
    return sortInstances(list)
  }, [view, tasks, archived, occurrences, today, tz, filter, sortBy])

  const groups = useMemo(() => {
    if (groupBy === 'none' || view === 'completed') return [{ key: 'all', label: '', items }]
    const map = new Map<string, { key: string; label: string; items: TaskInstance[] }>()
    for (const i of items) {
      let key: string
      let label: string
      if (groupBy === 'date') {
        key = !i.date ? 'zz' : i.date < today && !i.done ? '00-overdue' : i.date
        label = !i.date ? 'No date' : key === '00-overdue' ? 'Overdue' : relativeDay(i.date, today)
      } else if (groupBy === 'project') {
        const p = lookups.project(i.task.project_id)
        key = p ? p.name : 'zz'
        label = p ? p.name : 'No project'
      } else {
        key = String(PRIORITY_RANK[i.task.priority])
        label = i.task.priority[0].toUpperCase() + i.task.priority.slice(1)
      }
      if (!map.has(key)) map.set(key, { key, label, items: [] })
      map.get(key)!.items.push(i)
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [items, groupBy, view, today, lookups])

  const openTask: Task | null = useMemo(() => (openId ? [...tasks, ...archived].find((t) => t.id === openId) ?? null : null), [openId, tasks, archived])
  const setOpen = (id: string | null) => {
    const p = new URLSearchParams(params)
    if (id) p.set('task', id)
    else p.delete('task')
    setParams(p, { replace: true })
  }

  const quickAdd = async () => {
    if (!quick.trim()) return
    const p = parseQuickEntry(quick, tz)
    const due = p.due_date ?? (view === 'today' ? today : null)
    await actions.create({
      title: p.title,
      due_date: due,
      scheduled_at: p.scheduled_at,
      estimated_minutes: p.estimated_minutes,
      priority: p.priority,
      tags: p.tags,
      recurrence: p.recurrence,
      start_date: p.recurrence ? due ?? today : null,
      reminder_offsets: p.scheduled_at ? settings.notifications.task_default_offsets ?? [] : [],
    })
    setQuick('')
  }

  const selectedItems = items.filter((i) => selected.has(i.key))

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${tasks.filter((t) => t.status !== 'done' && !t.parent_id).length} open`}
        actions={
          <>
            <Button variant={selecting ? 'secondary' : 'outline'} size="sm" onClick={() => (setSelecting((s) => !s), setSelected(new Set()))}>
              <CheckSquare className="h-4 w-4" /> {selecting ? 'Done selecting' : 'Select'}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New task
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        <Segmented label="Task views" value={view} onChange={(v) => setParams({ view: v })} options={VIEWS} />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void quickAdd()
          }}
        >
          <Input aria-label="Add a task" placeholder={view === 'today' ? 'Add a task for today… (try “gym at 7am”)' : 'Add a task…'} value={quick} onChange={(e) => setQuick(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={!quick.trim()}>
            Add
          </Button>
          <Button type="button" variant={showFilters ? 'secondary' : 'outline'} size="icon" aria-label="Filters" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
            <ListFilter className="h-4 w-4" />
          </Button>
        </form>
        {showFilters && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface p-3 md:grid-cols-6">
            <Input aria-label="Search tasks" placeholder="Search" value={filter.search ?? ''} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} className="col-span-2" />
            <Select aria-label="Priority" value={filter.priority ?? ''} onChange={(e) => setFilter((f) => ({ ...f, priority: e.target.value as Priority | '' }))}>
              <option value="">Any priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </Select>
            <Select aria-label="Project" value={filter.projectId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, projectId: e.target.value || undefined }))}>
              <option value="">Any project</option>
              {lookups.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Tag" value={filter.tag ?? ''} onChange={(e) => setFilter((f) => ({ ...f, tag: e.target.value || undefined }))}>
              <option value="">Any tag</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="date">Group: date</option>
                <option value="project">Group: project</option>
                <option value="priority">Group: priority</option>
                <option value="none">No groups</option>
              </Select>
            </div>
            <Select aria-label="Sort by" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="col-span-2 md:col-span-1">
              <option value="smart">Sort: smart</option>
              <option value="priority">Sort: priority</option>
              <option value="title">Sort: title</option>
              <option value="created">Sort: newest</option>
            </Select>
            {(filter.search || filter.priority || filter.projectId || filter.tag) && (
              <Button variant="ghost" size="sm" onClick={() => setFilter({})}>
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>
        )}
      </div>

      {selecting && (
        <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-sm md:top-2">
          <span className="px-2 text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(items.map((i) => i.key)))}>
            Select all
          </Button>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {(['done', 'today', 'tomorrow', 'archive', 'delete'] as const).map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === 'delete' ? 'danger' : 'secondary'}
                disabled={!selected.size}
                onClick={async () => {
                  await actions.bulk(selectedItems, a, today)
                  setSelected(new Set())
                }}
              >
                {a === 'done' ? 'Complete' : a === 'today' ? 'Move to today' : a === 'tomorrow' ? 'Tomorrow' : a[0].toUpperCase() + a.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {error ? (
        <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger">Could not load tasks: {String((error as Error).message)}</p>
      ) : isLoading ? (
        <ListSkeleton />
      ) : !items.length ? (
        <EmptyState icon={CheckSquare} title={filter.search || filter.priority || filter.projectId || filter.tag ? 'No tasks match these filters' : 'Nothing here'}>
          {EMPTY[view]}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label || 'Tasks'}>
              {g.label && (
                <h2 className={`mb-1 px-2 text-xs font-semibold uppercase tracking-wide ${g.key === '00-overdue' ? 'text-danger' : 'text-muted'}`}>
                  {g.label} <span className="font-normal text-subtle">{g.items.length}</span>
                </h2>
              )}
              <ul className="flex flex-col">
                {g.items.map((i) => (
                  <TaskItem
                    key={i.key}
                    item={i}
                    onOpen={(x) => setOpen(x.task.id)}
                    selectable={selecting}
                    selected={selected.has(i.key)}
                    onSelect={(v) =>
                      setSelected((s) => {
                        const n = new Set(s)
                        if (v) n.add(i.key)
                        else n.delete(i.key)
                        return n
                      })
                    }
                    showDate={groupBy !== 'date'}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <TaskEditor open={creating} onClose={() => setCreating(false)} initial={view === 'today' ? { due_date: today } : undefined} />
      <TaskEditor open={!!openTask} task={openTask} onClose={() => setOpen(null)} />
    </div>
  )
}
