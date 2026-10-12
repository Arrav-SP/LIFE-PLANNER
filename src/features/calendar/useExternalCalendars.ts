import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { env } from '@/lib/env'
import { getSupabase } from '@/lib/supabase'
import { useSettings } from '@/settings/SettingsProvider'
import { expandCalendar, parseCalendar, type CalendarLink, type ExternalEvent, type ParsedCalendar } from './external'

/** The app's calendar function URL (see supabase/functions-src/calendar.ts). */
export const calendarFunctionUrl = () => `${env.supabaseUrl}/functions/v1/calendar`

export function feedUrl(token: string) {
  return `${calendarFunctionUrl()}/feed/${token}.ics`
}

/** Fetch another calendar's .ics through the app's function and parse it. */
export async function fetchCalendar(url: string): Promise<ParsedCalendar> {
  const sb = getSupabase()
  const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } }
  if (!data.session) throw new Error('Sign in to show other calendars.')
  let res: Response
  try {
    res = await fetch(`${calendarFunctionUrl()}/import?url=${encodeURIComponent(url)}`, {
      headers: { authorization: `Bearer ${data.session.access_token}`, apikey: env.supabaseKey },
    })
  } catch {
    throw new Error("Couldn't reach the calendar service. Check your connection.")
  }
  const body = await res.text()
  if (res.status === 404 && !body.includes('calendar')) throw new Error('The calendar function is not set up yet. See the setup guide.')
  if (!res.ok) throw new Error(body || `The calendar service answered with an error (${res.status}).`)
  try {
    return parseCalendar(body)
  } catch {
    throw new Error("That calendar file couldn't be read.")
  }
}

/** Occurrences from the user's enabled outside calendars for the range on screen. */
export function useExternalCalendars(range: { start: Date; end: Date } | null) {
  const { settings, tz } = useSettings()
  const links = useMemo(() => (settings.calendar_links ?? []).filter((l) => l.enabled), [settings.calendar_links])
  const results = useQueries({
    queries: links.map((l) => ({
      queryKey: ['external-calendar', l.id, l.url],
      queryFn: () => fetchCalendar(l.url),
      staleTime: 15 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
      retry: 1,
      enabled: env.mode === 'supabase',
    })),
  })
  const parsed = results.map((r) => r.data)
  const events = useMemo(() => {
    if (!range) return [] as (ExternalEvent & { link: CalendarLink })[]
    return links.flatMap((l, i) => {
      const cal = parsed[i]
      return cal ? expandCalendar(cal, l.id, range.start, range.end, tz).map((e) => ({ ...e, link: l })) : []
    })
  }, [links, range, tz, ...parsed]) // eslint-disable-line react-hooks/exhaustive-deps
  const errors = links.map((l, i) => ({ link: l, error: results[i]?.error as Error | null })).filter((e) => e.error)
  return { events, errors }
}
