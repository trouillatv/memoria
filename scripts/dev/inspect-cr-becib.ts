/**
 * scripts/dev/inspect-cr-becib.ts
 *
 * Outil de DIAGNOSTIC (jetable) : rend la fixture La Cravache via le gabarit
 * BECIB, décompresse les flux de contenu PDF et liste tous les rectangles
 * peints avec leur couleur de remplissage courante. Sert à localiser la « bande
 * navy » pleine hauteur sans deviner.
 *
 * Usage : npx tsx scripts/dev/inspect-cr-becib.ts
 */
import * as zlib from 'zlib'
import { renderToBuffer } from '@react-pdf/renderer'
import { CrBecibPdf } from '@/lib/pdf/cr-becib'
import { CRAVACHE_FIXTURE } from '@/lib/documents/fixtures/cravache'

function inflateStreams(pdf: Buffer): string {
  const out: string[] = []
  const buf = pdf
  let i = 0
  const needle = Buffer.from('stream')
  const end = Buffer.from('endstream')
  while (i < buf.length) {
    const s = buf.indexOf(needle, i)
    if (s === -1) break
    // skip "stream" + EOL (\r\n or \n)
    let dataStart = s + needle.length
    if (buf[dataStart] === 0x0d) dataStart++
    if (buf[dataStart] === 0x0a) dataStart++
    const e = buf.indexOf(end, dataStart)
    if (e === -1) break
    const raw = buf.subarray(dataStart, e)
    try {
      out.push(zlib.inflateSync(raw).toString('latin1'))
    } catch {
      // not flate-compressed; keep raw text (may be a content stream in clear)
      out.push(raw.toString('latin1'))
    }
    i = e + end.length
  }
  return out.join('\n=== STREAM BREAK ===\n')
}

type Rect = { x: number; y: number; w: number; h: number; fill: string }

function parseRects(content: string): Rect[] {
  const tokens = content.split(/\s+/)
  const rects: Rect[] = []
  const stack: number[] = []
  let fill = '(none)'
  const num = (t: string) => Number(t)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '') continue
    if (/^-?\d*\.?\d+$/.test(t)) {
      stack.push(num(t))
      continue
    }
    switch (t) {
      case 'rg': // r g b set fill (RGB)
        if (stack.length >= 3) fill = `rgb(${stack.slice(-3).map((v) => v.toFixed(3)).join(',')})`
        break
      case 'g': // gray set fill
        if (stack.length >= 1) fill = `gray(${stack[stack.length - 1].toFixed(3)})`
        break
      case 'k': // cmyk
        if (stack.length >= 4) fill = `cmyk(${stack.slice(-4).map((v) => v.toFixed(2)).join(',')})`
        break
      case 're': {
        if (stack.length >= 4) {
          const [x, y, w, h] = stack.slice(-4)
          rects.push({ x, y, w, h, fill })
        }
        break
      }
      default:
        break
    }
    // operators consume operands
    if (!/^-?\d*\.?\d+$/.test(t)) stack.length = 0
  }
  return rects
}

const NAVY = { r: 31 / 255, g: 42 / 255, b: 90 / 255 }
function isNavy(fill: string): boolean {
  const m = fill.match(/^rgb\(([\d.]+),([\d.]+),([\d.]+)\)$/)
  if (!m) return false
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return Math.abs(r - NAVY.r) < 0.05 && Math.abs(g - NAVY.g) < 0.05 && Math.abs(b - NAVY.b) < 0.05
}

// A4 page box. Le cadre est à left:22 → right:573.28. Tout rect hors [22, 573.28]
// en X déborde le liseré (cas du marqueur rouge signalé).
const PAGE_H = 841.89
const CONTENT_W = 595.28 - 34 * 2 // 527.28

async function main() {
  const pdf = await renderToBuffer(CrBecibPdf({ cr: CRAVACHE_FIXTURE }))
  console.log(`PDF size: ${pdf.length} bytes`)
  const raw = Buffer.from(pdf).toString('latin1')
  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length
  console.log(`Pages: ${pages}`)
  const content = inflateStreams(Buffer.from(pdf))
  const rects = parseRects(content)
  console.log(`Total painted rectangles: ${rects.length}`)

  const tall = rects.filter((r) => Math.abs(r.h) > 400)
  console.log(`\n=== TALL rects (|h| > 400pt) — runaway/bande pleine hauteur ===`)
  if (tall.length === 0) console.log('  (aucun — OK)')
  for (const r of tall) {
    console.log(`  x=${r.x.toFixed(1)} y=${r.y.toFixed(1)} w=${r.w.toFixed(1)} h=${r.h.toFixed(1)}  fill=${r.fill}${isNavy(r.fill) ? '  <-- NAVY' : ''}`)
  }

  // NB : coordonnées en repère LOCAL (pdfkit translate chaque élément via `cm`,
  // non composé ici) → l'absolu n'est pas fiable ; seul le runaway (hauteur
  // brute aberrante) est détectable sans CTM. La largeur, elle, est fiable.
  const tooWide = rects.filter((r) => Math.abs(r.w) > CONTENT_W + 1)
  console.log(`\n=== rects plus larges que la zone de contenu (${CONTENT_W.toFixed(0)}pt) ===`)
  if (tooWide.length === 0) console.log('  (aucun — rien ne dépasse la largeur de contenu)')
  for (const r of tooWide) console.log(`  w=${r.w.toFixed(1)} h=${r.h.toFixed(1)} fill=${r.fill}`)

  console.log(`\n=== NAVY-filled rects (marine #1F2A5A) ===`)
  for (const r of rects.filter((r) => isNavy(r.fill))) {
    console.log(`  x=${r.x.toFixed(1)} y=${r.y.toFixed(1)} w=${r.w.toFixed(1)} h=${r.h.toFixed(1)}`)
  }

  console.log(`\n=== Largest rects (top 8 par surface) ===`)
  ;[...rects].sort((a, b) => Math.abs(b.w * b.h) - Math.abs(a.w * a.h)).slice(0, 8).forEach((r) => {
    console.log(`  x=${r.x.toFixed(1)} y=${r.y.toFixed(1)} w=${r.w.toFixed(1)} h=${r.h.toFixed(1)}  fill=${r.fill}`)
  })
  void PAGE_H
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
