import { addDays, diffDays, parseKey, startOfWeek, weekdayOf, WEEKDAY_SHORT, zonedToInstant, dateKey, timeOf } from './dates'
import type { DateKey, Recurrence, Weekday } from './db/types'

const MAX_SCAN_DAYS = 366 * 20

function monthsBetween(a: DateKey, b: DateKey) {
  const pa = parseKey(a)
  const pb = parseKey(b)
  return (pb.y - pa.y) * 12 + (pb.m - pa.m)
}

/** Does the rule (anchored at `start`) produce an occurrence on `day`? Ignores until/count. */
export function matchesRule(rec: Recurrence, start: DateKey, day: DateKey): boolean {
  if (day < start) return false
  const interval = Math.max(1, Math.floor(rec.interval || 1))
  switch (rec.freq) {
    case 'daily':
      return diffDays(day, start) % interval === 0
    case 'weekly': {
      const days = rec.byWeekday?.length ? rec.byWeekday : [weekdayOf(start)]
      if (!days.includes(weekdayOf(day))) return false
      const weeks = diffDays(startOfWeek(day, 1), startOfWeek(start, 1)) / 7
      return weeks % interval === 0
    }
    case 'monthly': {
      const months = monthsBetween(start, day)
      if (months % interval !== 0) return false
      const want = rec.byMonthDay ?? parseKey(start).d
      return parseKey(day).d === want
    }
    case 'yearly': {
      const s = parseKey(start)
      const d = parseKey(day)
      return d.m === s.m && d.d === s.d && (d.y - s.y) % interval === 0
    }
    default:
      return false
  }
}

/**
 * Dates on which a recurring item occurs between `from` and `to` (inclusive).
 * Pure date arithmetic, so it is immune to time zones and DST.
 */
export function occurrenceDates(rec: Recurrence, start: DateKey, from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = []
  const until = rec.until || null
  const end = until && until < to ? until : to
  if (end < start) return out
  // With a count we must scan from the series start; otherwise from the window start.
  let k = rec.count ? start : from > start ? from : start
  let seen = 0
  let guard = 0
  for (; k <= end && guard < MAX_SCAN_DAYS; k = addDays(k, 1), guard++) {
    if (!matchesRule(rec, start, k)) continue
    seen++
    if (rec.count && seen > rec.count) break
    if (k >= from) out.push(k)
  }
  return out
}

/** Next occurrence on or after `from`, or null if the series has ended. */
export function nextOccurrence(rec: Recurrence, start: DateKey, from: DateKey): DateKey | null {
  const horizon = addDays(from, 366 * 5)
  const hits = occurrenceDates(rec, start, from, horizon)
  return hits[0] ?? null
}

export interface TimedOccurrence {
  /** Original start of this occurrence (identifies it for exceptions). */
  start: Date
  end: Date
  date: DateKey
}

/**
 * Occurrences of a timed recurring item. The wall-clock start time is kept in
 * the item's own time zone, so a 9:00 meeting stays at 9:00 across DST changes.
 */
export function timedOccurrences(
  rec: Recurrence | null,
  startAt: string,
  endAt: string,
  tz: string,
  rangeStart: Date,
  rangeEnd: Date,
): TimedOccurrence[] {
  const s = new Date(startAt)
  const e = new Date(endAt)
  const dur = e.getTime() - s.getTime()
  if (!rec) {
    return s < rangeEnd && e > rangeStart ? [{ start: s, end: e, date: dateKey(s, tz) }] : []
  }
  const startKey = dateKey(s, tz)
  const wall = timeOf(s, tz)
  // Pad the window by the duration so multi-day items overlapping the range appear.
  const fromKey = dateKey(new Date(rangeStart.getTime() - dur - 86400000), tz)
  const toKey = dateKey(new Date(rangeEnd.getTime() + 86400000), tz)
  const out: TimedOccurrence[] = []
  for (const k of occurrenceDates(rec, startKey, fromKey, toKey)) {
    const os = zonedToInstant(k, wall, tz)
    const oe = new Date(os.getTime() + dur)
    if (os < rangeEnd && oe > rangeStart) out.push({ start: os, end: oe, date: k })
  }
  return out
}

export function describeRecurrence(rec: Recurrence | null | undefined): string {
  if (!rec) return 'Does not repeat'
  const n = Math.max(1, rec.interval || 1)
  let base = ''
  switch (rec.freq) {
    case 'daily':
      base = n === 1 ? 'Every day' : `Every ${n} days`
      break
    case 'weekly': {
      const days = (rec.byWeekday ?? []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      const isWeekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d as Weekday))
      const label = isWeekdays ? 'weekdays' : days.length ? days.map((d) => WEEKDAY_SHORT[d]).join(', ') : ''
      if (n === 1) base = isWeekdays ? 'Every weekday' : label ? `Weekly on ${label}` : 'Every week'
      else base = `Every ${n} weeks${label ? ` on ${label}` : ''}`
      break
    }
    case 'monthly':
      base = `${n === 1 ? 'Monthly' : `Every ${n} months`}${rec.byMonthDay ? ` on day ${rec.byMonthDay}` : ''}`
      break
    case 'yearly':
      base = n === 1 ? 'Every year' : `Every ${n} years`
      break
  }
  if (rec.until) base += `, until ${rec.until}`
  else if (rec.count) base += `, ${rec.count} times`
  return base
}

export const RECURRENCE_PRESETS: { label: string; value: Recurrence | null }[] = [
  { label: 'Does not repeat', value: null },
  { label: 'Every day', value: { freq: 'daily', interval: 1 } },
  { label: 'Every weekday', value: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] } },
  { label: 'Every week', value: { freq: 'weekly', interval: 1 } },
  { label: 'Every month', value: { freq: 'monthly', interval: 1 } },
  { label: 'Every year', value: { freq: 'yearly', interval: 1 } },
]
