import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Dumbbell, Plus, Trash2, Trophy } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { getStore } from '@/lib/db'
import { addDays, formatInstant, formatKey, startOfWeek } from '@/lib/dates'
import { errorMessage, formatMinutes, plural } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Dialog, confirm } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { EmptyState, PageHeader, Panel, Segmented, Stat } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import type { Exercise, ExerciseMetric, Workout, WorkoutTemplate, WorkoutTemplateItem } from '@/lib/db/types'
import { formatPR, personalRecords, STARTER_EXERCISES, volume } from './logic'
import { WorkoutEditor } from './WorkoutEditor'

type Tab = 'workouts' | 'exercises' | 'templates' | 'body'

export function FitnessPage() {
  const { today, settings, tz } = useSettings()
  const [tab, setTab] = useState<Tab>('workouts')
  const workouts = useList('workouts', { order: [{ field: 'started_at', ascending: false }] })
  const sets = useList('workout_sets')
  const exercises = useList('exercises', { order: [{ field: 'name' }] })
  const templates = useList('workout_templates', { order: [{ field: 'name' }] })
  const [editing, setEditing] = useState<{ workout?: Workout; template?: WorkoutTemplate } | null>(null)
  const exList = (exercises.data ?? []).filter((e) => !e.archived_at)

  const weekStart = startOfWeek(today, settings.week_start)
  const thisWeek = (workouts.data ?? []).filter((w) => formatInstant(w.started_at, tz, 'yyyy-MM-dd') >= weekStart)

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Fitness"
        subtitle="Workouts, personal records and body measurements."
        actions={
          <>
            {(templates.data ?? []).length > 0 && (
              <Menu
                label="Start from template"
                trigger={<span className="inline-flex h-10 items-center rounded-lg border border-line px-3 text-sm font-medium hover:bg-surface-2">From template</span>}
                items={(templates.data ?? []).map((t) => ({ label: t.name, onSelect: () => setEditing({ template: t }) }))}
              />
            )}
            <Button onClick={() => setEditing({})}>
              <Plus className="h-4 w-4" aria-hidden /> Log workout
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="This week" value={plural(thisWeek.length, 'workout')} />
        <Stat label="Time this week" value={formatMinutes(thisWeek.reduce((s, w) => s + (w.duration_minutes ?? 0), 0)) || '0m'} />
        <Stat label="All time" value={(workouts.data ?? []).length} />
      </div>
      <Segmented
        label="Fitness section"
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'workouts', label: 'Workouts' },
          { value: 'exercises', label: 'Exercises & PRs' },
          { value: 'templates', label: 'Templates' },
          { value: 'body', label: 'Body' },
        ]}
      />

      {tab === 'workouts' &&
        ((workouts.data ?? []).length === 0 ? (
          <EmptyState icon={Dumbbell} title="No workouts yet" action={<Button onClick={() => setEditing({})}>Log your first workout</Button>} />
        ) : (
          <ul className="flex flex-col gap-2">
            {(workouts.data ?? []).map((w) => {
              const ws = (sets.data ?? []).filter((s) => s.workout_id === w.id)
              const names = [...new Set(ws.map((s) => (exercises.data ?? []).find((e) => e.id === s.exercise_id)?.name).filter(Boolean))]
              const vol = volume(ws)
              return (
                <li key={w.id}>
                  <button type="button" onClick={() => setEditing({ workout: w })} className="w-full rounded-xl border border-line bg-surface p-3 text-left hover:border-accent/50">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{w.title}</span>
                      <span className="text-xs text-muted">{formatInstant(w.started_at, tz, 'EEE d MMM, HH:mm')}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {plural(ws.length, 'set')}
                      {w.duration_minutes ? ` · ${formatMinutes(w.duration_minutes)}` : ''}
                      {vol ? ` · ${Math.round(vol).toLocaleString()} kg volume` : ''}
                    </p>
                    {names.length > 0 && <p className="mt-1 truncate text-sm">{names.join(' · ')}</p>}
                  </button>
                </li>
              )
            })}
          </ul>
        ))}

      {tab === 'exercises' && <ExercisesTab exercises={exList} sets={sets.data ?? []} />}
      {tab === 'templates' && <TemplatesTab templates={templates.data ?? []} exercises={exList} onStart={(t) => setEditing({ template: t })} />}
      {tab === 'body' && <BodyTab />}

      <WorkoutEditor
        open={!!editing}
        onClose={() => setEditing(null)}
        workout={editing?.workout}
        template={editing?.template}
        sets={editing?.workout ? (sets.data ?? []).filter((s) => s.workout_id === editing.workout!.id) : []}
        exercises={exercises.data ?? []}
      />
    </div>
  )
}

