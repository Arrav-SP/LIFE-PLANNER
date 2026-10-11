import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Field'
import { ColorPicker } from '@/components/ColorPicker'
import { useSettings } from '@/settings/SettingsProvider'
import { useLookups } from '@/lib/lookups'
import { getStore } from '@/lib/db'
import { useInvalidate } from '@/lib/db/hooks'
import { orderedWeekdays, WEEKDAY_SHORT } from '@/lib/dates'
import { toast } from '@/components/ui/toast'
import { cn, errorMessage } from '@/lib/utils'
import { syncHabitReminders } from '@/features/reminders/sync'
import type { Habit, HabitSchedule, Weekday } from '@/lib/db/types'

const schema = z
  .object({
    name: z.string().trim().min(1, 'Give the habit a name.').max(120),
    description: z.string().max(2000),
    kind: z.enum(['check', 'numeric']),
    target_value: z.string(),
    unit: z.string().max(30),
    scheduleType: z.enum(['daily', 'days', 'weekly', 'interval']),
    days: z.array(z.number().int().min(0).max(6)),
    timesPerWeek: z.coerce.number().int().min(1).max(7),
    everyDays: z.coerce.number().int().min(1).max(365),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date.'),
    reminder_time: z.string(),
    color: z.string(),
    goal_id: z.string(),
    show_on_dashboard: z.boolean(),
    show_in_planner: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.scheduleType === 'days' && v.days.length === 0) ctx.addIssue({ code: 'custom', path: ['days'], message: 'Pick at least one day.' })
    if (v.kind === 'numeric' && !(Number(v.target_value) > 0)) ctx.addIssue({ code: 'custom', path: ['target_value'], message: 'Enter a daily target above zero.' })
  })
type Form = z.infer<typeof schema>

function toForm(h: Habit | null | undefined, today: string): Form {
  const s = h?.schedule ?? { type: 'daily' }
  return {
    name: h?.name ?? '',
    description: h?.description ?? '',
    kind: h?.kind ?? 'check',
    target_value: h?.target_value ? String(h.target_value) : '',
    unit: h?.unit ?? '',
    scheduleType: s.type,
    days: s.type === 'days' ? s.days : [1, 2, 3, 4, 5],
    timesPerWeek: s.type === 'weekly' ? s.timesPerWeek : 3,
    everyDays: s.type === 'interval' ? s.everyDays : 2,
    start_date: h?.start_date ?? today,
    reminder_time: h?.reminder_time?.slice(0, 5) ?? '',
    color: h?.color ?? '#0f766e',
    goal_id: h?.goal_id ?? '',
    show_on_dashboard: h?.show_on_dashboard ?? true,
    show_in_planner: h?.show_in_planner ?? true,
  }
}

