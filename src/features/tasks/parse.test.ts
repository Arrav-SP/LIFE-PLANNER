import { describe, expect, it } from 'vitest'
import { parseQuickEntry } from './parse'

// Sunday 11 Oct 2026, 10:00 in Kolkata.
const NOW = new Date('2026-10-11T04:30:00Z')
const TZ = 'Asia/Kolkata'

describe('parseQuickEntry', () => {
  it('parses the canonical example', () => {
    const r = parseQuickEntry('Study OS for 90 minutes tomorrow at 6 PM', TZ, NOW)
    expect(r.title).toBe('Study OS')
    expect(r.estimated_minutes).toBe(90)
    expect(r.due_date).toBe('2026-10-12')
    expect(r.time).toBe('18:00')
    expect(r.scheduled_at).toBe('2026-10-12T12:30:00.000Z')
  })
  it('handles tags, priority and hours', () => {
    const r = parseQuickEntry('Revise DBMS #fat #sql !high for 1.5h', TZ, NOW)
    expect(r.title).toBe('Revise DBMS')
    expect(r.tags).toEqual(['fat', 'sql'])
    expect(r.priority).toBe('high')
    expect(r.estimated_minutes).toBe(90)
    expect(r.due_date).toBeNull()
  })
  it('handles weekdays and explicit dates', () => {
    expect(parseQuickEntry('Gym on friday', TZ, NOW).due_date).toBe('2026-10-16')
    expect(parseQuickEntry('Submit form 14 nov', TZ, NOW).due_date).toBe('2026-11-14')
    expect(parseQuickEntry('Pay rent oct 5', TZ, NOW).due_date).toBe('2027-10-05')
    expect(parseQuickEntry('Call home in 3 days', TZ, NOW).due_date).toBe('2026-10-14')
  })
  it('reads "day after tomorrow" as two days out', () => {
    const r = parseQuickEntry('Submit lab record day after tomorrow', TZ, NOW)
    expect(r.title).toBe('Submit lab record')
    expect(r.due_date).toBe('2026-10-13')
  })
  it('handles recurrence', () => {
    const r = parseQuickEntry('Leetcode every weekday at 7am', TZ, NOW)
    expect(r.title).toBe('Leetcode')
    expect(r.recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] })
    expect(r.time).toBe('07:00')
  })
  it('a bare time that has passed rolls to tomorrow', () => {
    const r = parseQuickEntry('Read at 9am', TZ, NOW)
    expect(r.due_date).toBe('2026-10-12')
    const r2 = parseQuickEntry('Read at 9pm', TZ, NOW)
    expect(r2.due_date).toBe('2026-10-11')
  })
  it('keeps plain text untouched', () => {
    expect(parseQuickEntry('Buy milk', TZ, NOW)).toMatchObject({ title: 'Buy milk', due_date: null, priority: 'normal' })
  })
})
