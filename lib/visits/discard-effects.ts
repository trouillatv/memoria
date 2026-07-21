// G4 — ÉCARTER UNE CAPTURE DÉFAIT CE QU'ELLE A SUGGÉRÉ (Vincent, 2026-07-21).
//
// Guillaume écarte un vocal après coup ; les prénoms qu'il contenait restent
// proposés comme intervenants. Il a raison, et le défaut est générique : le
// produit laissait vivre des propositions nées d'une matière qu'on venait de
// retirer.
//
// TROIS NIVEAUX, ET ILS NE SE VALENT PAS :
//
//   Capture            → réversible, c'est de la matière
//   Proposition IA     → réversible, c'est une lecture de cette matière
//   Objet du chantier  → définitif jusqu'à un geste humain
//
// Écarter une capture agit sur les deux premiers. JAMAIS sur le troisième :
// une action créée appartient au chantier, pas à la visite qui l'a suggérée.
// La supprimer parce qu'on écarte un vocal serait défaire le travail de
// quelqu'un sans le lui demander.
//
// POURQUOI ON NE CIBLE PAS « LES PROPOSITIONS DE CETTE CAPTURE » : elles ne
// savent pas d'où elles viennent. `site_report_proposals` ne porte aucun lien
// vers une capture (mig 099), et l'analyse projetée lit le corpus ENTIER —
// attribuer une proposition à une capture précise serait une inférence, et le
// produit n'en fait pas.
//
// La bonne formulation est donc l'inverse, et elle est plus juste : les
// propositions sont une FONCTION du corpus. Le corpus change → celles qui
// n'ont pas été validées deviennent caduques, l'analyse est invalidée, et la
// prochaine ouverture recalcule depuis ce qui reste. Rien n'est deviné.

import { createAdminClient } from '@/lib/supabase/admin'

export interface DiscardEffect {
  /** Propositions non validées retirées. */
  removedProposals: number
  /** L'analyse a été invalidée : la prochaine ouverture recalcule. */
  analysisInvalidated: boolean
}

/**
 * Défait ce qu'une capture avait suggéré, après son exclusion.
 *
 * N'agit que sur les propositions au statut `proposed` : celles qui ont été
 * acceptées ont produit un objet du chantier, et cet objet reste.
 */
export async function undoSuggestionsAfterDiscard(reportId: string): Promise<DiscardEffect> {
  const db = createAdminClient()

  // 1. Les propositions NON validées tombent. `.eq('status','proposed')` est la
  //    garantie : une proposition acceptée a créé un objet, on n'y touche pas.
  const { data: removed } = await db
    .from('site_report_proposals')
    .delete()
    .eq('report_id', reportId)
    .eq('status', 'proposed')
    .select('id')

  // 2. L'analyse est invalidée. La laisser en cache reviendrait à continuer
  //    d'afficher ce que la capture retirée avait fait dire — c'est
  //    exactement l'irritant. La prochaine ouverture régénère depuis le
  //    corpus réduit ; si la capture est réintégrée, tout revient.
  //
  //    Le COMPTE-RENDU HUMAIN n'est pas touché : ses sections corrigées
  //    appartiennent au conducteur. Une régénération ne réécrit jamais un
  //    texte que quelqu'un a relu.
  const { error } = await db
    .from('site_reports')
    .update({ debrief_analysis: null, debrief_generating_at: null })
    .eq('id', reportId)

  return { removedProposals: (removed ?? []).length, analysisInvalidated: !error }
}
