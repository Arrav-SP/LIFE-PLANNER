import { describe, expect, it } from 'vitest'
import { rulerPos, rulerSpan } from './ruler'

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 19, h, m))
const start = at(7)
const end = at(22)

describe('day ruler', () => {
  it('places an item inside the day', () => {
    expect(rulerSpan(at(10), at(13), start, end)).toEqual({ left: 20, width: 20 })
  })

  it('clips an item that crosses the start or end of the day', () => {
    expect(rulerSpan(at(6), at(8, 30), start, end)).toEqual({ left: 0, width: 10 })
    expect(rulerSpan(at(21), at(23), start, end)).toEqual({ left: (14 / 15) * 100, width: 100 - (14 / 15) * 100 })
  })

  it('drops items outside the day or with no length', () => {
    expect(rulerSpan(at(5), at(6), start, end)).toBeNull()
    expect(rulerSpan(at(22, 30), at(23), start, end)).toBeNull()
    expect(rulerSpan(at(12), at(12), start, end)).toBeNull()
  })

  it('clamps the now needle to the day', () => {
    expect(rulerPos(at(4), start, end)).toBe(0)
    expect(rulerPos(at(23), start, end)).toBe(100)
    expect(rulerPos(at(12), start, start)).toBe(0)
  })
})
