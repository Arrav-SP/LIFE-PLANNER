import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseStore } from './supabaseStore'

/** A query builder serving `total` rows the way Supabase does: at most 1000 per request. */
function fakeClient(total: number) {
  const ranges: [number, number][] = []
  const builder = {
    select: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      ranges.push([from, to])
      const last = Math.min(to, from + 999, total - 1)
      return Promise.resolve({ data: Array.from({ length: Math.max(0, last - from + 1) }, (_, i) => ({ id: String(from + i) })), error: null })
    },
  }
  return { client: { from: () => builder } as unknown as SupabaseClient, ranges }
}

describe('SupabaseStore.list', () => {
  it('reads every page past the 1000-row cap', async () => {
    const { client, ranges } = fakeClient(2005)
    expect(await new SupabaseStore(client).list('habit_checkins')).toHaveLength(2005)
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('still honours a limit', async () => {
    const { client, ranges } = fakeClient(2005)
    expect(await new SupabaseStore(client).list('tasks', { limit: 30 })).toHaveLength(30)
    expect(ranges).toEqual([[0, 29]])
  })
})
