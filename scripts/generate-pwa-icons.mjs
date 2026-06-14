/**
 * Génère les icônes PWA depuis public/logo.png.
 * - Supprime le fond blanc (seuil > 240 sur R+G+B)
 * - Trim les marges transparentes
 * - Resize + centre sur canvas transparent avec 15% de padding
 *
 * Output :
 *   public/icons/icon-192.png      (192×192, transparent)
 *   public/icons/icon-512.png      (512×512, transparent)
 *   public/icons/apple-touch-icon.png  (180×180, fond blanc — iOS exige un fond)
 *
 * Usage : node scripts/generate-pwa-icons.mjs
 */

import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'public', 'logo.png')
const ICONS_DIR = path.join(ROOT, 'public', 'icons')

async function removeWhiteBackground(inputPath) {
  const image = sharp(inputPath)
  const { width, height } = await image.metadata()

  const raw = await image.ensureAlpha().raw().toBuffer()

  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i], g = raw[i + 1], b = raw[i + 2]
    // Seuil large : blanc pur et nuances très claires
    if (r > 240 && g > 240 && b > 240) {
      raw[i + 3] = 0
    }
  }

  return sharp(raw, { raw: { width, height, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .png()
    .toBuffer()
}

async function buildIcon({ logoBuffer, size, padding, background }) {
  const logoSize = Math.round(size * (1 - padding * 2))
  const padPx = Math.round(size * padding)

  const resized = await sharp(logoBuffer)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer()

  const base = background
    ? sharp({ create: { width: size, height: size, channels: 4, background } })
    : sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })

  return base
    .composite([{ input: resized, top: padPx, left: padPx }])
    .png()
    .toBuffer()
}

async function main() {
  console.log('→ Suppression fond blanc du logo…')
  const logoBuffer = await removeWhiteBackground(SRC)

  const targets = [
    {
      name: 'icon-512.png',
      size: 512,
      padding: 0.12,
      background: null,  // transparent (purpose: "any")
    },
    {
      name: 'icon-192.png',
      size: 192,
      padding: 0.12,
      background: null,  // transparent (purpose: "any")
    },
    {
      // Maskable : fond sombre #0f172a, logo dans la safe zone (60% central).
      // purpose: "maskable" exige que les coins soient remplis — jamais transparent.
      name: 'icon-512-maskable.png',
      size: 512,
      padding: 0.2,  // 20% = safe zone Android (40% du diamètre protégé)
      background: { r: 15, g: 23, b: 42, alpha: 255 },  // #0f172a
    },
    {
      name: 'apple-touch-icon.png',
      size: 180,
      padding: 0.12,
      // iOS rend noir le transparent → fond blanc
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    },
  ]

  for (const t of targets) {
    const buf = await buildIcon({
      logoBuffer,
      size: t.size,
      padding: t.padding,
      background: t.background,
    })
    const out = path.join(ICONS_DIR, t.name)
    writeFileSync(out, buf)
    console.log(`✓ ${t.name} (${t.size}×${t.size})`)
  }

  console.log('\nTerminé. Relance le dev server pour voir les nouvelles icônes.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
