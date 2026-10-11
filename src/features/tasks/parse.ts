import { addDays, dateKey, todayKey, weekdayOf, zonedToInstant, parseKey } from '@/lib/dates'
import type { DateKey, Priority, Recurrence, Weekday } from '@/lib/db/types'

export interface ParsedEntry {
  title: string
  due_date: DateKey | null
  /** HH:mm wall-clock time, if one was given. */
  time: string | null
  scheduled_at: string | null
  estimated_minutes: number | null
  priority: Priority
  tags: string[]
  recurrence: Recurrence | null
  /** Human-readable pieces that were recognised, for the confirmation UI. */
  matched: string[]
}

const DAYS: Record<string, Weekday> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
}
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}
const DAY_RE = Object.keys(DAYS).sort((a, b) => b.length - a.length).join('|')
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')

/** The first date strictly after `from` that falls on weekday `wd`. */
function nextWeekday(from: DateKey, wd: Weekday): DateKey {
  return addDays(from, (wd - weekdayOf(from) + 7) % 7 || 7)
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function buildDate(year: number, month: number, day: number): DateKey | null {
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * Local, rule-based parser for quick entry, e.g.
 * "Study OS for 90 minutes tomorrow at 6 PM #fat !high".
 * No network or AI service is involved; the result is shown for confirmation.
 */
export function parseQuickEntry(input: string, tz: string, now: Date = new Date()): ParsedEntry {
  const today = todayKey(tz, now)
  let text = ` ${input.trim()} `
  const matched: string[] = []
  let due: DateKey | null = null
  let time: string | null = null
  let minutes: number | null = null
  let priority: Priority = 'normal'
  let recurrence: Recurrence | null = null
  const tags: string[] = []

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = text.match(re)
    if (!m) return
    if (fn(m) === false) return
    text = text.replace(m[0], ' ')
  }

  // Tags and priority markers.
  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_, t: string) => {
    tags.push(t.toLowerCase())
    return ' '
  })
  if (tags.length) matched.push(tags.map((t) => '#' + t).join(' '))
  take(/\s(?:!|p)(urgent|high|low|normal|[1-4])\b/i, (m) => {
    const v = m[1].toLowerCase()
    priority = (({ '1': 'urgent', '2': 'high', '3': 'normal', '4': 'low' } as Record<string, Priority>)[v] ?? v) as Priority
    matched.push(`${priority} priority`)
  })

  // Duration: "for 90 minutes", "for 1.5h", "for 2 hours", "for 1h30".
  take(/\sfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)(?:\s*(\d+)\s*(?:m|min|mins|minutes)?)?\b/i, (m) => {
    minutes = Math.round(parseFloat(m[1]) * 60 + (m[3] ? parseInt(m[3], 10) : 0))
  })
  if (minutes === null)
    take(/\sfor\s+(\d+)\s*(m|min|mins|minute|minutes)\b/i, (m) => {
      minutes = parseInt(m[1], 10)
    })
  if (minutes !== null) matched.push(`${minutes} min`)

  // Recurrence.
  take(/\severy\s+(day|weekday|weekdays|week|month|year|(?:other\s+)?(?:day|week))\b/i, (m) => {
    const v = m[1].toLowerCase()
    if (v === 'day') recurrence = { freq: 'daily', interval: 1 }
    else if (v.startsWith('weekday')) recurrence = { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }
    else if (v === 'week') recurrence = { freq: 'weekly', interval: 1 }
    else if (v === 'month') recurrence = { freq: 'monthly', interval: 1 }
    else if (v === 'year') recurrence = { freq: 'yearly', interval: 1 }
    else if (v === 'other day') recurrence = { freq: 'daily', interval: 2 }
    else if (v === 'other week') recurrence = { freq: 'weekly', interval: 2 }
  })
  if (!recurrence)
    take(new RegExp(`\\severy\\s+((?:${DAY_RE})(?:\\s*(?:,|and)\\s*(?:${DAY_RE}))*)\\b`, 'i'), (m) => {
      const days = m[1].split(/\s*(?:,|and)\s*/i).map((d) => DAYS[d.toLowerCase()])
      recurrence = { freq: 'weekly', interval: 1, byWeekday: [...new Set(days)] as Weekday[] }
      due = nextWeekday(addDays(today, -1), days[0])
    })
  if (recurrence) matched.push('repeats')

  // Time: "at 6 PM", "at 18:30", "6pm", "6:30pm", "tonight".
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => {
    let h = parseInt(m[1], 10)
    const min = m[2] ? parseInt(m[2], 10) : 0
    if (h > 12 || min > 59) return false
    const pm = m[3].toLowerCase() === 'pm'
    if (h === 12) h = pm ? 12 : 0
    else if (pm) h += 12
    time = `${pad(h)}:${pad(min)}`
  })
  if (!time)
    take(/\sat\s+(\d{1,2}):(\d{2})\b/i, (m) => {
      const h = parseInt(m[1], 10)
      const min = parseInt(m[2], 10)
      if (h > 23 || min > 59) return false
      time = `${pad(h)}:${pad(min)}`
    })
  if (!time)
    take(/\sat\s+(\d{1,2})\b(?!\s*(?:[/.-]|st|nd|rd|th))/i, (m) => {
      const h = parseInt(m[1], 10)
      if (h > 23) return false
      time = `${pad(h)}:00`
    })
  take(/\s(tonight)\b/i, () => {
    if (!time) time = '20:00'
    due = due ?? today
  })

  // Dates.
  take(/\s(today)\b/i, () => {
    due = today
  })
  take(/\s(tomorrow|tmrw|tmr)\b/i, () => {
    due = addDays(today, 1)
  })
  take(/\s(day after tomorrow)\b/i, () => {
    due = addDays(today, 2)
  })
  take(/\sin\s+(\d+)\s+(day|days|week|weeks)\b/i, (m) => {
    const n = parseInt(m[1], 10)
    due = addDays(today, m[2].toLowerCase().startsWith('week') ? n * 7 : n)
  })
  take(/\snext\s+week\b/i, () => {
    due = nextWeekday(today, 1)
  })
  take(new RegExp(`\\s(next\\s+|on\\s+|this\\s+)?(${DAY_RE})\\b`, 'i'), (m) => {
    if (!due) due = nextWeekday(today, DAYS[m[2].toLowerCase()])
  })
  // "12 oct", "oct 12", "12th october", optional year.
  take(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?\\b`, 'i'), (m) => {
    const t = parseKey(today)
    const month = MONTHS[m[2].toLowerCase()]
    let year = m[3] ? parseInt(m[3], 10) : t.y
    let d = buildDate(year, month, parseInt(m[1], 10))
    if (!d) return false
    if (!m[3] && d < today) {
      year += 1
      d = buildDate(year, month, parseInt(m[1], 10))
    }
    due = d
  })
  if (!due)
    take(new RegExp(`\\s(?:on\\s+)?(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'), (m) => {
      const t = parseKey(today)
      const month = MONTHS[m[1].toLowerCase()]
      let year = m[3] ? parseInt(m[3], 10) : t.y
      let d = buildDate(year, month, parseInt(m[2], 10))
      if (!d) return false
      if (!m[3] && d < today) {
        year += 1
        d = buildDate(year, month, parseInt(m[2], 10))
      }
      due = d
    })

  if (time && !due) {
    // A bare time means the next time that clock time comes round.
    const candidate = zonedToInstant(today, time, tz)
    due = candidate.getTime() > now.getTime() ? today : addDays(today, 1)
  }
  if (due) matched.push(due === today ? 'today' : due === addDays(today, 1) ? 'tomorrow' : due)
  if (time) matched.push(`at ${time}`)

  const scheduled_at = due && time ? zonedToInstant(due, time, tz).toISOString() : null
  const title = text.replace(/\s+/g, ' ').replace(/\s+(on|at|by|for)\s*$/i, '').trim()
  return {
    title: title || input.trim(),
    due_date: due,
    time,
    scheduled_at,
    estimated_minutes: minutes,
    priority,
    tags,
    recurrence,
    matched,
  }
}

export function sameDay(a: string, tz: string, key: DateKey) {
  return dateKey(a, tz) === key
}
