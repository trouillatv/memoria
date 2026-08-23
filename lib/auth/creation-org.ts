// -- QUELLE ORGANISATION POSSÈDE LA DONNÉE QU'ON CRÉE ? ----------------------
//
// Un chantier appartient à UNE organisation ; un utilisateur peut appartenir à
// plusieurs. `users.organization_id` n'est qu'une organisation PAR DÉFAUT
// héritée du monde mono-entreprise (cf. lib/db/users.ts) : s'en servir pour
// désigner le propriétaire d'une donnée neuve rattache silencieusement un
// chantier Becib à AGP — sans erreur, sans trace, invisible jusqu'à l'audit.
//
// Ce helper est le SEUL endroit qui décide. Trois situations, pas quatre :
//
//   0 appartenance active  → refus ('none')
//   1 appartenance         → automatique, aucun choix demandé à l'humain
//   plusieurs              → l'organisation doit être FOURNIE et validée
//
// Deux interdits qui sont la raison d'être du fichier :
//   · jamais de repli sur `users.organization_id` ;
//   · jamais `orgIds[0]` quand il y en a plusieurs — « la première » n'est pas
//     une réponse, c'est un tirage au sort sur la propriété d'une donnée.
//
// ⚠️ Ce helper ne REMPLACE pas le garde de `createSite()`
// (`requireOrganizationMembership`). Il le précède : ici on choisit, là on
// vérifie. Les deux restent — défense en profondeur.

import { getOrgIdsOfUser } from '@/lib/auth/memberships'

export type CreationOrgRefusal = 'none' | 'ambiguous' | 'forbidden'

export type CreationOrgResult =
  | { ok: true; organizationId: string }
  | { ok: false; reason: CreationOrgRefusal; error: string }

/** Aucune organisation active : le compte ne peut rien créer nulle part. */
export const AUCUNE_ORGANISATION = 'Aucune organisation active' as const

/**
 * Refus UNIFORME pour « pas choisie » et « pas la vôtre ».
 *
 * Deux messages distincts laisseraient énumérer les organisations d'un tiers en
 * observant laquelle répond différemment — même raison que `ACCES_REFUSE` dans
 * `lib/auth/memberships`. Le `reason` distingue pour les tests et les logs ; le
 * texte rendu à l'humain, non.
 */
export const ORGANISATION_REQUISE = 'Sélectionnez une organisation' as const

/**
 * L'organisation propriétaire d'une donnée qu'on s'apprête à créer.
 *
 * `requested` — l'organisation choisie par l'humain dans le formulaire. On ne
 * fait AUCUNE confiance à cette valeur : elle n'est retenue que si elle figure
 * dans les appartenances actives relues en base. Fournie et invalide → refus,
 * même en mono-organisation : une valeur qu'on ignore silencieusement est une
 * valeur qu'on finira par croire.
 */
export async function resolveCreationOrgId(
  requested?: string | null,
): Promise<CreationOrgResult> {
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) {
    return { ok: false, reason: 'none', error: AUCUNE_ORGANISATION }
  }

  if (requested) {
    if (!orgIds.includes(requested)) {
      return { ok: false, reason: 'forbidden', error: ORGANISATION_REQUISE }
    }
    return { ok: true, organizationId: requested }
  }

  if (orgIds.length === 1) return { ok: true, organizationId: orgIds[0] }

  return { ok: false, reason: 'ambiguous', error: ORGANISATION_REQUISE }
}
