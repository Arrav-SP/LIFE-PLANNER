import { useList } from '@/lib/db/hooks'
import { gte } from '@/lib/db/store'
import { addDays } from '@/lib/dates'
import { useSettings } from '@/settings/SettingsProvider'

/**
 * Tasks plus the recent occurrence records needed to expand recurring tasks.
 * Occurrences are limited to a rolling window to keep queries small.
 */
export function useTaskData(includeArchived = false) {
  const { today } = useSettings()
  const tasks = useList('tasks', { order: [{ field: 'sort_order' }, { field: 'created_at' }] })
  const occurrences = useList('task_occurrences', { filters: [gte('occurrence_date', addDays(today, -400))] })
  const all = tasks.data ?? []
  return {
    tasks: includeArchived ? all : all.filter((t) => !t.archived_at),
    archived: all.filter((t) => !!t.archived_at),
    occurrences: occurrences.data ?? [],
    isLoading: tasks.isLoading || occurrences.isLoading,
    error: tasks.error ?? occurrences.error,
  }
}
