import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, BellRing, Clock, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { getStore, type Reminder } from '@/lib/db'
import { useList, useInvalidate } from '@/lib/db/hooks'
import { useSettings } from '@/settings/SettingsProvider'
import { useAuth } from '@/auth/AuthProvider'
import { formatTime, minutesOfDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { inQuietHours, showBrowserNotification } from './notify'
import { rollForward } from './sync'
import { localFireAt, reminderDueAt } from './plan'
import { env } from '@/lib/env'

const LOOKAHEAD_MS = 24 * 3600 * 1000
const REFRESH_MS = 10 * 60 * 1000

/**
 * In-app reminder engine. While the app is open it schedules a timer for the
 * next due reminder, shows it in-app and (if allowed) as a browser
 * notification. It cannot run when the browser is closed; that needs Web Push.
 */
export function useReminderEngine() {
  const { user } = useAuth()
  const { settings, tz } = useSettings()
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firing = useRef(new Set<string>())
  // Due reminders left to the push server, so we notice when it takes them.
  const waiting = useRef(new Set<string>())

  const check = useCallback(async () => {
    if (!user) return
    const store = getStore()
    const horizon = new Date(Date.now() + LOOKAHEAD_MS).toISOString()
    let pending: Reminder[] = []
    try {
      pending = (
        await store.list('reminders', {
          filters: [{ field: 'status', op: 'in', value: ['scheduled', 'snoozed'] }],
          order: [{ field: 'remind_at', ascending: true }],
          limit: 200,
        })
      ).filter((r) => (r.status === 'snoozed' ? r.snoozed_until && r.snoozed_until <= horizon : r.remind_at <= horizon))
    } catch {
      return
    }
    // With push set up, the server delivers to every device. An open tab that
    // fired first would mark the reminder done and the phone would get nothing.
    let serverPushes = false
    if (env.mode === 'supabase' && env.vapidPublicKey && settings.notifications.push !== false && pending.some((r) => !r.push_sent_at)) {
      try {
        serverPushes = (await store.list('push_subscriptions', { limit: 1 })).length > 0
      } catch {
        serverPushes = false
      }
    }
    const now = Date.now()
    const pendingIds = new Set(pending.map((r) => r.id))
    const takenByServer = [...waiting.current].some((id) => !pendingIds.has(id))
    waiting.current = new Set(pending.filter((r) => reminderDueAt(r) <= now && localFireAt(r, serverPushes) > now).map((r) => r.id))
    const fireAt = (r: Reminder) => localFireAt(r, serverPushes)
    const due = pending.filter((r) => fireAt(r) <= now)
    for (const r of due) {
      if (firing.current.has(r.id)) continue
      firing.current.add(r.id)
      // Ignore reminders that are long past (e.g. app closed for days): mark them missed quietly.
      const stale = now - reminderDueAt(r) > 6 * 3600 * 1000
      try {
        await store.update('reminders', r.id, { status: 'fired', fired_at: new Date().toISOString() })
      } catch {
        continue
      }
      const quiet = inQuietHours(settings, minutesOfDay(new Date(), tz))
      const prefs = settings.notifications
      let channel: 'in_app' | 'browser' = 'in_app'
      let status: 'delivered' | 'suppressed' = 'delivered'
      let detail = ''
      if (stale) {
        status = 'suppressed'
        detail = 'Missed while the app was closed'
      } else if (r.source_type === 'habit' && prefs.habit_reminders === false) {
        status = 'suppressed'
        detail = 'Habit reminders are turned off'
      } else if (quiet) {
        status = 'suppressed'
        detail = 'Quiet hours'
      } else if (prefs.browser !== false && !r.push_sent_at && document.visibilityState !== 'visible') {
        const ok = await showBrowserNotification(r.title, r.body, r.url, r.dedupe_key)
        if (ok) channel = 'browser'
      }
      try {
        await store.insert('notification_log', { reminder_id: r.id, channel, title: r.title, body: r.body, url: r.url, status, detail })
      } catch {
        /* log is best-effort */
      }
      await rollForward(r, tz).catch(() => undefined)
    }
    if (due.length || takenByServer) {
      invalidate('reminders')
      invalidate('notification_log')
      void qc.invalidateQueries({ queryKey: ['reminders'] })
    }
    const next = pending.map(fireAt).filter((t) => t > now).sort((a, b) => a - b)[0]
    if (timer.current) clearTimeout(timer.current)
    // Re-check soon while the server owes a push, so the bell updates when it lands.
    const wait = Math.min(next ? next - now + 250 : REFRESH_MS, waiting.current.size ? 30_000 : REFRESH_MS)
    timer.current = setTimeout(() => void check(), Math.max(1000, wait))
  }, [user, settings, tz, invalidate, qc])

  useEffect(() => {
    void check()
    const onVis = () => document.visibilityState === 'visible' && void check()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    const onChange = () => void check()
    window.addEventListener('lp:reminders-changed', onChange)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
      window.removeEventListener('lp:reminders-changed', onChange)
    }
  }, [check])
}

export async function snoozeReminder(r: Reminder, minutes: number) {
  // Clearing push_sent_at lets the push server send it again when the snooze ends.
  await getStore().update('reminders', r.id, { status: 'snoozed', snoozed_until: new Date(Date.now() + minutes * 60000).toISOString(), push_sent_at: null })
  window.dispatchEvent(new Event('lp:reminders-changed'))
}

export async function dismissReminder(r: Reminder) {
  await getStore().update('reminders', r.id, { status: 'dismissed' })
}

export function ReminderCenter({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const { tz, settings } = useSettings()
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const { data: fired = [] } = useList('reminders', { filters: [{ field: 'status', op: 'eq', value: 'fired' }], order: [{ field: 'fired_at', ascending: false }], limit: 30 })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const act = async (fn: () => Promise<void>) => {
    await fn()
    invalidate('reminders')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        aria-label={fired.length ? `${fired.length} reminders` : 'Reminders'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('relative grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg', !compact && 'border border-line bg-surface')}
      >
        {fired.length ? <BellRing className="h-[18px] w-[18px] text-accent" /> : <Bell className="h-[18px] w-[18px]" />}
        {fired.length > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{fired.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-slide-up rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold">Reminders</p>
            <Link to="/reminders" className="text-xs font-medium text-accent hover:underline" onClick={() => setOpen(false)}>
              Manage
            </Link>
          </div>
          {!fired.length ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nothing needs your attention.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {fired.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <button
                    className="block w-full text-left"
                    onClick={() => {
                      void act(() => dismissReminder(r))
                      setOpen(false)
                      navigate(r.url || '/')
                    }}
                  >
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted">
                      {r.body} · {formatTime(r.remind_at, tz, settings.time_format)}
                    </p>
                  </button>
                  <div className="mt-2 flex gap-1.5">
                    <button className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs" onClick={() => void act(() => snoozeReminder(r, 10))}>
                      <Clock className="h-3 w-3" /> 10 min
                    </button>
                    <button className="rounded-md bg-surface-2 px-2 py-1 text-xs" onClick={() => void act(() => snoozeReminder(r, 60))}>
                      1 hour
                    </button>
                    <button className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2" onClick={() => void act(() => dismissReminder(r))}>
                      <X className="h-3 w-3" /> Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
