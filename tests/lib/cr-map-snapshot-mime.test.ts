// Correctif Vincent (2026-08-27) : sur DIMENC-Sireis, la carte PDF en fond
// Satellite s'affichait grise. Cause racine PROUVÉE : OSM (Plan) sert du PNG,
// Mapbox Satellite sert du JPEG — mais `buildSvg()` forçait un data URI
// `image/png` quelle que soit la tuile réelle. Resvg (`usvg-parser`) choisit
// son décodeur sur le MIME déclaré, pas sur le contenu des octets (voir
// `ImageHrefResolver::default_data_resolver`, image.rs) : des octets JPEG
// étiquetés `image/png` échouent à décoder et le noeud <image> disparaît —
// le fond gris `<rect fill="#e5e7eb">` du SVG reste seul visible.
//
// Ces tests exercent le chemin de rendu réel (`buildSvg` → Resvg via
// `renderMapPixelsForTest`/`renderMapPng`), pas seulement le contrat
// `TileData`. Fixtures : PNG et JPEG 256x256 unis, générés une fois via
// `sharp` (présent en devDependency transitive, absent du runtime de test) et
// figés ici en base64 — aucune dépendance à `sharp` dans la suite.

import { describe, it, expect } from 'vitest'
import { buildSvg, renderMapPng, renderMapPixelsForTest } from '@/lib/pdf/cr-map-snapshot'

// 256x256 uni, bleu (30,144,255), généré par sharp({create:{...}}).png().toBuffer().
const PNG_TILE_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAFMklEQVR4nO3cwQ3DMAwEQVeyNatjpoa8+OAAKiBYr2BLvMvXGwuBrmrwrf8CC4FsABIgkDcACRDIJxAJEMgZgAQI5BBMAgRyC0QCBHINSgIEMgcgAQIZhJEAgUyCSYBAohAkQCBZIBIgkDAcCRBIGpQECCQOTQIE0gcgAQIpxJAAgTTCSIBAKpEkQCCdYBKkkK0UT4JubwP/CrH/DKxsABIgkDcACRDIJxAJEMgZgAQI5BBMAgRyC0QCBHINSgIEMgcgAQIZhJEAgUyCSYBAohAkQCBZIBIgkDAcCRBIGpQECCQOTQIE0gcgAQIpxJAAgTTCSIBAKpEkQCCdYBKkjqwUT4JubwP/CrH/DKxsABIgkDcACRDIJxAJEMgZgAQI5BBMAgRyC0QCBHINSgIEMgcgAQIZhJEAgUyCSYBAohAkQCBZIBIgkDAcCRBIGpQECCQOTQIE0gcgAQIpxJAAgTTCSIBAKpEkQCCdYBKkjqwUT4JubwP/CrH/DKxsABIgkDcACRDIJxAJEMgZgAQI5BBMAgRyC0QCBHINSgIEMgcgAQIZhJEAgUyCSYBAohAkQCBZIBIgkDAcCRBIGpQECCQOTQIE0gcgAQIpxJAAAY0wEiAwKpEkQGB0gkmAgFI8Cd71beBfIfafgZUNQAIE8gYgAQL5BCIBAjkDkACBHIJJgEBugUiAQK5BSYBA5gAkQCCDMBIgkEkwCRBIFIIECCQLRAIEEoYjAQJJg5IAgcShSYBA+gAkQCCFGBIgkEYYCRBIJZIECKQTTILUkZXiSdDtbeBfIfafgZUNQAIE8gYgAQL5BCIBAjkDkACBHIJJgEBugUiAQK5BSYBA5gAkQCCDMBIgkEkwCRBIFIIECCQLRAIEEoYjAQJJg5IAgcShSYBA+gAkQCCFGBIgkEYYCRBIJZIECKQTTILUkZXiSdDtbeBfIfafgZUNQAIE8gYgAQL5BCIBAjkDkACBHIJJgEBugUiAQK5BSYBA5gAkQCCDMBIgkEkwCRBIFIIECCQLRAIEEoYjAQJJg5IAgcShSYBA+gAkQCCFGBIgkEYYCRBIJZIECKQTTILUkZXiSdDtbeBfIfafgZUNQAIE8gYgAQL5BCIBAjkDkACBHIJJgEBugUiAQK5BSYBA5gAkQCCDMBIgkEkwCRBIFIIECCQLRAIEEoYjAQJJg5IAgcShSYBA+gAkQCCFGBIgkEYYCRBIJZIECKQTTILUkZXiSdDtbeBfIfafgZUNQAIE8gYgAQL5BCIBAjkDkACBHIJJgEBugUiAQK5BSYBA5gAkQCCDMBIgkEkwCRBIFIIECCQLRAIEEoYjAQJJg5IAgcShSYBA+gAkQCCFGBIgkEYYCRBIJZIECKQTTILUkZXiSdDtbeBfIfafgZUNQAIE8gYgAQL5BCIBAjkDkACBHIJJgEBugUiAQK5BSYBA5gAkQCCDMBIgkEkwCRBIFIIECCQLRAIEEoYjAQLSoCRAYMShSYDA6AOQAIFRiCEBAqMRRgIERiWSBAiMTjAJEFCKJ8G7vg38K8T+M7CyAUiAQN4AJEAgn0AkQCBnABIgkEMwCRDILRAJEMg1KAkQyByABAhkEEYCBDIJJgECiUKQAIFkgUiAQMJwJEAgaVASIJA4NAkQSB+ABAikEEMCBNIIIwECqUSSAIF0gkmQOrJSPAm6vQ38K8T+M7CyAUiAQN4AJEAgn0AkQCBnABIgkEMwCRDILRAJEMg1KAkQyByABAhkEEYCBDIJJgECiUKQAIFkgUiAQP9vgx876xkkcTcxOwAAAABJRU5ErkJggg=='

