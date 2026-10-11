import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { ColorPicker } from '@/components/ColorPicker'
import { getStore } from '@/lib/db'
import { useInvalidate } from '@/lib/db/hooks'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/lib/utils'
import { useLookups } from '@/lib/lookups'
import type { Goal, Project } from '@/lib/db/types'

const optNum = z.string().refine((s) => s.trim() === '' || Number.isFinite(Number(s)), 'Enter a number.')

const goalSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the goal a title.').max(200),
    description: z.string().max(5000),
    status: z.enum(['active', 'paused', 'completed', 'abandoned']),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    target_date: z.string(),
    progress_mode: z.enum(['tasks', 'milestones', 'metric', 'manual']),
    metric_unit: z.string().max(30),
    metric_start: optNum,
    metric_target: optNum,
    manual_progress: optNum,
    color: z.string(),
    notes: z.string().max(10000),
  })
  .superRefine((v, ctx) => {
    if (v.progress_mode === 'metric' && v.metric_target.trim() === '') ctx.addIssue({ code: 'custom', path: ['metric_target'], message: 'Set a target value.' })
  })
type GoalForm = z.infer<typeof goalSchema>

const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))
const n = (v: string) => (v.trim() === '' ? null : Number(v))

export function GoalEditor({ open, onClose, goal, onSaved }: { open: boolean; onClose: () => void; goal?: Goal | null; onSaved?: (g: Goal) => void }) {
  const invalidate = useInvalidate()
  const defaults = (): GoalForm => ({
    title: goal?.title ?? '',
    description: goal?.description ?? '',
    status: goal?.status ?? 'active',
    priority: goal?.priority ?? 'normal',
    target_date: goal?.target_date ?? '',
    progress_mode: goal?.progress_mode ?? 'tasks',
    metric_unit: goal?.metric_unit ?? '',
    metric_start: s(goal?.metric_start ?? 0),
    metric_target: s(goal?.metric_target),
    manual_progress: s(goal?.manual_progress ?? 0),
    color: goal?.color ?? '#2563eb',
    notes: goal?.notes ?? '',
  })
  const { register, handleSubmit, control, watch, reset, formState } = useForm<GoalForm>({ resolver: zodResolver(goalSchema), defaultValues: defaults() })
  useEffect(() => {
    if (open) reset(defaults())
  }, [open, goal?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const mode = watch('progress_mode')
  const e = formState.errors

  const submit = handleSubmit(async (f) => {
    const values = {
      title: f.title.trim(),
      description: f.description,
      status: f.status,
      priority: f.priority,
      target_date: f.target_date || null,
      progress_mode: f.progress_mode,
      metric_unit: f.metric_unit || null,
      metric_start: n(f.metric_start),
      metric_target: n(f.metric_target),
      manual_progress: n(f.manual_progress),
      color: f.color,
      notes: f.notes,
      completed_at: f.status === 'completed' ? goal?.completed_at ?? new Date().toISOString() : null,
    }
    try {
      const saved = goal ? await getStore().update('goals', goal.id, values) : await getStore().insert('goals', values)
      invalidate('goals')
      toast.success(goal ? 'Goal saved' : 'Goal created')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={goal ? 'Edit goal' : 'New goal'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={formState.isSubmitting}>
            {goal ? 'Save' : 'Create goal'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(ev) => void submit(ev)}>
        <Field label="Title" htmlFor="g-title" className="md:col-span-2" error={e.title?.message}>
          <Input id="g-title" data-autofocus placeholder="e.g. Finish Andrew Ng's ML Specialization" {...register('title')} />
        </Field>
        <Field label="Why it matters" htmlFor="g-desc" className="md:col-span-2">
          <Textarea id="g-desc" rows={2} {...register('description')} />
        </Field>
        <Field label="Target date" htmlFor="g-date">
          <Input id="g-date" type="date" {...register('target_date')} />
        </Field>
        <Field label="Status" htmlFor="g-status">
          <Select id="g-status" {...register('status')}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="abandoned">Abandoned</option>
          </Select>
        </Field>
        <Field label="Priority" htmlFor="g-pri">
          <Select id="g-pri" {...register('priority')}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
        <Field label="Measure progress by" htmlFor="g-mode">
          <Select id="g-mode" {...register('progress_mode')}>
            <option value="tasks">Linked tasks completed</option>
            <option value="milestones">Milestones reached</option>
            <option value="metric">A number (e.g. chapters, kg)</option>
            <option value="manual">Manual percentage</option>
          </Select>
        </Field>
        {mode === 'metric' && (
          <div className="grid grid-cols-3 gap-2 md:col-span-2">
            <Field label="Start" htmlFor="g-ms" error={e.metric_start?.message}>
              <Input id="g-ms" inputMode="decimal" {...register('metric_start')} />
            </Field>
            <Field label="Target" htmlFor="g-mt" error={e.metric_target?.message}>
              <Input id="g-mt" inputMode="decimal" {...register('metric_target')} />
            </Field>
            <Field label="Unit" htmlFor="g-mu">
              <Input id="g-mu" placeholder="chapters" {...register('metric_unit')} />
            </Field>
          </div>
        )}
        {mode === 'manual' && (
          <Field label="Progress (%)" htmlFor="g-man" error={e.manual_progress?.message}>
            <Input id="g-man" type="number" min={0} max={100} {...register('manual_progress')} />
          </Field>
        )}
        <Field label="Color" className="md:col-span-2">
          <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />
        </Field>
        <Field label="Notes" htmlFor="g-notes" className="md:col-span-2">
          <Textarea id="g-notes" rows={3} {...register('notes')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

const projectSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the project a name.').max(200),
    description: z.string().max(5000),
    status: z.enum(['planned', 'active', 'on_hold', 'completed', 'cancelled']),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    goal_id: z.string(),
    start_date: z.string(),
    target_date: z.string(),
    color: z.string(),
    notes: z.string().max(10000),
  })
  .refine((v) => !v.start_date || !v.target_date || v.start_date <= v.target_date, { path: ['target_date'], message: 'The target date must be after the start date.' })
type ProjectForm = z.infer<typeof projectSchema>

export function ProjectEditor({ open, onClose, project, goalId, onSaved }: { open: boolean; onClose: () => void; project?: Project | null; goalId?: string | null; onSaved?: (p: Project) => void }) {
  const invalidate = useInvalidate()
  const { goals } = useLookups()
  const defaults = (): ProjectForm => ({
    name: project?.name ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'active',
    priority: project?.priority ?? 'normal',
    goal_id: project?.goal_id ?? goalId ?? '',
    start_date: project?.start_date ?? '',
    target_date: project?.target_date ?? '',
    color: project?.color ?? '#7c3aed',
    notes: project?.notes ?? '',
  })
  const { register, handleSubmit, control, reset, formState } = useForm<ProjectForm>({ resolver: zodResolver(projectSchema), defaultValues: defaults() })
  useEffect(() => {
    if (open) reset(defaults())
  }, [open, project?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const e = formState.errors

  const submit = handleSubmit(async (f) => {
    const values = {
      ...f,
      name: f.name.trim(),
      goal_id: f.goal_id || null,
      start_date: f.start_date || null,
      target_date: f.target_date || null,
      completed_at: f.status === 'completed' ? project?.completed_at ?? new Date().toISOString() : null,
    }
    try {
      const saved = project ? await getStore().update('projects', project.id, values) : await getStore().insert('projects', values)
      invalidate('projects')
      toast.success(project ? 'Project saved' : 'Project created')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : 'New project'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={formState.isSubmitting}>
            {project ? 'Save' : 'Create project'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(ev) => void submit(ev)}>
        <Field label="Name" htmlFor="p-name" className="md:col-span-2" error={e.name?.message}>
          <Input id="p-name" data-autofocus placeholder="e.g. Life Planner app" {...register('name')} />
        </Field>
        <Field label="Description" htmlFor="p-desc" className="md:col-span-2">
          <Textarea id="p-desc" rows={2} {...register('description')} />
        </Field>
        <Field label="Status" htmlFor="p-status">
          <Select id="p-status" {...register('status')}>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Priority" htmlFor="p-pri">
          <Select id="p-pri" {...register('priority')}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
        <Field label="Start date" htmlFor="p-start">
          <Input id="p-start" type="date" {...register('start_date')} />
        </Field>
        <Field label="Target date" htmlFor="p-target" error={e.target_date?.message}>
          <Input id="p-target" type="date" {...register('target_date')} />
        </Field>
        <Field label="Goal" htmlFor="p-goal" className="md:col-span-2">
          <Select id="p-goal" {...register('goal_id')}>
            <option value="">No goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Color" className="md:col-span-2">
          <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />
        </Field>
        <Field label="Notes" htmlFor="p-notes" className="md:col-span-2">
          <Textarea id="p-notes" rows={3} {...register('notes')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
