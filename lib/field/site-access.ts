import 'server-only'

// ── LA GARDE D'ACCÈS À UN CHANTIER ───────────────────────────────────────────
// Découvert en ouvrant la Mémoire dans un navigateur : un conducteur de l'org
// démo affichait « Lycée PETRO ATTITI » — nom, statistiques, carte des captures —
// alors que ce chantier appartient à une AUTRE organisation. Les pages lisaient :
//
//   createAdminClient().from('sites').select(...).eq('id', siteId)
//
// Le client admin porte le service role : il BYPASSE la RLS. Sans filtre
// d'organisation dans le code, n'importe quel utilisateur authentifié ouvrait
// n'importe quel chantier en changeant l'UUID de l'URL. (Cf.
// [[isolation-tenants-fail-closed]].)
//
// Seul le panneau Mémoire était vide — parce qu'il filtrait par org. Il avait
// raison tout seul ; c'est la page qui était nue.
//
// POURQUOI PAS UN LAYOUT POUR LA SÉCURITÉ : un layout ne se réexécute pas à chaque
// navigation (Next.js déconseille explicitement d'y placer une autorisation). La
// garde vit donc dans CHAQUE page, et un test de doctrine vérifie qu'aucune n'y
// échappe. Le groupe `(chantier)` a bien un `layout.tsx`, mais il ne porte que le
// CHROME persistant (nom du chantier + pills) ; il appelle aussi cette garde, sans
// jamais la remplacer dans les pages.
//
// `cache()` déduplique l'appel dans un même rendu (layout + page = 1 seul contrôle)
// SANS cache durable : chaque requête réévalue l'autorisation.

import { cache } from 'react'
import { notFound } from 'next/navigation'
import { requireOwned } from '@/lib/auth/ownership'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export interface SiteAccess {
  siteId: string
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUserWithProfile>>>
}

/**
 * Autorise l'accès à un chantier, ou rend un 404.
 *
 * 404 et non 403 : dire « accès refusé » confirmerait l'EXISTENCE du chantier à
 * quelqu'un qui n'a pas à savoir qu'il existe. Un chantier d'une autre
 * organisation doit être indiscernable d'un chantier inexistant.
 *
 * Retourne l'utilisateur : les pages en ont besoin de toute façon, et ça évite
 * de le relire — la garde ne coûte donc presque rien à poser.
 */
export const requireSiteAccess = cache(async (siteId: string): Promise<SiteAccess> => {
  const user = await getCurrentUserWithProfile()
  if (!user) notFound()
  const owned = await requireOwned(user.role, 'sites', siteId)
  if (!owned.allowed) notFound()
  return { siteId, user }
})
