// Builds the iCalendar (.ics) feed that Google Calendar (or any calendar app)
// subscribes to. Pure, so it can be tested here and bundled into the
// `calendar` Edge Function.
import type { CalendarEvent, EventException, Recurrence, Task } from '@/lib/db/types'
import { addDays, dateKey, timeOf, zonedToInstant } from '@/lib/dates'
import { seriesStart } from '@/features/tasks/logic'
import { tzOffset, tzScan } from '@date-fns/tz'

const DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const DEFAULT_TASK_MINUTES = 30

/** Escape a TEXT value (RFC 5545 §3.3.11). */
export function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Fold a content line at 75 octets (RFC 5545 §3.1), never splitting a UTF-8 character. */
export function fold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const parts: string[] = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur)
      cur = ''
      size = 0
    }
    cur += ch
    size += n
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const dateValue = (key: string) => key.replace(/-/g, '')
/** Wall-clock time of an instant in `tz`, as an iCalendar local DATE-TIME. */
const local = (d: Date, tz: string) => `${dateValue(dateKey(d, tz))}T${timeOf(d, tz).replace(':', '')}00`

/** `wall` is the start's wall-clock time, or null for all-day series. */
export function rrule(rec: Recurrence, tz: string, wall: string | null): string {
  const parts = [`FREQ=${rec.freq.toUpperCase()}`]
  if ((rec.interval || 1) > 1) parts.push(`INTERVAL=${Math.floor(rec.interval)}`)
  if (rec.freq === 'weekly' && rec.byWeekday?.length) parts.push(`BYDAY=${[...rec.byWeekday].sort().map((d) => DAY[d]).join(',')}`)
  if (rec.freq === 'monthly' && rec.byMonthDay) parts.push(`BYMONTHDAY=${rec.byMonthDay}`)
  if (rec.count) parts.push(`COUNT=${rec.count}`)
  else if (rec.until) {
    // UNTIL is inclusive. With a zoned DTSTART it must be UTC: the last occurrence's start.
    parts.push(`UNTIL=${wall === null ? dateValue(rec.until) : utc(zonedToInstant(rec.until, wall, tz))}`)
  }
  return `RRULE:${parts.join(';')}`
}

