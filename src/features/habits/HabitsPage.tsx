import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore, Flame, Pencil, Plus, Repeat, Trash2, Trophy } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useList, useInvalidate } from '@/lib/db/hooks'
import { gte } from '@/lib/db/store'
import { getStore } from '@/lib/db'
import { addDays, formatKey, startOfWeek, WEEKDAY_SHORT, weekdayOf } from '@/lib/dates'
import { cn, errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Dialog, confirm } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { EmptyState, ListSkeleton, PageHeader, Segmented } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import { syncHabitReminders } from '@/features/reminders/sync'
import type { DateKey, Habit, HabitCheckin } from '@/lib/db/types'
import { checkinMap, describeSchedule, habitScheduledOn, habitStats, isComplete } from './logic'
import { useHabitActions } from './actions'
import { HabitEditor } from './HabitEditor'

export function HabitsPage() {
  const { today, tz } = useSettings()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [editing, setEditing] = useState<Habit | null>(null)
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [logging, setLogging] = useState<{ h: Habit; date: DateKey } | null>(null)
  const habits = useList('habits', { order: [{ field: 'sort_order' }, { field: 'created_at' }] })
  const checkins = useList('habit_checkins', { filters: [gte('date', addDays(today, -400))] })
  const invalidate = useInvalidate()

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreating(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const list = (habits.data ?? []).filter((h) => (tab === 'active' ? !h.archived_at : !!h.archived_at))
  const all = checkins.data ?? []

  const archive = async (h: Habit, on: boolean) => {
    try {
      const saved = await getStore().update('habits', h.id, { archived_at: on ? new Date().toISOString() : null })
      await syncHabitReminders(saved, tz)
      invalidate('habits')
      toast.success(on ? 'Habit archived' : 'Habit restored')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const remove = async (h: Habit) => {
    if (!(await confirm({ title: 'Delete this habit?', message: `“${h.name}” and all of its check-ins will be permanently deleted.`, confirmLabel: 'Delete', danger: true }))) return
    try {
      await getStore().removeWhere('reminders', [
        { field: 'source_type', op: 'eq', value: 'habit' },
        { field: 'source_id', op: 'eq', value: h.id },
      ])
      await getStore().remove('habits', h.id)
      invalidate('habits')
      toast.success('Habit deleted')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Habits"
        subtitle="Streaks only count the days a habit is scheduled."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New habit
          </Button>
        }
      />
      <Segmented
        label="Habit list"
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'archived', label: 'Archived' },
        ]}
      />
      {habits.isLoading ? (
        <ListSkeleton rows={3} />
      ) : list.length === 0 ? (
        <EmptyState icon={Repeat} title={tab === 'active' ? 'No habits yet' : 'No archived habits'} action={tab === 'active' && <Button onClick={() => setCreating(true)}>Add your first habit</Button>}>
          {tab === 'active' && 'Track things like the gym, 5 DSA problems a day, or reading NCERTs.'}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((h) => (
            <HabitCard
              key={h.id}
              habit={h}
              checkins={all}
              onLog={(date) => setLogging({ h, date })}
              menu={
                <Menu
                  label={`Actions for ${h.name}`}
                  items={[
                    { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(h) },
                    h.archived_at
                      ? { label: 'Restore', icon: <ArchiveRestore className="h-4 w-4" />, onSelect: () => void archive(h, false) }
                      : { label: 'Archive', icon: <Archive className="h-4 w-4" />, onSelect: () => void archive(h, true) },
                    { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void remove(h) },
                  ]}
                />
              }
            />
          ))}
        </ul>
      )}
      <HabitEditor open={creating} onClose={() => setCreating(false)} />
      <HabitEditor open={!!editing} habit={editing} onClose={() => setEditing(null)} />
      <LogDialog target={logging} checkins={all} onClose={() => setLogging(null)} />
    </div>
  )
}

