import { env } from './env'
import { getStore } from './db'
import { eq } from './db/store'

/** Web Push needs a VAPID key, a service worker and the Supabase backend. */
export function pushAvailable(): { ok: boolean; reason?: string } {
  if (env.mode !== 'supabase') return { ok: false, reason: 'Push needs the Supabase backend; local mode cannot send notifications to a closed app.' }
  if (!env.vapidPublicKey) return { ok: false, reason: 'Set VITE_VAPID_PUBLIC_KEY and deploy the send-due-reminders function (see the README).' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return { ok: false, reason: 'This browser does not support push. On iPhone, add the app to your Home Screen first (iOS 16.4+).' }
  return { ok: true }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** base64url without padding, the form Web Push libraries expect. */
const toB64 = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '')

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function subscribePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications are not allowed for this site.')
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey) as BufferSource }))
  const store = getStore()
  const existing = await store.list('push_subscriptions', { filters: [eq('endpoint', sub.endpoint)] })
  if (!existing.length)
    await store.insert('push_subscriptions', { endpoint: sub.endpoint, p256dh: toB64(sub.getKey('p256dh')), auth: toB64(sub.getKey('auth')), user_agent: navigator.userAgent.slice(0, 300) })
}

export async function unsubscribePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await getStore().removeWhere('push_subscriptions', [eq('endpoint', sub.endpoint)])
  await sub.unsubscribe()
}
