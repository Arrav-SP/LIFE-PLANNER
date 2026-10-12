import { StoreError, type DataStore, type Filter, type Insert, type ListQuery, type Patch } from './store'
import type { LocalStore } from './localStore'
import type { Outbox, QueuedOp } from './outbox'
import { primaryKey, TABLES, type Row, type TableName } from './types'

export interface OfflineDeps {
  /** The signed-in user, also when the session can only be read from this device (offline). */
  userId(): Promise<string | null>
  online(): boolean
  outbox: Outbox
  /** This user's copy of their data on this device. */
  mirror(userId: string): LocalStore
  /** Try to get a fresh access token. False when that isn't possible right now. */
  refreshAuth(): Promise<boolean>
  /** How long to wait for the server before using this device's copy. Default 10 s. */
  timeoutMs?: number
}

export interface SyncStatus {
  online: boolean
  /** Changes saved on this device that the server hasn't got yet. */
  pending: number
  syncing: boolean
}

export interface SyncReport {
  sent: number
  /** Plain-language reasons for changes the server refused; those changes were dropped. */
  failed: string[]
}

const PAGE = 1000
/** After the server couldn't be reached, use this device's copy straight away for this long. */
const BACKOFF_MS = 30_000

function withTimeout<R>(p: Promise<R>, ms: number): Promise<R> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new StoreError('The server took too long to answer.', 'offline')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

export function isOfflineError(e: unknown): boolean {
  if (e instanceof StoreError) return e.code === 'offline'
  return e instanceof TypeError && /fetch|network|load failed/i.test(e.message)
}

function isAuthError(e: unknown): boolean {
  return e instanceof StoreError && ['PGRST301', 'PGRST303', '42501'].includes(e.code ?? '')
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error'
}

/**
 * Wraps the Supabase store so the app keeps working without internet.
 * Online, reads and writes go to the server and a copy is kept on this device.
 * Offline, reads come from that copy and writes are saved to it and queued;
 * the queue is replayed in order once the server can be reached again.
 */
export class OfflineStore implements DataStore {
  readonly kind = 'supabase' as const
  private flushing: Promise<boolean> | null = null
  private unreachableUntil = 0
  private status: SyncStatus = { online: true, pending: 0, syncing: false }
  private listeners = new Set<() => void>()
  private reportListeners = new Set<(r: SyncReport) => void>()

  constructor(
    private remote: DataStore,
    private deps: OfflineDeps,
  ) {
    this.status.online = deps.online()
  }

  /** Every server call, cut short if the connection hangs. Changes are safe to resend, so a late success is harmless. */
  private srv<R>(fn: (remote: DataStore) => Promise<R>): Promise<R> {
    return withTimeout(fn(this.remote), this.deps.timeoutMs ?? 10_000)
  }

  /** Something else found the server unreachable (e.g. sign-in couldn't refresh): use this device's copy for now. */
  markUnreachable() {
    this.wentOffline()
  }

  /** The device says it's back online: try the server again right away. */
  retryNow() {
    this.unreachableUntil = 0
  }

  private reachable() {
    return this.deps.online() && Date.now() >= this.unreachableUntil
  }

  // ---- status for the UI -------------------------------------------------

  getStatus = (): SyncStatus => this.status

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  /** Called after queued changes reach the server (or are refused). */
  onSynced(fn: (r: SyncReport) => void) {
    this.reportListeners.add(fn)
    return () => void this.reportListeners.delete(fn)
  }

  private setStatus(patch: Partial<SyncStatus>) {
    const next = { ...this.status, ...patch }
    if (next.online === this.status.online && next.pending === this.status.pending && next.syncing === this.status.syncing) return
    this.status = next
    for (const fn of this.listeners) fn()
  }

  async refreshStatus() {
    const uid = await this.deps.userId()
    this.setStatus({ online: this.deps.online(), pending: uid ? (await this.deps.outbox.list(uid)).length : 0 })
  }

  // ---- sync ---------------------------------------------------------------

