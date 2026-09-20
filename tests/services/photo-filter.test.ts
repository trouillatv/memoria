import { describe, it, expect } from 'vitest'
import {
  isPhotographicImage,
  shouldKeepEmbeddedImage,
  classifyEmbeddedImageGeometry,
  shouldRetainAsVisitPhoto,
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

  // 3. Petit logo carré (154×154, cas BELLA page 1) → géométrie 'strong'/'candidate' selon
  // le seuil, mais jamais retenu comme photo finale (voir bloc contrat de rétention plus bas).
  it('rejette un petit logo carré au niveau géométrique isPhotographicImage/shouldKeepEmbeddedImage', () => {
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

  // 4. Bandeau large et court (337×153, cas BELLA page 2).
  it('rejette un bandeau large et court au niveau géométrique isPhotographicImage/shouldKeepEmbeddedImage', () => {
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

  // 5. Petit élément décoratif (icône) → géométriquement pas photographique.
  it('rejette un petit élément décoratif au niveau géométrique isPhotographicImage/shouldKeepEmbeddedImage', () => {
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

describe('classifyEmbeddedImageGeometry — tri de plausibilité (doctrine 2 niveaux, GO Vincent)', () => {
  it('classe en reject un bloc sous le plancher natif (bruit/dégénéré)', () => {
    expect(
      classifyEmbeddedImageGeometry({ nativeWidth: 71, nativeHeight: 64, bboxArea: coverageBbox(0.1), pageArea: PAGE_AREA }),
    ).toBe('reject')
    // Logo CAPSE PV4 : 71×64 px.
    expect(
      classifyEmbeddedImageGeometry({ nativeWidth: 79, nativeHeight: 79, bboxArea: coverageBbox(0.1), pageArea: PAGE_AREA }),
    ).toBe('reject')
  })

  it('classe en strong un bloc satisfaisant la doctrine historique (photo ou figure pleine page)', () => {
    expect(
      classifyEmbeddedImageGeometry({ nativeWidth: 1200, nativeHeight: 1600, bboxArea: coverageBbox(25), pageArea: PAGE_AREA }),
    ).toBe('strong')
  })

  it('classe en candidate les blocs intermédiaires/compressés type photos PV4 (90×128 à 298×201)', () => {
    expect(
      classifyEmbeddedImageGeometry({ nativeWidth: 90, nativeHeight: 128, bboxArea: coverageBbox(1), pageArea: PAGE_AREA }),
    ).toBe('candidate')
    expect(
      classifyEmbeddedImageGeometry({ nativeWidth: 298, nativeHeight: 201, bboxArea: coverageBbox(2), pageArea: PAGE_AREA }),
    ).toBe('candidate')
    // Anciens assets non photographiques (logo 154×154, bandeau 337×153, icône 96×96) :
    // au-dessus du plancher natif de 80 px → 'candidate', jamais 'reject' ni 'strong'.
    // C'est Vision qui les élimine, pas la géométrie seule (preuve d'audit : la surface
    // native d'un bandeau décoratif peut dépasser celle d'une vraie photo PV4).
    expect(
      classifyEmbeddedImageGeometry({ nativeWidth: 154, nativeHeight: 154, bboxArea: coverageBbox(0.1), pageArea: PAGE_AREA }),
    ).toBe('candidate')
    expect(
      classifyEmbeddedImageGeometry({ nativeWidth: 337, nativeHeight: 153, bboxArea: coverageBbox(0.8), pageArea: PAGE_AREA }),
    ).toBe('candidate')
    expect(
      classifyEmbeddedImageGeometry({ nativeWidth: 96, nativeHeight: 96, bboxArea: coverageBbox(0.3), pageArea: PAGE_AREA }),
    ).toBe('candidate')
  })
})

describe('shouldRetainAsVisitPhoto — contrat final « jamais présent comme photo finale » (GO Vincent)', () => {
  const LOW_COVERAGE = 0.001

  it('logo 154×154 : candidate + decorative Vision → jamais photo finale', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'candidate', imageClass: 'decorative', bboxCoverage: LOW_COVERAGE }),
    ).toBe(false)
  })

  it('bannière 337×153 : candidate + decorative Vision → jamais photo finale', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'candidate', imageClass: 'decorative', bboxCoverage: LOW_COVERAGE }),
    ).toBe(false)
  })

  it('icône 96×96 : candidate + decorative Vision → jamais photo finale', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'candidate', imageClass: 'decorative', bboxCoverage: LOW_COVERAGE }),
    ).toBe(false)
  })

  it('logo PV4 71×64 : rejet déterministe avant Vision (geometryTier reject)', () => {
    expect(
      classifyEmbeddedImageGeometry({ nativeWidth: 71, nativeHeight: 64, bboxArea: coverageBbox(0.05), pageArea: PAGE_AREA }),
    ).toBe('reject')
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'reject', imageClass: 'evidence', bboxCoverage: LOW_COVERAGE }),
    ).toBe(false)
  })

  it('photo compressée 90×128 + Vision evidence (non-decorative) → conservée', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'candidate', imageClass: 'evidence', bboxCoverage: 0.01 }),
    ).toBe(true)
  })

  it('photo compressée ~298×201 + Vision evidence (non-decorative) → conservée', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'candidate', imageClass: 'evidence', bboxCoverage: 0.02 }),
    ).toBe(true)
  })

  it('petit bloc ambigu + Vision decorative → rejeté', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'candidate', imageClass: 'decorative', bboxCoverage: 0.01 }),
    ).toBe(false)
  })

  it('petit bloc ambigu + Vision uncertain/échec → non affiché automatiquement (fail-closed)', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'candidate', imageClass: 'uncertain', bboxCoverage: 0.01 }),
    ).toBe(false)
  })

  it('grande vraie photo (strong) + Vision indisponible/incertaine → ne régresse pas (fail-open)', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'strong', imageClass: 'uncertain', bboxCoverage: 0.03 }),
    ).toBe(true)
  })

  it('grande vraie photo (strong) + Vision decorative sur forte couverture → conservée (garde-fou faux positif)', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'strong', imageClass: 'decorative', bboxCoverage: 0.2 }),
    ).toBe(true)
  })

  it('grande vraie photo (strong) + Vision decorative sur faible couverture → rejetée', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'strong', imageClass: 'decorative', bboxCoverage: 0.01 }),
    ).toBe(false)
  })

  it('document_context (plan/schéma) sur un bloc candidate → conservé (pas une photo décorative)', () => {
    expect(
      shouldRetainAsVisitPhoto({ geometryTier: 'candidate', imageClass: 'document_context', bboxCoverage: 0.01 }),
    ).toBe(true)
  })
})
