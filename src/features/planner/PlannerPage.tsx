import { useMemo, useState, type DragEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, Clock, Plus, Repeat, Wand2, X } from 'lucide-react'
import { useSettings, useMinuteTick } from '@/settings/SettingsProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { gte, isNull } from '@/lib/db/store'
import { getStore } from '@/lib/db'
import { addDays, dateKey, daysInRange, formatKey, formatTime, relativeDay, startOfWeek, timeOf, zonedToInstant } from '@/lib/dates'
import { cn, errorMessage, formatMinutes } from '@/lib/utils'
import { linkTo } from '@/lib/links'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Field'
import { EmptyState, Panel, Segmented } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import type { DateKey, TimeBlock } from '@/lib/db/types'
import { useTaskData } from '@/features/tasks/useTaskData'
import { expandTasks, overdue, sortInstances, type TaskInstance } from '@/features/tasks/logic'
import { useTaskActions } from '@/features/tasks/actions'
import { TaskEditor } from '@/features/tasks/TaskEditor'
import { expandBlocks, expandEvents, freeSlots } from '@/features/calendar/logic'
import { checkinMap, habitScheduledOn, isComplete } from '@/features/habits/logic'
import { useHabitActions } from '@/features/habits/actions'
import { dayWindow, dropMinute, hhmm, layoutLanes, parsePlanDrop, parsePlanMove, PLAN_DRAG_TYPE, PLAN_MOVE_TYPE, suggestSlot, type PlanDrop, type PlanMove } from './logic'
import { BlockEditor, type BlockTarget } from './BlockEditor'

const HOUR_PX = 56

/** Props that make a side-panel item draggable onto the day timeline. */
function dragPlan(p: PlanDrop) {
  return {
    draggable: true,
    title: 'Drag onto the timeline',
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(PLAN_DRAG_TYPE, JSON.stringify(p))
      e.dataTransfer.effectAllowed = 'copy'
    },
  }
}

interface Item {
  key: string
  title: string
  start: Date
  end: Date
  kind: 'event' | 'block' | 'task'
  color: string | null
  done: boolean
  block?: TimeBlock & { virtual: boolean }
  task?: TaskInstance
  eventId?: string
  allDay?: boolean
}

export function PlannerPage() {
  const { tz, today, settings } = useSettings()
  useMinuteTick()
  const [params, setParams] = useSearchParams()
  const date: DateKey = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today
  const mode = params.get('mode') === 'week' ? 'week' : 'day'
  const setDate = (d: DateKey) => {
    params.set('date', d)
    setParams(params)
  }
  const setMode = (m: 'day' | 'week') => {
    params.set('mode', m)
    setParams(params)
  }

  const weekStart = startOfWeek(date, settings.week_start)
  const days = mode === 'week' ? daysInRange(weekStart, addDays(weekStart, 6)) : [date]
  const rangeStart = zonedToInstant(days[0], '00:00', tz)
  const rangeEnd = zonedToInstant(addDays(days[days.length - 1], 1), '00:00', tz)

  const events = useList('events', { filters: [isNull('archived_at')] })
  const exceptions = useList('event_exceptions')
  const blocks = useList('time_blocks')
  const { tasks, occurrences } = useTaskData()

  const instances = useMemo(() => expandTasks(tasks.filter((t) => !t.parent_id), occurrences, days[0], days[days.length - 1], tz).filter((i) => !i.skipped), [tasks, occurrences, days[0], days.length, tz]) // eslint-disable-line react-hooks/exhaustive-deps

  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    for (const e of expandEvents(events.data ?? [], exceptions.data ?? [], rangeStart, rangeEnd, tz))
      out.push({ key: e.key, title: e.title, start: e.start, end: e.end, kind: 'event', color: e.color, done: false, allDay: e.allDay, eventId: e.event.id })
    for (const b of expandBlocks(blocks.data ?? [], rangeStart, rangeEnd, tz))
      out.push({ key: b.instanceKey, title: b.title, start: b.start, end: b.end, kind: 'block', color: b.color, done: b.status === 'done', block: b })
    for (const i of instances) {
      if (!i.scheduledAt) continue
      const s = new Date(i.scheduledAt)
      out.push({ key: `task:${i.key}`, title: i.task.title, start: s, end: new Date(s.getTime() + (i.task.estimated_minutes || settings.default_task_minutes) * 60000), kind: 'task', color: null, done: i.done, task: i })
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [events.data, exceptions.data, blocks.data, instances, rangeStart.getTime(), rangeEnd.getTime(), tz, settings.default_task_minutes]) // eslint-disable-line react-hooks/exhaustive-deps

  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null)
  const [openTask, setOpenTask] = useState<TaskInstance | null>(null)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">{mode === 'day' ? relativeDay(date, today) : 'Week plan'}</h1>
          <p className="text-sm text-muted">{mode === 'day' ? formatKey(date, 'EEEE, d MMMM yyyy') : `${formatKey(days[0], 'd MMM')} – ${formatKey(days[6], 'd MMM yyyy')}`}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous" onClick={() => setDate(addDays(date, mode === 'week' ? -7 : -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDate(today)}>
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label="Next" onClick={() => setDate(addDays(date, mode === 'week' ? 7 : 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Segmented
          label="Planner view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
          ]}
        />
        <Button onClick={() => setBlockTarget({ date })}>
          <Plus className="h-4 w-4" aria-hidden /> Time block
        </Button>
      </div>

      {mode === 'day' ? (
        <DayPlan date={date} items={items} instances={instances} allTasks={tasks} onBlock={setBlockTarget} onTask={setOpenTask} />
      ) : (
        <WeekPlan
          days={days}
          items={items}
          instances={instances}
          onBlock={setBlockTarget}
          onTask={setOpenTask}
          onDay={(d) => {
            params.set('date', d)
            params.set('mode', 'day')
            setParams(params)
          }}
        />
      )}

      <BlockEditor target={blockTarget} onClose={() => setBlockTarget(null)} />
      <TaskEditor open={!!openTask} task={openTask?.task} onClose={() => setOpenTask(null)} />
    </div>
  )
}

