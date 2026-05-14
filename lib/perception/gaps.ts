// V5.1 Slice 3 — Vides verticaux proportionnels au temps écoulé entre events.
//
// Doctrine Vincent 2026-05-14 :
//   - Le silence est lisible. Un vide visuel proportionnel au gap temporel
//     fait sentir le rythme du lieu sans aucun chiffre.
//   - Limite max stricte 220px (sinon incompréhensible).
//   - Au-delà de 14 jours de gap + limite visuelle atteinte → micro-repère
//     qualitatif textuel (jamais chiffré).

const MIN_GAP_PX = 20
const MAX_GAP_PX = 220
const PX_PER_DAY = 8

/**
 * Calcule la hauteur de gap (en pixels) pour `daysBetween` jours sans event.
 * Bornée à [MIN_GAP_PX, MAX_GAP_PX].
 */
export function gapHeightPx(daysBetween: number): number {
  if (daysBetween <= 0) return MIN_GAP_PX
  return Math.min(MAX_GAP_PX, Math.max(MIN_GAP_PX, Math.floor(daysBetween * PX_PER_DAY)))
}

/**
 * Renvoie un libellé qualitatif pour un gap visible (≥ 14 jours), sinon null.
 *
 * Strictement qualitatif (pas de chiffre). Sert de micro-repère anti-ambiguïté
 * quand le seul vide ne dit pas assez. Cf. plan V5.1.2 § Slice 3.
 */
export function silenceLabel(daysBetween: number): string | null {
  if (daysBetween < 14) return null
  if (daysBetween < 30) return 'rien de notable depuis quelques semaines.'
  if (daysBetween < 90) return 'silence depuis plusieurs semaines.'
  return 'silence prolongé.'
}

/**
 * Indique si le gap mérite l'affichage d'un micro-repère textuel en plus
 * du gap visuel (au-delà du seuil 14j).
 */
export function shouldRenderSilenceMarker(daysBetween: number): boolean {
  return daysBetween >= 14
}
