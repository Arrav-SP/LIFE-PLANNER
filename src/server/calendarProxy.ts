// Which calendar URLs the `calendar` Edge Function will fetch for the app.
// Calendar hosts don't allow browsers to read their .ics files directly
// (no CORS), so the function fetches them; it only talks to known calendar
// providers so it can't be used to reach anything else.

const HOSTS = ['calendar.google.com', 'outlook.live.com', 'outlook.office365.com']

export function isAllowedCalendarHost(host: string): boolean {
  const h = host.toLowerCase()
  return HOSTS.includes(h) || /^p\d+-caldav\.icloud\.com$/.test(h)
}

/** The https URL to fetch, or null if this isn't a calendar address the app supports. */
export function importTarget(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'))
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  return isAllowedCalendarHost(u.hostname) ? u : null
}

/** Max size of a calendar file the function will pass on. */
export const MAX_ICS_BYTES = 5 * 1024 * 1024
