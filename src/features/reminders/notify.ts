import type { UserSettings } from '@/lib/db/types'

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied'

export function notificationPermission(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission as PermissionState
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!('Notification' in window)) return 'unsupported'
  try {
    return (await Notification.requestPermission()) as PermissionState
  } catch {
    return notificationPermission()
  }
}

/** Is `date` inside the user's quiet hours (which may wrap past midnight)? */
export function inQuietHours(settings: Pick<UserSettings, 'quiet_hours_start' | 'quiet_hours_end'>, minutesOfDay: number): boolean {
  const { quiet_hours_start: s, quiet_hours_end: e } = settings
  if (!s || !e) return false
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  const a = toMin(s)
  const b = toMin(e)
  if (a === b) return false
  return a < b ? minutesOfDay >= a && minutesOfDay < b : minutesOfDay >= a || minutesOfDay < b
}

/** Show a system notification through the service worker when possible (required on Android). */
export async function showBrowserNotification(title: string, body: string, url: string, tag: string): Promise<boolean> {
  if (notificationPermission() !== 'granted') return false
  const options: NotificationOptions = { body, tag, icon: '/pwa-192.png', badge: '/pwa-192.png', data: { url } }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, options)
      return true
    }
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      window.location.assign(url)
    }
    return true
  } catch {
    return false
  }
}
