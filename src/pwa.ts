import { toast } from '@/components/ui/toast'

/** Register the service worker in production builds and offer updates without forcing a reload. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const update = registerSW({
        onNeedRefresh() {
          toast.info('A new version is ready.', { label: 'Reload', onClick: () => void update(true) })
        },
        onOfflineReady() {
          toast.success('Ready to work offline for viewing.')
        },
      })
    })
    .catch(() => undefined)
}
