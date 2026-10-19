import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Link2, History } from 'lucide-react'
import type { ChecklistItem, Priority, Recurrence, Task, TaskLink } from '@/lib/db/types'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { RecurrenceEditor } from '@/components/RecurrenceEditor'
import { useSettings } from '@/settings/SettingsProvider'
import { Link } from 'react-router-dom'
import { useLookups } from '@/lib/lookups'
import { linkTo } from '@/lib/links'
import { useList } from '@/lib/db/hooks'
import { eq } from '@/lib/db/store'
import { dateKey, formatInstant, timeOf, zonedToInstant } from '@/lib/dates'
import { uid } from '@/lib/utils'
import { useTaskActions } from './actions'

export const REMINDER_CHOICES = [
  { v: 0, label: 'At time' },
  { v: 5, label: '5 min' },
  { v: 10, label: '10 min' },
  { v: 30, label: '30 min' },
  { v: 60, label: '1 hour' },
  { v: 1440, label: '1 day' },
]

interface Draft {
  title: string
  description: string
  priority: Priority
  status: Task['status']
  start_date: string
  due_date: string
  sched_date: string
  sched_time: string
  deadline: string
  estimated_minutes: string
  actual_minutes: string
  category_id: string
  project_id: string
  goal_id: string
  tags: string
  checklist: ChecklistItem[]
  links: TaskLink[]
  notes: string
  recurrence: Recurrence | null
  reminder_offsets: number[]
}

function toDraft(t: Partial<Task> | null, tz: string, defaults: number[]): Draft {
  return {
    title: t?.title ?? '',
    description: t?.description ?? '',
    priority: t?.priority ?? 'normal',
    status: t?.status ?? 'todo',
    start_date: t?.start_date ?? '',
    due_date: t?.due_date ?? '',
    sched_date: t?.scheduled_at ? dateKey(t.scheduled_at, tz) : '',
    sched_time: t?.scheduled_at ? timeOf(t.scheduled_at, tz) : '',
    deadline: t?.deadline ? `${dateKey(t.deadline, tz)}T${timeOf(t.deadline, tz)}` : '',
    estimated_minutes: t?.estimated_minutes ? String(t.estimated_minutes) : '',
    actual_minutes: t?.actual_minutes ? String(t.actual_minutes) : '',
    category_id: t?.category_id ?? '',
    project_id: t?.project_id ?? '',
    goal_id: t?.goal_id ?? '',
    tags: (t?.tags ?? []).join(', '),
    checklist: t?.checklist ?? [],
    links: t?.links ?? [],
    notes: t?.notes ?? '',
    recurrence: t?.recurrence ?? null,
    reminder_offsets: t?.reminder_offsets ?? (t?.id ? [] : defaults),
  }
}

function fromDraft(d: Draft, tz: string): Partial<Task> {
  const num = (s: string) => (s.trim() ? Math.max(0, Math.round(Number(s))) || null : null)
  const schedDate = d.sched_date || (d.sched_time ? d.due_date : '')
  const scheduled_at = schedDate && d.sched_time ? zonedToInstant(schedDate, d.sched_time, tz).toISOString() : null
  const [dlDate, dlTime] = d.deadline.split('T')
  return {
    title: d.title.trim(),
    description: d.description,
    priority: d.priority,
    status: d.status,
    start_date: d.start_date || null,
    due_date: d.due_date || (scheduled_at ? schedDate : null) || null,
    scheduled_at,
    deadline: dlDate ? zonedToInstant(dlDate, dlTime || '23:59', tz).toISOString() : null,
    estimated_minutes: num(d.estimated_minutes),
    actual_minutes: num(d.actual_minutes),
    category_id: d.category_id || null,
    project_id: d.project_id || null,
    goal_id: d.goal_id || null,
    tags: [...new Set(d.tags.split(',').map((s) => s.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))],
    checklist: d.checklist.filter((c) => c.text.trim()),
    links: d.links.filter((l) => l.url.trim()),
    notes: d.notes,
    recurrence: d.recurrence,
    reminder_offsets: d.reminder_offsets,
  }
}

