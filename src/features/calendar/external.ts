// Read-only calendars from other apps (Google Calendar's secret iCal address),
// parsed with ical.js and expanded for the range on screen.
import ICAL from 'ical.js'
import { isValidTimeZone, zonedToInstant } from '@/lib/dates'

export type { CalendarLinkSetting as CalendarLink } from '@/lib/db/types'

export interface ExternalEvent {
  key: string
  calendarId: string
  title: string
  location: string
  allDay: boolean
  /** Instants for timed events. */
  start: Date
  end: Date
  /** Dates (YYYY-MM-DD, end exclusive) for all-day events. */
  startKey?: string
  endKey?: string
}

/** A parsed calendar file, ready to expand for any range. */
export interface ParsedCalendar {
  masters: ICAL.Event[]
}

const MAX_OCCURRENCES = 5000

export function parseCalendar(ics: string): ParsedCalendar {
  const root = new ICAL.Component(ICAL.parse(ics))
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(vtz)
    } catch {
      /* a broken time zone just means floating times */
    }
  }
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  for (const v of root.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(v)
    if (!e.startDate) continue
    if (e.isRecurrenceException()) exceptions.push(e)
    else masters.set(e.uid || `anon-${masters.size}`, e)
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex)
  return { masters: [...masters.values()] }
}

const keyOf = (t: ICAL.Time) => `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`

/** An ICAL time as an instant. Floating times are read in `tz` (or the property's own IANA TZID). */
function instant(t: ICAL.Time, tz: string, tzid?: string): Date {
  const zone = t.zone?.tzid
  if (zone && zone !== 'floating') return t.toJSDate()
  const local = `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
  return zonedToInstant(keyOf(t), local, tzid && isValidTimeZone(tzid) ? tzid : tz)
}

function addDaysKey(key: string, n: number) {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function toExternal(calendarId: string, key: string, item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null, tz: string): ExternalEvent {
  const tzid = item.component.getFirstProperty('dtstart')?.getParameter('tzid') as string | undefined
  const base = { key, calendarId, title: item.summary || '(No title)', location: item.location || '' }
  if (start.isDate) {
    const startKey = keyOf(start)
    const endKey = end && keyOf(end) > startKey ? keyOf(end) : addDaysKey(startKey, 1)
    return { ...base, allDay: true, startKey, endKey, start: zonedToInstant(startKey, '00:00', tz), end: zonedToInstant(endKey, '00:00', tz) }
  }
  const s = instant(start, tz, tzid)
  const e = end ? instant(end, tz, tzid) : new Date(s.getTime() + 3600000)
  return { ...base, allDay: false, start: s, end: e > s ? e : new Date(s.getTime() + 15 * 60000) }
}

/** Every occurrence overlapping [rangeStart, rangeEnd). */
export function expandCalendar(cal: ParsedCalendar, calendarId: string, rangeStart: Date, rangeEnd: Date, tz: string): ExternalEvent[] {
  const out: ExternalEvent[] = []
  const overlaps = (e: ExternalEvent) => e.start < rangeEnd && e.end > rangeStart
  for (const ev of cal.masters) {
    if (!ev.isRecurring()) {
      const x = toExternal(calendarId, `${calendarId}:${ev.uid}`, ev, ev.startDate, ev.endDate, tz)
      if (overlaps(x)) out.push(x)
      continue
    }
    const it = ev.iterator()
    for (let i = 0, next = it.next(); next && i < MAX_OCCURRENCES; i++, next = it.next()) {
      const d = ev.getOccurrenceDetails(next)
      const x = toExternal(calendarId, `${calendarId}:${ev.uid}:${next.toString()}`, d.item, d.startDate, d.endDate, tz)
      if (x.start >= rangeEnd) break
      if (overlaps(x)) out.push(x)
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}
