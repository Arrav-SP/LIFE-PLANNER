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

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return true // the browser doesn't say; assume it matches
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

/**
 * This device's push subscription, created if needed, made with the current
 * VAPID key, and saved on the server so the push function can reach it.
 */
async function ensureSubscription(reg: ServiceWorkerRegistration, create: boolean): Promise<PushSubscription | null> {
  const key = urlBase64ToUint8Array(env.vapidPublicKey)
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with an older key is rejected by the push service: replace it.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await getStore()
      .removeWhere('push_subscriptions', [eq('endpoint', sub.endpoint)])
      .catch(() => undefined)
    await sub.unsubscribe()
    sub = null
    create = true
  }
  if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource })
  if (!sub) return null
  const store = getStore()
  const existing = await store.list('push_subscriptions', { filters: [eq('endpoint', sub.endpoint)] })
  if (!existing.length)
    await store.insert('push_subscriptions', { endpoint: sub.endpoint, p256dh: toB64(sub.getKey('p256dh')), auth: toB64(sub.getKey('auth')), user_agent: navigator.userAgent.slice(0, 300) })
  return sub
}

export async function subscribePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications are not allowed for this site.')
  await ensureSubscription(reg, true)
}

/**
 * Run on app start: if this device has push on, make sure the server still
 * knows about it (it forgets subscriptions the browser dropped) and that it
 * uses the current key.
 */
export async function refreshPushSubscription(): Promise<void> {
  if (!pushAvailable().ok || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.getRegistration()
  if (reg) await ensureSubscription(reg, false)
}

export async function unsubscribePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await getStore().removeWhere('push_subscriptions', [eq('endpoint', sub.endpoint)])
  await sub.unsubscribe()
}