  /** Send queued changes. Resolves true when nothing is left in the queue. */
  flush(): Promise<boolean> {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = null
      })
    }
    return this.flushing
  }

  private async doFlush(): Promise<boolean> {
    const uid = await this.deps.userId()
    if (!uid) return true
    let ops = await this.deps.outbox.list(uid)
    if (!ops.length) {
      this.setStatus({ pending: 0, online: this.deps.online() })
      return true
    }
    if (!this.reachable()) {
      this.setStatus({ online: false, pending: ops.length })
      return false
    }
    this.setStatus({ syncing: true, pending: ops.length })
    const report: SyncReport = { sent: 0, failed: [] }
    let refreshed = false
    let done = true
    let unreachable = false
    try {
      while (ops.length) {
        const op = ops[0]
        try {
          await this.apply(op)
          report.sent++
        } catch (e) {
          if (isOfflineError(e)) {
            done = false
            unreachable = true
            this.unreachableUntil = Date.now() + BACKOFF_MS
            break
          }
          if (isAuthError(e) && !refreshed) {
            refreshed = true
            if (await this.deps.refreshAuth()) continue // retry this change with the new token
            done = false
            break
          }
          // The server refused it (a duplicate, or the record was deleted elsewhere). Drop it so the rest can go.
          report.failed.push(message(e))
        }
        await this.deps.outbox.remove(op.seq)
        ops = ops.slice(1)
        this.setStatus({ pending: ops.length })
      }
    } finally {
      this.setStatus({ syncing: false, online: this.reachable() && !unreachable, pending: ops.length })
      if (report.sent || report.failed.length) for (const fn of this.reportListeners) fn(report)
    }
    return done
  }

  private async apply(op: QueuedOp) {
    const t = op.table
    switch (op.kind) {
      case 'insert':
        try {
          await this.srv((r) => r.insert(t, op.values))
        } catch (e) {
          // Already there: an earlier attempt got through before the connection dropped.
          const id = (op.values as { id?: string }).id
          if (e instanceof StoreError && e.code === '23505' && id && (await this.srv((r) => r.get(t, id)))) return
          throw e
        }
        return
      case 'update':
        await this.srv((r) => r.update(t, op.id, op.patch))
        return
      case 'upsert':
        await this.srv((r) => r.upsert(t, op.values, op.onConflict as never))
        return
      case 'remove':
        await this.srv((r) => r.remove(t, op.id))
        return
      case 'removeWhere':
        await this.srv((r) => r.removeWhere(t, op.filters))
        return
    }
  }

  /** Download all of this user's data so it can be read offline. Skipped while changes are still queued. */
  async refreshMirror(): Promise<boolean> {
    const uid = await this.deps.userId()
    if (!uid || !this.reachable()) return false
    if (!(await this.flush())) return false
    const mirror = this.deps.mirror(uid)
    try {
      for (const table of TABLES) {
        const rows: Row<TableName>[] = []
        for (let offset = 0; ; offset += PAGE) {
          const page = await this.srv((r) => r.list(table, { order: [{ field: primaryKey(table) }], limit: PAGE, offset }))
          rows.push(...page)
          if (page.length < PAGE) break
        }
        // A change queued meanwhile would be hidden by the snapshot; wait for the next refresh.
        if ((await this.deps.outbox.list(uid)).length) return false
        await mirror.replaceTable(table, rows)
      }
      return true
    } catch (e) {
      if (!isOfflineError(e)) throw e
      this.wentOffline()
      return false
    }
  }

  // ---- DataStore ----------------------------------------------------------

  private async session() {
    const uid = await this.deps.userId()
    return uid ? { uid, mirror: this.deps.mirror(uid) } : null
  }

  /** Online with nothing queued: the server can be used directly. */
  private async serverReady(): Promise<boolean> {
    if (!this.reachable()) {
      this.setStatus({ online: false })
      return false
    }
    return this.flush()
  }

  private wentOffline() {
    this.unreachableUntil = Date.now() + BACKOFF_MS
    this.setStatus({ online: false })
  }

  private async read<R>(fromServer: () => Promise<R>, keep: (r: R) => Promise<void>, fromDevice: () => Promise<R>): Promise<R> {
    if (await this.serverReady()) {
      try {
        const r = await this.srv(fromServer)
        await keep(r).catch(() => undefined)
        return r
      } catch (e) {
        if (!isOfflineError(e)) throw e
        this.wentOffline()
      }
    }
    return fromDevice()
  }

  private async write<R>(toServer: () => Promise<R>, keep: (r: R) => Promise<void>, offline: () => Promise<R>): Promise<R> {
    if (await this.serverReady()) {
      try {
        const r = await this.srv(toServer)
        await keep(r).catch(() => undefined)
        return r
      } catch (e) {
        if (!isOfflineError(e)) throw e
        this.wentOffline()
      }
    }
    const r = await offline()
    await this.refreshStatus()
    return r
  }

  async list<T extends TableName>(table: T, query?: ListQuery): Promise<Row<T>[]> {
    const s = await this.session()
    if (!s) return this.remote.list(table, query)
    return this.read(
      () => this.remote.list(table, query),
      (rows) => s.mirror.putRaw(table, rows),
      () => s.mirror.list(table, query),
    )
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const s = await this.session()
    if (!s) return this.remote.get(table, id)
    return this.read(
      () => this.remote.get(table, id),
      (row) => (row ? s.mirror.putRaw(table, [row]) : s.mirror.deleteRaw(table, id)),
      () => s.mirror.get(table, id),
    )
  }

  async insert<T extends TableName>(table: T, values: Insert<T>): Promise<Row<T>> {
    const s = await this.session()
    if (!s) return this.remote.insert(table, values)
    return this.write(
      () => this.remote.insert(table, values),
      (row) => s.mirror.putRaw(table, [row]),
      async () => {
        const row = await s.mirror.insert(table, values)
        const values2 = primaryKey(table) === 'id' ? { ...values, id: (row as { id: string }).id } : values
        await this.deps.outbox.add(s.uid, { kind: 'insert', table, values: values2 as Insert<TableName> })
        return row
      },
    )
  }

  async insertMany<T extends TableName>(table: T, values: Insert<T>[]): Promise<Row<T>[]> {
    const s = await this.session()
    if (!s || !values.length) return this.remote.insertMany(table, values)
    return this.write(
      () => this.remote.insertMany(table, values),
      (rows) => s.mirror.putRaw(table, rows),
      async () => {
        const out: Row<T>[] = []
        for (const v of values) {
          const row = await s.mirror.insert(table, v)
          const v2 = primaryKey(table) === 'id' ? { ...v, id: (row as { id: string }).id } : v
          await this.deps.outbox.add(s.uid, { kind: 'insert', table, values: v2 as Insert<TableName> })
          out.push(row)
        }
        return out
      },
    )
  }

  async update<T extends TableName>(table: T, id: string, patch: Patch<T>): Promise<Row<T>> {
    const s = await this.session()
    if (!s) return this.remote.update(table, id, patch)
    return this.write(
      () => this.remote.update(table, id, patch),
      (row) => s.mirror.putRaw(table, [row]),
      async () => {
        const row = await s.mirror.update(table, id, patch)
        await this.deps.outbox.add(s.uid, { kind: 'update', table, id, patch: patch as Patch<TableName> })
        return row
      },
    )
  }

  async upsert<T extends TableName>(table: T, values: Insert<T>, onConflict: (keyof Row<T> & string)[]): Promise<Row<T>> {
    const s = await this.session()
    if (!s) return this.remote.upsert(table, values, onConflict)
    return this.write(
      () => this.remote.upsert(table, values, onConflict),
      (row) => s.mirror.putRaw(table, [row]),
      async () => {
        const row = await s.mirror.upsert(table, values, onConflict)
        // Keep this device's id so later queued changes to the same row line up.
        const values2 = primaryKey(table) === 'id' ? { ...values, id: (row as { id: string }).id } : values
        await this.deps.outbox.add(s.uid, { kind: 'upsert', table, values: values2 as Insert<TableName>, onConflict })
        return row
      },
    )
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const s = await this.session()
    if (!s) return this.remote.remove(table, id)
    return this.write(
      () => this.remote.remove(table, id),
      () => s.mirror.remove(table, id),
      async () => {
        await s.mirror.remove(table, id)
        await this.deps.outbox.add(s.uid, { kind: 'remove', table, id })
      },
    )
  }

  async removeWhere<T extends TableName>(table: T, filters: Filter[]): Promise<void> {
    const s = await this.session()
    if (!s) return this.remote.removeWhere(table, filters)
    if (!filters.length) throw new StoreError('Refusing to delete without a filter.')
    return this.write(
      () => this.remote.removeWhere(table, filters),
      () => s.mirror.removeWhere(table, filters),
      async () => {
        await s.mirror.removeWhere(table, filters)
        await this.deps.outbox.add(s.uid, { kind: 'removeWhere', table, filters })
      },
    )
  }

  async clearAll(): Promise<void> {
    const s = await this.session()
    if (s && !(await this.serverReady())) throw new StoreError('Connect to the internet to delete your data.', 'offline')
    await this.remote.clearAll()
    if (s) {
      await s.mirror.clearAll()
      await this.deps.outbox.clear(s.uid)
    }
  }

  async deleteAccount(): Promise<void> {
    const s = await this.session()
    if (s && !this.deps.online()) throw new StoreError('Connect to the internet to delete your account.', 'offline')
    await this.remote.deleteAccount()
    if (s) {
      await s.mirror.clearAll()
      await this.deps.outbox.clear(s.uid)
    }
    await this.refreshStatus()
  }

  /** Forget this device's copy (on sign-out), unless it still holds changes the server hasn't got. */
  async forgetDevice(userId: string): Promise<boolean> {
    if ((await this.deps.outbox.list(userId)).length) return false
    await this.deps.mirror(userId).clearAll()
    return true
  }
}
