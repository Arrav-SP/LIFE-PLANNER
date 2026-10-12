import { openDB, type IDBPDatabase } from 'idb'
import type { Filter, Insert, Patch } from './store'
import type { TableName } from './types'

/** A change made while offline, replayed against the server in order once back online. */
export type OutboxOp =
  | { kind: 'insert'; table: TableName; values: Insert<TableName> }
  | { kind: 'update'; table: TableName; id: string; patch: Patch<TableName> }
  | { kind: 'upsert'; table: TableName; values: Insert<TableName>; onConflict: string[] }
  | { kind: 'remove'; table: TableName; id: string }
  | { kind: 'removeWhere'; table: TableName; filters: Filter[] }

export type QueuedOp = OutboxOp & { seq: number; user_id: string; queued_at: string }

export interface Outbox {
  add(userId: string, op: OutboxOp): Promise<void>
  /** This user's queued changes, oldest first. */
  list(userId: string): Promise<QueuedOp[]>
  remove(seq: number): Promise<void>
  clear(userId: string): Promise<void>
}

const STORE = 'ops'

/** The outbox kept in IndexedDB so queued changes survive closing the app. */
export class IdbOutbox implements Outbox {
  private db: Promise<IDBPDatabase>

  constructor(name = 'life-planner-outbox') {
    this.db = openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true })
      },
    })
  }

  async add(userId: string, op: OutboxOp) {
    const db = await this.db
    await db.add(STORE, JSON.parse(JSON.stringify({ ...op, user_id: userId, queued_at: new Date().toISOString() })))
  }

  async list(userId: string) {
    const db = await this.db
    return ((await db.getAll(STORE)) as QueuedOp[]).filter((o) => o.user_id === userId).sort((a, b) => a.seq - b.seq)
  }

  async remove(seq: number) {
    const db = await this.db
    await db.delete(STORE, seq)
  }

  async clear(userId: string) {
    for (const o of await this.list(userId)) await this.remove(o.seq)
  }
}
