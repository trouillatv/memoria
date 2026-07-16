import 'server-only'

// ── INVALIDATION DE LA PROJECTION ────────────────────────────────────────────
// Règle d'architecture (doctrine) : c'est la MUTATION qui invalide, jamais l'écran.
//   createSiteAction() / updateSiteAction() / promoteProposal() / dismissProposal()
//   / projectDebriefToProposals()  →  invalidateSiteProjection(siteId)
// Ainsi, quel que soit l'appelant (server action, route API, import, batch), la
// projection est toujours invalidée — personne ne peut « oublier » de le faire
// depuis un écran. Module SANS dépendance (hors next/cache) pour éviter tout cycle
// avec la couche projection et la couche d'écriture.

import { revalidateTag, revalidatePath } from 'next/cache'

export function siteProjectionTag(siteId: string): string {
  return `site-projection:${siteId}`
}

/**
 * Fait tomber la projection d'un chantier (cache de données) et revalide les routes
 * qui la lisent — mobile ET tableau de bord. « Invalider → tous les écrans changent ».
 *
 * DÉFENSIF : hors contexte de requête (script de seed, cron, batch), les API de
 * revalidation lèvent — on les avale pour ne JAMAIS casser la mutation appelante.
 */
export function invalidateSiteProjection(siteId: string): void {
  if (!siteId) return
  // Next 16 exige un profil de cache : 'max' fait tomber l'entrée quelle que soit sa durée.
  try { revalidateTag(siteProjectionTag(siteId), 'max') } catch { /* hors requête */ }
  for (const path of ['/m', '/m/actions', '/m/planning', `/m/site/${siteId}`, '/dashboard', `/sites/${siteId}`, `/sites/${siteId}/actions`]) {
    try { revalidatePath(path) } catch { /* hors requête */ }
  }
}