export function TaskEditor({
  open,
  onClose,
  task,
  initial,
  parentId,
}: {
  open: boolean
  onClose: () => void
  task?: Task | null
  initial?: Partial<Task>
  parentId?: string | null
}) {
  const { tz, settings } = useSettings()
  const lookups = useLookups()
  const actions = useTaskActions()
  const defaults = settings.notifications.task_default_offsets ?? []
  const [d, setD] = useState<Draft>(() => toDraft(task ?? initial ?? null, tz, defaults))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [newSub, setNewSub] = useState('')
  const subtasks = useList('tasks', task ? { filters: [eq('parent_id', task.id)], order: [{ field: 'sort_order' }, { field: 'created_at' }] } : undefined, { enabled: !!task })
  const history = useList('task_history', task ? { filters: [eq('task_id', task.id)], order: [{ field: 'created_at', ascending: false }], limit: 15 } : undefined, { enabled: !!task })

  useEffect(() => {
    if (open) {
      setD(toDraft(task ?? initial ?? null, tz, defaults))
      setError(null)
    }
  }, [open, task?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))

  const save = async () => {
    if (!d.title.trim()) return setError('Give the task a title.')
    if (d.start_date && d.due_date && d.start_date > d.due_date) return setError('The start date must be on or before the due date.')
    if (d.recurrence && !d.start_date && !d.due_date && !d.sched_date) return setError('A repeating task needs a start or due date to anchor it.')
    setSaving(true)
    const values = fromDraft(d, tz)
    const r = task ? await actions.update(task, values, 'Task saved') : await actions.create({ ...values, parent_id: parentId ?? null })
    setSaving(false)
    if (r) onClose()
  }

  const milestoneProjects = useMemo(() => lookups.projects, [lookups.projects])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : parentId ? 'New subtask' : 'New task'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {task ? 'Save' : 'Add task'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="Title" htmlFor="t-title" className="md:col-span-2" error={error ?? undefined}>
          <Input id="t-title" data-autofocus value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="What needs doing?" maxLength={300} />
        </Field>
        <Field label="Description" htmlFor="t-desc" className="md:col-span-2">
          <Textarea id="t-desc" value={d.description} onChange={(e) => set('description', e.target.value)} rows={2} />
        </Field>
        <Field label="Priority" htmlFor="t-pri">
          <Select id="t-pri" value={d.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
        <Field label="Status" htmlFor="t-status">
          <Select id="t-status" value={d.status} onChange={(e) => set('status', e.target.value as Task['status'])}>
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Start date" htmlFor="t-start">
          <Input id="t-start" type="date" value={d.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </Field>
        <Field label="Due date" htmlFor="t-due">
          <Input id="t-due" type="date" value={d.due_date} onChange={(e) => set('due_date', e.target.value)} />
        </Field>
        <Field label="Scheduled time" htmlFor="t-stime" hint="Places the task on your calendar and planner.">
          <div className="flex gap-2">
            <Input id="t-sdate" aria-label="Scheduled date" type="date" value={d.sched_date} onChange={(e) => set('sched_date', e.target.value)} />
            <Input id="t-stime" type="time" value={d.sched_time} onChange={(e) => set('sched_time', e.target.value)} className="w-32" />
          </div>
        </Field>
        <Field label="Hard deadline" htmlFor="t-deadline">
          <Input id="t-deadline" type="datetime-local" value={d.deadline} onChange={(e) => set('deadline', e.target.value)} />
        </Field>
        <Field label="Estimate (minutes)" htmlFor="t-est">
          <Input id="t-est" type="number" min={1} max={1440} inputMode="numeric" value={d.estimated_minutes} onChange={(e) => set('estimated_minutes', e.target.value)} />
        </Field>
        <Field label="Actual (minutes)" htmlFor="t-act">
          <Input id="t-act" type="number" min={0} inputMode="numeric" value={d.actual_minutes} onChange={(e) => set('actual_minutes', e.target.value)} />
        </Field>
        <Field label="Project" htmlFor="t-proj" hint={task?.project_id && task?.project_id === d.project_id ? <Link to={linkTo.project(task?.project_id)} className="text-accent hover:underline">Open project</Link> : undefined}>
          <Select id="t-proj" value={d.project_id} onChange={(e) => set('project_id', e.target.value)}>
            <option value="">None</option>
            {milestoneProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Goal" htmlFor="t-goal" hint={task?.goal_id && task?.goal_id === d.goal_id ? <Link to={linkTo.goal(task?.goal_id)} className="text-accent hover:underline">Open goal</Link> : undefined}>
          <Select id="t-goal" value={d.goal_id} onChange={(e) => set('goal_id', e.target.value)}>
            <option value="">None</option>
            {lookups.goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category" htmlFor="t-cat">
          <Select id="t-cat" value={d.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">None</option>
            {lookups.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tags" htmlFor="t-tags" hint="Separate with commas.">
          <Input id="t-tags" value={d.tags} onChange={(e) => set('tags', e.target.value)} placeholder="study, fat" />
        </Field>

        <div className="md:col-span-2">
          <RecurrenceEditor idPrefix="t-rec" value={d.recurrence} onChange={(r) => set('recurrence', r)} />
        </div>

        <fieldset className="md:col-span-2">
          <legend className="mb-1.5 text-xs font-semibold text-muted">Remind me</legend>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_CHOICES.map((c) => {
              const on = d.reminder_offsets.includes(c.v)
              return (
                <button
                  key={c.v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('reminder_offsets', on ? d.reminder_offsets.filter((x) => x !== c.v) : [...d.reminder_offsets, c.v].sort((a, b) => a - b))}
                  className={on ? 'rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-fg' : 'rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-surface-2'}
                >
                  {c.v === 0 ? c.label : `${c.label} before`}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-subtle">Uses the scheduled time, else the deadline, else 9:00 on the due date.</p>
        </fieldset>

        <fieldset className="md:col-span-2">
          <legend className="mb-1.5 text-xs font-semibold text-muted">Checklist</legend>
          <div className="flex flex-col gap-1.5">
            {d.checklist.map((c, i) => (
              <div key={c.id} className="flex items-center gap-2">
                <Checkbox checked={c.done} label={`Checklist item ${i + 1} done`} onChange={(v) => set('checklist', d.checklist.map((x) => (x.id === c.id ? { ...x, done: v } : x)))} />
                <Input aria-label={`Checklist item ${i + 1}`} value={c.text} onChange={(e) => set('checklist', d.checklist.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))} className="h-9" />
                <Button variant="ghost" size="icon-sm" aria-label="Remove item" onClick={() => set('checklist', d.checklist.filter((x) => x.id !== c.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="self-start" onClick={() => set('checklist', [...d.checklist, { id: uid(), text: '', done: false }])}>
              <Plus className="h-4 w-4" /> Add item
            </Button>
          </div>
        </fieldset>

        <fieldset className="md:col-span-2">
          <legend className="mb-1.5 text-xs font-semibold text-muted">Links</legend>
          <div className="flex flex-col gap-1.5">
            {d.links.map((l, i) => (
              <div key={l.id} className="flex items-center gap-2">
                <Link2 className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                <Input aria-label={`Link ${i + 1} label`} placeholder="Label" value={l.label} onChange={(e) => set('links', d.links.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)))} className="h-9 w-1/3" />
                <Input aria-label={`Link ${i + 1} URL`} placeholder="https://" type="url" value={l.url} onChange={(e) => set('links', d.links.map((x) => (x.id === l.id ? { ...x, url: e.target.value } : x)))} className="h-9" />
                <Button variant="ghost" size="icon-sm" aria-label="Remove link" onClick={() => set('links', d.links.filter((x) => x.id !== l.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="self-start" onClick={() => set('links', [...d.links, { id: uid(), label: '', url: '' }])}>
              <Plus className="h-4 w-4" /> Add link
            </Button>
          </div>
        </fieldset>

        <Field label="Notes" htmlFor="t-notes" className="md:col-span-2">
          <Textarea id="t-notes" value={d.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
        </Field>

        {task && (
          <div className="md:col-span-2">
            <p className="mb-1.5 text-xs font-semibold text-muted">Subtasks</p>
            <ul className="flex flex-col gap-1">
              {(subtasks.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-lg px-1 py-1">
                  <Checkbox
                    round
                    checked={s.status === 'done'}
                    label={`Complete ${s.title}`}
                    onChange={(v) => void actions.update(s, { status: v ? 'done' : 'todo', completed_at: v ? new Date().toISOString() : null })}
                  />
                  <span className={s.status === 'done' ? 'text-muted line-through' : ''}>{s.title}</span>
                  <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Delete ${s.title}`} onClick={() => void actions.remove(s)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex gap-2">
              <Input
                aria-label="New subtask"
                placeholder="Add a subtask"
                value={newSub}
                className="h-9"
                onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (newSub.trim()) void actions.create({ title: newSub.trim(), parent_id: task.id, project_id: task.project_id, goal_id: task.goal_id }).then(() => setNewSub(''))
                  }
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                className="h-9"
                onClick={() => newSub.trim() && void actions.create({ title: newSub.trim(), parent_id: task.id, project_id: task.project_id, goal_id: task.goal_id }).then(() => setNewSub(''))}
              >
                Add
              </Button>
            </div>
          </div>
        )}

        {task && (history.data?.length ?? 0) > 0 && (
          <details className="md:col-span-2">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted">
              <History className="h-3.5 w-3.5" /> History
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
              {history.data!.map((h) => (
                <li key={h.id}>
                  <span className="tabular">{formatInstant(h.created_at, tz, 'd MMM, HH:mm')}</span> · {h.action.replace(/_/g, ' ')}
                  {h.action === 'updated' && Object.keys(h.changes).length ? ` (${Object.keys(h.changes).join(', ').replace(/_/g, ' ')})` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
