// Décision « garder ou rejeter » d'une image embarquée d'un PDF historique.
//
// Module pur, sans dépendance mupdf ni `server-only` : la logique de décision est
// isolée ici pour être testable indépendamment du décodage PDF (voir
// `extract-images.ts` qui la consomme dans `onImageBlock`).
//
// Problème résolu : le filtre historique reposait sur la *couverture de la page*
// (bbox ≥ 5 % de la page). Or une planche photo (mosaïque de vignettes) contient de
// vraies photos de 630×840 à 1200×1600 px natifs qui ne couvrent chacune que
// 1,7–3,2 % de la page — elles étaient donc toutes rejetées. La couverture mesure la
// *taille d'affichage*, pas la nature de l'image.
//
// Règle retenue : une image est conservée si elle est **photographique par sa
// résolution native** OU si elle **occupe une part substantielle de la page**
// (figure/scan pleine page). Un logo, un bandeau ou une icône ne satisfait ni l'un
// ni l'autre (petit en pixels ET petit sur la page).

// --- Seuils « photographique par résolution native » ---------------------------
//
// Ancrés sur la séparation observée dans le corpus PV historique entre objets
// graphiques et photographies (ex. BELLA CR26-U103) :
//   - assets non photographiques : logo 154×154 (0,024 Mpx), bandeau 337×153
//     (0,052 Mpx) → côté court ≤ 154 px, surface ≤ 0,05 Mpx ;
//   - photographies réelles : de 630×840 (0,53 Mpx) à 1200×1600 (1,9 Mpx)
//     → côté court ≥ 630 px, surface ≥ 0,53 Mpx.
// Les deux populations sont séparées par un facteur ~4× (côté court) et ~10×
// (surface). Les seuils ci-dessous se placent dans cet écart, avec marge, et
// expriment une intention — ce ne sont pas des valeurs calées sur un seul document.

// Côté court minimal : une photo n'est ni une icône ni une bande fine. 200 px se
// place juste au-dessus du plus grand asset non photographique observé (154 px)
// et très en dessous du plus petit cliché réel (630 px).
export const MIN_PHOTO_SHORT_SIDE_PX = 200

// Surface native minimale (~0,1 Mpx) : une vraie capture porte beaucoup de pixels.
// 100 000 px² se situe entre le plus gros asset (0,05 Mpx) et la plus petite photo
// (0,53 Mpx), sans être calé sur l'un des deux.
export const MIN_PHOTO_AREA_PX = 100_000

// --- Seuils « figure/scan pleine page » (branche de non-régression) ------------
//
// Reprend le comportement historique : une image qui couvre une part substantielle
// de la page est conservée même si sa résolution native est modeste (scan pleine
// page basse définition). Un garde-fou de dimension native évite d'accepter un
// aplat décoratif minuscule étiré à toute la page.
export const MIN_PAGE_COVERAGE = 0.05 // 5 % de la page
export const MIN_NATIVE_PX = 80

/**
 * Vrai si l'image a la résolution native d'une photographie, indépendamment de sa
 * taille d'affichage dans la page (donc valable pour une vignette de mosaïque).
 */
export function isPhotographicImage(nativeWidth: number, nativeHeight: number): boolean {
  if (!Number.isFinite(nativeWidth) || !Number.isFinite(nativeHeight)) return false
  if (nativeWidth <= 0 || nativeHeight <= 0) return false
  const shortSide = Math.min(nativeWidth, nativeHeight)
  const area = nativeWidth * nativeHeight
  return shortSide >= MIN_PHOTO_SHORT_SIDE_PX && area >= MIN_PHOTO_AREA_PX
}

export interface EmbeddedImageMetrics {
  nativeWidth: number
  nativeHeight: number
  bboxArea: number // surface de la bbox d'affichage (points² PDF)
  pageArea: number // surface de la page (points² PDF)
}

/**
 * Décision finale : conserver l'image extraite d'un PDF historique ?
 * Conservée si photographique par résolution OU figure/scan couvrant la page.
 */
export function shouldKeepEmbeddedImage(m: EmbeddedImageMetrics): boolean {
  if (isPhotographicImage(m.nativeWidth, m.nativeHeight)) return true

  // Branche figure/scan pleine page : couverture substantielle + garde-fou natif.
  const coverage = m.pageArea > 0 ? m.bboxArea / m.pageArea : 0
  return (
    coverage >= MIN_PAGE_COVERAGE &&
    m.nativeWidth >= MIN_NATIVE_PX &&
    m.nativeHeight >= MIN_NATIVE_PX
  )
}