function HabitCard({ habit: h, checkins, onLog, menu }: { habit: Habit; checkins: HabitCheckin[]; onLog: (d: DateKey) => void; menu: React.ReactNode }) {
  const { today, settings } = useSettings()
  const actions = useHabitActions()
  const [showHistory, setShowHistory] = useState(false)
  const stats = useMemo(() => habitStats(h, checkins, today, settings.week_start), [h, checkins, today, settings.week_start])
  const map = useMemo(() => checkinMap(checkins, h.id), [checkins, h.id])
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))

  const tap = (d: DateKey) => {
    if (h.archived_at) return
    if (h.kind === 'numeric') onLog(d)
    else void actions.toggle(h, d, map.get(d))
  }

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: h.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{h.name}</p>
          <p className="text-xs text-muted">
            {describeSchedule(h)}
            {h.kind === 'numeric' && ` · ${h.target_value} ${h.unit}`.trimEnd()}
            {h.reminder_time && ` · reminder ${h.reminder_time.slice(0, 5)}`}
          </p>
        </div>
        <div className="flex items-center gap-4 text-right text-xs text-muted">
          <span className="flex items-center gap-1" title="Current streak">
            <Flame className={cn('h-4 w-4', stats.current > 0 ? 'text-warning' : 'text-subtle')} aria-hidden />
            <span className="text-sm font-semibold text-fg tabular">{stats.current}</span>
            {stats.unit === 'week' ? 'wk' : 'd'}
          </span>
          <span className="hidden items-center gap-1 sm:flex" title="Best streak">
            <Trophy className="h-4 w-4 text-subtle" aria-hidden />
            <span className="tabular">{stats.best}</span>
          </span>
          <span className="hidden tabular sm:inline" title="Completion over the last 30 days">
            {Math.round(stats.rate30 * 100)}%
          </span>
        </div>
        {menu}
      </div>
      <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => {
          const c = map.get(d)
          const done = isComplete(h, c)
          const partial = !done && !!c && c.value > 0
          const scheduled = h.schedule.type === 'weekly' || habitScheduledOn(h, d)
          return (
            <button
              key={d}
              type="button"
              onClick={() => tap(d)}
              disabled={!!h.archived_at || d < h.start_date}
              aria-pressed={done}
              aria-label={`${h.name} on ${formatKey(d, 'EEEE d MMM')}: ${done ? 'done' : partial ? `${c!.value} of ${h.target_value}` : 'not done'}`}
              className={cn(
                'flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-lg border text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                done ? 'border-transparent text-white' : 'border-line hover:bg-surface-2',
                !scheduled && !done && 'border-dashed opacity-60',
                d === today && !done && 'border-accent',
              )}
              style={done ? { background: h.color } : partial ? { background: `${h.color}33` } : undefined}
            >
              <span className={cn(!done && 'text-muted')}>{WEEKDAY_SHORT[weekdayOf(d)].slice(0, 2)}</span>
              <span className="font-semibold tabular">{h.kind === 'numeric' && c ? c.value : formatKey(d, 'd')}</span>
            </button>
          )
        })}
        <button type="button" onClick={() => setShowHistory((v) => !v)} className="ml-auto shrink-0 px-2 text-xs font-medium text-accent hover:underline">
          {showHistory ? 'Hide history' : 'History'}
        </button>
      </div>
      {showHistory && <Heatmap habit={h} map={map} />}
    </li>
  )
}

/** The last 20 weeks as a GitHub-style grid. */
function Heatmap({ habit: h, map }: { habit: Habit; map: Map<DateKey, HabitCheckin> }) {
  const { today, settings } = useSettings()
  const weeks = 20
  const first = addDays(startOfWeek(today, settings.week_start), -(weeks - 1) * 7)
  return (
    <div className="mt-3 overflow-x-auto">
      <div className="inline-grid grid-flow-col gap-1" style={{ gridTemplateRows: 'repeat(7, 0.8rem)' }}>
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const d = addDays(first, i)
          if (d > today) return <span key={d} className="h-[0.8rem] w-[0.8rem]" />
          const c = map.get(d)
          const done = isComplete(h, c)
          return <span key={d} title={`${formatKey(d, 'd MMM')}${c ? `: ${c.value}` : ''}`} className={cn('h-[0.8rem] w-[0.8rem] rounded-sm', !done && 'bg-surface-2')} style={done ? { background: h.color } : c ? { background: `${h.color}55` } : undefined} />
        })}
      </div>
    </div>
  )
}

function LogDialog({ target, checkins, onClose }: { target: { h: Habit; date: DateKey } | null; checkins: HabitCheckin[]; onClose: () => void }) {
  const actions = useHabitActions()
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const existing = target ? checkinMap(checkins, target.h.id).get(target.date) : undefined
  useEffect(() => {
    if (target) {
      setValue(existing ? String(existing.value) : String(target.h.target_value ?? ''))
      setNote(existing?.note ?? '')
    }
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return null
  const save = async () => {
    await actions.setValue(target.h, target.date, Math.max(0, Number(value) || 0), note)
    onClose()
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Log ${target.h.name}`}
      description={formatKey(target.date, 'EEEE, d MMMM')}
      size="sm"
      footer={
        <>
          {existing && (
            <Button variant="ghost" onClick={() => void actions.setValue(target.h, target.date, 0).then(onClose)}>
              Clear
            </Button>
          )}
          <Button onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label={`Amount${target.h.unit ? ` (${target.h.unit})` : ''}`} htmlFor="log-v" hint={`Target: ${target.h.target_value ?? 1}`}>
          <Input id="log-v" data-autofocus type="number" min={0} step="any" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="log-n">
          <Textarea id="log-n" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
