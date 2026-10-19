/** Where `t` falls across the day, as a percentage clamped to 0–100. */
export function rulerPos(t: Date, dayStart: Date, dayEnd: Date): number {
  const span = dayEnd.getTime() - dayStart.getTime()
  if (span <= 0) return 0
  return Math.min(100, Math.max(0, ((t.getTime() - dayStart.getTime()) / span) * 100))
}

/** An item's place on the ruler, or null when none of it falls inside the day. */
export function rulerSpan(start: Date, end: Date, dayStart: Date, dayEnd: Date): { left: number; width: number } | null {
  const left = rulerPos(start, dayStart, dayEnd)
  const right = rulerPos(end, dayStart, dayEnd)
  return right > left ? { left, width: right - left } : null
}
