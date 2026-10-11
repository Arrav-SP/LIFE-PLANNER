// Generates the PWA icons with no dependencies (Node's zlib only).
// Run with: npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const BG = [13, 148, 136] // teal-600
const FG = [255, 255, 255]

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// Distance from point to segment, for drawing the check mark.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function icon(size, { maskable }) {
  const s = size
  const radius = maskable ? 0 : s * 0.22
  const scale = maskable ? 0.7 : 1 // keep the mark inside the maskable safe zone
  const c = s / 2
  const pts = [[0.3, 0.52], [0.45, 0.66], [0.72, 0.36]].map(([x, y]) => [c + (x - 0.5) * s * scale, c + (y - 0.5) * s * scale])
  const stroke = s * 0.085 * scale
  return png(s, (x, y) => {
    // Rounded square mask with simple edge antialiasing.
    const qx = Math.max(Math.abs(x - c) - (c - radius), 0)
    const qy = Math.max(Math.abs(y - c) - (c - radius), 0)
    const outside = Math.hypot(qx, qy) - radius
    const alpha = Math.max(0, Math.min(1, 0.5 - outside))
    if (alpha === 0) return [0, 0, 0, 0]
    const d = Math.min(segDist(x, y, ...pts[0], ...pts[1]), segDist(x, y, ...pts[1], ...pts[2]))
    const f = Math.max(0, Math.min(1, stroke / 2 + 0.5 - d))
    const mix = (i) => Math.round(BG[i] * (1 - f) + FG[i] * f)
    return [mix(0), mix(1), mix(2), Math.round(alpha * 255)]
  })
}

mkdirSync('public', { recursive: true })
writeFileSync('public/pwa-192.png', icon(192, { maskable: false }))
writeFileSync('public/pwa-512.png', icon(512, { maskable: false }))
writeFileSync('public/pwa-512-maskable.png', icon(512, { maskable: true }))
writeFileSync('public/apple-touch-icon.png', icon(180, { maskable: true }))
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="rgb(${BG})"/><path d="M19.2 33.3 28.8 42.2 46.1 23" fill="none" stroke="#fff" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`,
)
console.log('Icons written to public/')
