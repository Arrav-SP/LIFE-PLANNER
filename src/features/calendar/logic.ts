import type { CalendarEvent, EventException, TimeBlock } from '@/lib/db/types'
import { timedOccurrences } from '@/lib/recurrence'
import { dateKey } from '@/lib/dates'

/** One concrete appearance of an event on the calendar. */
export interface EventInstance {
  key: string
  event: CalendarEvent
  /** Original occurrence start (identifies the occurrence for exceptions). */
  originalStart: string
  start: Date
  end: Date
  allDay: boolean
  title: string
  location: string
  color: string | null
  exception?: EventException
  recurring: boolean
}

/** Expand events (and their exceptions) into instances overlapping [rangeStart, rangeEnd). */
export function expandEvents(events: CalendarEvent[], exceptions: EventException[], rangeStart: Date, rangeEnd: Date, tz: string): EventInstance[] {
  const exByEvent = new Map<string, EventException[]>()
  for (const x of exceptions) {
    if (!exByEvent.has(x.event_id)) exByEvent.set(x.event_id, [])
    exByEvent.get(x.event_id)!.push(x)
  }
  const out: EventInstance[] = []
  for (const ev of events) {
    if (ev.archived_at) continue
    const exs = exByEvent.get(ev.id) ?? []
    // Widen the window so occurrences moved into range by an override are found.
    const pad = 7 * 86400000
    const occs = timedOccurrences(ev.recurrence, ev.start_at, ev.end_at, ev.timezone || tz, new Date(rangeStart.getTime() - pad), new Date(rangeEnd.getTime() + pad))
    for (const o of occs) {
      const ex = ev.recurrence ? exs.find((x) => new Date(x.occurrence_start).getTime() === o.start.getTime()) : undefined
      if (ex?.cancelled) continue
      const ov = ex?.override ?? {}
      const start = ov.start_at ? new Date(ov.start_at) : o.start
      const end = ov.end_at ? new Date(ov.end_at) : o.end
      if (!(start < rangeEnd && end > rangeStart)) continue
      out.push({
        key: `${ev.id}:${o.start.toISOString()}`,
        event: ev,
        originalStart: o.start.toISOString(),
        start,
        end,
        allDay: ov.all_day ?? ev.all_day,
        title: ov.title ?? ev.title,
        location: ov.location ?? ev.location,
        color: ov.color !== undefined ? ov.color : ev.color,
        exception: ex,
        recurring: !!ev.recurrence,
      })
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

export interface Conflict {
  a: string
  b: string
}

interface Span {
  key: string
  start: Date
  end: Date
  allDay?: boolean
}

/** Pairs of timed items that overlap. All-day items never conflict. */
export function findConflicts(items: Span[]): Conflict[] {
  const timed = items.filter((i) => !i.allDay).sort((a, b) => a.start.getTime() - b.start.getTime())
  const out: Conflict[] = []
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[j].start >= timed[i].end) break
      out.push({ a: timed[i].key, b: timed[j].key })
    }
  }
  return out
}

/** Free gaps (minutes) between busy spans within a day window. */
export function freeSlots(busy: Span[], dayStart: Date, dayEnd: Date, minMinutes = 15): { start: Date; end: Date }[] {
  const spans = busy
    .filter((b) => !b.allDay && b.end > dayStart && b.start < dayEnd)
    .map((b) => ({ s: Math.max(b.start.getTime(), dayStart.getTime()), e: Math.min(b.end.getTime(), dayEnd.getTime()) }))
    .sort((a, b) => a.s - b.s)
  const out: { start: Date; end: Date }[] = []
  let cursor = dayStart.getTime()
  for (const s of spans) {
    if (s.s - cursor >= minMinutes * 60000) out.push({ start: new Date(cursor), end: new Date(s.s) })
    cursor = Math.max(cursor, s.e)
  }
  if (dayEnd.getTime() - cursor >= minMinutes * 60000) out.push({ start: new Date(cursor), end: dayEnd })
  return out
}

/** Expand recurring time blocks (routines) into concrete blocks for the range. */
export function expandBlocks(blocks: TimeBlock[], rangeStart: Date, rangeEnd: Date, tz: string): (TimeBlock & { instanceKey: string; start: Date; end: Date; date: string; virtual: boolean })[] {
  const out: (TimeBlock & { instanceKey: string; start: Date; end: Date; date: string; virtual: boolean })[] = []
  for (const b of blocks) {
    for (const o of timedOccurrences(b.recurrence, b.start_at, b.end_at, tz, rangeStart, rangeEnd)) {
      out.push({ ...b, instanceKey: `${b.id}:${o.start.toISOString()}`, start: o.start, end: o.end, date: dateKey(o.start, tz), virtual: !!b.recurrence && o.start.toISOString() !== new Date(b.start_at).toISOString() })
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}
