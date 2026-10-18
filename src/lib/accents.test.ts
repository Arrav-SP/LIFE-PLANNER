import { describe, expect, it } from 'vitest'
import { ACCENTS, accentColors, accentCss, contrast, DARK_BG, LIGHT_BG } from './accents'

describe('accents', () => {
  it.each(ACCENTS)('$name is readable in both themes', (a) => {
    const { light, dark } = accentColors(a)
    expect(contrast(light.accent, LIGHT_BG)).toBeGreaterThanOrEqual(4.5) // links on light backgrounds
    expect(contrast(light.fg, light.accent)).toBeGreaterThanOrEqual(4.5) // button text
    expect(contrast(dark.accent, DARK_BG)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dark.fg, dark.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves the default and unknown ids to index.css', () => {
    expect(accentCss('teal')).toBe('')
    expect(accentCss('nope')).toBe('')
    expect(accentCss('lavender')).toMatch(/^html:root\{--accent:\d+ \d+ \d+;.*html:root\.dark\{/)
  })
})
