import { describe, expect, it } from 'vitest'
import { describeRecurrence, nextOccurrence, occurrenceDates, timedOccurrences } from './recurrence'
import { timeOf } from './dates'

describe('occurrenceDates', () => {
  it('daily with interval', () => {
    expect(occurrenceDates({ freq: 'daily', interval: 2 }, '2026-10-01', '2026-10-01', '2026-10-07')).toEqual([
      '2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07',
    ])
  })
  it('weekdays only', () => {
    const d = occurrenceDates({ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }, '2026-10-12', '2026-10-10', '2026-10-19')
    expect(d).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19'])
  })
  it('every 2 weeks on Mon and Thu', () => {
    const d = occurrenceDates({ freq: 'weekly', interval: 2, byWeekday: [1, 4] }, '2026-10-12', '2026-10-12', '2026-11-01')
    expect(d).toEqual(['2026-10-12', '2026-10-15', '2026-10-26', '2026-10-29'])
  })
  it('monthly skips months without the day', () => {
    const d = occurrenceDates({ freq: 'monthly', interval: 1 }, '2026-01-31', '2026-01-01', '2026-05-31')
    expect(d).toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
  })
  it('respects until and count', () => {
    expect(occurrenceDates({ freq: 'daily', interval: 1, until: '2026-10-03' }, '2026-10-01', '2026-10-01', '2026-10-30')).toHaveLength(3)
    expect(occurrenceDates({ freq: 'daily', interval: 1, count: 4 }, '2026-10-01', '2026-10-03', '2026-10-30')).toEqual(['2026-10-03', '2026-10-04'])
  })
  it('never returns dates before the start', () => {
    expect(occurrenceDates({ freq: 'daily', interval: 1 }, '2026-10-05', '2026-10-01', '2026-10-06')).toEqual(['2026-10-05', '2026-10-06'])
  })
  it('nextOccurrence', () => {
    expect(nextOccurrence({ freq: 'weekly', interval: 1, byWeekday: [6] }, '2026-10-01', '2026-10-12')).toBe('2026-10-17')
    expect(nextOccurrence({ freq: 'daily', interval: 1, until: '2026-10-02' }, '2026-10-01', '2026-10-12')).toBeNull()
  })
})

describe('timedOccurrences', () => {
  it('keeps wall-clock time across a DST change', () => {
    // 9:00 New York, weekly; DST ends 2026-11-01.
    const occ = timedOccurrences(
      { freq: 'weekly', interval: 1 },
      '2026-10-26T13:00:00.000Z',
      '2026-10-26T14:00:00.000Z',
      'America/New_York',
      new Date('2026-10-25T00:00:00Z'),
      new Date('2026-11-10T00:00:00Z'),
    )
    expect(occ).toHaveLength(3)
    expect(occ.map((o) => timeOf(o.start, 'America/New_York'))).toEqual(['09:00', '09:00', '09:00'])
    expect(occ[1].start.toISOString()).toBe('2026-11-02T14:00:00.000Z')
  })
  it('handles a one-off item', () => {
    const occ = timedOccurrences(null, '2026-10-12T04:00:00Z', '2026-10-12T05:00:00Z', 'Asia/Kolkata', new Date('2026-10-12T00:00:00Z'), new Date('2026-10-13T00:00:00Z'))
    expect(occ).toHaveLength(1)
    expect(occ[0].date).toBe('2026-10-12')
  })
})

describe('describeRecurrence', () => {
  it('reads naturally', () => {
    expect(describeRecurrence(null)).toBe('Does not repeat')
    expect(describeRecurrence({ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] })).toBe('Every weekday')
    expect(describeRecurrence({ freq: 'daily', interval: 3, until: '2026-12-01' })).toBe('Every 3 days, until 2026-12-01')
  })
})
