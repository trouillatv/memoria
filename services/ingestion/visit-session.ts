// Session de visite — la brique TRANSVERSE (mig 184).
//
// « Un sous-traitant envoie des médias pendant deux jours : une visite ou deux ? »
// Une session = la fenêtre temporelle d'UNE visite. Politique DÉTERMINISTE, sans
// IA : on parcourt les captures triées par instant réel et on OUVRE une nouvelle
// session dès qu'un GRAND écart apparaît (ou qu'on change de jour). Un lot de 2
// jours devient ainsi 2 visites — proposées, jamais imposées (l'écran de
// reconstruction laisse « tout regrouper »). La même brique servira au direct
// (auto-clôture par inactivité) et à WhatsApp Business. Cf. docs/ingestion-engine.md.

/**
 * GAP_MAX — au-delà de cet écart entre deux captures, on considère qu'une NOUVELLE
 * visite commence. 4 h : sépare les journées de travail sans couper une pause
 * déjeuner (2 h serait trop agressif). Le franchissement d'un jour calendaire
 * découpe aussi (cf. `splitByGap`). Valeur produit — ajustable par organisation.
 */
export const SESSION_GAP_MAX_MS = 4 * 60 * 60 * 1000

/**
 * Découpe une suite d'instants (déjà TRIÉS croissants, en ms) en groupes = sessions.
 * Nouveau groupe si l'écart avec le précédent dépasse `gapMaxMs` OU si on change de
 * jour calendaire (UTC). Retourne, pour chaque index d'entrée, l'index de session.
 *
 * Fonction PURE (testable sans base) : c'est le cœur de la reconstruction.
 */
export function splitByGap(
  sortedMs: Array<number | null>,
  gapMaxMs = SESSION_GAP_MAX_MS,
): number[] {
  const groups: number[] = []
  let session = 0
  let prev: number | null = null
  for (const ms of sortedMs) {
    if (prev !== null && ms !== null) {
      const gap = ms - prev
      if (gap > gapMaxMs || !sameUtcDay(prev, ms)) session += 1
    }
    groups.push(session)
    // Un instant NULL (horodatage inconnu) n'ouvre pas de coupure : il colle à la
    // session courante plutôt que d'en inventer une.
    if (ms !== null) prev = ms
  }
  return groups
}

function sameUtcDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  )
}
