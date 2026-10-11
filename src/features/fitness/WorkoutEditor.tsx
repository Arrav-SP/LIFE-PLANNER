import { useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { Dialog, confirm } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { getStore } from '@/lib/db'
import { eq } from '@/lib/db/store'
import { useInvalidate } from '@/lib/db/hooks'
import { toast } from '@/components/ui/toast'
import { useSettings } from '@/settings/SettingsProvider'
import { dateKey, timeOf, zonedToInstant } from '@/lib/dates'
import { errorMessage, uid } from '@/lib/utils'
import type { Exercise, ExerciseMetric, Workout, WorkoutSet, WorkoutTemplate } from '@/lib/db/types'

interface SetDraft {
  key: string
  reps: string
  weight: string
  distance: string
  minutes: string
}
interface Block {
  key: string
  exercise_id: string
  sets: SetDraft[]
}

const emptySet = (): SetDraft => ({ key: uid(), reps: '', weight: '', distance: '', minutes: '' })
const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))

export function fieldsFor(metric: ExerciseMetric): ('reps' | 'weight' | 'distance' | 'minutes')[] {
  switch (metric) {
    case 'weight_reps':
      return ['weight', 'reps']
    case 'reps':
      return ['reps']
    case 'duration':
      return ['minutes']
    case 'distance':
      return ['distance']
    case 'distance_duration':
      return ['distance', 'minutes']
  }
}
const LABEL = { reps: 'Reps', weight: 'kg', distance: 'km', minutes: 'min' }