function offset(min: number): string {
  const sign = min < 0 ? '-' : '+'
  const a = Math.abs(min)
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`
}

/**
 * A VTIMEZONE for `tz`, with every offset change in the years around `now`.
 * Calendar apps need it to place times written in that zone (RFC 5545 §3.6.5).
 */
export function vtimezone(tz: string, now: Date = new Date()): string[] {
  const y = now.getUTCFullYear()
  const from = new Date(Date.UTC(y - 2, 0, 1))
  const to = new Date(Date.UTC(y + 6, 0, 1))
  const out = ['BEGIN:VTIMEZONE', `TZID:${tz}`]
  const changes = tzScan(tz, { start: from, end: to })
  if (!changes.length) {
    const o = offset(tzOffset(tz, now))
    out.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${o}`, `TZOFFSETTO:${o}`, 'END:STANDARD')
  } else {
    // Each change starts at the local time on the clock just before it.
    let prev = tzOffset(tz, from)
    out.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${offset(prev)}`, `TZOFFSETTO:${offset(prev)}`, 'END:STANDARD')
    for (const c of changes) {
      const kind = c.change > 0 ? 'DAYLIGHT' : 'STANDARD'
      const wall = new Date(c.date.getTime() + prev * 60000).toISOString().replace(/[-:]/g, '').slice(0, 15)
      out.push(`BEGIN:${kind}`, `DTSTART:${wall}`, `TZOFFSETFROM:${offset(prev)}`, `TZOFFSETTO:${offset(c.offset)}`, `END:${kind}`)
      prev = c.offset
    }
  }
  out.push('END:VTIMEZONE')
  return out
}

export interface FeedInput {
  events: CalendarEvent[]
  exceptions: EventException[]
  tasks: Task[]
  /** The user's time zone. */
  tz: string
  /** Absolute app URL for links back, e.g. https://life-planner.vercel.app */
  appUrl?: string
  now?: Date
}

function vevent(lines: string[]): string[] {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT']
}

function timing(start: Date, end: Date, allDay: boolean, tz: string): string[] {
  if (allDay) {
    const s = dateKey(start, tz)
    let e = dateKey(end, tz)
    if (e <= s) e = addDays(s, 1)
    return [`DTSTART;VALUE=DATE:${dateValue(s)}`, `DTEND;VALUE=DATE:${dateValue(e)}`]
  }
  return [`DTSTART;TZID=${tz}:${local(start, tz)}`, `DTEND;TZID=${tz}:${local(end, tz)}`]
}

function eventLines(ev: CalendarEvent, tz: string, stamp: string, appUrl?: string): string[] {
  const zone = ev.timezone || tz
  const start = new Date(ev.start_at)
  const end = new Date(ev.end_at)
  const desc = [ev.description, ev.notes, ev.meeting_url].filter(Boolean).join('\n\n')
  const out = [`UID:${ev.id}@life-planner`, `DTSTAMP:${stamp}`, ...timing(start, end, ev.all_day, zone), `SUMMARY:${icsText(ev.title)}`]
  if (ev.location) out.push(`LOCATION:${icsText(ev.location)}`)
  if (desc) out.push(`DESCRIPTION:${icsText(desc)}`)
  if (appUrl) out.push(`URL:${appUrl}/calendar?event=${ev.id}`)
  if (ev.updated_at) out.push(`LAST-MODIFIED:${utc(new Date(ev.updated_at))}`)
  return out
}

function taskLines(t: Task, tz: string, stamp: string, appUrl?: string): string[] | null {
  if (t.archived_at || t.status === 'done' || t.status === 'cancelled') return null
  const minutes = t.estimated_minutes || DEFAULT_TASK_MINUTES
  let head: string[]
  let wall = '00:00'
  if (t.scheduled_at) {
    const at = new Date(t.scheduled_at)
    wall = timeOf(at, tz)
    // Recurring tasks repeat from their series start at the scheduled wall-clock time.
    const start = t.recurrence ? zonedToInstant(seriesStart(t, tz), wall, tz) : at
    head = timing(start, new Date(start.getTime() + minutes * 60000), false, tz)
  } else {
    const day = t.due_date ?? (t.recurrence ? seriesStart(t, tz) : null)
    if (!day) return null
    head = [`DTSTART;VALUE=DATE:${dateValue(day)}`, `DTEND;VALUE=DATE:${dateValue(addDays(day, 1))}`]
  }
  const out = [`UID:task-${t.id}@life-planner`, `DTSTAMP:${stamp}`, ...head, `SUMMARY:${icsText(`Task: ${t.title}`)}`]
  if (t.recurrence) out.push(rrule(t.recurrence, tz, t.scheduled_at ? wall : null))
  const desc = [t.description, t.notes].filter(Boolean).join('\n\n')
  if (desc) out.push(`DESCRIPTION:${icsText(desc)}`)
  if (appUrl) out.push(`URL:${appUrl}/tasks?task=${t.id}`)
  out.push('TRANSP:TRANSPARENT')
  return out
}

/** The whole feed: events (with repeats, moved and cancelled occurrences) and dated tasks. */
export function buildFeed({ events, exceptions, tasks, tz, appUrl, now = new Date() }: FeedInput): string {
  const stamp = utc(now)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Life Planner//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Life Planner',
    `X-WR-TIMEZONE:${tz}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]
  const zones = new Set([tz, ...events.filter((e) => !e.archived_at && e.timezone).map((e) => e.timezone)])
  for (const z of zones) lines.push(...vtimezone(z, now))
  for (const ev of events) {
    if (ev.archived_at) continue
    const zone = ev.timezone || tz
    const base = eventLines(ev, tz, stamp, appUrl)
    const exs = ev.recurrence ? exceptions.filter((x) => x.event_id === ev.id) : []
    if (ev.recurrence) {
      base.push(rrule(ev.recurrence, zone, ev.all_day ? null : timeOf(new Date(ev.start_at), zone)))
      for (const x of exs.filter((x) => x.cancelled)) {
        const at = new Date(x.occurrence_start)
        base.push(ev.all_day ? `EXDATE;VALUE=DATE:${dateValue(dateKey(at, zone))}` : `EXDATE;TZID=${zone}:${local(at, zone)}`)
      }
    }
    lines.push(...vevent(base))
    // A changed occurrence is its own VEVENT with the series UID and the original start as RECURRENCE-ID.
    for (const x of exs.filter((x) => !x.cancelled)) {
      const ov = x.override
      const orig = new Date(x.occurrence_start)
      const dur = new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime()
      const start = ov.start_at ? new Date(ov.start_at) : orig
      const end = ov.end_at ? new Date(ov.end_at) : new Date(orig.getTime() + dur)
      const merged: CalendarEvent = {
        ...ev,
        title: ov.title ?? ev.title,
        location: ov.location ?? ev.location,
        description: ov.description ?? ev.description,
        notes: ov.notes ?? ev.notes,
        meeting_url: ov.meeting_url ?? ev.meeting_url,
        all_day: ov.all_day ?? ev.all_day,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        updated_at: x.updated_at,
      }
      const l = eventLines(merged, tz, stamp, appUrl)
      l.splice(2, 0, ev.all_day ? `RECURRENCE-ID;VALUE=DATE:${dateValue(dateKey(orig, zone))}` : `RECURRENCE-ID;TZID=${zone}:${local(orig, zone)}`)
      lines.push(...vevent(l))
    }
  }
  for (const t of tasks) {
    const l = taskLines(t, tz, stamp, appUrl)
    if (l) lines.push(...vevent(l))
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
