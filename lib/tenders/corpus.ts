// LE TEXTE DU DOSSIER — source unique.
//
// « Une visite, une source de vérité » vaut aussi pour l'appel d'offres : il ne
// doit exister QU'UNE façon de lire un AO, et elle lit TOUTES ses pièces.
//
// Avant, chaque consommateur (atelier IA, agents, audit, rapprochements,
// embeddings) faisait son propre `getTenderDocument()` → `.limit(1)`. Tant qu'un
// AO n'avait qu'un document, ça passait. Depuis qu'il en a plusieurs, ça devient
// faux et sournois : `getTenderDocument` rend la DERNIÈRE pièce déposée, donc
// ajouter une annexe à un dossier faisait perdre le CCTP à tous ces agents.
//
// Toute nouvelle lecture d'un AO passe par ici. Jamais par une requête maison.

import { createAdminClient } from '@/lib/supabase/admin'
import { buildTenderCorpus, TENDER_CORPUS_BUDGET, type TenderPiece } from './pieces'

/**
 * Toutes les pièces LUES d'un dossier, dans l'ordre de dépôt.
 * Les pièces sans texte extrait (scan illisible) sont absentes : elles n'ont
 * nourri aucune analyse, et il ne faut pas laisser croire le contraire.
 */
export async function listTenderPieces(tenderId: string): Promise<TenderPiece[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('tender_documents')
    .select('kind, filename, extracted_text')
    .eq('tender_id', tenderId)
    .order('uploaded_at', { ascending: true })

  return (data ?? [])
    .map((d) => ({
      kind: (d as { kind: TenderPiece['kind'] }).kind,
      filename: (d as { filename: string }).filename,
      text: ((d as { extracted_text: string | null }).extracted_text ?? '').trim(),
    }))
    .filter((p) => p.text.length > 0)
}

/**
 * Le texte du dossier, prêt à être soumis à un agent : chaque pièce annoncée par
 * sa nature, chacune avec sa part du budget de lecture.
 *
 * Rend `''` si aucune pièce n'est lisible — un appelant qui reçoit `''` doit le
 * dire à l'utilisateur, pas inventer une réponse.
 */
export async function getTenderCorpus(
  tenderId: string,
  budget: number = TENDER_CORPUS_BUDGET,
): Promise<string> {
  return buildTenderCorpus(await listTenderPieces(tenderId), budget)
}
