import type { DateKey } from '@/lib/db/types'
import { addDays, zonedToInstant } from '@/lib/dates'

export interface Timed {
  key: string
  start: Date
  end: Date
}

/** Assign overlapping items to side-by-side lanes for a day timeline. */
export function layoutLanes<T extends Timed>(items: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime())
  const out: (T & { lane: number; lanes: number })[] = []
  let cluster: (T & { lane: number; lanes: number })[] = []
  let clusterEnd = 0
  const flush = () => {
    const n = Math.max(1, ...cluster.map((c) => c.lane + 1))
    for (const c of cluster) c.lanes = n
    out.push(...cluster)
    cluster = []
  }
  for (const it of sorted) {
    if (cluster.length && it.start.getTime() >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.lane))
    let lane = 0
    while (used.has(lane)) lane++
    cluster.push({ ...it, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, it.end.getTime())
  }
  if (cluster.length) flush()
  return out
}

/** The planner's day on `date`: from the day-start hour to the day-end hour in Settings. */
export function dayWindow(date: DateKey, startHour: number, endHour: number, tz: string): { dayStart: Date; dayEnd: Date } {
  const s = Math.min(startHour, 23)
  const e = Math.max(endHour, s + 1)
  return {
    dayStart: zonedToInstant(date, `${String(s).padStart(2, '0')}:00`, tz),
    dayEnd: e >= 24 ? zonedToInstant(addDays(date, 1), '00:00', tz) : zonedToInstant(date, `${String(e).padStart(2, '0')}:00`, tz),
  }
}

/** Place items one after another into the free slots; each placement uses up its time. */
export function placeAll<T extends { minutes: number }>(free: { start: Date; end: Date }[], items: T[], after: Date): { placed: (T & { start: Date; end: Date })[]; unplaced: T[] } {
  let gaps = free
  const placed: (T & { start: Date; end: Date })[] = []
  const unplaced: T[] = []
  for (const it of items) {
    const slot = suggestSlot(gaps, it.minutes, after)
    if (!slot) {
      unplaced.push(it)
      continue
    }
    placed.push({ ...it, ...slot })
    gaps = gaps.flatMap((g) =>
      g.end <= slot.start || g.start >= slot.end
        ? [g]
        : [...(g.start < slot.start ? [{ start: g.start, end: slot.start }] : []), ...(slot.end < g.end ? [{ start: slot.end, end: g.end }] : [])],
    )
  }
  return { placed, unplaced }
}

/** The first free slot that fits `minutes`, starting no earlier than `after`. */
export function suggestSlot(free: { start: Date; end: Date }[], minutes: number, after: Date): { start: Date; end: Date } | null {
  const need = minutes * 60000
  for (const f of free) {
    const s = Math.max(f.start.getTime(), roundUp(after.getTime()))
    if (f.end.getTime() - s >= need) return { start: new Date(s), end: new Date(s + need) }
  }
  return null
}

/** Round up to the next 15 minutes. */
function roundUp(ms: number) {
  const q = 15 * 60000
  return Math.ceil(ms / q) * q
}