// 256x256 uni, orange (200,100,50), généré par sharp({create:{...}}).jpeg({quality:80}).toBuffer().
// Décodage intégral déjà PROUVÉ via ce même chemin (scripts/_diag_jpeg_sharp_check.ts) :
// 65536/65536 pixels non-transparents, couleur exacte (200,100,50,255) à trois points échantillonnés.
const JPEG_TILE_B64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAEAAQADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCQCPXwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//2Q=='

/** Fond `<rect fill="#e5e7eb">` posé par `buildSvg()` avant toute tuile — la
 *  couleur qu'on retrouve exactement là où une tuile aurait dû être décodée
 *  mais ne l'a pas été (bug MIME reproduit). */
const BACKGROUND_RGB = [0xe5, 0xe7, 0xeb] as const

function pixelAt(rendered: { pixels: Buffer; width: number }, x: number, y: number): [number, number, number, number] {
  const i = (y * rendered.width + x) * 4
  return [rendered.pixels[i], rendered.pixels[i + 1], rendered.pixels[i + 2], rendered.pixels[i + 3]]
}

function countNearWhitePixels(
  { pixels, width, height }: { pixels: Buffer; width: number; height: number },
  cx: number,
  cy: number,
  halfSize = 9,
): number {
  let count = 0
  for (let y = Math.max(0, Math.round(cy - halfSize)); y <= Math.min(height - 1, Math.round(cy + halfSize)); y++) {
    for (let x = Math.max(0, Math.round(cx - halfSize)); x <= Math.min(width - 1, Math.round(cx + halfSize)); x++) {
      const i = (y * width + x) * 4
      if (pixels[i] >= 250 && pixels[i + 1] >= 250 && pixels[i + 2] >= 250 && pixels[i + 3] >= 250) count++
    }
  }
  return count
}

