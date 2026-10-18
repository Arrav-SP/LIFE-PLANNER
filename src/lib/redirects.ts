// Pages that were merged keep their old addresses working: push notifications,
// saved reminders, bookmarks and installed shortcuts still point at them.

export const MOVED_PATHS = ['/planner', '/projects', '/analytics'] as const

/** Where an old address goes now, keeping the item it pointed at. */
export function redirectTarget(path: string, search: string): string {
  const q = new URLSearchParams(search)
  const out = new URLSearchParams()
  const keep = (from: string, to = from) => {
    const v = q.get(from)
    if (v) out.set(to, v)
  }
  switch (path) {
    case '/planner':
      out.set('view', q.get('mode') === 'week' ? 'week' : 'day')
      keep('date')
      return `/calendar?${out}`
    case '/projects':
      out.set('tab', 'projects')
      keep('project')
      return `/goals?${out}`
    case '/analytics':
      return '/review?tab=trends'
    default:
      return '/'
  }
}
