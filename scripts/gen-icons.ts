/**
 * Génère les 3 icônes PWA placeholder via @resvg/resvg-js (rendu SVG → PNG).
 * Si la lib n'est pas disponible, fallback : message d'erreur clair.
 */
import * as fs from 'fs'
import * as path from 'path'

function buildSvg(size: number): string {
  const fontSize = Math.round(size * 0.52)
  const textY = Math.round(size * 0.65)
  const radius = Math.round(size * 0.17)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/>
  <text x="${size / 2}" y="${textY}" text-anchor="middle" font-size="${fontSize}" font-family="sans-serif" font-weight="bold" fill="white">N</text>
</svg>`
}

async function main() {
  const dir = path.join(process.cwd(), 'public', 'icons')
  fs.mkdirSync(dir, { recursive: true })

  let Resvg: typeof import('@resvg/resvg-js').Resvg
  try {
    ;({ Resvg } = await import('@resvg/resvg-js'))
  } catch {
    console.warn('@resvg/resvg-js indisponible — icons non générées.')
    console.warn('Installer : npm i -D @resvg/resvg-js && relancer npm run gen:icons')
    process.exit(1)
  }

  const targets: Array<[number, string]> = [
    [192, 'icon-192.png'],
    [512, 'icon-512.png'],
    [180, 'apple-touch-icon.png'],
  ]
  for (const [size, name] of targets) {
    const svg = buildSvg(size)
    const png = new Resvg(svg).render().asPng()
    fs.writeFileSync(path.join(dir, name), png)
    console.log(`Wrote ${name} (${size}×${size}, ${png.length} bytes)`)
  }
}

main().catch((e) => {
  console.error('[gen-icons] failed:', e)
  process.exit(1)
})
