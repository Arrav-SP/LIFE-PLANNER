import { dropMinute, hhmm, layoutLanes, parsePlanDrop, parsePlanMove, placeAll, suggestSlot } from './logic'

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 12, h, m))

describe('layoutLanes', () => {
  it('puts overlapping items side by side', () => {
    const r = layoutLanes([
      { key: 'a', start: at(9), end: at(10) },
      { key: 'b', start: at(9, 30), end: at(11) },
      { key: 'c', start: at(12), end: at(13) },
    ])
    const byKey = Object.fromEntries(r.map((x) => [x.key, x]))
    expect(byKey.a.lanes).toBe(2)
    expect(byKey.b.lane).toBe(1)
    expect(byKey.c.lanes).toBe(1)
  })
})

describe('suggestSlot', () => {
  it('finds the first gap that fits', () => {
    const free = [
      { start: at(9), end: at(9, 30) },
      { start: at(11), end: at(14) },
    ]
    expect(suggestSlot(free, 60, at(8))?.start.toISOString()).toBe(at(11).toISOString())
    expect(suggestSlot(free, 60, at(11, 5))?.start.toISOString()).toBe(at(11, 15).toISOString())
    expect(suggestSlot(free, 240, at(8))).toBeNull()
  })
})

describe('placeAll', () => {
  it('places items one after another and reports what does not fit', () => {
    const free = [
      { start: at(9), end: at(10) },
      { start: at(11), end: at(11, 30) },
    ]
    const { placed, unplaced } = placeAll(free, [{ id: 'a', minutes: 40 }, { id: 'b', minutes: 30 }, { id: 'c', minutes: 45 }], at(8))
    expect(placed.map((p) => [p.id, p.start.getTime(), p.end.getTime()])).toEqual([
      ['a', at(9).getTime(), at(9, 40).getTime()],
      ['b', at(11).getTime(), at(11, 30).getTime()],
    ])
    expect(unplaced.map((u) => u.id)).toEqual(['c'])
  })
})

describe('drag onto the timeline', () => {
  it('lands in the 15-minute row under the pointer, inside the day', () => {
    expect(dropMinute(0, 56, 15 * 60)).toBe(0)
    expect(dropMinute(56 * 2.4, 56, 15 * 60)).toBe(135) // 2h24m down -> 2:15 row
    expect(dropMinute(-20, 56, 15 * 60)).toBe(0)
    expect(dropMinute(56 * 99, 56, 15 * 60)).toBe(15 * 60 - 15)
  })

  it('accepts only well-formed items', () => {
    expect(parsePlanDrop(JSON.stringify({ title: ' Study: OS ', minutes: 60, color: '#7c3aed', task_id: '' }))).toEqual({
      title: 'Study: OS',
      minutes: 60,
      task_id: null,
      task_occurrence_date: null,
      category_id: null,
      color: '#7c3aed',
    })
    expect(parsePlanDrop('not json')).toBeNull()
    expect(parsePlanDrop(JSON.stringify({ title: 'x', minutes: 9999 }))).toBeNull()
    expect(parsePlanDrop(JSON.stringify({ title: 'x', minutes: 30, color: 'red;}' }))?.color).toBeNull()
  })
})

describe('moving timeline items', () => {
  it('reads a dragged block or task, and nothing else', () => {
    expect(parsePlanMove(JSON.stringify({ kind: 'block', id: 'b1' }))).toEqual({ kind: 'block', id: 'b1' })
    expect(parsePlanMove(JSON.stringify({ kind: 'event', id: 'e1' }))).toBeNull()
    expect(parsePlanMove(JSON.stringify({ kind: 'task', id: '' }))).toBeNull()
    expect(parsePlanMove('{')).toBeNull()
  })

  it('labels half-hour slots', () => {
    expect([420, 450, 1410].map(hhmm)).toEqual(['07:00', '07:30', '23:30'])
  })
})
