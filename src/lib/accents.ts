// Accent colours for Settings → Appearance. Each is one hue: its pastel is the
// accent in dark mode and the soft highlight in light mode. In light mode the
// accent itself is darkened just enough that text in it stays readable (WCAG AA,
// 4.5:1), because `text-accent` is used for links and labels all over the app.

export interface Accent {
  id: string
  name: string
  hue: number
  sat: number
}

export type RGB = [number, number, number]

export const DEFAULT_ACCENT = 'teal'

export const ACCENTS: Accent[] = [
  { id: 'teal', name: 'Teal', hue: 174, sat: 60 },
  { id: 'mint', name: 'Mint', hue: 150, sat: 55 },
  { id: 'sage', name: 'Sage', hue: 110, sat: 25 },
  { id: 'sky', name: 'Sky', hue: 200, sat: 75 },
  { id: 'periwinkle', name: 'Periwinkle', hue: 228, sat: 70 },
  { id: 'lavender', name: 'Lavender', hue: 260, sat: 60 },
  { id: 'lilac', name: 'Lilac', hue: 285, sat: 50 },
  { id: 'orchid', name: 'Orchid', hue: 310, sat: 50 },
  { id: 'pink', name: 'Pink', hue: 335, sat: 75 },
  { id: 'rose', name: 'Rose', hue: 355, sat: 70 },
  { id: 'peach', name: 'Peach', hue: 18, sat: 85 },
  { id: 'apricot', name: 'Apricot', hue: 32, sat: 85 },
  { id: 'butter', name: 'Butter', hue: 48, sat: 85 },
]

/** The app's backgrounds text must read on (index.css --surface-2, the worst case in each theme). */
export const LIGHT_BG: RGB = [240, 240, 236]
export const DARK_BG: RGB = [32, 36, 41]

function hsl(h: number, s: number, l: number): RGB {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round((l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [f(0), f(8), f(4)]
}

function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Step the lightness from `l` until the colour reads on `bg`. */
function readable(a: Accent, l: number, step: number, bg: RGB): RGB {
  while (contrast(hsl(a.hue, a.sat, l), bg) < 4.5 && l > 0 && l < 100) l += step
  return hsl(a.hue, a.sat, l)
}

export function accentColors(a: Accent) {
  return {
    swatch: hsl(a.hue, a.sat, 80),
    light: { accent: readable(a, 50, -1, LIGHT_BG), fg: [255, 255, 255] as RGB, soft: hsl(a.hue, a.sat, 90) },
    dark: { accent: readable(a, 80, 1, DARK_BG), fg: hsl(a.hue, 40, 12), soft: hsl(a.hue, Math.min(a.sat, 35), 20) },
  }
}

/** CSS that overrides the default (teal) accent from index.css; empty for the default. */
export function accentCss(id: string | null | undefined): string {
  const a = ACCENTS.find((x) => x.id === id)
  if (!a || a.id === DEFAULT_ACCENT) return ''
  const { light, dark } = accentColors(a)
  const vars = (c: { accent: RGB; fg: RGB; soft: RGB }) => `--accent:${c.accent.join(' ')};--accent-fg:${c.fg.join(' ')};--accent-soft:${c.soft.join(' ')}`
  // `html:root` outranks index.css's `:root` wherever this <style> lands in <head>.
  return `html:root{${vars(light)}}html:root.dark{${vars(dark)}}`
}
