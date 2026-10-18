import type { NoteKind } from '@/lib/db/types'

export interface Capture {
  kind: NoteKind
  title: string
  content: string
  url: string
  tags: string[]
}

/**
 * Turn the Inbox capture box into a note. A web address anywhere in the text
 * becomes the note's link (and makes it a Link note); the first remaining line
 * is the title, the rest the body, and #words are tags.
 */
export function parseCapture(text: string, kind: 'note' | 'idea'): Capture {
  const t = text.trim()
  const tags = [...t.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[2].toLowerCase())
  const found = /https?:\/\/\S+/i.exec(t)?.[0] ?? ''
  // "see https://x.com." links to https://x.com, not "x.com."
  const url = found.replace(/[.,;:!?)\]]+$/, '')
  const lines = (found ? t.replace(found, '') : t).split('\n')
  const at = lines.findIndex((l) => l.trim())
  const title = (at >= 0 ? lines[at].trim().replace(/\s{2,}/g, ' ') : url).slice(0, 300)
  const content = at >= 0 ? lines.slice(at + 1).join('\n').trim() : ''
  return { kind: url ? 'link' : kind, title, content, url, tags }
}
