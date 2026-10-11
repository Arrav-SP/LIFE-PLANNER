import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getStore } from '@/lib/db'
import type { UserSettings } from '@/lib/db/types'
import { browserTimeZone, todayKey } from '@/lib/dates'
import { useAuth } from '@/auth/AuthProvider'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/lib/utils'

export function defaultSettings(userId: string): UserSettings {
  const now = new Date().toISOString()
  return {
    user_id: userId,
    display_name: '',
    timezone: browserTimeZone(),
    date_format: 'd MMM yyyy',
    time_format: 'HH:mm',
    week_start: 1,
    theme: 'system',
    default_task_minutes: 30,
    day_start_hour: 7,
    day_end_hour: 22,
    quiet_hours_start: null,
    quiet_hours_end: null,
    notifications: { in_app: true, browser: false, push: false, task_default_offsets: [10], event_default_offsets: [10], habit_reminders: true },
    dashboard: {},
    onboarded_at: null,
    created_at: now,
    updated_at: now,
  }
}

interface SettingsCtx {
  settings: UserSettings
  loaded: boolean
  tz: string
  today: string
  update(patch: Partial<UserSettings>): Promise<void>
}

const Ctx = createContext<SettingsCtx | null>(null)
const THEME_KEY = 'lp-theme'

export function applyTheme(theme: UserSettings['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', !!dark)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* storage unavailable */
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const userId = user?.id ?? ''
  const q = useQuery({
    queryKey: ['user_settings', 'one', userId],
    enabled: !!userId,
    queryFn: async () => {
      const store = getStore()
      const row = await store.get('user_settings', userId)
      if (row) return { ...defaultSettings(userId), ...row, notifications: { ...defaultSettings(userId).notifications, ...row.notifications } }
      const d = defaultSettings(userId)
      const { user_id: _u, created_at: _c, updated_at: _up, ...rest } = d
      void _u
      void _c
      void _up
      return store.upsert('user_settings', { ...rest, user_id: userId } as never, ['user_id'] as never)
    },
  })

  const settings = q.data ?? defaultSettings(userId)

  useEffect(() => {
    applyTheme(settings.theme)
    if (settings.theme !== 'system') return
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const fn = () => applyTheme('system')
    mq?.addEventListener?.('change', fn)
    return () => mq?.removeEventListener?.('change', fn)
  }, [settings.theme])

  const update = useCallback(
    async (patch: Partial<UserSettings>) => {
      const key = ['user_settings', 'one', userId]
      const prev = qc.getQueryData<UserSettings>(key)
      qc.setQueryData(key, { ...(prev ?? defaultSettings(userId)), ...patch })
      try {
        const saved = await getStore().update('user_settings', userId, patch as never)
        qc.setQueryData(key, saved)
      } catch (e) {
        qc.setQueryData(key, prev)
        toast.error(errorMessage(e))
      }
    },
    [qc, userId],
  )

  const tz = settings.timezone || browserTimeZone()
  const today = todayKey(tz)
  // Recompute "today" each minute so the app rolls over at midnight.
  const tick = useMinuteTick()
  const value = useMemo(() => ({ settings, loaded: q.isSuccess, tz, today, update }), [settings, q.isSuccess, tz, today, update, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMinuteTick() {
  const [t, setT] = useState(() => Math.floor(Date.now() / 60000))
  useEffect(() => {
    const id = setInterval(() => setT(Math.floor(Date.now() / 60000)), 15000)
    return () => clearInterval(id)
  }, [])
  return t
}

export function useSettings(): SettingsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettings outside SettingsProvider')
  return v
}
