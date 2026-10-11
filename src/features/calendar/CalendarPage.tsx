import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import type { DateSelectArg, DatesSetArg, EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useList } from '@/lib/db/hooks'
import { isNull } from '@/lib/db/store'
import { dateKey, timeOf } from '@/lib/dates'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/misc'
import { useTaskData } from '@/features/tasks/useTaskData'
import { expandTasks, type TaskInstance } from '@/features/tasks/logic'
import { useTaskActions } from '@/features/tasks/actions'
import { TaskEditor } from '@/features/tasks/TaskEditor'
import { expandBlocks, expandEvents, findConflicts, type EventInstance } from './logic'
import { useEventActions } from './actions'
import { EventEditor, type EditorTarget } from './EventEditor'
import { fromWall, toWall, wallKey } from './wall'

type View = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek'
const VIEWS: { value: View; label: string }[] = [
  { value: 'dayGridMonth', label: 'Month' },
  { value: 'timeGridWeek', label: 'Week' },
  { value: 'timeGridDay', label: 'Day' },
  { value: 'listWeek', label: 'Agenda' },
]

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

export function CalendarPage() {
  const { tz, settings } = useSettings()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const cal = useRef<FullCalendar>(null)
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  const [view, setView] = useState<View>(() => readPref('lp-cal-view', narrow ? 'listWeek' : 'timeGridWeek'))
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)
  const [title, setTitle] = useState('')
  const [show, setShow] = useState(() => readPref('lp-cal-show', { tasks: true, blocks: true }))
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [scopeFor, setScopeFor] = useState<EventInstance | null>(null)
  const [task, setTask] = useState<TaskInstance | null>(null)

  const events = useList('events', { filters: [isNull('archived_at')] })
  const exceptions = useList('event_exceptions')
  const blocks = useList('time_blocks')
  const { tasks, occurrences } = useTaskData()
  const eventActions = useEventActions()
  const taskActions = useTaskActions()

  useEffect(() => {
    try {
      localStorage.setItem('lp-cal-view', JSON.stringify(view))
      localStorage.setItem('lp-cal-show', JSON.stringify(show))
    } catch {
      /* storage unavailable */
    }
  }, [view, show])

  // Deep link: /calendar?event=<id> opens the event.
  useEffect(() => {
    const id = params.get('event')
    const ev = id && (events.data ?? []).find((e) => e.id === id)
    if (ev) {
      setEditor({ event: ev, scope: 'all' })
      params.delete('event')
      setParams(params, { replace: true })
    }
  }, [params, events.data, setParams])

  const instances = useMemo(() => (range ? expandEvents(events.data ?? [], exceptions.data ?? [], range.start, range.end, tz) : []), [events.data, exceptions.data, range, tz])
  const blockInstances = useMemo(() => (range && show.blocks ? expandBlocks(blocks.data ?? [], range.start, range.end, tz) : []), [blocks.data, range, tz, show.blocks])
  const taskInstances = useMemo(() => {
    if (!range || !show.tasks) return []
    return expandTasks(
      tasks.filter((t) => !t.parent_id),
      occurrences,
      dateKey(range.start, tz),
      dateKey(new Date(range.end.getTime() - 1), tz),
      tz,
    ).filter((i) => i.date && !i.skipped)
  }, [tasks, occurrences, range, tz, show.tasks])

  const busy = useMemo(
    () => [
      ...instances.map((i) => ({ key: i.key, title: i.title, start: i.start, end: i.end, allDay: i.allDay })),
      ...blockInstances.map((b) => ({ key: b.instanceKey, title: b.title, start: b.start, end: b.end, allDay: false })),
    ],
    [instances, blockInstances],
  )
  const conflictKeys = useMemo(() => {
    const s = new Set<string>()
    for (const c of findConflicts(busy)) {
      s.add(c.a)
      s.add(c.b)
    }
    return s
  }, [busy])

  const fcEvents: EventInput[] = useMemo(() => {
    const out: EventInput[] = []
    for (const i of instances) {
      const color = i.color ?? 'rgb(var(--accent))'
      out.push({
        id: i.key,
        title: i.title,
        start: i.allDay ? dateKey(i.start, tz) : toWall(i.start, tz),
        end: i.allDay ? dateKey(i.end, tz) : toWall(i.end, tz),
        allDay: i.allDay,
        backgroundColor: color,
        borderColor: color,
        classNames: conflictKeys.has(i.key) ? ['lp-conflict'] : [],
        extendedProps: { kind: 'event', inst: i, location: i.location },
      })
    }
    for (const b of blockInstances) {
      const color = b.color ?? 'rgb(var(--warning))'
      out.push({
        id: b.instanceKey,
        title: b.title,
        start: toWall(b.start, tz),
        end: toWall(b.end, tz),
        backgroundColor: color,
        borderColor: color,
        editable: false,
        classNames: ['lp-block', ...(b.status === 'done' ? ['lp-done'] : []), ...(conflictKeys.has(b.instanceKey) ? ['lp-conflict'] : [])],
        extendedProps: { kind: 'block' },
      })
    }
    for (const t of taskInstances) {
      const timed = !!t.scheduledAt
      const start = timed ? new Date(t.scheduledAt!) : null
      out.push({
        id: `task:${t.key}`,
        title: `☐ ${t.task.title}`,
        start: timed ? toWall(start!, tz) : t.date!,
        end: timed ? toWall(new Date(start!.getTime() + (t.task.estimated_minutes || settings.default_task_minutes) * 60000), tz) : undefined,
        allDay: !timed,
        backgroundColor: 'rgb(var(--surface))',
        borderColor: 'rgb(var(--accent))',
        textColor: 'rgb(var(--fg))',
        classNames: ['lp-task', ...(t.done ? ['lp-done'] : [])],
        durationEditable: false,
        extendedProps: { kind: 'task', inst: t },
      })
    }
    return out
  }, [instances, blockInstances, taskInstances, conflictKeys, tz, settings.default_task_minutes])

  const nowFn = useCallback(() => toWall(new Date(), tz), [tz])
  const timeFormat = useMemo(() => ({ hour: 'numeric' as const, minute: '2-digit' as const, hour12: settings.time_format !== 'HH:mm' }), [settings.time_format])
  const plugins = useMemo(() => [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin], [])

  const api = () => cal.current?.getApi()
  const changeView = (v: View) => {
    setView(v)
    api()?.changeView(v)
  }

  const onDatesSet = useCallback(
    (arg: DatesSetArg) => {
      const start = fromWall(arg.start, tz)
      const end = fromWall(arg.end, tz)
      // FullCalendar fires this on re-render too; only store real changes to avoid a loop.
      setRange((r) => (r && r.start.getTime() === start.getTime() && r.end.getTime() === end.getTime() ? r : { start, end }))
      setTitle(arg.view.title)
    },
    [tz],
  )

  const onSelect = (arg: DateSelectArg) => {
    api()?.unselect()
    setEditor({ start: fromWall(arg.start, tz), end: fromWall(arg.end, tz), allDay: arg.allDay })
  }

  const onClick = (arg: EventClickArg) => {
    const kind = arg.event.extendedProps.kind as string
    if (kind === 'event') {
      const inst = arg.event.extendedProps.inst as EventInstance
      if (inst.recurring) setScopeFor(inst)
      else setEditor({ event: inst.event, instance: inst, scope: 'all' })
    } else if (kind === 'task') setTask(arg.event.extendedProps.inst as TaskInstance)
    else if (kind === 'block') navigate(`/planner?date=${wallKey(arg.event.start!)}`)
  }

  const onMove = async (arg: EventDropArg | EventResizeDoneArg) => {
    const e = arg.event
    const kind = e.extendedProps.kind as string
    if (kind === 'event') {
      const inst = e.extendedProps.inst as EventInstance
      const start = fromWall(e.start!, tz)
      let end: Date
      if (e.allDay) end = e.end ? fromWall(e.end, tz) : fromWall(new Date(e.start!.getTime() + 86400000), tz)
      else end = e.end ? fromWall(e.end, tz) : new Date(start.getTime() + (inst.end.getTime() - inst.start.getTime() || 3600000))
      const r = await eventActions.move(inst, start, end, e.allDay)
      if (r === null) arg.revert()
    } else if (kind === 'task') {
      const inst = e.extendedProps.inst as TaskInstance
      const key = wallKey(e.start!)
      if (!inst.task.recurrence && !e.allDay) {
        const at = fromWall(e.start!, tz)
        const r = await taskActions.update(inst.task, { due_date: key, scheduled_at: at.toISOString() }, 'Task moved')
        if (!r) arg.revert()
      } else if (!inst.task.recurrence && e.allDay) {
        const r = await taskActions.update(inst.task, { due_date: key, scheduled_at: inst.task.scheduled_at ? fromWallKeepTime(key, inst.task.scheduled_at, tz) : null }, 'Task moved')
        if (!r) arg.revert()
      } else {
        await taskActions.reschedule(inst, key)
      }
    } else arg.revert()
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">{title || 'Calendar'}</h1>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous" onClick={() => api()?.prev()}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => api()?.today()}>
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label="Next" onClick={() => api()?.next()}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Segmented label="Calendar view" value={view} onChange={changeView} options={VIEWS} />
        <Button onClick={() => setEditor({})}>
          <Plus className="h-4 w-4" aria-hidden /> Event
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-4 text-sm text-muted">
        <label className="flex items-center gap-2">
          <Checkbox checked={show.tasks} onChange={(v) => setShow((s) => ({ ...s, tasks: v }))} label="Show tasks" /> Tasks
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={show.blocks} onChange={(v) => setShow((s) => ({ ...s, blocks: v }))} label="Show time blocks" /> Time blocks
        </label>
        {conflictKeys.size > 0 && <span className="text-danger">Red edge = overlapping items</span>}
      </div>
      <div className="rounded-xl border border-line bg-surface p-2 md:p-3">
        <FullCalendar
          ref={cal}
          plugins={plugins}
          initialView={view}
          headerToolbar={false}
          timeZone="UTC"
          now={nowFn}
          firstDay={settings.week_start}
          height={view === 'dayGridMonth' || view === 'listWeek' ? 'auto' : 'calc(100vh - 240px)'}
          scrollTime={`${String(settings.day_start_hour).padStart(2, '0')}:00:00`}
          nowIndicator
          selectable
          selectMirror
          editable
          dayMaxEvents={4}
          events={fcEvents}
          datesSet={onDatesSet}
          select={onSelect}
          eventClick={onClick}
          eventDrop={(a) => void onMove(a)}
          eventResize={(a) => void onMove(a)}
          eventTimeFormat={timeFormat}
          slotLabelFormat={timeFormat}
          noEventsText="Nothing scheduled"
          allDayText="All day"
        />
      </div>

      <Dialog
        open={!!scopeFor}
        onClose={() => setScopeFor(null)}
        title={scopeFor?.title ?? ''}
        description="This is a repeating event. What do you want to edit?"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                const i = scopeFor!
                setScopeFor(null)
                setEditor({ event: i.event, instance: i, scope: 'all' })
              }}
            >
              All events
            </Button>
            <Button
              data-autofocus
              onClick={() => {
                const i = scopeFor!
                setScopeFor(null)
                setEditor({ event: i.event, instance: i, scope: 'one' })
              }}
            >
              Only this one
            </Button>
          </>
        }
      />
      <EventEditor target={editor} onClose={() => setEditor(null)} busy={busy} />
      <TaskEditor open={!!task} task={task?.task} onClose={() => setTask(null)} />
    </div>
  )
}

/** Move a scheduled instant to another day, keeping its wall-clock time. */
function fromWallKeepTime(key: string, scheduledAt: string, tz: string): string {
  return fromWall(new Date(`${key}T${timeOf(scheduledAt, tz)}:00Z`), tz).toISOString()
}
