import { describe, it, expect } from 'vitest'
import {
  isPhotographicImage,
  shouldKeepEmbeddedImage,
  MIN_PHOTO_SHORT_SIDE_PX,
  MIN_PHOTO_AREA_PX,
} from '@/services/pdf/photo-filter'

// Page A4 portrait en points PDF (595×842) → surface de référence pour la couverture.
const PAGE_AREA = 595 * 842

// Fabrique une bbox d'affichage à partir d'un pourcentage de couverture de la page.
const coverageBbox = (pct: number) => (PAGE_AREA * pct) / 100

describe('photo-filter — frontières du filtre d’image embarquée', () => {
  // 1. Grande photo, très faible couverture (vignette de planche photo BELLA) → ACCEPT.
  it('garde une vraie photo même à faible couverture (mosaïque)', () => {
    expect(isPhotographicImage(640, 850)).toBe(true)
    expect(
      shouldKeepEmbeddedImage({
        nativeWidth: 640,
        nativeHeight: 850,
        bboxArea: coverageBbox(3), // 3 % de la page, comme les photos BELLA
        pageArea: PAGE_AREA,
      }),
    ).toBe(true)
  })

  // 2. Grande photo, couverture normale (photo pleine largeur) → ACCEPT.
  it('garde une grande photo à couverture normale', () => {
    expect(
      shouldKeepEmbeddedImage({
        nativeWidth: 1200,
        nativeHeight: 1600,
        bboxArea: coverageBbox(25),
        pageArea: PAGE_AREA,
      }),
    ).toBe(true)
  })

  // 3. Petit logo carré (154×154, cas BELLA page 1) → REJECT.
  it('rejette un petit logo carré', () => {
    expect(isPhotographicImage(154, 154)).toBe(false)
    expect(
      shouldKeepEmbeddedImage({
        nativeWidth: 154,
        nativeHeight: 154,
        bboxArea: coverageBbox(0.1),
        pageArea: PAGE_AREA,
      }),
    ).toBe(false)
  })

  // 4. Bandeau large et court (337×153, cas BELLA page 2) → REJECT.
  it('rejette un bandeau large et court', () => {
    expect(isPhotographicImage(337, 153)).toBe(false)
    expect(
      shouldKeepEmbeddedImage({
        nativeWidth: 337,
        nativeHeight: 153,
        bboxArea: coverageBbox(0.8),
        pageArea: PAGE_AREA,
      }),
    ).toBe(false)
  })

  // 5. Petit élément décoratif (icône) → REJECT.
  it('rejette un petit élément décoratif', () => {
    expect(isPhotographicImage(96, 96)).toBe(false)
    expect(
      shouldKeepEmbeddedImage({
        nativeWidth: 96,
        nativeHeight: 96,
        bboxArea: coverageBbox(0.3),
        pageArea: PAGE_AREA,
      }),
    ).toBe(false)
  })

  // 6. Non-régression : grande image existante (photo/figure pleine page) → ACCEPT.
  it('garde une grande image existante (non-régression)', () => {
    expect(
      shouldKeepEmbeddedImage({
        nativeWidth: 1500,
        nativeHeight: 2000,
        bboxArea: coverageBbox(60),
        pageArea: PAGE_AREA,
      }),
    ).toBe(true)
  })

  // Branche figure/scan pleine page : image basse définition mais couvrant la page → ACCEPT.
  it('garde un scan basse définition couvrant la page (branche couverture)', () => {
    expect(isPhotographicImage(200, 280)).toBe(false) // pas photographique par résolution
    expect(
      shouldKeepEmbeddedImage({
        nativeWidth: 200,
        nativeHeight: 280,
        bboxArea: coverageBbox(90), // mais couvre 90 % de la page
        pageArea: PAGE_AREA,
      }),
    ).toBe(true)
  })

  // Garde-fou : entrées dégénérées jamais gardées.
  it('rejette les dimensions dégénérées', () => {
    expect(isPhotographicImage(0, 0)).toBe(false)
    expect(isPhotographicImage(Number.NaN, 900)).toBe(false)
    expect(isPhotographicImage(-10, -10)).toBe(false)
  })

  it('expose des seuils cohérents avec la séparation observée', () => {
    // Les seuils restent dans l'écart corpus (asset ≤154 px / ≤0,05 Mpx ;
    // photo ≥630 px / ≥0,53 Mpx). Garde de non-régression sur le calibrage.
    expect(MIN_PHOTO_SHORT_SIDE_PX).toBeGreaterThan(154)
    expect(MIN_PHOTO_SHORT_SIDE_PX).toBeLessThan(630)
    expect(MIN_PHOTO_AREA_PX).toBeGreaterThan(154 * 154)
    expect(MIN_PHOTO_AREA_PX).toBeLessThan(630 * 840)
  })
})
