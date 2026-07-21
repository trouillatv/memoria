'use server'

// LES ENTREPRISES DÉJÀ CONNUES — de quoi rattacher une personne sans la retaper.
//
// « Yann » ne dit pas chez qui il travaille. Pour l'y rattacher, il faut lui
// proposer les entreprises que l'organisation connaît DÉJÀ — sinon chaque
// validation en invente une nouvelle avec une orthographe légèrement
// différente, et « AGP », « A.G.P. » et « Agp » finissent par désigner trois
// sociétés pour la même. Une liste qui aide, jamais qui enferme : le champ
// reste libre, parce qu'aucune liste ne couvre un chantier qui commence.
//
// Le champ reste libre pour une autre raison, de fond : refuser un nom absent
// de la liste obligerait à créer la fiche entreprise AVANT de pouvoir arbitrer.
// On ne fait pas payer à l'arbitrage le prix d'un référentiel incomplet.

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listCompanies } from '@/lib/db/companies'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActeurConnu } from '@/lib/acteurs/resolution-identite'

/**
 * Les noms d'entreprises de l'organisation de l'utilisateur.
 *
 * Isolation tenant : le service-role passe outre la RLS, le filtre est ICI —
 * on lit l'organisation de la SESSION, jamais un identifiant reçu du client.
 * Sans organisation, on ne devine pas : liste vide.
 */
export async function listOrgCompanyNamesAction(): Promise<string[]> {
  const user = await getCurrentUserWithProfile()
  if (!user?.organization_id) return []
  try {
    const companies = await listCompanies(user.organization_id)
    return companies.map((c) => c.name).filter((n): n is string => Boolean(n?.trim()))
  } catch {
    // Une liste indisponible ne doit jamais empêcher d'arbitrer : le champ
    // libre suffit à travailler.
    return []
  }
}

// ── LES PERSONNES DÉJÀ CONNUES — pour ne pas créer la même deux fois ────────
//
// « Yann », « Y. Martin » et « Yann Martin » créent aujourd'hui trois contacts :
// `findOrCreateCompanyContact` ne rapproche que par égalité EXACTE du nom.
// Chaque visite ajoute donc une variante, et la mémoire se fragmente d'autant
// plus vite que le produit sert.
//
// On ne répare pas après coup — fusionner deux contacts est destructif. On
// évite la deuxième variante : l'écran propose celle qui existe déjà au moment
// où l'on s'apprête à saisir la nouvelle.
//
// Le RAPPROCHEMENT lui-même n'est pas ici : il vit dans un module pur et testé
// (`lib/acteurs/resolution-identite`), et tourne côté écran. Cette action ne
// fait que servir la matière — un aller-retour, pas un par acteur.

/**
 * Les personnes connues de l'organisation, avec leur entreprise.
 *
 * Isolation tenant : l'organisation vient de la SESSION, jamais du client.
 * Plafond volontaire — au-delà, ce n'est plus une aide à la saisie mais un
 * export, et il faudrait une vraie recherche serveur.
 */
export async function listActeursConnusAction(): Promise<ActeurConnu[]> {
  const user = await getCurrentUserWithProfile()
  if (!user?.organization_id) return []
  try {
    const { data, error } = await createAdminClient()
      .from('company_contacts')
      .select('id, full_name, companies(name)')
      .eq('organization_id', user.organization_id)
      .is('deleted_at', null)
      .order('full_name', { ascending: true })
      .limit(500)
    if (error || !data) return []
    type Jointure = { id: string; full_name: string | null; companies: unknown }
    // La jointure to-one revient tantôt en objet, tantôt en tableau selon la
    // version des types générés. On accepte les deux plutôt que de parier :
    // se tromper ici ferait perdre l'entreprise EN SILENCE, et le rapprochement
    // ne pencherait plus jamais du bon côté.
    const nomEntreprise = (v: unknown): string | null => {
      const cible = Array.isArray(v) ? v[0] : v
      const nom = (cible as { name?: string | null } | null | undefined)?.name
      return nom?.trim() || null
    }
    return (data as unknown as Jointure[])
      .filter((r) => Boolean(r.full_name?.trim()))
      .map((r) => ({
        id: r.id,
        nom: r.full_name!.trim(),
        entreprise: nomEntreprise(r.companies),
      }))
  } catch {
    // Une liste indisponible ne doit jamais empêcher d'arbitrer.
    return []
  }
}
