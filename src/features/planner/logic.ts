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
