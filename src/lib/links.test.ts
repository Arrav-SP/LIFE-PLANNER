import { describe, expect, it } from 'vitest'
import { convertedLink, linkTo } from './links'

describe('linkTo', () => {
  it('builds the deep links each page reads', () => {
    expect(linkTo.task('t1')).toBe('/tasks?view=all&task=t1')
    expect(linkTo.event('e1')).toBe('/calendar?event=e1')
    expect(linkTo.calendarDay('2026-10-12')).toBe('/calendar?date=2026-10-12')
    expect(linkTo.planner('2026-10-12')).toBe('/planner?date=2026-10-12&mode=day')
    expect(linkTo.planner('2026-10-12', 'week')).toBe('/planner?date=2026-10-12&mode=week')
    expect(linkTo.habit('h1')).toBe('/habits?habit=h1')
    expect(linkTo.subject('s1')).toBe('/study?subject=s1')
    expect(linkTo.note('n1')).toBe('/inbox?note=n1')
    expect(linkTo.week('2026-10-05')).toBe('/review?week=2026-10-05')
  })
})

describe('convertedLink', () => {
  it('points a converted note at what it became', () => {
    expect(convertedLink('task', 't1')).toBe('/tasks?view=all&task=t1')
    expect(convertedLink('event', 'e1')).toBe('/calendar?event=e1')
    expect(convertedLink('reminder', 'r1')).toBe('/reminders')
    expect(convertedLink('task', null)).toBeNull()
  })
})
