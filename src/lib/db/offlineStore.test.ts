import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalStore } from './localStore'
import { OfflineStore, type SyncReport } from './offlineStore'
import { IdbOutbox } from './outbox'
import { StoreError, type DataStore } from './store'

const USER = '11111111-1111-4111-8111-111111111111'
let n = 0

/** A stand-in for Supabase: a separate store that can be switched off, or made to refuse calls. */
function fakeServer() {
  const db = new LocalStore(USER, `server-${++n}`)
  const ctl = { down: false, refuse: null as null | ((method: string, args: unknown[]) => StoreError | null) }
  const remote = new Proxy(db, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver)
      if (typeof v !== 'function') return v
      return async (...args: unknown[]) => {
        if (ctl.down) throw new StoreError('You appear to be offline.', 'offline')
        const err = ctl.refuse?.(String(prop), args)
        if (err) throw err
        return v.apply(target, args)
      }
    },
  }) as DataStore
  return { db, remote, ctl }
}

function setup() {
  const server = fakeServer()
  const net = { online: true }
  const outbox = new IdbOutbox(`outbox-${n}`)
  const mirror = new LocalStore(USER, `cache-${n}`)
  const refreshAuth = vi.fn(async () => true)
  const store = new OfflineStore(server.remote, {
    userId: async () => USER,
    online: () => net.online,
    outbox,
    mirror: () => mirror,
    refreshAuth,
  })
  const reports: SyncReport[] = []
  store.onSynced((r) => reports.push(r))
  const goOffline = () => {
    net.online = false
    server.ctl.down = true
  }
  const goOnline = () => {
    net.online = true
    server.ctl.down = false
    store.retryNow()
  }
  return { store, server, outbox, mirror, reports, goOffline, goOnline, refreshAuth }
}

