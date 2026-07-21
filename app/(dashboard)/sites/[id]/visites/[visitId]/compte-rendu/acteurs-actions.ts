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