function DayPlan({
  date,
  items,
  instances,
  allTasks,
  onBlock,
  onTask,
}: {
  date: DateKey
  items: Item[]
  instances: TaskInstance[]
  allTasks: ReturnType<typeof useTaskData>['tasks']
  onBlock: (t: BlockTarget) => void
  onTask: (i: TaskInstance) => void
}) {
  const { tz, today, settings } = useSettings()
  const navigate = useNavigate()
  const { occurrences } = useTaskData()
  const taskActions = useTaskActions()
  const habitActions = useHabitActions()
  const invalidate = useInvalidate()
  const habits = useList('habits', { filters: [isNull('archived_at')], order: [{ field: 'sort_order' }] })
  const checkins = useList('habit_checkins', { filters: [gte('date', addDays(date, -7))] })
  const goals = useList('goals', { filters: [isNull('archived_at')] })
  const subjects = useList('subjects', { filters: [isNull('archived_at')] })
  // Minutes after the day start where a dragged item would land, while one is over the timeline.
  const [dropAt, setDropAt] = useState<number | null>(null)
  // An item from the timeline is being dragged (shows the "drop here to unschedule" area), and whether it's over it.
  const [moving, setMoving] = useState(false)
  const [unplanOver, setUnplanOver] = useState(false)

  const startHour = Math.min(settings.day_start_hour, 23)
  const endHour = Math.max(settings.day_end_hour, startHour + 1)
  const { dayStart, dayEnd } = dayWindow(date, settings.day_start_hour, settings.day_end_hour, tz)
  const timed = items.filter((i) => !i.allDay)
  const allDay = items.filter((i) => i.allDay)
  const laid = layoutLanes(timed)
  const now = new Date()
  const isToday = date === today

  const free = freeSlots(
    timed.map((t) => ({ key: t.key, start: t.start, end: t.end })),
    isToday && now > dayStart ? new Date(Math.min(now.getTime(), dayEnd.getTime())) : dayStart,
    dayEnd,
    15,
  )
  const freeMinutes = free.reduce((s, f) => s + (f.end.getTime() - f.start.getTime()) / 60000, 0)

  const blockedTaskIds = new Set(items.filter((i) => i.block?.task_id).map((i) => i.block!.task_id))
  const lateList = isToday ? overdue(allTasks.filter((t) => !t.parent_id), occurrences, today, tz) : []
  const unscheduled = sortInstances([...lateList, ...instances.filter((i) => i.date === date)].filter((i) => !i.done && !i.scheduledAt && !blockedTaskIds.has(i.task.id)))
  const plannedMinutes = timed.filter((t) => t.kind !== 'event').reduce((s, t) => s + (t.end.getTime() - t.start.getTime()) / 60000, 0)

  // Blocks that ended without being marked done, and the tasks they were for.
  const missed = isToday ? timed.filter((t) => t.kind === 'block' && !t.done && !t.block?.virtual && t.block?.status === 'planned' && t.end < now) : []

  const scheduleTask = (i: TaskInstance, slot: { start: Date; end: Date }) =>
    onBlock({ date, start: timeOf(slot.start, tz), end: timeOf(slot.end, tz), title: i.task.title, task_id: i.task.id, task_occurrence_date: i.occurrenceDate })

  const placeBlock = async (p: PlanDrop, start: Date) => {
    try {
      await getStore().insert('time_blocks', {
        title: p.title,
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + p.minutes * 60000).toISOString(),
        task_id: p.task_id ?? null,
        task_occurrence_date: p.task_occurrence_date ?? null,
        category_id: p.category_id ?? null,
        color: p.color ?? null,
        status: 'planned',
        notes: '',
        recurrence: null,
      })
      invalidate('time_blocks')
      toast.success(`Planned “${p.title}” for ${formatTime(start, tz, settings.time_format)}`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const taskPlan = (i: TaskInstance): PlanDrop => ({
    title: i.task.title,
    minutes: i.task.estimated_minutes || settings.default_task_minutes,
    task_id: i.task.id,
    task_occurrence_date: i.occurrenceDate,
    category_id: i.task.category_id,
  })

  const autoPlace = async (i: TaskInstance) => {
    const slot = suggestSlot(free, i.task.estimated_minutes || settings.default_task_minutes, isToday ? now : dayStart)
    if (!slot) return toast.info('No free slot long enough today. Try tomorrow or shorten the estimate.')
    await placeBlock(taskPlan(i), slot.start)
  }

  /** Tap instead of drag (phones, keyboard): open the block editor at the next free slot. */
  const openPlan = (p: PlanDrop) => {
    const slot = suggestSlot(free, p.minutes, isToday ? now : dayStart) ?? { start: dayStart, end: new Date(dayStart.getTime() + p.minutes * 60000) }
    onBlock({ date, start: timeOf(slot.start, tz), end: timeOf(slot.end, tz), title: p.title })
  }

  const setBlockStatus = async (b: TimeBlock, status: TimeBlock['status']) => {
    try {
      await getStore().update('time_blocks', b.id, { status, actual_minutes: status === 'done' ? Math.round((Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000) : null })
      if (status === 'done' && b.task_id) {
        const inst = instances.find((i) => i.task.id === b.task_id && (!b.task_occurrence_date || i.occurrenceDate === b.task_occurrence_date)) ?? lateList.find((i) => i.task.id === b.task_id)
        if (inst && !inst.done) await taskActions.setDone(inst, true)
      }
      invalidate('time_blocks')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const replan = async (b: TimeBlock) => {
    const mins = Math.round((Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000)
    const slot = suggestSlot(free, mins, now)
    try {
      if (slot) {
        await getStore().update('time_blocks', b.id, { start_at: slot.start.toISOString(), end_at: slot.end.toISOString(), status: 'planned' })
        toast.success(`Moved to ${formatTime(slot.start, tz, settings.time_format)}`)
      } else {
        const t = zonedToInstant(addDays(today, 1), `${String(startHour).padStart(2, '0')}:00`, tz)
        await getStore().update('time_blocks', b.id, { start_at: t.toISOString(), end_at: new Date(t.getTime() + mins * 60000).toISOString(), status: 'planned' })
        toast.success('No room left today, moved to tomorrow morning')
      }
      invalidate('time_blocks')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const top = (d: Date) => ((d.getTime() - dayStart.getTime()) / 3600000) * HOUR_PX
  const slots = Array.from({ length: hours.length * 2 }, (_, k) => startHour * 60 + k * 30)
  const findItem = (m: PlanMove) => timed.find((t) => (m.kind === 'block' ? t.block?.id === m.id && !t.block.virtual : t.task?.task.id === m.id))

  const moveItem = async (m: PlanMove, start: Date) => {
    const it = findItem(m)
    if (!it) return
    const ms = it.end.getTime() - it.start.getTime()
    try {
      if (it.block) {
        await getStore().update('time_blocks', it.block.id, { start_at: start.toISOString(), end_at: new Date(start.getTime() + ms).toISOString() })
        invalidate('time_blocks')
      } else if (it.task) await taskActions.update(it.task.task, { scheduled_at: start.toISOString() })
      toast.success(`Moved to ${formatTime(start, tz, settings.time_format)}`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  /** Dragged back to the side panel: the block goes (with undo); a scheduled task loses its time and returns to To schedule. */
  const unplanItem = async (m: PlanMove) => {
    const it = findItem(m)
    if (!it) return
    try {
      if (it.block) {
        const b = it.block
        await getStore().remove('time_blocks', b.id)
        invalidate('time_blocks')
        toast.success(`Took “${it.title}” off the timeline`, {
          label: 'Undo',
          onClick: () =>
            void getStore()
              .insert('time_blocks', { id: b.id, title: b.title, start_at: b.start_at, end_at: b.end_at, task_id: b.task_id, task_occurrence_date: b.task_occurrence_date, category_id: b.category_id, color: b.color, notes: b.notes, status: b.status, actual_minutes: b.actual_minutes, recurrence: b.recurrence })
              .then(() => invalidate('time_blocks')),
        })
      } else if (it.task) {
        const t = it.task.task
        await taskActions.update(t, { scheduled_at: null, due_date: t.due_date ?? date }, `Took “${it.title}” off the timeline`)
      }
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const dragMinute = (e: DragEvent<HTMLDivElement>) => dropMinute(e.clientY - e.currentTarget.getBoundingClientRect().top, HOUR_PX, hours.length * 60)
  const planGoals = (goals.data ?? []).filter((g) => g.status === 'active')
  const planSubjects = subjects.data ?? []
  const dueHabits = (habits.data ?? []).filter((h) => h.show_in_planner && (h.schedule.type === 'weekly' || habitScheduledOn(h, date)))

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label="Timeline" className="min-w-0 rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-xs text-muted">
          <span>
            <strong className="text-fg">{formatMinutes(plannedMinutes) || '0m'}</strong> planned
          </span>
          <span>
            <strong className="text-fg">{formatMinutes(Math.round(freeMinutes)) || '0m'}</strong> free{isToday ? ' from now' : ''}
          </span>
          <span className="ml-auto hidden sm:inline">Click a slot or drag items in; drag them back to the right to unschedule</span>
        </div>
        {allDay.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
            {allDay.map((a) => (
              <span key={a.key} className="rounded-md px-2 py-0.5 text-xs text-white" style={{ background: a.color ?? 'rgb(var(--accent))' }}>
                {a.title}
              </span>
            ))}
          </div>
        )}
        <div
          className="relative mb-3 ml-14 mr-2 mt-3"
          style={{ height: hours.length * HOUR_PX }}
          onDragOver={(e) => {
            const move = e.dataTransfer.types.includes(PLAN_MOVE_TYPE)
            if (!move && !e.dataTransfer.types.includes(PLAN_DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = move ? 'move' : 'copy'
            setDropAt(dragMinute(e))
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDropAt(null)
            setMoving(false)
            const at = new Date(dayStart.getTime() + dragMinute(e) * 60000)
            const m = parsePlanMove(e.dataTransfer.getData(PLAN_MOVE_TYPE))
            if (m) return void moveItem(m, at)
            const p = parsePlanDrop(e.dataTransfer.getData(PLAN_DRAG_TYPE))
            if (p) void placeBlock(p, at)
          }}
        >
          {slots.map((min, idx) => {
            const label = hhmm(min)
            const half = min % 60 !== 0
            return (
              <button
                key={min}
                type="button"
                aria-label={`Add block at ${label}`}
                onClick={() => onBlock({ date, start: label, end: hhmm(Math.min(min + 60, 23 * 60 + 59)) })}
                className={cn('absolute inset-x-0 border-t text-left hover:bg-surface-2/60', half ? 'border-dashed border-line/40' : 'border-line/70')}
                style={{ top: idx * (HOUR_PX / 2), height: HOUR_PX / 2 }}
              >
                <span className={cn('absolute -left-14 -top-2 w-12 pr-2 text-right tabular', half ? 'text-[10px] text-subtle/70' : 'text-[11px] text-subtle')}>
                  {formatTime(zonedToInstant(date, label, tz), tz, settings.time_format === 'HH:mm' ? 'HH:mm' : half ? 'h:mm a' : 'h a')}
                </span>
              </button>
            )
          })}
          {laid.map((it) => {
            const movable = it.block ? !it.block.recurrence && !it.block.virtual : !!it.task && !it.task.task.recurrence
            const t = Math.max(0, top(it.start))
            const h = Math.max(22, Math.min(top(it.end), hours.length * HOUR_PX) - t)
            if (top(it.end) <= 0 || t >= hours.length * HOUR_PX) return null
            const color = it.color ?? (it.kind === 'event' ? 'rgb(var(--accent))' : it.kind === 'task' ? 'rgb(var(--accent))' : 'rgb(var(--warning))')
            return (
              <div
                key={it.key}
                {...(movable
                  ? {
                      draggable: true,
                      title: 'Drag to move, or drag to the right to unschedule',
                      onDragStart: (e: DragEvent) => {
                        e.dataTransfer.setData(PLAN_MOVE_TYPE, JSON.stringify({ kind: it.block ? 'block' : 'task', id: it.block ? it.block.id : it.task!.task.id }))
                        e.dataTransfer.effectAllowed = 'move'
                        setMoving(true)
                      },
                      onDragEnd: () => {
                        setMoving(false)
                        setUnplanOver(false)
                        setDropAt(null)
                      },
                    }
                  : {})}
                className={cn('absolute overflow-hidden rounded-md border-l-4 px-2 py-1 text-xs shadow-sm', it.kind === 'task' ? 'border border-dashed bg-surface' : 'bg-surface-2', it.done && 'opacity-60', movable && 'cursor-grab active:cursor-grabbing')}
                style={{ top: t + 1, height: h - 2, left: `calc(${(it.lane / it.lanes) * 100}% + 2px)`, width: `calc(${100 / it.lanes}% - 4px)`, borderLeftColor: color }}
              >
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    className={cn('min-w-0 flex-1 truncate text-left font-medium', it.done && 'line-through')}
                    onClick={() => (it.task ? onTask(it.task) : it.block ? onBlock({ block: it.block }) : it.eventId ? navigate(linkTo.event(it.eventId)) : undefined)}
                  >
                    {it.block?.recurrence && <Repeat className="mr-1 inline h-3 w-3" aria-label="Routine" />}
                    {it.title}
                  </button>
                  {it.block && !it.block.recurrence && (
                    <Button size="icon-sm" variant="ghost" className="-my-1 h-6 w-6" aria-label={it.done ? `Mark ${it.title} not done` : `Mark ${it.title} done`} onClick={() => void setBlockStatus(it.block!, it.done ? 'planned' : 'done')}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {it.task && <Checkbox round className="scale-75" checked={it.done} label={`Complete ${it.title}`} onChange={(v) => void taskActions.setDone(it.task!, v)} />}
                </div>
                {h > 36 && (
                  <p className="truncate text-muted">
                    {formatTime(it.start, tz, settings.time_format)} – {formatTime(it.end, tz, settings.time_format)}
                  </p>
                )}
              </div>
            )
          })}
          {isToday && now > dayStart && now < dayEnd && <div className="pointer-events-none absolute -left-1 right-0 z-10 h-0.5 bg-danger" style={{ top: top(now) }} aria-hidden />}
          {dropAt !== null && (
            <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-dashed border-accent" style={{ top: (dropAt / 60) * HOUR_PX }} aria-hidden>
              <span className="absolute -top-2.5 right-1 rounded bg-accent px-1.5 text-[11px] font-medium text-accent-fg tabular">
                {formatTime(new Date(dayStart.getTime() + dropAt * 60000), tz, settings.time_format)}
              </span>
            </div>
          )}
        </div>
      </section>

      <aside
        className={cn('flex min-w-0 flex-col gap-4 rounded-xl transition', unplanOver && 'ring-2 ring-accent ring-offset-4 ring-offset-bg')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(PLAN_MOVE_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setUnplanOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setUnplanOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setUnplanOver(false)
          setMoving(false)
          const m = parsePlanMove(e.dataTransfer.getData(PLAN_MOVE_TYPE))
          if (m) void unplanItem(m)
        }}
      >
        {moving && (
          <div className={cn('rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm', unplanOver ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted')}>
            Drop here to take it off the timeline
          </div>
        )}
        {missed.length > 0 && (
          <Panel
            title={
              <span className="flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4" aria-hidden /> Missed blocks
              </span>
            }
          >
            <ul className="flex flex-col gap-2">
              {missed.map((m) => (
                <li key={m.key} className="text-sm">
                  <p className="truncate font-medium">{m.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => void replan(m.block!)}>
                      <Wand2 className="h-3.5 w-3.5" aria-hidden /> Replan
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void setBlockStatus(m.block!, 'done')}>
                      Did it
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void setBlockStatus(m.block!, 'skipped')}>
                      <X className="h-3.5 w-3.5" aria-hidden /> Skip
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title={`To schedule · ${unscheduled.length}`} bodyClassName="p-2">
          {unscheduled.length === 0 ? (
            <EmptyState title="All planned" />
          ) : (
            <ul className="flex flex-col">
              {unscheduled.map((i) => {
                const mins = i.task.estimated_minutes || settings.default_task_minutes
                const slot = suggestSlot(free, mins, isToday ? now : dayStart)
                return (
                  <li key={i.key} className="cursor-grab rounded-lg px-2 py-2 hover:bg-surface-2 active:cursor-grabbing" {...dragPlan(taskPlan(i))}>
                    <button type="button" className="block w-full truncate text-left text-sm" onClick={() => onTask(i)}>
                      {i.task.title}
                    </button>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <Clock className="h-3 w-3" aria-hidden /> {formatMinutes(mins)}
                      {i.date && i.date < date && <span className="text-danger">overdue</span>}
                      <span className="ml-auto flex gap-1">
                        {slot && (
                          <button type="button" className="font-medium text-accent hover:underline" onClick={() => void autoPlace(i)} title="Place in the next free slot">
                            {formatTime(slot.start, tz, settings.time_format)}
                          </button>
                        )}
                        <button type="button" className="font-medium text-muted hover:text-fg" onClick={() => scheduleTask(i, slot ?? { start: dayStart, end: new Date(dayStart.getTime() + mins * 60000) })}>
                          Pick time
                        </button>
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Free time">
          {free.length === 0 ? (
            <p className="text-sm text-muted">No free slots left.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {free.map((f) => (
                <li key={f.start.toISOString()}>
                  <button
                    type="button"
                    className="flex w-full justify-between rounded-md px-2 py-1 text-left hover:bg-surface-2"
                    onClick={() => onBlock({ date, start: timeOf(f.start, tz), end: timeOf(new Date(Math.min(f.end.getTime(), f.start.getTime() + 3600000)), tz) })}
                  >
                    <span className="tabular">
                      {formatTime(f.start, tz, settings.time_format)} – {formatTime(f.end, tz, settings.time_format)}
                    </span>
                    <span className="text-muted">{formatMinutes(Math.round((f.end.getTime() - f.start.getTime()) / 60000))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {dueHabits.length > 0 && (
          <Panel title="Habits">
            <ul className="flex flex-col gap-2">
              {dueHabits.map((h) => {
                const c = checkinMap(checkins.data ?? [], h.id).get(date)
                const done = isComplete(h, c)
                return (
                  <li key={h.id} className="flex cursor-grab items-center gap-3 text-sm active:cursor-grabbing" {...dragPlan({ title: h.name, minutes: settings.default_task_minutes, color: h.color })}>
                    <Checkbox round checked={done} label={`Check in ${h.name}`} disabled={date > today} onChange={() => void habitActions.toggle(h, date, c)} />
                    <Link to={linkTo.habit(h.id)} className="min-w-0 flex-1 truncate hover:underline">
                      {h.name}
                    </Link>
                    {h.reminder_time && <span className="text-xs text-muted">{h.reminder_time.slice(0, 5)}</span>}
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}

        {(planGoals.length > 0 || planSubjects.length > 0) && (
          <Panel title="Goals & study">
            <p className="mb-2 text-xs text-muted">Drag one onto the timeline to block time for it, or tap to pick a time.</p>
            <ul className="flex flex-wrap gap-1.5">
              {[
                ...planSubjects.map((s) => ({ key: s.id, plan: { title: `Study: ${s.name}`, minutes: 60, color: s.color } })),
                ...planGoals.map((g) => ({ key: g.id, plan: { title: g.title, minutes: 60, color: g.color } })),
              ].map(({ key, plan }) => (
                <li key={key}>
                  <button
                    type="button"
                    className="flex max-w-full cursor-grab items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2 active:cursor-grabbing"
                    onClick={() => openPlan(plan)}
                    {...dragPlan(plan)}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: plan.color }} aria-hidden />
                    <span className="truncate">{plan.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </aside>
    </div>
  )
}

function WeekPlan({ days, items, instances, onDay, onBlock, onTask }: { days: DateKey[]; items: Item[]; instances: TaskInstance[]; onDay: (d: DateKey) => void; onBlock: (t: BlockTarget) => void; onTask: (i: TaskInstance) => void }) {
  const { tz, today, settings } = useSettings()
  const navigate = useNavigate()
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((d) => {
        const ds = zonedToInstant(d, '00:00', tz)
        const de = zonedToInstant(addDays(d, 1), '00:00', tz)
        const dayItems = items.filter((i) => (i.allDay ? i.start < de && i.end > ds : dateKey(i.start, tz) === d))
        const dayTasks = instances.filter((i) => i.date === d && !i.scheduledAt)
        const planned = dayItems.filter((i) => !i.allDay && i.kind !== 'event').reduce((s, i) => s + (i.end.getTime() - i.start.getTime()) / 60000, 0)
        const taskMinutes = dayTasks.filter((i) => !i.done).reduce((s, i) => s + (i.task.estimated_minutes ?? 0), 0)
        return (
          <section key={d} className={cn('flex min-w-0 flex-col rounded-xl border bg-surface', d === today ? 'border-accent' : 'border-line')}>
            <button type="button" onClick={() => onDay(d)} className="border-b border-line px-3 py-2 text-left hover:bg-surface-2">
              <p className={cn('text-xs font-semibold uppercase', d === today ? 'text-accent' : 'text-muted')}>{formatKey(d, 'EEE')}</p>
              <p className="text-lg font-semibold">{formatKey(d, 'd MMM')}</p>
              <p className="text-xs text-muted">
                {formatMinutes(Math.round(planned)) || '0m'} blocked{taskMinutes ? ` · ${formatMinutes(taskMinutes)} tasks` : ''}
              </p>
            </button>
            <ul className="flex flex-col gap-1 p-2 text-xs">
              {dayItems.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    className={cn('w-full truncate rounded-md border-l-2 bg-surface-2 px-2 py-1 text-left', i.done && 'line-through opacity-60')}
                    style={{ borderLeftColor: i.color ?? 'rgb(var(--accent))' }}
                    onClick={() => (i.task ? onTask(i.task) : i.block ? onBlock({ block: i.block }) : i.eventId ? navigate(linkTo.event(i.eventId)) : onDay(d))}
                  >
                    {!i.allDay && <span className="tabular text-muted">{formatTime(i.start, tz, settings.time_format)} </span>}
                    {i.title}
                  </button>
                </li>
              ))}
              {dayTasks.map((i) => (
                <li key={i.key}>
                  <button type="button" onClick={() => onTask(i)} className={cn('flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left hover:bg-surface-2', i.done && 'text-muted line-through')}>
                    <CalendarClock className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
                    <span className="truncate">{i.task.title}</span>
                  </button>
                </li>
              ))}
              {dayItems.length + dayTasks.length === 0 && <li className="px-1 py-2 text-subtle">Nothing planned</li>}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
