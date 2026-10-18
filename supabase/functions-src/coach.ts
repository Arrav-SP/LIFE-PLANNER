// Supabase Edge Function (Deno): "Ask the coach". Optional. Free.
//
//   POST /coach  { summary }  ->  { text }
//
// Sends the Coach page's summary to a free AI model on Groq and returns its
// written plan. Only signed-in users of this app can call it. Secrets (never
// shipped to the browser): GROQ_API_KEY, and optionally GROQ_MODEL.
//
// This is the source. `npm run functions:build` bundles it into
// supabase/functions/coach/index.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1'
import { buildCoachRequest, coachErrorMessage, DEFAULT_MODEL } from '../../src/server/aiCoach'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (status: number, body: Record<string, string>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  // The gateway also accepts the public key, so check for a real signed-in user.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const { data: auth } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } }
  if (!auth.user) return json(401, { error: 'Sign in to the app first.' })

  const key = Deno.env.get('GROQ_API_KEY')
  if (!key) return json(500, { error: 'The AI coach is not set up. Add the GROQ_API_KEY secret (see the README).' })

  let body: ReturnType<typeof buildCoachRequest>
  try {
    body = buildCoachRequest(((await req.json()) as { summary?: unknown }).summary, Deno.env.get('GROQ_MODEL') || DEFAULT_MODEL)
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'Bad request' })
  }

  let res: Response
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
  } catch {
    return json(504, { error: 'The AI service did not answer. Try again later.' })
  }
  if (!res.ok) return json(502, { error: coachErrorMessage(res.status) })
  const out = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = out.choices?.[0]?.message?.content?.trim()
  if (!text) return json(502, { error: 'The AI returned an empty answer. Try again.' })
  return json(200, { text })
})
