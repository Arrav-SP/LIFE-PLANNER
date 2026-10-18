import { describe, expect, it } from 'vitest'
import { parseCapture } from './logic'

describe('parseCapture', () => {
  it('keeps plain notes and ideas as typed', () => {
    expect(parseCapture('buy milk', 'note')).toEqual({ kind: 'note', title: 'buy milk', content: '', url: '', tags: [] })
    expect(parseCapture('app idea\nmore detail\n', 'idea')).toEqual({ kind: 'idea', title: 'app idea', content: 'more detail', url: '', tags: [] })
  })

  it('makes a bare address a link titled by the address', () => {
    expect(parseCapture('https://fitcircle-arav.expo.app/profile', 'note')).toMatchObject({ kind: 'link', title: 'https://fitcircle-arav.expo.app/profile', url: 'https://fitcircle-arav.expo.app/profile' })
  })

  it('pulls an address out of a sentence, without trailing punctuation', () => {
    expect(parseCapture('read this https://example.com/a. later', 'idea')).toMatchObject({ kind: 'link', title: 'read this later', url: 'https://example.com/a' })
  })

  it('finds an address on a later line and keeps the first line as the title', () => {
    expect(parseCapture('OS notes\nhttps://example.com/os\nchapter 3', 'note')).toEqual({ kind: 'link', title: 'OS notes', content: 'chapter 3', url: 'https://example.com/os', tags: [] })
  })

  it('reads #tags', () => {
    expect(parseCapture('study dbms #FAT #quiz', 'note').tags).toEqual(['fat', 'quiz'])
  })
})
