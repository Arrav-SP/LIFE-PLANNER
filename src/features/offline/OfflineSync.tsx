import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, RefreshCw } from 'lucide-react'
import { getOfflineStore } from '@/lib/db'
import type { SyncStatus } from '@/lib/db/offlineStore'
import { useAuth } from '@/auth/AuthProvider'
import { toast } from '@/components/ui/toast'

const REFRESH_MS = 10 * 60 * 1000
const NONE: SyncStatus = { online: true, pending: 0, syncing: false }
const noop = () => () => undefined

/**
 * Keeps this device's copy of the data fresh and uploads changes made offline
 * as soon as the server can be reached. Renders nothing.
 */
export function OfflineSync() {
  const { user } = useAuth()
  const qc = useQueryClient()

  useEffect(() => {
    const store = getOfflineStore()
    if (!store || !user) return
    let alive = true
    const offSynced = store.onSynced((r) => {
      void qc.invalidateQueries()
      if (r.sent) toast.success(`Synced ${r.sent} ${r.sent === 1 ? 'change' : 'changes'} made offline.`)
      if (r.failed.length) toast.error(`${r.failed.length} offline ${r.failed.length === 1 ? 'change' : 'changes'} could not be saved: ${r.failed[0]}`)
    })
    const sync = async () => {
      if (!alive) return
      await store.refreshStatus()
      await store.refreshMirror().catch(() => undefined)
    }
    void sync()
    const onOnline = () => {
      store.retryNow()
      void sync()
    }
    const onOffline = () => void store.refreshStatus()
    const onVisible = () => document.visibilityState === 'visible' && void store.flush()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => document.visibilityState === 'visible' && void sync(), REFRESH_MS)
    return () => {
      alive = false
      offSynced()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [user, qc])

  return null
}

export function useSyncStatus(): SyncStatus {
  const store = getOfflineStore()
  return useSyncExternalStore(store?.subscribe ?? noop, store?.getStatus ?? (() => NONE))
}

/** A slim notice while offline or while offline changes are uploading. */
export function SyncBanner() {
  const { online, pending, syncing } = useSyncStatus()
  if (online && !pending) return null
  const changes = `${pending} ${pending === 1 ? 'change' : 'changes'}`
  return (
    <div role="status" className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg md:mx-8">
      {online ? <RefreshCw className={syncing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden /> : <CloudOff className="h-3.5 w-3.5" aria-hidden />}
      {!online
        ? pending
          ? `Offline. ${changes} saved on this device will upload when you're back online.`
          : "Offline. You can keep working; changes upload when you're back online."
        : syncing
          ? `Uploading ${changes} made offline…`
          : `${changes} waiting to upload.`}
    </div>
  )
}
