import { useEffect } from 'react'

/** Scrolls the element with this id into view once the page's data is ready (used by deep links). */
export function useScrollIntoView(elementId: string | null, ready: boolean) {
  useEffect(() => {
    if (!elementId || !ready) return
    const t = window.setTimeout(() => document.getElementById(elementId)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 50)
    return () => window.clearTimeout(t)
  }, [elementId, ready])
}
