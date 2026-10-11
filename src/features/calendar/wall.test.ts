import { fromWall, toWall } from './wall'

describe('wall clock conversion', () => {
  it('round-trips an instant through Kolkata wall time', () => {
    const t = new Date('2026-10-12T12:30:00.000Z')
    const wall = toWall(t, 'Asia/Kolkata')
    expect(wall).toBe('2026-10-12T18:00:00Z')
    expect(fromWall(new Date(wall), 'Asia/Kolkata').toISOString()).toBe(t.toISOString())
  })
  it('handles a DST zone', () => {
    const t = new Date('2026-11-01T14:00:00.000Z') // 09:00 in New York after DST ends
    expect(toWall(t, 'America/New_York')).toBe('2026-11-01T09:00:00Z')
    expect(fromWall(new Date('2026-11-01T09:00:00Z'), 'America/New_York').toISOString()).toBe(t.toISOString())
  })
})
