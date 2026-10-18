// The "Ask the coach" request, kept free of Deno so it can be unit-tested.
// supabase/functions-src/coach.ts sends it to Groq's OpenAI-compatible API.

/** Groq's free tier allows a few thousand tokens a minute, so the summary is capped. */
export const MAX_SUMMARY_CHARS = 12_000

/** Groq retired llama-3.3-70b-versatile in Aug 2026 and points to this one; override with the GROQ_MODEL secret. */
export const DEFAULT_MODEL = 'openai/gpt-oss-120b'

export const SYSTEM_PROMPT = [
  'You are a practical, encouraging planning coach inside a personal planner app.',
  'Use only the data the user sends. Do not invent tasks, dates or numbers.',
  'Reply in plain text with short "-" bullet points, no markdown symbols like ** or #, under 250 words, in these parts:',
  'Today: what to do, in order, with rough times that fit the free time.',
  'This week: what to schedule, and how to balance study subjects against their deadlines.',
  'Drop or move: what to postpone or cut, and why.',
  'One habit or pattern tip, only if the data shows one.',
].join('\n')

export function buildCoachRequest(summary: unknown, model: string = DEFAULT_MODEL) {
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('Nothing to send to the coach.')
  return {
    model,
    temperature: 0.4,
    // Reasoning models spend part of this before answering, so leave room.
    max_completion_tokens: 2000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: summary.trim().slice(0, MAX_SUMMARY_CHARS) },
    ],
  }
}

/** A plain-language reason for a failed call to the AI service. */
export function coachErrorMessage(status: number): string {
  if (status === 429) return 'The free AI limit is reached for now. Try again in a minute.'
  if (status === 401 || status === 403) return 'The AI key is missing or wrong. Check the GROQ_API_KEY secret in Supabase.'
  if (status === 404) return 'The AI model was not found. Set the GROQ_MODEL secret to a current Groq model.'
  return `The AI service answered with an error (${status}). Try again later.`
}
