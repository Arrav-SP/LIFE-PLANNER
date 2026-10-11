import { dateKey, timeOf, utcToKey, zonedToInstant } from '@/lib/dates'

/**
 * FullCalendar runs in UTC "wall-clock" mode so it can show the user's chosen
 * time zone without a timezone plugin: we hand it the wall time in that zone
 * labelled as UTC, and convert back on every edit.
 */
export function toWall(d: Date, tz: string): string {
  return `${dateKey(d, tz)}T${timeOf(d, tz)}:00Z`
}

export function fromWall(d: Date, tz: string): Date {
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return zonedToInstant(utcToKey(d.getTime()), `${hh}:${mm}`, tz)
}

export function wallKey(d: Date): string {
  return utcToKey(d.getTime())
}
