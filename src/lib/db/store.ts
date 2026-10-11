import type { Row, TableName } from './types'

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'contains' | 'ilike'

export interface Filter {
  field: string
  op: FilterOp
  value: unknown
}

export interface ListQuery {
  filters?: Filter[]
  order?: { field: string; ascending?: boolean }[]
  limit?: number
  offset?: number
}

/** Fields the store fills in itself; callers never send them. */
export type Managed = 'id' | 'user_id' | 'created_at' | 'updated_at'

export type Insert<T extends TableName> = Partial<Omit<Row<T>, 'user_id' | 'created_at' | 'updated_at'>>
export type Patch<T extends TableName> = Partial<Omit<Row<T>, Managed>>

/**
 * The single persistence boundary. The Supabase implementation is the source
 * of truth in production; the IndexedDB implementation powers local mode and
 * tests. Ownership is never taken from callers: the store assigns user_id.
 */
export interface DataStore {
  readonly kind: 'supabase' | 'local'
  list<T extends TableName>(table: T, query?: ListQuery): Promise<Row<T>[]>
  get<T extends TableName>(table: T, id: string): Promise<Row<T> | null>
  insert<T extends TableName>(table: T, values: Insert<T>): Promise<Row<T>>
  insertMany<T extends TableName>(table: T, values: Insert<T>[]): Promise<Row<T>[]>
  update<T extends TableName>(table: T, id: string, patch: Patch<T>): Promise<Row<T>>
  /** Insert or update by a unique set of columns (e.g. habit_id + date). */
  upsert<T extends TableName>(table: T, values: Insert<T>, onConflict: (keyof Row<T> & string)[]): Promise<Row<T>>
  remove<T extends TableName>(table: T, id: string): Promise<void>
  removeWhere<T extends TableName>(table: T, filters: Filter[]): Promise<void>
  /** Delete every row the current user owns (used by account deletion in local mode). */
  clearAll(): Promise<void>
  deleteAccount(): Promise<void>
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'StoreError'
  }
}

// ---------------------------------------------------------------------------
// In-memory query evaluation shared by the local store and tests.
// ---------------------------------------------------------------------------

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

export function matchesFilter(row: Record<string, unknown>, f: Filter): boolean {
  const v = row[f.field]
  switch (f.op) {
    case 'eq':
      return v === f.value
    case 'neq':
      return v !== f.value
    case 'gt':
      return v !== null && v !== undefined && compare(v, f.value) > 0
    case 'gte':
      return v !== null && v !== undefined && compare(v, f.value) >= 0
    case 'lt':
      return v !== null && v !== undefined && compare(v, f.value) < 0
    case 'lte':
      return v !== null && v !== undefined && compare(v, f.value) <= 0
    case 'in':
      return Array.isArray(f.value) && f.value.includes(v)
    case 'is':
      return f.value === null ? v === null || v === undefined : v === f.value
    case 'contains':
      if (Array.isArray(v)) {
        const needles = Array.isArray(f.value) ? f.value : [f.value]
        return needles.every((n) => v.includes(n))
      }
      return false
    case 'ilike': {
      const pattern = String(f.value).replace(/%/g, '').toLowerCase()
      return typeof v === 'string' && v.toLowerCase().includes(pattern)
    }
    default:
      return false
  }
}

export function applyQuery<R>(rows: R[], query: ListQuery = {}): R[] {
  let out = rows.filter((r) => (query.filters ?? []).every((f) => matchesFilter(r as Record<string, unknown>, f)))
  if (query.order?.length) {
    const order = query.order
    out = [...out].sort((a, b) => {
      for (const o of order) {
        const c = compare((a as Record<string, unknown>)[o.field], (b as Record<string, unknown>)[o.field])
        if (c !== 0) return o.ascending === false ? -c : c
      }
      return 0
    })
  }
  const offset = query.offset ?? 0
  if (offset || query.limit !== undefined) {
    out = out.slice(offset, query.limit !== undefined ? offset + query.limit : undefined)
  }
  return out
}

// Convenience builders so feature code reads naturally.
export const eq = (field: string, value: unknown): Filter => ({ field, op: 'eq', value })
export const neq = (field: string, value: unknown): Filter => ({ field, op: 'neq', value })
export const gte = (field: string, value: unknown): Filter => ({ field, op: 'gte', value })
export const gt = (field: string, value: unknown): Filter => ({ field, op: 'gt', value })
export const lte = (field: string, value: unknown): Filter => ({ field, op: 'lte', value })
export const lt = (field: string, value: unknown): Filter => ({ field, op: 'lt', value })
export const isNull = (field: string): Filter => ({ field, op: 'is', value: null })
export const inList = (field: string, value: unknown[]): Filter => ({ field, op: 'in', value })
export const ilike = (field: string, value: string): Filter => ({ field, op: 'ilike', value })
