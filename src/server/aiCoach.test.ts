import { describe, expect, it } from 'vitest'
import { buildCoachRequest, coachErrorMessage, DEFAULT_MODEL, MAX_SUMMARY_CHARS, SYSTEM_PROMPT } from './aiCoach'

describe('buildCoachRequest', () => {
  it('sends the system prompt and the summary, capped for the free tier', () => {
    const r = buildCoachRequest('  ' + 'x'.repeat(MAX_SUMMARY_CHARS + 500))
    expect(r.model).toBe(DEFAULT_MODEL)
    expect(r.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT })
    expect(r.messages[1].content).toHaveLength(MAX_SUMMARY_CHARS)
  })

  it('refuses an empty or non-text summary', () => {
    expect(() => buildCoachRequest('   ')).toThrow('Nothing to send')
    expect(() => buildCoachRequest({ evil: true })).toThrow('Nothing to send')
  })

  it('explains rate limits and key problems plainly', () => {
    expect(coachErrorMessage(429)).toMatch(/limit/)
    expect(coachErrorMessage(401)).toMatch(/GROQ_API_KEY/)
  })
})
