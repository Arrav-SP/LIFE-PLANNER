import { toast } from '@/components/ui/toast'

/**
 * The worker skips waiting (src/sw.ts), so a new deploy takes over as soon as
 * it has downloaded. Reload then, so the page runs the new code too. Not on the
 * very first install (there was no old version), and not while a dialog is open,
 * where a half-filled form would be lost: then offer the reload instead.
 */
export function reloadOnUpdate(sw: Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'>, reload: () => void) {
  let controlled = !!sw.controller
  let reloading = false
  sw.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true
      return
    }
    if (reloading) return
    if (document.querySelector('[role=dialog]')) {
      toast.info('A new version is ready.', { label: 'Reload', onClick: reload })
      return
    }
    reloading = true
    reload()
  })
}

/** Register the service worker in production builds and keep the app on the newest deploy. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  reloadOnUpdate(navigator.serviceWorker, () => location.reload())
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        onRegisteredSW(_url, registration) {
          if (!registration) return
          // An installed app brought back from the background never navigates, so the browser
          // wouldn't look for a new deploy by itself: check when it's shown again, and hourly.
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void registration.update().catch(() => undefined)
          })
          setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000)
        },
        onOfflineReady() {
          toast.success('Ready to work offline.')
        },
      })
    })
    .catch(() => undefined)
}
