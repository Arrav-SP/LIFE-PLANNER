import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Trash2 } from 'lucide-react'
import { Dialog, confirm } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { ColorPicker } from '@/components/ColorPicker'
import { RecurrenceEditor } from '@/components/RecurrenceEditor'
import { getStore } from '@/lib/db'
import { useInvalidate } from '@/lib/db/hooks'
import { useLookups } from '@/lib/lookups'
import { toast } from '@/components/ui/toast'
import { useSettings } from '@/settings/SettingsProvider'
import { dateKey, timeOf, zonedToInstant } from '@/lib/dates'
import { errorMessage } from '@/lib/utils'
import type { Recurrence, TimeBlock } from '@/lib/db/types'

const schema = z
  .object({
    title: z.string().trim().min(1, 'Give the block a name.').max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
    start: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a start time.'),
    end: z.string().regex(/^\d{2}:\d{2}$/, 'Pick an end time.'),
    category_id: z.string(),
    color: z.string().nullable(),
    notes: z.string().max(5000),
    recurrence: z.custom<Recurrence | null>(),
  })
  .refine((v) => v.end > v.start, { path: ['end'], message: 'The block must end after it starts.' })
type Form = z.infer<typeof schema>

export interface BlockTarget {
  block?: TimeBlock
  date?: string
  start?: string
  end?: string
  title?: string
  task_id?: string | null
  task_occurrence_date?: string | null
}

export function BlockEditor({ target, onClose }: { target: BlockTarget | null; onClose: () => void }) {
  const { tz } = useSettings()
  const { categories } = useLookups()
  const invalidate = useInvalidate()
  const b = target?.block
  const defaults = (): Form => ({
    title: b?.title ?? target?.title ?? '',
    date: b ? dateKey(b.start_at, tz) : target?.date ?? dateKey(new Date(), tz),
    start: b ? timeOf(b.start_at, tz) : target?.start ?? '09:00',
    end: b ? timeOf(b.end_at, tz) : target?.end ?? '10:00',
    category_id: b?.category_id ?? '',
    color: b?.color ?? null,
    notes: b?.notes ?? '',
    recurrence: b?.recurrence ?? null,
  })
  const { register, handleSubmit, control, reset, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: defaults() })
  useEffect(() => {
    if (target) reset(defaults())
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = handleSubmit(async (f) => {
    const values = {
      title: f.title.trim(),
      start_at: zonedToInstant(f.date, f.start, tz).toISOString(),
      end_at: zonedToInstant(f.date, f.end, tz).toISOString(),
      category_id: f.category_id || null,
      color: f.color,
      notes: f.notes,
      recurrence: f.recurrence,
    }
    try {
      if (b) await getStore().update('time_blocks', b.id, values)
      else await getStore().insert('time_blocks', { ...values, task_id: target?.task_id ?? null, task_occurrence_date: target?.task_occurrence_date ?? null, status: 'planned' })
      invalidate('time_blocks')
      toast.success(b ? 'Block saved' : 'Block added')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  })

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      title={b ? (b.recurrence ? 'Edit routine' : 'Edit time block') : 'New time block'}
      footer={
        <>
          {b && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                if (!(await confirm({ title: b.recurrence ? 'Delete this routine?' : 'Delete this block?', message: b.recurrence ? 'It will be removed from every day it repeats on.' : undefined, confirmLabel: 'Delete', danger: true }))) return
                try {
                  await getStore().remove('time_blocks', b.id)
                  invalidate('time_blocks')
                  toast.success('Block deleted')
                  onClose()
                } catch (e) {
                  toast.error(errorMessage(e))
                }
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form className="grid grid-cols-2 gap-4" onSubmit={(e) => void submit(e)}>
        <Field label="What" htmlFor="b-title" className="col-span-2" error={formState.errors.title?.message}>
          <Input id="b-title" data-autofocus placeholder="e.g. Deep work: DSA" {...register('title')} />
        </Field>
        <Field label={b?.recurrence ? 'First day' : 'Day'} htmlFor="b-date" className="col-span-2" error={formState.errors.date?.message}>
          <Input id="b-date" type="date" {...register('date')} />
        </Field>
        <Field label="From" htmlFor="b-start" error={formState.errors.start?.message}>
          <Input id="b-start" type="time" {...register('start')} />
        </Field>
        <Field label="To" htmlFor="b-end" error={formState.errors.end?.message}>
          <Input id="b-end" type="time" {...register('end')} />
        </Field>
        <div className="col-span-2">
          <Controller control={control} name="recurrence" render={({ field }) => <RecurrenceEditor idPrefix="b-rec" value={field.value ?? null} onChange={field.onChange} />} />
        </div>
        <Field label="Category" htmlFor="b-cat" className="col-span-2">
          <Select id="b-cat" {...register('category_id')}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Color" className="col-span-2">
          <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value ?? ''} onChange={field.onChange} />} />
        </Field>
        <Field label="Notes" htmlFor="b-notes" className="col-span-2">
          <Textarea id="b-notes" rows={2} {...register('notes')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