const METRIC_LABEL: Record<ExerciseMetric, string> = {
  weight_reps: 'Weight × reps',
  reps: 'Reps only',
  duration: 'Time',
  distance: 'Distance',
  distance_duration: 'Distance and time',
}

function ExercisesTab({ exercises, sets }: { exercises: Exercise[]; sets: import('@/lib/db/types').WorkoutSet[] }) {
  const invalidate = useInvalidate()
  const [name, setName] = useState('')
  const [metric, setMetric] = useState<ExerciseMetric>('weight_reps')
  const [group, setGroup] = useState('')
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn()
      if (msg) toast.success(msg)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      invalidate('exercises')
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Add exercise">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            void run(() => getStore().insert('exercises', { name: name.trim(), metric_type: metric, category: metric.startsWith('distance') ? 'cardio' : 'strength', muscle_group: group.trim(), notes: '' }), 'Exercise added').then(() => {
              setName('')
              setGroup('')
            })
          }}
        >
          <Input aria-label="Exercise name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="min-w-[10rem] flex-1" />
          <Select aria-label="Measured by" value={metric} onChange={(e) => setMetric(e.target.value as ExerciseMetric)} className="w-48">
            {Object.entries(METRIC_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Input aria-label="Muscle group" placeholder="Muscle group" value={group} onChange={(e) => setGroup(e.target.value)} className="w-40" />
          <Button type="submit" variant="secondary" disabled={!name.trim()}>
            Add
          </Button>
        </form>
        {exercises.length === 0 && (
          <Button
            variant="ghost"
            className="mt-3"
            onClick={() => void run(() => getStore().insertMany('exercises', STARTER_EXERCISES.map((e) => ({ ...e, notes: '' }))), 'Added common exercises')}
          >
            Add {STARTER_EXERCISES.length} common exercises
          </Button>
        )}
      </Panel>
      {exercises.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {exercises.map((e) => {
            const prs = personalRecords(
              e.metric_type,
              sets.filter((s) => s.exercise_id === e.id),
            )
            return (
              <li key={e.id} className="group rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{e.name}</p>
                    <p className="text-xs text-muted">
                      {METRIC_LABEL[e.metric_type]}
                      {e.muscle_group && ` · ${e.muscle_group}`}
                    </p>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${e.name}`}
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    onClick={async () => {
                      if (await confirm({ title: `Remove ${e.name}?`, message: 'It is hidden from pickers. Logged sets and records are kept.', confirmLabel: 'Remove' }))
                        await run(() => getStore().update('exercises', e.id, { archived_at: new Date().toISOString() }))
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {prs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {prs.map((p) => (
                      <span key={p.label} className="inline-flex items-center gap-1">
                        <Trophy className="h-3 w-3 text-warning" aria-hidden />
                        <span className="text-muted">{p.label}</span> <span className="font-semibold">{formatPR(p)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function TemplatesTab({ templates, exercises, onStart }: { templates: WorkoutTemplate[]; exercises: Exercise[]; onStart: (t: WorkoutTemplate) => void }) {
  const invalidate = useInvalidate()
  const [editing, setEditing] = useState<WorkoutTemplate | 'new' | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="secondary" onClick={() => setEditing('new')} disabled={!exercises.length}>
          <Plus className="h-4 w-4" aria-hidden /> New template
        </Button>
        {!exercises.length && <p className="mt-2 text-sm text-muted">Add exercises first.</p>}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {templates.map((t) => (
          <li key={t.id} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-muted">{t.items.map((i) => `${exercises.find((e) => e.id === i.exercise_id)?.name ?? 'Exercise'} ${i.sets}×${i.reps ?? ''}`).join(' · ')}</p>
              </div>
              <Menu
                label={`Actions for ${t.name}`}
                items={[
                  { label: 'Edit', onSelect: () => setEditing(t) },
                  {
                    label: 'Delete',
                    danger: true,
                    onSelect: async () => {
                      if (!(await confirm({ title: 'Delete template?', confirmLabel: 'Delete', danger: true }))) return
                      await getStore().remove('workout_templates', t.id)
                      invalidate('workout_templates')
                    },
                  },
                ]}
              />
            </div>
            <Button size="sm" className="mt-2" onClick={() => onStart(t)}>
              Start workout
            </Button>
          </li>
        ))}
      </ul>
      <TemplateEditor open={editing !== null} template={editing === 'new' ? null : editing} exercises={exercises} onClose={() => setEditing(null)} />
    </div>
  )
}

function TemplateEditor({ open, template, exercises, onClose }: { open: boolean; template: WorkoutTemplate | null; exercises: Exercise[]; onClose: () => void }) {
  const invalidate = useInvalidate()
  const [name, setName] = useState('')
  const [items, setItems] = useState<WorkoutTemplateItem[]>([])
  useEffect(() => {
    if (open) {
      setName(template?.name ?? '')
      setItems(template?.items ?? [{ exercise_id: exercises[0]?.id ?? '', sets: 3, reps: 10, weight: null }])
    }
  }, [open, template?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!name.trim()) return toast.error('Give the template a name.')
    try {
      const values = { name: name.trim(), notes: '', items: items.filter((i) => i.exercise_id) }
      if (template) await getStore().update('workout_templates', template.id, values)
      else await getStore().insert('workout_templates', values)
      invalidate('workout_templates')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={template ? 'Edit template' : 'New template'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <Field label="Name" htmlFor="tpl-name">
        <Input id="tpl-name" placeholder="e.g. Push day" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <ul className="mt-4 flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2">
            <Select aria-label="Exercise" value={it.exercise_id} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, exercise_id: e.target.value } : x)))} className="flex-1">
              {exercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
            <Input aria-label="Sets" type="number" min={1} className="w-16" value={it.sets} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, sets: Math.max(1, Number(e.target.value) || 1) } : x)))} />
            <span className="text-muted">×</span>
            <Input aria-label="Reps" type="number" min={0} className="w-16" value={it.reps ?? ''} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, reps: e.target.value ? Number(e.target.value) : null } : x)))} />
            <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setItems([...items, { exercise_id: exercises[0]?.id ?? '', sets: 3, reps: 10 }])}>
        <Plus className="h-4 w-4" aria-hidden /> Add exercise
      </Button>
    </Dialog>
  )
}

function BodyTab() {
  const { today } = useSettings()
  const invalidate = useInvalidate()
  const metrics = useList('body_metrics', { order: [{ field: 'date' }] })
  const [date, setDate] = useState(today)
  const [weight, setWeight] = useState('')
  const [fat, setFat] = useState('')
  const data = (metrics.data ?? []).filter((m) => m.weight_kg !== null).map((m) => ({ date: m.date, label: formatKey(m.date, 'd MMM'), weight: m.weight_kg }))
  const last = metrics.data?.[metrics.data.length - 1]
  const monthAgo = (metrics.data ?? []).filter((m) => m.date <= addDays(today, -30) && m.weight_kg !== null).pop()

  const save = async () => {
    const w = weight.trim() ? Number(weight) : null
    const f = fat.trim() ? Number(fat) : null
    if ((w !== null && !(w > 0 && w < 500)) || (f !== null && !(f >= 0 && f < 80))) return toast.error('Check the numbers you entered.')
    if (w === null && f === null) return
    try {
      await getStore().upsert('body_metrics', { date, weight_kg: w, body_fat_pct: f, measurements: {}, notes: '' }, ['date'])
      invalidate('body_metrics')
      setWeight('')
      setFat('')
      toast.success('Saved')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Log measurement">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label="Date" htmlFor="bm-date">
            <Input id="bm-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Weight (kg)" htmlFor="bm-w">
            <Input id="bm-w" inputMode="decimal" className="w-28" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </Field>
          <Field label="Body fat %" htmlFor="bm-f">
            <Input id="bm-f" inputMode="decimal" className="w-28" value={fat} onChange={(e) => setFat(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
      </Panel>
      {data.length > 0 ? (
        <Panel title={`Weight${last?.weight_kg ? ` · ${last.weight_kg} kg` : ''}${monthAgo?.weight_kg && last?.weight_kg ? ` (${last.weight_kg - monthAgo.weight_kg >= 0 ? '+' : ''}${(last.weight_kg - monthAgo.weight_kg).toFixed(1)} in 30 days)` : ''}`}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="rgb(var(--line))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} tickLine={false} axisLine={false} />
                <YAxis domain={['dataMin - 1', 'dataMax + 1']} tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 8 }} />
                <Line type="monotone" dataKey="weight" stroke="rgb(var(--accent))" strokeWidth={2} dot={{ r: 3 }} name="Weight (kg)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 max-h-48 overflow-y-auto text-sm">
            {[...(metrics.data ?? [])].reverse().map((m) => (
              <li key={m.id} className="flex justify-between border-b border-line py-1 last:border-0">
                <span className="text-muted">{formatKey(m.date, 'd MMM yyyy')}</span>
                <span className="tabular">
                  {m.weight_kg !== null && `${m.weight_kg} kg`}
                  {m.body_fat_pct !== null && ` · ${m.body_fat_pct}%`}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <EmptyState title="No measurements yet">Log your weight to see a trend line.</EmptyState>
      )}
    </div>
  )
}