describe('cr-map-snapshot — contrat MIME par tuile (Plan=PNG, Satellite=JPEG)', () => {
  it('tuile PNG + image/png → décodée et rendue (couleur exacte, PNG sans perte)', () => {
    const svg = buildSvg([{ left: 0, top: 0, b64: PNG_TILE_B64, mimeType: 'image/png' }], [])
    const rendered = renderMapPixelsForTest(svg)
    const [r, g, b, a] = pixelAt(rendered, 128, 128)
    expect([r, g, b, a]).toEqual([30, 144, 255, 255])
  })

  it('tuile JPEG + image/jpeg → décodée et rendue (couleur proche, tolérance JPEG)', () => {
    const svg = buildSvg([{ left: 0, top: 0, b64: JPEG_TILE_B64, mimeType: 'image/jpeg' }], [])
    const rendered = renderMapPixelsForTest(svg)
    const [r, g, b, a] = pixelAt(rendered, 128, 128)
    expect(a).toBe(255)
    expect(Math.abs(r - 200)).toBeLessThanOrEqual(3)
    expect(Math.abs(g - 100)).toBeLessThanOrEqual(3)
    expect(Math.abs(b - 50)).toBeLessThanOrEqual(3)
  })

  it('mauvais MIME (octets JPEG déclarés image/png) → reproduit le fond transparent/gris (bug de production)', () => {
    // Ce test doit continuer à échouer si `buildSvg`/`fetchTile` recommencent
    // à forcer un MIME indépendant du contenu réel de la tuile — c'est
    // exactement le bug rapporté par Vincent sur DIMENC-Sireis.
    const svg = buildSvg([{ left: 0, top: 0, b64: JPEG_TILE_B64, mimeType: 'image/png' }], [])
    const rendered = renderMapPixelsForTest(svg)
    const [r, g, b, a] = pixelAt(rendered, 128, 128)
    expect([r, g, b, a]).toEqual([...BACKGROUND_RGB, 255])
  })

  it('Plan inchangé : tuile PNG + marqueur superposé, les deux restent lisibles', () => {
    const svg = buildSvg(
      [{ left: 0, top: 0, b64: PNG_TILE_B64, mimeType: 'image/png' }],
      [{ cx: 128, cy: 200, color: '#0284c7', label: '5' }],
    )
    const rendered = renderMapPixelsForTest(svg)
    // Imagerie réelle visible loin du marqueur.
    expect(pixelAt(rendered, 30, 30)).toEqual([30, 144, 255, 255])
    // Le marqueur (chiffre blanc peint) reste visible au-dessus de la tuile.
    expect(countNearWhitePixels(rendered, 128, 200)).toBeGreaterThan(5)
  })

  it('Satellite produit un PNG final avec contenu d\'imagerie réel, pas seulement les marqueurs', () => {
    const svg = buildSvg(
      [{ left: 0, top: 0, b64: JPEG_TILE_B64, mimeType: 'image/jpeg' }],
      [{ cx: 128, cy: 200, color: '#0284c7', label: '5' }],
    )
    const png = renderMapPng(svg)
    expect(png.length).toBeGreaterThan(0)
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')

    const rendered = renderMapPixelsForTest(svg)
    // Un point loin du marqueur mais dans la tuile doit montrer la couleur de
    // la tuile JPEG décodée, pas le fond gris `#e5e7eb` du SVG.
    const [r, g, b] = pixelAt(rendered, 30, 30)
    expect(Math.abs(r - 200)).toBeLessThanOrEqual(3)
    expect(Math.abs(g - 100)).toBeLessThanOrEqual(3)
    expect(Math.abs(b - 50)).toBeLessThanOrEqual(3)
  })

  it('numéros des clusters toujours visibles avec une tuile Satellite en fond (aucune régression de numérotation)', () => {
    const svg = buildSvg(
      [{ left: 0, top: 0, b64: JPEG_TILE_B64, mimeType: 'image/jpeg' }],
      [{ cx: 128, cy: 128, color: '#334155', label: '3 · 4' }],
    )
    const rendered = renderMapPixelsForTest(svg)
    expect(countNearWhitePixels(rendered, 128, 128)).toBeGreaterThan(5)
  })
})
