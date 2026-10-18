import { describe, expect, it } from 'vitest'
import { ACCENTS, accentColors, accentCss, contrast, DARK_BG, type RGB } from './accents'

const INK: RGB = [24, 27, 31] // index.css --fg in light mode
const MUTED: RGB = [92, 98, 106] // --muted

describe('accents', () => {
  it.each(ACCENTS)('$name is readable in both themes', (a) => {
    const { light, dark } = accentColors(a)
    expect(contrast(light.accent, light.surface2)).toBeGreaterThanOrEqual(4.5) // links on the tinted panels
    expect(contrast(light.fg, light.accent)).toBeGreaterThanOrEqual(4.5) // button text
    expect(contrast(MUTED, light.surface2)).toBeGreaterThanOrEqual(4.5) // secondary text on the tint
    expect(contrast(INK, light.soft)).toBeGreaterThanOrEqual(4.5) // active menu item
    expect(contrast(dark.accent, DARK_BG)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dark.fg, dark.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves no or an unknown accent to index.css', () => {
    expect(accentCss(undefined)).toBe('')
    expect(accentCss('nope')).toBe('')
    expect(accentCss('lavender')).toMatch(/^html:root\{--accent:\d+ \d+ \d+;.*--bg:\d+ \d+ \d+;.*\}html:root\.dark\{--accent:/)
  })
})
