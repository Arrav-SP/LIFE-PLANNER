import { useMemo } from 'react'
import { useList } from './db/hooks'
import { isNull } from './db/store'

/** Shared lookups for pickers and labels. */
export function useLookups() {
  const categories = useList('categories', { order: [{ field: 'sort_order' }, { field: 'name' }] })
  const projects = useList('projects', { filters: [isNull('archived_at')], order: [{ field: 'name' }] })
  const goals = useList('goals', { filters: [isNull('archived_at')], order: [{ field: 'title' }] })
  return useMemo(
    () => ({
      categories: categories.data ?? [],
      projects: projects.data ?? [],
      goals: goals.data ?? [],
      category: (id: string | null) => (categories.data ?? []).find((c) => c.id === id) ?? null,
      project: (id: string | null) => (projects.data ?? []).find((p) => p.id === id) ?? null,
      goal: (id: string | null) => (goals.data ?? []).find((g) => g.id === id) ?? null,
    }),
    [categories.data, projects.data, goals.data],
  )
}
