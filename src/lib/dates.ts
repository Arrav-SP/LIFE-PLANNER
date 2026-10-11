import { TZDate } from '@date-fns/tz'
import { format as fmt } from 'date-fns'
import type { DateKey, Instant, Weekday } from './db/types'

const keyFormatters = new Map<string, Intl.DateTimeFormat>()

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Calendar date of an instant in a time zone, as YYYY-MM-DD. */
export function dateKey(d: Date | Instant, tz: string): DateKey {
  const date = typeof d === 'string' ? new Date(d) : d
  let f = keyFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    keyFormatters.set(tz, f)
  }
  return f.format(date)
}

export function todayKey(tz: string, now: Date = new Date()): DateKey {
  return dateKey(now, tz)
}

export function parseKey(key: DateKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number)
  return { y, m, d }
}

/** Midnight UTC of the key's date; used only for day arithmetic. */
export function keyToUTC(key: DateKey): number {
  const { y, m, d } = parseKey(key)
  return Date.UTC(y, m - 1, d)
}

export function utcToKey(ms: number): DateKey {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(key: DateKey, n: number): DateKey {
  return utcToKey(keyToUTC(key) + n * 86400000)
}

export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((keyToUTC(a) - keyToUTC(b)) / 86400000)
}

export function weekdayOf(key: DateKey): Weekday {
  return new Date(keyToUTC(key)).getUTCDay() as Weekday
}

export function startOfWeek(key: DateKey, weekStart: number): DateKey {
  const wd = weekdayOf(key)
  return addDays(key, -((wd - weekStart + 7) % 7))
}

export function startOfMonth(key: DateKey): DateKey {
  return key.slice(0, 8) + '01'
}

export function endOfMonth(key: DateKey): DateKey {
  const { y, m } = parseKey(key)
  return utcToKey(Date.UTC(y, m, 0))
}

export function addMonths(key: DateKey, n: number): DateKey {
  const { y, m, d } = parseKey(key)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return utcToKey(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)))
}

export function daysInRange(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = []
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k)
  return out
}

/** The instant at which the wall-clock time `hh:mm` occurs on `key` in `tz` (DST-aware). */
export function zonedToInstant(key: DateKey, time: string, tz: string): Date {
  const { y, m, d } = parseKey(key)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(new TZDate(y, m - 1, d, hh || 0, mm || 0, 0, tz).getTime())
}

/** Wall-clock HH:mm of an instant in a time zone. */
export function timeOf(d: Date | Instant, tz: string): string {
  const z = new TZDate(new Date(d).getTime(), tz)
  return `${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')}`
}

/** Minutes since local midnight of an instant in a time zone. */
export function minutesOfDay(d: Date | Instant, tz: string): number {
  const z = new TZDate(new Date(d).getTime(), tz)
  return z.getHours() * 60 + z.getMinutes()
}

export function formatKey(key: DateKey, pattern = 'EEE, d MMM'): string {
  const { y, m, d } = parseKey(key)
  return fmt(new Date(y, m - 1, d, 12), pattern)
}

export function formatInstant(d: Date | Instant, tz: string, pattern: string): string {
  return fmt(new TZDate(new Date(d).getTime(), tz), pattern)
}

export function formatTime(d: Date | Instant, tz: string, timeFormat: string = 'HH:mm'): string {
  return formatInstant(d, tz, timeFormat)
}

/** Friendly relative label for a date key: Today, Tomorrow, Yesterday or a short date. */
export function relativeDay(key: DateKey, today: DateKey): string {
  const diff = diffDays(key, today)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return formatKey(key, 'EEEE')
  return formatKey(key, key.slice(0, 4) === today.slice(0, 4) ? 'd MMM' : 'd MMM yyyy')
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function orderedWeekdays(weekStart: number): Weekday[] {
  return Array.from({ length: 7 }, (_, i) => ((weekStart + i) % 7) as Weekday)
}

export function greeting(hour: number): string {
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
