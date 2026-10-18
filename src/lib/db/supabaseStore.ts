import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { StoreError, type DataStore, type Filter, type Insert, type ListQuery, type Patch } from './store'
import { primaryKey, TABLES, type Row, type TableName } from './types'

/** Supabase errors become plain-language messages. */
function fail(error: PostgrestError | null, fallback: string): never {
  if (!error) throw new StoreError(fallback)
  const code = error.code
  if (code === '23505') throw new StoreError('An entry with the same details already exists.', code)
  if (code === '23503') throw new StoreError('A linked record could not be found. It may have been deleted.', code)
  if (code === '23514') throw new StoreError('Some values are out of range. Check the form and try again.', code)
  if (code === 'PGRST204' || code === 'PGRST205')
    throw new StoreError('This needs a database update first. Run the newest file in supabase/migrations in the Supabase SQL Editor.', code)
  if (code === '42501') throw new StoreError('Your session has expired. Sign in again to continue.', code)
  if (code === 'PGRST301' || code === 'PGRST303') throw new StoreError('Your session has expired. Sign in again to continue.', code)
  // Network failures: Chrome says "Failed to fetch", Safari "Load failed"; timeouts abort the request.
  if (/fetch|network|load failed|timed? ?out|abort/i.test(error.message ?? '')) throw new StoreError('You appear to be offline.', 'offline')
  throw new StoreError(error.message || fallback, code)
}

// The generated query builder types are too strict for a generic table
// parameter, so the builder is typed loosely here and rows are typed at the
// DataStore boundary instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = any

const PAGE = 1000

function applyFilters(q: Builder, filters: Filter[] = []): Builder {
  for (const f of filters) {
    switch (f.op) {
      case 'eq':
        q = q.eq(f.field, f.value)
        break
      case 'neq':
        q = q.neq(f.field, f.value)
        break
      case 'gt':
        q = q.gt(f.field, f.value)
        break
      case 'gte':
        q = q.gte(f.field, f.value)
        break
      case 'lt':
        q = q.lt(f.field, f.value)
        break
      case 'lte':
        q = q.lte(f.field, f.value)
        break
      case 'in':
        q = q.in(f.field, f.value as unknown[])
        break
      case 'is':
        q = q.is(f.field, f.value)
        break
      case 'contains':
        q = q.contains(f.field, Array.isArray(f.value) ? f.value : [f.value])
        break
      case 'ilike':
        q = q.ilike(f.field, `%${String(f.value).replace(/[%_]/g, (m) => '\\' + m)}%`)
        break
    }
  }
  return q
}

/** Never send ownership or server-managed columns; the database sets them. */
function stripManaged(values: Record<string, unknown>, table: TableName) {
  const out = { ...values }
  delete out.created_at
  delete out.updated_at
  if (table !== 'user_settings') delete out.user_id
  else delete out.user_id
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

export class SupabaseStore implements DataStore {
  readonly kind = 'supabase' as const
  constructor(private client: SupabaseClient) {}

  /**
   * Supabase answers at most 1000 rows per request (its default "Max rows"),
   * so read page by page until a short page. The primary key is the last sort
   * key so pages never overlap or skip rows.
   * shortcut: assumes the project's Max rows is at least PAGE; a lower setting ends the read early.
   */
  async list<T extends TableName>(table: T, query: ListQuery = {}): Promise<Row<T>[]> {
    const order = [...(query.order ?? []), { field: primaryKey(table), ascending: true }]
    const rows: Row<T>[] = []
    let from = query.offset ?? 0
    const end = query.limit !== undefined ? from + query.limit : Infinity
    while (from < end) {
      const size = Math.min(PAGE, end - from)
      let q: Builder = applyFilters(this.client.from(table).select('*'), query.filters)
      for (const o of order) q = q.order(o.field, { ascending: o.ascending !== false, nullsFirst: false })
      const { data, error } = await q.range(from, from + size - 1)
      if (error) fail(error, 'Could not load data.')
      const page = (data ?? []) as Row<T>[]
      rows.push(...page)
      if (page.length < size) break
      from += size
    }
    return rows
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const { data, error } = await this.client.from(table).select('*').eq(primaryKey(table), id).maybeSingle()
    if (error) fail(error, 'Could not load the record.')
    return (data ?? null) as Row<T> | null
  }

  async insert<T extends TableName>(table: T, values: Insert<T>): Promise<Row<T>> {
    const { data, error } = await (this.client.from(table) as Builder)
      .insert(stripManaged(values as Record<string, unknown>, table))
      .select('*')
      .single()
    if (error) fail(error, 'Could not save.')
    return data as Row<T>
  }

  async insertMany<T extends TableName>(table: T, values: Insert<T>[]): Promise<Row<T>[]> {
    if (!values.length) return []
    const { data, error } = await (this.client.from(table) as Builder)
      .insert(values.map((v) => stripManaged(v as Record<string, unknown>, table)))
      .select('*')
    if (error) fail(error, 'Could not save.')
    return (data ?? []) as Row<T>[]
  }

  async update<T extends TableName>(table: T, id: string, patch: Patch<T>): Promise<Row<T>> {
    const body = stripManaged(patch as Record<string, unknown>, table)
    delete body.id
    const { data, error } = await (this.client.from(table) as Builder)
      .update(body)
      .eq(primaryKey(table), id)
      .select('*')
      .single()
    if (error) fail(error, 'Could not save changes.')
    return data as Row<T>
  }

  async upsert<T extends TableName>(table: T, values: Insert<T>, onConflict: (keyof Row<T> & string)[]): Promise<Row<T>> {
    // Unique constraints in the schema are scoped per row, so look the row up
    // first (RLS limits this to the user's own rows) and update or insert.
    let q: Builder = this.client.from(table).select('*')
    for (const c of onConflict) {
      const v = (values as Record<string, unknown>)[c]
      q = v === null ? q.is(c, null) : q.eq(c, v)
    }
    const { data, error } = await q.limit(1)
    if (error) fail(error, 'Could not save.')
    const existing = (data ?? [])[0] as Record<string, unknown> | undefined
    if (existing) return this.update(table, existing[primaryKey(table)] as string, values as Patch<T>)
    return this.insert(table, values)
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const { error } = await this.client.from(table).delete().eq(primaryKey(table), id)
    if (error) fail(error, 'Could not delete.')
  }

  async removeWhere<T extends TableName>(table: T, filters: Filter[]): Promise<void> {
    if (!filters.length) throw new StoreError('Refusing to delete without a filter.')
    const q = applyFilters(this.client.from(table).delete(), filters)
    const { error } = await q
    if (error) fail(error, 'Could not delete.')
  }

  async clearAll(): Promise<void> {
    // Delete leaf tables first; cascades handle most children.
    for (const t of [...TABLES].reverse()) {
      const { data: auth } = await this.client.auth.getUser()
      if (!auth.user) return
      const { error } = await this.client.from(t).delete().eq('user_id', auth.user.id)
      if (error) fail(error, 'Could not delete data.')
    }
  }

  async deleteAccount(): Promise<void> {
    const { error } = await this.client.rpc('delete_my_account')
    if (error) fail(error, 'Could not delete the account.')
    await this.client.auth.signOut()
  }
}
