import { describe, expect, it } from 'vitest'
import { expandEvents, findConflicts, freeSlots } from './logic'
import type { CalendarEvent, EventException } from '@/lib/db/types'

function ev(p: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1', user_id: 'u', created_at: '', updated_at: '', title: 'Lecture', description: '', all_day: false,
    start_at: '2026-10-12T04:00:00.000Z', end_at: '2026-10-12T05:00:00.000Z', timezone: 'Asia/Kolkata', location: '', meeting_url: '',
    notes: '', category_id: null, color: null, project_id: null, goal_id: null, tags: [], recurrence: null, reminder_offsets: [], archived_at: null, ...p,
  }
}
const ex = (p: Partial<EventException>): EventException => ({ id: 'x', user_id: 'u', created_at: '', updated_at: '', event_id: 'e1', occurrence_start: '', cancelled: false, override: {}, ...p })
const R0 = new Date('2026-10-12T00:00:00Z')
const R1 = new Date('2026-10-19T00:00:00Z')

describe('expandEvents', () => {
  it('expands a weekday series', () => {
    const list = expandEvents([ev({ recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] } })], [], R0, R1, 'Asia/Kolkata')
    expect(list).toHaveLength(5)
  })
  it('applies cancel and edit-one-occurrence exceptions', () => {
    const series = ev({ recurrence: { freq: 'daily', interval: 1 } })
    const list = expandEvents(
      [series],
      [
        ex({ occurrence_start: '2026-10-13T04:00:00.000Z', cancelled: true }),
        ex({ id: 'y', occurrence_start: '2026-10-14T04:00:00.000Z', override: { title: 'Moved lecture', start_at: '2026-10-14T08:00:00.000Z', end_at: '2026-10-14T09:00:00.000Z' } }),
      ],
      R0,
      R1,
      'Asia/Kolkata',
    )
    expect(list).toHaveLength(6)
    const moved = list.find((i) => i.title === 'Moved lecture')!
    expect(moved.start.toISOString()).toBe('2026-10-14T08:00:00.000Z')
    expect(moved.originalStart).toBe('2026-10-14T04:00:00.000Z')
    expect(list.some((i) => i.originalStart === '2026-10-13T04:00:00.000Z')).toBe(false)
  })
})

describe('conflicts and free time', () => {
  const s = (key: string, a: string, b: string) => ({ key, start: new Date(a), end: new Date(b) })
  it('detects overlaps but not touching items', () => {
    const c = findConflicts([s('a', '2026-10-12T09:00Z', '2026-10-12T10:00Z'), s('b', '2026-10-12T09:30Z', '2026-10-12T11:00Z'), s('c', '2026-10-12T11:00Z', '2026-10-12T12:00Z')])
    expect(c).toEqual([{ a: 'a', b: 'b' }])
  })
  it('finds gaps', () => {
    const f = freeSlots([s('a', '2026-10-12T09:00Z', '2026-10-12T10:00Z')], new Date('2026-10-12T08:00Z'), new Date('2026-10-12T12:00Z'))
    expect(f.map((x) => [x.start.toISOString().slice(11, 16), x.end.toISOString().slice(11, 16)])).toEqual([
      ['08:00', '09:00'],
      ['10:00', '12:00'],
    ])
  })
})
