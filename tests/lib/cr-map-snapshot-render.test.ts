// Audit ciblé Vincent (2026-08-27) : sur le PDF réel, les repères de la carte
// apparaissent en pastilles sombres SANS numéro lisible, alors que la carte
// interactive affiche bien « 1 · 2 · 3 » etc. Diagnostic : `loadSystemFonts`
// (Resvg) échoue SILENCIEUSEMENT en production (Vercel serverless n'a aucune
// police système) — le SVG contient bien le bon <text>, mais Resvg ne trouve
// aucune police pour le dessiner et l'omet, sans erreur. Preuve manuelle :
// _resvg_text_test.mjs / _resvg_text_test_nofonts.png (racine du repo).
//
// Ce test n'inspecte PAS seulement les données d'entrée (le <text> dans le
// SVG) : il rend réellement le PNG via Resvg et vérifie la présence de pixels
// blancs dans la zone du chiffre — c'est la seule façon de distinguer « le
// texte est écrit dans le SVG » de « le texte est visible dans l'image ».
// Aucune modification du clustering ni de la numérotation : ce test porte
// uniquement sur le rendu (buildSvg/renderMapPng ne changent ni les positions
// ni les labels, cf. lib/visits/geo.ts pour cette logique-là).

import { describe, it, expect } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { buildSvg, renderMapPng, renderMapPixelsForTest, FONT_FAMILY, isCrMapSnapshotFresh, CURRENT_CR_MAP_RENDER_VERSION } from '@/lib/pdf/cr-map-snapshot'

/** Compte les pixels quasi blancs (le fill du texte, #ffffff) dans une petite
 *  fenêtre centrée sur (cx, cy) — assez large pour couvrir un chiffre à
 *  font-size 16-19, assez étroite pour rester à distance du contour blanc du
 *  marqueur (stroke #ffffff sur le cercle/la pastille), qui produirait sinon
 *  un faux positif. Seuil élevé (>=250) pour distinguer le blanc pur du texte
 *  du fond gris clair de la carte (#e5e7eb = 229,231,235). */
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

describe('cr-map-snapshot — le SVG contient les bons <text>', () => {
  it('marqueur simple : label, fill blanc, font-family de la police embarquée', () => {
    const svg = buildSvg([], [{ cx: 100, cy: 100, color: '#0284c7', label: '7' }])
    expect(svg).toContain('>7<')
    expect(svg).toContain(`font-family="${FONT_FAMILY}"`)
    expect(svg).toContain('fill="#ffffff"')
  })

  it('marqueur groupé : label à points séparateurs, même police', () => {
    const svg = buildSvg([], [{ cx: 100, cy: 100, color: '#334155', label: '3 · 4' }])
    expect(svg).toContain('>3 · 4<')
    expect(svg).toContain(`font-family="${FONT_FAMILY}"`)
  })
})

describe('cr-map-snapshot — le PNG réellement rendu affiche le chiffre (pas seulement le SVG source)', () => {
  it('marqueur simple : des pixels blancs sont visibles dans le disque (le chiffre est peint)', () => {
    const svg = buildSvg([], [{ cx: 100, cy: 100, color: '#0284c7', label: '7' }])
    const rendered = renderMapPixelsForTest(svg)
    expect(countNearWhitePixels(rendered, 100, 100)).toBeGreaterThan(5)
  })

  it('marqueur groupé : des pixels blancs sont visibles dans la pastille (le label est peint)', () => {
    const svg = buildSvg([], [{ cx: 300, cy: 100, color: '#334155', label: '3 · 4' }])
    const rendered = renderMapPixelsForTest(svg)
    expect(countNearWhitePixels(rendered, 300, 100)).toBeGreaterThan(5)
  })

  it('renderMapPng (chemin de production) produit un PNG non vide', () => {
    const svg = buildSvg([], [{ cx: 100, cy: 100, color: '#0284c7', label: '9' }])
    const png = renderMapPng(svg)
    expect(png.length).toBeGreaterThan(0)
    // Signature PNG (89 50 4E 47 0D 0A 1A 0A).
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  })
})

describe('cr-map-snapshot — isCrMapSnapshotFresh() invalide par version du moteur, pas seulement par fond', () => {
  it('même fond, version courante : réutilisable', () => {
    expect(isCrMapSnapshotFresh({ path: 'x.png', baseLayer: 'plan', renderVersion: CURRENT_CR_MAP_RENDER_VERSION }, 'plan')).toBe(true)
  })

  it('même fond, version absente (NULL — cas réel du snapshot DIMENC-Sireis pré-ddcccbfb) : régénéré malgré un fond inchangé', () => {
    expect(isCrMapSnapshotFresh({ path: 'x.png', baseLayer: 'plan', renderVersion: null }, 'plan')).toBe(false)
  })

  it('même fond, version antérieure à la version courante : régénéré', () => {
    expect(isCrMapSnapshotFresh({ path: 'x.png', baseLayer: 'plan', renderVersion: CURRENT_CR_MAP_RENDER_VERSION - 1 }, 'plan')).toBe(false)
  })

  it('fond différent, même si version courante : régénéré (comportement existant préservé)', () => {
    expect(isCrMapSnapshotFresh({ path: 'x.png', baseLayer: 'plan', renderVersion: CURRENT_CR_MAP_RENDER_VERSION }, 'satellite')).toBe(false)
  })

  it('aucun instantané stocké : régénéré', () => {
    expect(isCrMapSnapshotFresh({ path: null, baseLayer: null, renderVersion: null }, 'plan')).toBe(false)
  })
})

describe('cr-map-snapshot — reproduction du bug (sans police embarquée, le chiffre disparaît silencieusement)', () => {
  it('sans fontFiles, Resvg rend le marqueur mais AUCUN pixel blanc du chiffre (bug de production reproduit)', () => {
    const svg = buildSvg([], [{ cx: 100, cy: 100, color: '#0284c7', label: '7' }])
    // Même appel que `renderMapPixelsForTest`, mais SANS la police embarquée —
    // simule l'environnement de production avant correctif (0 police système,
    // `loadSystemFonts` ne trouve donc rien). Si ce test échoue (des pixels
    // blancs apparaissent quand même), c'est que Resvg a changé de
    // comportement et que ce test ne prouve plus rien — à réexaminer.
    const rendered = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: [] } }).render()
    const count = countNearWhitePixels({ pixels: rendered.pixels, width: rendered.width, height: rendered.height }, 100, 100)
    expect(count).toBe(0)
  })
})