// --- Classification géométrique en 2 niveaux (P0 PV4 Photos) --------------------
//
// Preuve d'audit (PV4, PDF "Mail-Galerie") : une image photographique réelle et un
// élément décoratif peuvent avoir des dimensions natives du même ordre de grandeur
// (photo réelle 298×201 px = 59 898 px² > bandeau décoratif déjà verrouillé en test
// 337×153 px = 51 561 px²). Aucun seuil de taille absolue ne peut séparer les deux
// populations de façon générique — la géométrie ne peut donc plus, seule, trancher
// pour les blocs de taille intermédiaire.
//
// Doctrine retenue : la géométrie ne fait qu'un tri de plausibilité minimale ; c'est
// la classification sémantique Vision (`is_decorative`, voir extract-historical-pv.ts)
// qui arbitre les blocs ambigus. En cas d'échec ou d'incertitude Vision sur un bloc
// ambigu, le comportement est fail-closed (jamais affiché comme photo de visite) —
// pour ne jamais transformer un logo/bandeau en photo par défaut.
export type EmbeddedImageGeometryTier = 'reject' | 'candidate' | 'strong'

/**
 * Classe géométrique d'un bloc image, AVANT toute analyse sémantique.
 * - 'reject'    : bruit/dégénéré (icône minuscule, puce, séparateur) — jamais extrait.
 * - 'candidate' : taille plausible mais insuffisante pour trancher seule — nécessite
 *   la confirmation Vision avant d'être retenu comme photo de visite.
 * - 'strong'    : doctrine historique (photographique par résolution native, ou
 *   figure/scan couvrant substantiellement la page) — retenu même si Vision est
 *   indisponible ou incertain, pour ne jamais régresser sur le comportement existant.
 */
export function classifyEmbeddedImageGeometry(m: EmbeddedImageMetrics): EmbeddedImageGeometryTier {
  if (shouldKeepEmbeddedImage(m)) return 'strong'
  if (m.nativeWidth >= MIN_NATIVE_PX && m.nativeHeight >= MIN_NATIVE_PX) return 'candidate'
  return 'reject'
}

// --- Contrat final de rétention (P0 PV4 Photos) ---------------------------------
//
// Classification sémantique Vision, telle que produite par `classifyImage()` dans
// extract-historical-pv.ts (dupliquée ici comme union de littéraux pour rester un
// module pur, sans dépendance vers l'orchestrateur).
export type ImageSemanticClass = 'decorative' | 'document_context' | 'evidence' | 'uncertain'

// Couverture de page au-delà de laquelle un `decorative=true` Vision n'est pas retenu
// comme disqualifiant sur un bloc 'strong' — garde-fou contre un faux positif Vision
// sur une grande photo réelle qui couvre substantiellement la page. Ne s'applique pas
// aux blocs 'candidate' : pour une taille intermédiaire/ambiguë, Vision arbitre seule.
export const DECORATIVE_MAX_COVERAGE_STRONG = 0.15

export interface EmbeddedImageRetentionInput {
  geometryTier: EmbeddedImageGeometryTier
  imageClass: ImageSemanticClass
  bboxCoverage: number // fraction 0..1 de la page couverte par la bbox d'affichage
}

/**
 * Contrat global : ce bloc doit-il apparaître comme photo finale de la visite ?
 * Ne dépend jamais du seul document/nom de fichier — uniquement de la géométrie et
 * de l'arbitrage sémantique Vision. Doctrine (GO Vincent) :
 * - 'reject'    : jamais (bruit/dégénéré, déjà éliminé avant extraction).
 * - 'candidate' : Vision arbitre seule, fail-closed — 'evidence'/'document_context'
 *   conservés ; 'decorative' rejeté ; 'uncertain' (Vision indisponible/incertaine)
 *   jamais affiché par défaut.
 * - 'strong'    : doctrine historique — conservé sauf 'decorative' confirmé sur une
 *   couverture de page faible (< DECORATIVE_MAX_COVERAGE_STRONG) ; 'uncertain' reste
 *   conservé (fail-open, non-régression sur les grandes photos historiques).
 */
export function shouldRetainAsVisitPhoto(input: EmbeddedImageRetentionInput): boolean {
  const { geometryTier, imageClass, bboxCoverage } = input
  if (geometryTier === 'reject') return false
  if (geometryTier === 'candidate') {
    return imageClass === 'evidence' || imageClass === 'document_context'
  }
  // geometryTier === 'strong'
  if (imageClass === 'decorative' && bboxCoverage < DECORATIVE_MAX_COVERAGE_STRONG) return false
  return true
}