export function HabitEditor({ open, onClose, habit }: { open: boolean; onClose: () => void; habit?: Habit | null }) {
  const { today, tz, settings } = useSettings()
  const { goals } = useLookups()
  const invalidate = useInvalidate()
  const { register, handleSubmit, control, watch, reset, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: toForm(habit, today) })

  useEffect(() => {
    if (open) reset(toForm(habit, today))
  }, [open, habit?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const kind = watch('kind')
  const scheduleType = watch('scheduleType')
  const errs = formState.errors

  const submit = handleSubmit(async (f) => {
    const schedule: HabitSchedule =
      f.scheduleType === 'days'
        ? { type: 'days', days: [...f.days].sort() as Weekday[] }
        : f.scheduleType === 'weekly'
          ? { type: 'weekly', timesPerWeek: f.timesPerWeek }
          : f.scheduleType === 'interval'
            ? { type: 'interval', everyDays: f.everyDays }
            : { type: 'daily' }
    const values = {
      name: f.name.trim(),
      description: f.description,
      kind: f.kind,
      target_value: f.kind === 'numeric' ? Number(f.target_value) : null,
      unit: f.kind === 'numeric' ? f.unit.trim() : '',
      schedule,
      start_date: f.start_date,
      reminder_time: f.reminder_time || null,
      color: f.color,
      goal_id: f.goal_id || null,
      show_on_dashboard: f.show_on_dashboard,
      show_in_planner: f.show_in_planner,
    }
    try {
      const saved = habit ? await getStore().update('habits', habit.id, values) : await getStore().insert('habits', { ...values, icon: '', sort_order: Date.now() % 1e9 })
      await syncHabitReminders(saved, tz)
      invalidate('habits')
      toast.success(habit ? 'Habit saved' : 'Habit added')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={habit ? 'Edit habit' : 'New habit'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={formState.isSubmitting}>
            {habit ? 'Save' : 'Add habit'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => void submit(e)}>
        <Field label="Name" htmlFor="h-name" className="md:col-span-2" error={errs.name?.message}>
          <Input id="h-name" data-autofocus placeholder="e.g. Solve 5 DSA problems" {...register('name')} />
        </Field>
        <Field label="Type" htmlFor="h-kind">
          <Select id="h-kind" {...register('kind')}>
            <option value="check">Yes / no</option>
            <option value="numeric">Count or amount</option>
          </Select>
        </Field>
        {kind === 'numeric' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Daily target" htmlFor="h-target" error={errs.target_value?.message}>
              <Input id="h-target" type="number" min={0} step="any" inputMode="decimal" {...register('target_value')} />
            </Field>
            <Field label="Unit" htmlFor="h-unit">
              <Input id="h-unit" placeholder="problems" {...register('unit')} />
            </Field>
          </div>
        ) : (
          <div className="hidden md:block" />
        )}
        <Field label="How often" htmlFor="h-sched">
          <Select id="h-sched" {...register('scheduleType')}>
            <option value="daily">Every day</option>
            <option value="days">On specific days</option>
            <option value="weekly">Some times a week</option>
            <option value="interval">Every few days</option>
          </Select>
        </Field>
        <div>
          {scheduleType === 'days' && (
            <Field label="Days" error={errs.days?.message}>
              <Controller
                control={control}
                name="days"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                    {orderedWeekdays(settings.week_start).map((d) => {
                      const on = field.value.includes(d)
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => field.onChange(on ? field.value.filter((x) => x !== d) : [...field.value, d])}
                          className={cn('h-9 w-11 rounded-lg border text-sm font-medium', on ? 'border-accent bg-accent text-accent-fg' : 'border-line hover:bg-surface-2')}
                        >
                          {WEEKDAY_SHORT[d]}
                        </button>
                      )
                    })}
                  </div>
                )}
              />
            </Field>
          )}
          {scheduleType === 'weekly' && (
            <Field label="Times per week" htmlFor="h-tpw" error={errs.timesPerWeek?.message}>
              <Input id="h-tpw" type="number" min={1} max={7} {...register('timesPerWeek')} />
            </Field>
          )}
          {scheduleType === 'interval' && (
            <Field label="Every N days" htmlFor="h-every" error={errs.everyDays?.message}>
              <Input id="h-every" type="number" min={1} {...register('everyDays')} />
            </Field>
          )}
        </div>
        <Field label="Start date" htmlFor="h-start" error={errs.start_date?.message}>
          <Input id="h-start" type="date" {...register('start_date')} />
        </Field>
        <Field label="Reminder" htmlFor="h-rem" hint="Optional. Sent on scheduled days.">
          <Input id="h-rem" type="time" {...register('reminder_time')} />
        </Field>
        <Field label="Linked goal" htmlFor="h-goal">
          <Select id="h-goal" {...register('goal_id')}>
            <option value="">None</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Color">
          <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />
        </Field>
        <Field label="Notes" htmlFor="h-desc" className="md:col-span-2">
          <Textarea id="h-desc" rows={2} {...register('description')} />
        </Field>
        <div className="flex flex-col gap-3 md:col-span-2">
          <Controller control={control} name="show_on_dashboard" render={({ field }) => <Switch checked={field.value} onChange={field.onChange} label="Show on dashboard" />} />
          <Controller control={control} name="show_in_planner" render={({ field }) => <Switch checked={field.value} onChange={field.onChange} label="Show in day planner" />} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