export function WorkoutEditor({
  open,
  onClose,
  workout,
  sets,
  exercises,
  template,
}: {
  open: boolean
  onClose: () => void
  workout?: Workout | null
  sets?: WorkoutSet[]
  exercises: Exercise[]
  template?: WorkoutTemplate | null
}) {
  const { tz, today } = useSettings()
  const invalidate = useInvalidate()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(today)
  const [time, setTime] = useState('07:00')
  const [duration, setDuration] = useState('')
  const [notes, setNotes] = useState('')
  const [blocks, setBlocks] = useState<Block[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    if (workout) {
      setTitle(workout.title)
      setDate(dateKey(workout.started_at, tz))
      setTime(timeOf(workout.started_at, tz))
      setDuration(workout.duration_minutes ? String(workout.duration_minutes) : '')
      setNotes(workout.notes)
      const byEx = new Map<string, Block>()
      for (const s of [...(sets ?? [])].sort((a, b) => a.set_index - b.set_index)) {
        if (!byEx.has(s.exercise_id)) byEx.set(s.exercise_id, { key: uid(), exercise_id: s.exercise_id, sets: [] })
        byEx.get(s.exercise_id)!.sets.push({ key: s.id, reps: s.reps?.toString() ?? '', weight: s.weight?.toString() ?? '', distance: s.distance_km?.toString() ?? '', minutes: s.duration_seconds ? String(+(s.duration_seconds / 60).toFixed(2)) : '' })
      }
      setBlocks([...byEx.values()])
    } else {
      setTitle(template?.name ?? 'Workout')
      setDate(today)
      setTime(timeOf(new Date(), tz))
      setDuration('')
      setNotes('')
      setBlocks(
        (template?.items ?? []).map((it) => ({
          key: uid(),
          exercise_id: it.exercise_id,
          sets: Array.from({ length: Math.max(1, it.sets) }, () => ({ ...emptySet(), reps: it.reps?.toString() ?? '', weight: it.weight?.toString() ?? '', distance: it.distance_km?.toString() ?? '', minutes: it.duration_seconds ? String(it.duration_seconds / 60) : '' })),
        })),
      )
    }
  }, [open, workout?.id, template?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const ex = (id: string) => exercises.find((e) => e.id === id)
  const setBlock = (key: string, fn: (b: Block) => Block) => setBlocks((bs) => bs.map((b) => (b.key === key ? fn(b) : b)))

  const save = async () => {
    if (!title.trim()) return setError('Give the workout a name.')
    const rows = blocks.flatMap((b) => b.sets.filter((s) => s.reps || s.weight || s.distance || s.minutes).map((s) => ({ b, s })))
    for (const { s } of rows) {
      for (const v of [s.reps, s.weight, s.distance, s.minutes]) if (v.trim() && (!Number.isFinite(Number(v)) || Number(v) < 0)) return setError('Set values must be positive numbers.')
    }
    setSaving(true)
    try {
      const start = zonedToInstant(date, time, tz)
      const dur = num(duration)
      const values = { title: title.trim(), started_at: start.toISOString(), ended_at: dur ? new Date(start.getTime() + dur * 60000).toISOString() : null, duration_minutes: dur, notes, template_id: workout?.template_id ?? template?.id ?? null }
      const store = getStore()
      const w = workout ? await store.update('workouts', workout.id, values) : await store.insert('workouts', values)
      if (workout) await store.removeWhere('workout_sets', [eq('workout_id', w.id)])
      await store.insertMany(
        'workout_sets',
        rows.map(({ b, s }, i) => ({ workout_id: w.id, exercise_id: b.exercise_id, set_index: i, reps: num(s.reps), weight: num(s.weight), distance_km: num(s.distance), duration_seconds: num(s.minutes) !== null ? Math.round(num(s.minutes)! * 60) : null, notes: '' })),
      )
      invalidate('workouts')
      toast.success(workout ? 'Workout saved' : 'Workout logged')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={workout ? 'Edit workout' : 'Log workout'}
      size="lg"
      footer={
        <>
          {workout && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                if (!(await confirm({ title: 'Delete this workout?', message: 'All of its sets will be deleted.', confirmLabel: 'Delete', danger: true }))) return
                try {
                  await getStore().remove('workouts', workout.id)
                  invalidate('workouts')
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
          <Button onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Name" htmlFor="w-title" className="col-span-2" error={error || undefined}>
          <Input id="w-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Date" htmlFor="w-date">
          <Input id="w-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Start" htmlFor="w-time">
          <Input id="w-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Duration (min)" htmlFor="w-dur" className="col-span-2 md:col-span-1">
          <Input id="w-dur" type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        {blocks.map((b) => {
          const e = ex(b.exercise_id)
          const fields = fieldsFor(e?.metric_type ?? 'weight_reps')
          return (
            <section key={b.key} className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
                <Select aria-label="Exercise" value={b.exercise_id} onChange={(ev) => setBlock(b.key, (x) => ({ ...x, exercise_id: ev.target.value }))} className="flex-1">
                  {exercises.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
                <Button size="icon-sm" variant="ghost" aria-label="Remove exercise" onClick={() => setBlocks((bs) => bs.filter((x) => x.key !== b.key))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="w-10 text-left font-medium">Set</th>
                    {fields.map((f) => (
                      <th key={f} className="text-left font-medium">
                        {LABEL[f]}
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {b.sets.map((s, i) => (
                    <tr key={s.key}>
                      <td className="py-1 tabular text-muted">{i + 1}</td>
                      {fields.map((f) => (
                        <td key={f} className="py-1 pr-2">
                          <Input
                            aria-label={`Set ${i + 1} ${LABEL[f]}`}
                            className="h-9"
                            inputMode="decimal"
                            value={s[f]}
                            onChange={(ev) => setBlock(b.key, (x) => ({ ...x, sets: x.sets.map((y) => (y.key === s.key ? { ...y, [f]: ev.target.value } : y)) }))}
                          />
                        </td>
                      ))}
                      <td>
                        <Button size="icon-sm" variant="ghost" aria-label={`Remove set ${i + 1}`} onClick={() => setBlock(b.key, (x) => ({ ...x, sets: x.sets.filter((y) => y.key !== s.key) }))}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1"
                onClick={() => setBlock(b.key, (x) => ({ ...x, sets: [...x.sets, x.sets.length ? { ...x.sets[x.sets.length - 1], key: uid() } : emptySet()] }))}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add set
              </Button>
            </section>
          )
        })}
        {exercises.length === 0 ? (
          <p className="text-sm text-muted">Add exercises on the Exercises tab first.</p>
        ) : (
          <Button variant="secondary" onClick={() => setBlocks((bs) => [...bs, { key: uid(), exercise_id: exercises[0].id, sets: [emptySet()] }])}>
            <Plus className="h-4 w-4" aria-hidden /> Add exercise
          </Button>
        )}
        <Field label="Notes" htmlFor="w-notes">
          <Textarea id="w-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}
