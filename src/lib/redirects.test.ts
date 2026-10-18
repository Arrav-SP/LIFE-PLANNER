import { describe, expect, it } from 'vitest'
import { redirectTarget } from './redirects'

describe('redirectTarget', () => {
  it('sends old page addresses where the page lives now, keeping the item', () => {
    expect(redirectTarget('/planner', '?date=2026-10-12&mode=week')).toBe('/calendar?view=week&date=2026-10-12')
    expect(redirectTarget('/planner', '')).toBe('/calendar?view=day')
    expect(redirectTarget('/projects', '?project=p1')).toBe('/goals?tab=projects&project=p1')
    expect(redirectTarget('/analytics', '')).toBe('/review?tab=trends')
  })
})