describe('OfflineStore', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => {
    t = setup()
  })

  it('reads from the server online and from this device offline', async () => {
    await t.server.db.insert('tasks', { title: 'Revise OS' })
    expect((await t.store.list('tasks')).map((r) => r.title)).toEqual(['Revise OS'])
    t.goOffline()
    expect((await t.store.list('tasks')).map((r) => r.title)).toEqual(['Revise OS'])
    expect(t.store.getStatus().online).toBe(false)
  })

  it('also reads offline when the device thinks it is online but the server is unreachable', async () => {
    await t.server.db.insert('tasks', { title: 'Revise OS' })
    await t.store.list('tasks')
    t.server.ctl.down = true
    expect((await t.store.list('tasks')).map((r) => r.title)).toEqual(['Revise OS'])
  })

  it('stops waiting on a server that hangs, and skips it for a while after', async () => {
    const server = fakeServer()
    const mirror = new LocalStore(USER, `cache-hang-${n}`)
    const store = new OfflineStore(server.remote, {
      userId: async () => USER,
      online: () => true,
      outbox: new IdbOutbox(`outbox-hang-${n}`),
      mirror: () => mirror,
      refreshAuth: async () => true,
      timeoutMs: 50,
    })
    await mirror.putRaw('tasks', [await server.db.insert('tasks', { title: 'Cached' })])
    let calls = 0
    server.ctl.refuse = () => {
      calls++
      return null
    }
    const hang = new Promise<never>(() => undefined)
    const realList = server.db.list.bind(server.db)
    server.db.list = (() => hang) as typeof server.db.list
    expect((await store.list('tasks')).map((r) => r.title)).toEqual(['Cached'])
    expect(calls).toBe(1)
    server.db.list = realList
    await store.list('tasks')
    expect(calls).toBe(1) // answered from this device without trying the server
    store.retryNow()
    await store.list('tasks')
    expect(calls).toBe(2)
  })

  it('saves changes offline and uploads them in order once back online', async () => {
    t.goOffline()
    const task = await t.store.insert('tasks', { title: 'Gym' })
    await t.store.update('tasks', task.id, { title: 'Gym: legs' })
    const other = await t.store.insert('tasks', { title: 'Delete me' })
    await t.store.remove('tasks', other.id)
    expect((await t.store.list('tasks')).map((r) => r.title)).toEqual(['Gym: legs'])
    expect(t.store.getStatus().pending).toBe(4)
    expect(await t.server.db.list('tasks')).toEqual([])

    t.goOnline()
    expect(await t.store.flush()).toBe(true)
    const onServer = await t.server.db.list('tasks')
    expect(onServer.map((r) => [r.id, r.title])).toEqual([[task.id, 'Gym: legs']])
    expect(t.reports).toEqual([{ sent: 4, failed: [] }])
    expect(t.store.getStatus()).toMatchObject({ online: true, pending: 0, syncing: false })
  })

  it('keeps the same id for upserts made offline', async () => {
    const habit = await t.store.insert('habits', { name: 'Read NCERT', start_date: '2026-10-01' })
    t.goOffline()
    const c = await t.store.upsert('habit_checkins', { habit_id: habit.id, date: '2026-10-12', value: 1 }, ['habit_id', 'date'])
    await t.store.update('habit_checkins', c.id, { note: 'Ch. 3' })
    t.goOnline()
    await t.store.flush()
    expect((await t.server.db.list('habit_checkins')).map((r) => [r.id, r.note])).toEqual([[c.id, 'Ch. 3']])
  })

  it('drops a change the server refuses and carries on with the rest', async () => {
    const gone = await t.store.insert('tasks', { title: 'Deleted on laptop' })
    t.goOffline()
    await t.store.update('tasks', gone.id, { title: 'Edited on phone' })
    await t.store.insert('tasks', { title: 'New on phone' })
    await t.server.db.remove('tasks', gone.id)
    t.goOnline()
    // The fake server answers like Supabase does for a missing row.
    t.server.ctl.refuse = (m, a) => (m === 'update' && a[1] === gone.id ? new StoreError('That record no longer exists.', 'PGRST116') : null)
    expect(await t.store.flush()).toBe(true)
    expect((await t.server.db.list('tasks')).map((r) => r.title)).toEqual(['New on phone'])
    expect(t.reports[0]).toEqual({ sent: 1, failed: ['That record no longer exists.'] })
  })

  it('keeps changes queued if the connection drops mid-upload', async () => {
    t.goOffline()
    await t.store.insert('tasks', { title: 'One' })
    await t.store.insert('tasks', { title: 'Two' })
    t.goOnline()
    let calls = 0
    t.server.ctl.refuse = (m) => (m === 'insert' && ++calls === 2 ? new StoreError('You appear to be offline.', 'offline') : null)
    expect(await t.store.flush()).toBe(false)
    expect((await t.outbox.list(USER)).length).toBe(1)
    t.server.ctl.refuse = null
    expect(await t.store.flush()).toBe(false) // backing off after the drop
    t.store.retryNow()
    expect(await t.store.flush()).toBe(true)
    expect((await t.server.db.list('tasks')).map((r) => r.title).sort()).toEqual(['One', 'Two'])
  })

  it('refreshes an expired session and retries', async () => {
    t.goOffline()
    await t.store.insert('tasks', { title: 'After a long flight' })
    t.goOnline()
    let expired = true
    t.server.ctl.refuse = () => (expired ? new StoreError('Your session has expired.', 'PGRST301') : null)
    t.refreshAuth.mockImplementation(async () => {
      expired = false
      return true
    })
    expect(await t.store.flush()).toBe(true)
    expect(t.refreshAuth).toHaveBeenCalledTimes(1)
    expect((await t.server.db.list('tasks')).length).toBe(1)
  })

  it('counts an insert the server already has as sent', async () => {
    t.goOffline()
    const task = await t.store.insert('tasks', { title: 'Twice' })
    t.goOnline()
    await t.server.db.insert('tasks', { id: task.id, title: 'Twice' })
    t.server.ctl.refuse = (m) => (m === 'insert' ? new StoreError('An entry with the same details already exists.', '23505') : null)
    expect(await t.store.flush()).toBe(true)
    expect(t.reports[0]).toEqual({ sent: 1, failed: [] })
  })

  it('downloads everything for offline use, including deletions made elsewhere', async () => {
    const a = await t.server.db.insert('tasks', { title: 'A' })
    await t.store.list('tasks')
    await t.server.db.remove('tasks', a.id)
    await t.server.db.insert('goals', { title: 'FAT' })
    expect(await t.store.refreshMirror()).toBe(true)
    t.goOffline()
    expect(await t.store.list('tasks')).toEqual([])
    expect((await t.store.list('goals')).map((g) => g.title)).toEqual(['FAT'])
  })

  it('needs the internet to delete everything', async () => {
    t.goOffline()
    await expect(t.store.clearAll()).rejects.toThrow('Connect to the internet')
  })
})
