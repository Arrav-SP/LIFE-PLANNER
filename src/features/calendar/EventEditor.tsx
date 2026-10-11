import { useEffect, useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { ColorPicker } from '@/components/ColorPicker'
import { RecurrenceEditor } from '@/components/RecurrenceEditor'
import { useSettings } from '@/settings/SettingsProvider'
import { useLookups } from '@/lib/lookups'
import { addDays, dateKey, formatTime, timeOf, zonedToInstant } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { REMINDER_CHOICES } from '@/features/tasks/TaskEditor'
import type { CalendarEvent, Recurrence } from '@/lib/db/types'
import type { EventInstance } from './logic'
import { useEventActions, type Scope } from './actions'

const schema = z
  .object({
    title: z.string().trim().min(1, 'Give the event a title.').max(300),
    all_day: z.boolean(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
    start_time: z.string(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
    end_time: z.string(),
    location: z.string().max(300),
    meeting_url: z.string().trim().refine((s) => s === '' || /^https?:\/\//i.test(s), 'Use a full link starting with https://'),
    description: z.string().max(5000),
    notes: z.string().max(10000),
    category_id: z.string(),
    project_id: z.string(),
    goal_id: z.string(),
    color: z.string().nullable(),
    tags: z.string(),
    recurrence: z.custom<Recurrence | null>(),
    reminder_offsets: z.array(z.number()),
  })
  .superRefine((v, ctx) => {
    if (!v.all_day && (!v.start_time || !v.end_time)) ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'Set a start and end time, or make it all day.' })
    const s = `${v.start_date}T${v.all_day ? '00:00' : v.start_time}`
    const e = `${v.end_date}T${v.all_day ? '00:00' : v.end_time}`
    if (v.all_day ? v.end_date < v.start_date : e <= s) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'The event must end after it starts.' })
  })
type Form = z.infer<typeof schema>

export interface EditorTarget {
  /** Existing event (series) being edited. */
  event?: CalendarEvent
  /** The clicked occurrence, when editing a single occurrence. */
  instance?: EventInstance
  scope?: Scope
  /** Defaults for a new event. */
  start?: Date
  end?: Date
  allDay?: boolean
  title?: string
}

