import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { getStore } from './index'
import type { Insert, ListQuery, Patch } from './store'
import type { Row, TableName } from './types'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '../utils'

export const keys = {
  table: (t: TableName) => [t] as const,
  list: (t: TableName, q?: ListQuery) => [t, 'list', q ?? {}] as const,
  one: (t: TableName, id: string | null | undefined) => [t, 'one', id] as const,
}

export function useList<T extends TableName>(
  table: T,
  query?: ListQuery,
  opts?: Omit<UseQueryOptions<Row<T>[]>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Row<T>[]>({
    queryKey: keys.list(table, query),
    queryFn: () => getStore().list(table, query),
    ...opts,
  })
}

export function useRecord<T extends TableName>(table: T, id: string | null | undefined) {
  return useQuery<Row<T> | null>({
    queryKey: keys.one(table, id),
    queryFn: () => (id ? getStore().get(table, id) : Promise.resolve(null)),
    enabled: !!id,
  })
}

/** Tables whose cached queries go stale when the given table changes. */
const DEPENDENTS: Partial<Record<TableName, TableName[]>> = {
  tasks: ['task_occurrences', 'task_history', 'time_blocks', 'reminders'],
  events: ['event_exceptions', 'reminders'],
  habits: ['habit_checkins', 'reminders'],
  workouts: ['workout_sets'],
  goals: ['projects', 'milestones', 'goal_progress'],
  projects: ['milestones', 'tasks'],
  subjects: ['study_topics', 'study_sessions'],
}

export function useInvalidate() {
  const qc = useQueryClient()
  return (table: TableName) => {
    void qc.invalidateQueries({ queryKey: keys.table(table) })
    for (const d of DEPENDENTS[table] ?? []) void qc.invalidateQueries({ queryKey: keys.table(d) })
  }
}

interface MutOpts {
  /** Toast shown on success. Omit for silent saves. */
  success?: string
  silent?: boolean
}

export function useCreate<T extends TableName>(table: T, opts: MutOpts = {}) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (values: Insert<T>) => getStore().insert(table, values),
    onSuccess: () => {
      invalidate(table)
      if (opts.success) toast.success(opts.success)
    },
    onError: (e) => !opts.silent && toast.error(errorMessage(e)),
  })
}

export function useUpdate<T extends TableName>(table: T, opts: MutOpts = {}) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Patch<T> }) => getStore().update(table, id, patch),
    onSuccess: () => {
      invalidate(table)
      if (opts.success) toast.success(opts.success)
    },
    onError: (e) => !opts.silent && toast.error(errorMessage(e)),
  })
}

export function useRemove<T extends TableName>(table: T, opts: MutOpts = {}) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => getStore().remove(table, id),
    onSuccess: () => {
      invalidate(table)
      if (opts.success) toast.success(opts.success)
    },
    onError: (e) => !opts.silent && toast.error(errorMessage(e)),
  })
}

export function useUpsert<T extends TableName>(table: T, onConflict: (keyof Row<T> & string)[], opts: MutOpts = {}) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (values: Insert<T>) => getStore().upsert(table, values, onConflict),
    onSuccess: () => {
      invalidate(table)
      if (opts.success) toast.success(opts.success)
    },
    onError: (e) => !opts.silent && toast.error(errorMessage(e)),
  })
}
