// Supabase Edge Function (Deno): calendar links. Optional. Free plan.
//
//   GET /calendar/feed/<token>.ics   Your events and dated tasks as an iCalendar
//                                    feed. Subscribe to it in Google Calendar
//                                    ("From URL"). Anyone with the link can read
//                                    it, so the token is long and can be reset.
//   GET /calendar/import?url=<ics>   For the signed-in app only: fetches a
//                                    calendar's secret iCal address (Google,
//                                    Outlook, iCloud) so the app can show it.
//
// Deploy with JWT verification OFF (Google can't sign in); the import route
// checks the user's token itself. Optional secret: APP_URL (links back to the app).
//
// This is the source. `npm run functions:build` bundles it into
// supabase/functions/calendar/index.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1'
import { buildFeed } from '../../src/server/icsFeed'
import { importTarget, isAllowedCalendarHost, MAX_ICS_BYTES } from '../../src/server/calendarProxy'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
}

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS, ...headers } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET') return text(405, 'Method not allowed')
  const url = new URL(req.url)
  // The service role bypasses row-level security, so every query below names its user.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const feed = url.pathname.match(/\/feed\/([A-Za-z0-9_-]{32,64})(?:\.ics)?$/)
  if (feed) {
    const { data: owner } = await sb.from('user_settings').select('user_id,timezone').eq('calendar_feed_token', feed[1]).maybeSingle()
    if (!owner) return text(404, 'Calendar not found. The link may have been reset.')
    const uid = owner.user_id as string
    const [events, exceptions, tasks] = await Promise.all([
      sb.from('events').select('*').eq('user_id', uid).is('archived_at', null).limit(5000),
      sb.from('event_exceptions').select('*').eq('user_id', uid).limit(5000),
      sb.from('tasks').select('*').eq('user_id', uid).is('archived_at', null).not('status', 'in', '(done,cancelled)').or('scheduled_at.not.is.null,due_date.not.is.null').limit(5000),
    ])
    const failed = events.error ?? exceptions.error ?? tasks.error
    if (failed) return text(500, failed.message)
    const body = buildFeed({
      events: events.data ?? [],
      exceptions: exceptions.data ?? [],
      tasks: tasks.data ?? [],
      tz: (owner.timezone as string) || 'UTC',
      appUrl: Deno.env.get('APP_URL')?.replace(/\/$/, ''),
    })
    return new Response(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'max-age=900', ...CORS } })
  }

  if (url.pathname.endsWith('/import')) {
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    const { data: auth } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } }
    if (!auth.user) return text(401, 'Sign in to the app first.')
    const first = importTarget(url.searchParams.get('url') ?? '')
    if (!first) return text(400, 'Use the secret iCal address of a Google, Outlook or iCloud calendar.')
    let target: URL = first
    // Follow a few redirects by hand so each hop is checked.
    for (let hop = 0; hop < 4; hop++) {
      let res: Response
      try {
        res = await fetch(target, { redirect: 'manual', headers: { accept: 'text/calendar' }, signal: AbortSignal.timeout(15_000) })
      } catch {
        return text(504, 'The calendar did not answer. Try again later.')
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next: URL = new URL(res.headers.get('location')!, target)
        if (next.protocol !== 'https:' || !isAllowedCalendarHost(next.hostname)) return text(400, 'The calendar redirected somewhere unexpected.')
        target = next
        continue
      }
      if (res.status === 404 || res.status === 403 || res.status === 401) return text(404, 'That calendar address no longer works. Copy it again from your calendar settings.')
      if (!res.ok) return text(502, `The calendar answered with an error (${res.status}).`)
      const body = await res.text()
      if (body.length > MAX_ICS_BYTES) return text(413, 'That calendar is too large to show.')
      if (!body.includes('BEGIN:VCALENDAR')) return text(422, "That address isn't a calendar file.")
      return new Response(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', ...CORS } })
    }
    return text(400, 'The calendar redirected too many times.')
  }

  return text(404, 'Not found')
})