export function EventEditor({
  target,
  onClose,
  busy,
  onSaved,
}: {
  target: EditorTarget | null
  onClose: () => void
  busy: { key: string; title: string; start: Date; end: Date; allDay: boolean }[]
  onSaved?: (ev: CalendarEvent) => void
}) {
  const { tz, settings } = useSettings()
  const lookups = useLookups()
  const actions = useEventActions()
  const ev = target?.event ?? target?.instance?.event
  const oneOnly = target?.scope === 'one' && !!target.instance

  const defaults = (): Form => {
    const inst = target?.instance
    const start = oneOnly && inst ? inst.start : ev ? new Date(ev.start_at) : target?.start ?? zonedToInstant(dateKey(new Date(), tz), `${String(Math.min(22, new Date().getHours() + 1)).padStart(2, '0')}:00`, tz)
    const end = oneOnly && inst ? inst.end : ev ? new Date(ev.end_at) : target?.end ?? new Date(start.getTime() + 3600000)
    const allDay = oneOnly && inst ? inst.allDay : ev ? ev.all_day : target?.allDay ?? false
    // All-day ends are exclusive midnights; show the inclusive last day.
    const endKey = allDay ? addDays(dateKey(end, tz), dateKey(end, tz) > dateKey(start, tz) ? -1 : 0) : dateKey(end, tz)
    return {
      title: (oneOnly && inst ? inst.title : ev?.title) ?? target?.title ?? '',
      all_day: allDay,
      start_date: dateKey(start, tz),
      start_time: allDay ? '' : timeOf(start, tz),
      end_date: endKey,
      end_time: allDay ? '' : timeOf(end, tz),
      location: (oneOnly && inst ? inst.location : ev?.location) ?? '',
      meeting_url: (oneOnly ? inst?.exception?.override.meeting_url : undefined) ?? ev?.meeting_url ?? '',
      description: (oneOnly ? inst?.exception?.override.description : undefined) ?? ev?.description ?? '',
      notes: (oneOnly ? inst?.exception?.override.notes : undefined) ?? ev?.notes ?? '',
      category_id: ev?.category_id ?? '',
      project_id: ev?.project_id ?? '',
      goal_id: ev?.goal_id ?? '',
      color: (oneOnly && inst ? inst.color : ev?.color) ?? null,
      tags: (ev?.tags ?? []).join(', '),
      recurrence: ev?.recurrence ?? null,
      reminder_offsets: ev?.reminder_offsets ?? settings.notifications.event_default_offsets ?? [10],
    }
  }

  const { register, handleSubmit, control, watch, reset, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: defaults() })
  useEffect(() => {
    if (target) reset(defaults())
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const v = watch()
  const span = (f: Form): { start: Date; end: Date } =>
    f.all_day
      ? { start: zonedToInstant(f.start_date, '00:00', tz), end: zonedToInstant(addDays(f.end_date, 1), '00:00', tz) }
      : { start: zonedToInstant(f.start_date, f.start_time || '00:00', tz), end: zonedToInstant(f.end_date, f.end_time || '00:00', tz) }

  const conflicts = useMemo(() => {
    if (!target || v.all_day || !v.start_time || !v.end_time) return []
    const { start, end } = span(v)
    const selfKey = target.instance?.key
    return busy.filter((b) => !b.allDay && b.key !== selfKey && (!ev || !b.key.startsWith(`${ev.id}:`) || oneOnly) && b.start < end && b.end > start)
  }, [v.all_day, v.start_date, v.start_time, v.end_date, v.end_time, busy, target]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = handleSubmit(async (f) => {
    const { start, end } = span(f)
    let ok: unknown
    if (oneOnly && target?.instance) {
      ok = await actions.overrideOccurrence(target.instance, {
        title: f.title.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: f.all_day,
        location: f.location,
        meeting_url: f.meeting_url,
        description: f.description,
        notes: f.notes,
        color: f.color,
      })
    } else {
      const values: Partial<CalendarEvent> = {
        title: f.title.trim(),
        all_day: f.all_day,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        location: f.location,
        meeting_url: f.meeting_url,
        description: f.description,
        notes: f.notes,
        category_id: f.category_id || null,
        project_id: f.project_id || null,
        goal_id: f.goal_id || null,
        color: f.color,
        tags: [...new Set(f.tags.split(',').map((s) => s.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))],
        recurrence: f.recurrence,
        reminder_offsets: f.reminder_offsets,
      }
      const saved = ev ? await actions.update(ev, { ...values, timezone: ev.timezone || tz }) : await actions.create(values)
      if (saved) onSaved?.(saved)
      ok = saved
    }
    if (ok !== null) onClose()
  })

  const title = !ev ? 'New event' : oneOnly ? 'Edit this occurrence' : ev.recurrence ? 'Edit all events in series' : 'Edit event'

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          {ev && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                const r = await actions.remove(target?.instance ?? { event: ev }, oneOnly ? 'one' : 'all')
                if (r !== null) onClose()
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> {oneOnly ? 'Delete this one' : 'Delete'}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={formState.isSubmitting}>
            {ev ? 'Save' : 'Add event'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => void submit(e)}>
        <Field label="Title" htmlFor="e-title" className="md:col-span-2" error={formState.errors.title?.message}>
          <Input id="e-title" data-autofocus placeholder="e.g. DBMS lab" {...register('title')} />
        </Field>
        <div className="flex items-center gap-2 md:col-span-2">
          <Controller control={control} name="all_day" render={({ field }) => <Checkbox checked={field.value} onChange={field.onChange} label="All day" />} />
          <span className="text-sm">All day</span>
        </div>
        <Field label="Starts" error={formState.errors.start_date?.message}>
          <div className="flex gap-2">
            <Input aria-label="Start date" type="date" {...register('start_date')} />
            {!v.all_day && <Input aria-label="Start time" type="time" className="w-32" {...register('start_time')} />}
          </div>
        </Field>
        <Field label="Ends" error={formState.errors.end_date?.message ?? formState.errors.end_time?.message}>
          <div className="flex gap-2">
            <Input aria-label="End date" type="date" {...register('end_date')} />
            {!v.all_day && <Input aria-label="End time" type="time" className="w-32" {...register('end_time')} />}
          </div>
        </Field>
        {conflicts.length > 0 && (
          <div role="status" className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning md:col-span-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Overlaps with {conflicts.slice(0, 3).map((c) => `“${c.title}” (${formatTime(c.start, tz, settings.time_format)})`).join(', ')}
              {conflicts.length > 3 && ` and ${conflicts.length - 3} more`}. You can still save it.
            </span>
          </div>
        )}
        {!oneOnly && (
          <div className="md:col-span-2">
            <Controller control={control} name="recurrence" render={({ field }) => <RecurrenceEditor idPrefix="e-rec" value={field.value ?? null} onChange={field.onChange} />} />
          </div>
        )}
        <Field label="Location" htmlFor="e-loc">
          <Input id="e-loc" placeholder="e.g. SJT 512" {...register('location')} />
        </Field>
        <Field label="Meeting link" htmlFor="e-url" error={formState.errors.meeting_url?.message}>
          <Input id="e-url" type="url" placeholder="https://" {...register('meeting_url')} />
        </Field>
        {!oneOnly && (
          <>
            <Field label="Category" htmlFor="e-cat">
              <Select id="e-cat" {...register('category_id')}>
                <option value="">None</option>
                {lookups.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tags" htmlFor="e-tags" hint="Comma separated">
              <Input id="e-tags" {...register('tags')} />
            </Field>
            <Field label="Project" htmlFor="e-proj">
              <Select id="e-proj" {...register('project_id')}>
                <option value="">None</option>
                {lookups.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Goal" htmlFor="e-goal">
              <Select id="e-goal" {...register('goal_id')}>
                <option value="">None</option>
                {lookups.goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reminders" className="md:col-span-2">
              <Controller
                control={control}
                name="reminder_offsets"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reminders">
                    {REMINDER_CHOICES.map((c) => {
                      const on = field.value.includes(c.v)
                      return (
                        <button
                          key={c.v}
                          type="button"
                          aria-pressed={on}
                          onClick={() => field.onChange(on ? field.value.filter((x) => x !== c.v) : [...field.value, c.v].sort((a, b) => a - b))}
                          className={cn('rounded-full border px-3 py-1 text-sm', on ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:bg-surface-2')}
                        >
                          {c.v === 0 ? c.label : `${c.label} before`}
                        </button>
                      )
                    })}
                  </div>
                )}
              />
            </Field>
          </>
        )}
        <Field label="Color" className="md:col-span-2">
          <Controller
            control={control}
            name="color"
            render={({ field }) => (
              <div className="flex flex-wrap items-center gap-3">
                <ColorPicker value={field.value ?? ''} onChange={field.onChange} />
                {field.value && (
                  <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => field.onChange(null)}>
                    Use default
                  </button>
                )}
              </div>
            )}
          />
        </Field>
        <Field label="Description" htmlFor="e-desc" className="md:col-span-2">
          <Textarea id="e-desc" rows={2} {...register('description')} />
        </Field>
        <Field label="Notes" htmlFor="e-notes" className="md:col-span-2">
          <Textarea id="e-notes" rows={2} {...register('notes')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
