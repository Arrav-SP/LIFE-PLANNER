import { describe, expect, it } from 'vitest'
import type { CalendarEvent, EventException, Task } from '@/lib/db/types'
import { expandEvents } from '@/features/calendar/logic'
import { expandCalendar, parseCalendar } from '@/features/calendar/external'
import { expandTasks } from '@/features/tasks/logic'
import { zonedToInstant } from '@/lib/dates'
import { buildFeed, fold, icsText, rrule } from './icsFeed'
import { importTarget } from './calendarProxy'

const stamp = { user_id: 'u', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  ...stamp,
  id: 'e1',
  title: 'OS lecture',
  description: '',
  all_day: false,
  start_at: '2026-10-05T03:30:00Z',
  end_at: '2026-10-05T05:00:00Z',
  timezone: 'Asia/Kolkata',
  location: 'SJT 501',
  meeting_url: '',
  notes: '',
  category_id: null,
  color: null,
  project_id: null,
  goal_id: null,
  tags: [],
  recurrence: null,
  reminder_offsets: [],
  archived_at: null,
  ...over,
})

const task = (over: Partial<Task>): Task => ({
  ...stamp,
  id: 't1',
  parent_id: null,
  title: 'Striver A2Z: 5 problems',
  description: '',
  status: 'todo',
  priority: 'normal',
  start_date: '2026-10-01',
  due_date: null,
  deadline: null,
  scheduled_at: '2026-10-01T13:30:00Z',
  estimated_minutes: 90,
  actual_minutes: null,
  category_id: null,
  project_id: null,
  goal_id: null,
  milestone_id: null,
  tags: [],
  checklist: [],
  links: [],
  notes: '',
  recurrence: null,
  reminder_offsets: [],
  sort_order: 0,
  completed_at: null,
  archived_at: null,
  ...over,
})

const iso = (d: Date) => d.toISOString()

describe('buildFeed', () => {
  it('round-trips repeating events, moved and cancelled occurrences through a calendar parser', () => {
    for (const tz of ['Asia/Kolkata', 'America/New_York']) {
      const weekly = event({
        timezone: tz,
        start_at: zonedToInstant('2026-10-05', '09:00', tz).toISOString(),
        end_at: zonedToInstant('2026-10-05', '10:30', tz).toISOString(),
        recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3], until: '2026-12-31' },
      })
      const allDay = event({
        id: 'e2',
        title: 'FAT exams',
        all_day: true,
        timezone: tz,
        start_at: zonedToInstant('2026-11-12', '00:00', tz).toISOString(),
        end_at: zonedToInstant('2026-11-29', '00:00', tz).toISOString(),
      })
      const exceptions: EventException[] = [
        { ...stamp, id: 'x1', event_id: 'e1', occurrence_start: zonedToInstant('2026-10-12', '09:00', tz).toISOString(), cancelled: true, override: {} },
        {
          ...stamp,
          id: 'x2',
          event_id: 'e1',
          occurrence_start: zonedToInstant('2026-10-14', '09:00', tz).toISOString(),
          cancelled: false,
          override: { title: 'OS lecture (moved)', start_at: zonedToInstant('2026-10-14', '14:00', tz).toISOString(), end_at: zonedToInstant('2026-10-14', '15:30', tz).toISOString() },
        },
      ]
      const from = new Date('2026-10-01T00:00:00Z')
      const to = new Date('2026-12-01T00:00:00Z') // spans the US DST change on 1 Nov
      const ics = buildFeed({ events: [weekly, allDay], exceptions, tasks: [], tz, now: new Date('2026-10-12T00:00:00Z') })

      const app = expandEvents([weekly, allDay], exceptions, from, to, tz).map((i) => [i.title, iso(i.start), iso(i.end)])
      const parsed = expandCalendar(parseCalendar(ics), 'g', from, to, tz).map((e) => [e.title, iso(e.start), iso(e.end)])
      expect(parsed.sort()).toEqual(app.sort())
      expect(parsed.find((p) => p[0] === 'OS lecture (moved)')).toBeTruthy()
    }
  })

  it('includes dated and repeating tasks as calendar entries', () => {
    const tz = 'Asia/Kolkata'
    const daily = task({ recurrence: { freq: 'daily', interval: 1, until: '2026-10-10' } }) // 19:00 IST
    const due = task({ id: 't2', title: 'Submit DBMS DA', scheduled_at: null, due_date: '2026-10-20', recurrence: null })
    const done = task({ id: 't3', title: 'Done already', status: 'done' })
    const ics = buildFeed({ events: [], exceptions: [], tasks: [daily, due, done], tz })
    const from = new Date('2026-10-01T00:00:00Z')
    const to = new Date('2026-10-31T00:00:00Z')
    const parsed = expandCalendar(parseCalendar(ics), 'g', from, to, tz)
    const dsa = parsed.filter((e) => e.title === 'Task: Striver A2Z: 5 problems')
    const app = expandTasks([daily], [], '2026-10-01', '2026-10-30', tz)
    expect(dsa.map((e) => iso(e.start))).toEqual(app.map((i) => i.scheduledAt))
    expect(dsa[0].end.getTime() - dsa[0].start.getTime()).toBe(90 * 60000)
    expect(parsed.find((e) => e.title === 'Task: Submit DBMS DA')).toMatchObject({ allDay: true, startKey: '2026-10-20', endKey: '2026-10-21' })
    expect(parsed.some((e) => e.title.includes('Done already'))).toBe(false)
  })

  it('escapes text and folds long lines', () => {
    expect(icsText('a,b;c\\d\ne')).toBe(String.raw`a\,b\;c\\d\ne`)
    const long = `SUMMARY:${'é'.repeat(60)}`
    const folded = fold(long)
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n ').join('')).toBe(long)
  })

  it('writes RRULEs the way calendar apps expect', () => {
    expect(rrule({ freq: 'weekly', interval: 2, byWeekday: [5, 1] }, 'Asia/Kolkata', '09:00')).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR')
    expect(rrule({ freq: 'daily', interval: 1, until: '2026-12-31' }, 'Asia/Kolkata', '09:00')).toBe('RRULE:FREQ=DAILY;UNTIL=20261231T033000Z')
    expect(rrule({ freq: 'monthly', interval: 1, byMonthDay: 15, count: 3 }, 'UTC', null)).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3')
    expect(rrule({ freq: 'yearly', interval: 1, until: '2030-01-01' }, 'UTC', null)).toBe('RRULE:FREQ=YEARLY;UNTIL=20300101')
  })
})

describe('importTarget', () => {
  it('accepts calendar providers only', () => {
    expect(importTarget('https://calendar.google.com/calendar/ical/abc%40gmail.com/private-123/basic.ics')?.hostname).toBe('calendar.google.com')
    expect(importTarget('webcal://p52-caldav.icloud.com/published/2/abc')?.protocol).toBe('https:')
    expect(importTarget('https://outlook.office365.com/owa/calendar/x/reachcalendar.ics')).not.toBeNull()
    expect(importTarget('http://calendar.google.com/x.ics')).toBeNull()
    expect(importTarget('https://evil.example.com/x.ics')).toBeNull()
    expect(importTarget('https://calendar.google.com.evil.example/x.ics')).toBeNull()
    expect(importTarget('https://user:pw@calendar.google.com/x.ics')).toBeNull()
    expect(importTarget('https://calendar.google.com:8443/x.ics')).toBeNull()
    expect(importTarget('not a url')).toBeNull()
  })
})
