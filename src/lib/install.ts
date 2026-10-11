import { useSyncExternalStore } from 'react'

/** The non-standard event Chromium browsers fire when the app can be installed. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallState {
  /** Running as an installed app (home screen / dock), so there is nothing to offer. */
  installed: boolean
  /** The browser handed us an install prompt we can show on click. */
  canPrompt: boolean
  /** iPhone or iPad, where installing is a manual Share → Add to Home Screen. */
  ios: boolean
}

let deferred: BeforeInstallPromptEvent | null = null
let justInstalled = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS reports itself as a Mac, so also check for touch.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

let snapshot: InstallState = { installed: false, canPrompt: false, ios: false }
function refresh() {
  const next = { installed: justInstalled || isStandalone(), canPrompt: !!deferred, ios: isIOS() }
  if (next.installed !== snapshot.installed || next.canPrompt !== snapshot.canPrompt || next.ios !== snapshot.ios) {
    snapshot = next
    emit()
  }
}

/** Call once at startup: the browser fires the prompt event early, often before React renders. */
export function listenForInstall() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // keep the browser's own mini-banner away; we show our own button
    deferred = e as BeforeInstallPromptEvent
    refresh()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    justInstalled = true
    refresh()
  })
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', refresh)
  refresh()
}

/** Shows the browser's install dialog. Resolves true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  deferred = null // a prompt can only be used once
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') justInstalled = true
  refresh()
  return outcome === 'accepted'
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
    () => snapshot,
  )
}
