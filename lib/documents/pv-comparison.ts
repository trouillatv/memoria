import 'server-only'

// Lot 2 — Moteur de comparaison inter-CR
//
// Calcule le delta déterministe entre deux runs d'extraction sur le même chantier.
// Entrée : deux runId dont les propositions ont déjà été réconciliées (subject_thread_id assigné).
//
// Règle fondamentale (Vincent) :
//   - "not_mentioned" / "non_mentionné" est un état CALCULÉ — jamais stocké.
//   - L'absence d'un sujet dans le PV suivant ne signifie pas "levé" :
//     seulement "non mentionné depuis N CR".
//   - Le moteur ne fait jamais d'inférence : il observe et classe.

const OBSERVATION_FAMILIES = new Set(['observation', 'reservation', 'non_conformity'])

type ProposalRow = {
  id: string
  subject_thread_id: string
  proposal_family: string
  thematic_category: string | null
  label: string
  document_status: string | null
}

export type DeltaTransition =
  | 'nouveau'       // sujet présent dans `to`, absent de `from`
  | 'non_mentionné' // sujet présent dans `from`, absent de `to`
  | 'maintenu'      // statut identique
  | 'réalisé'       // planned/in_progress → done (famille action/forecast)
  | 'levé'          // open/in_progress/non_compliant → done (réservation/observation)
  | 'réouvert'      // done → open/in_progress/non_compliant
  | 'aggravé'       // open/in_progress → non_compliant
  | 'progressé'     // planned → in_progress
  | 'annulé'        // any → cancelled
  | 'changé'        // toute autre transition de statut

export interface DeltaItem {
  subjectThreadId: string
  family: string
  thematicCategory: string | null
  label: string          // label du run `to` si présent, sinon `from`
  fromStatus: string | null
  toStatus: string | null
  transition: DeltaTransition
  fromProposalId: string | null
  toProposalId: string | null
}

export interface PvDelta {
  fromRunId: string
  toRunId: string
  items: DeltaItem[]
}

export function computeTransition(
  from: ProposalRow | null,
  to: ProposalRow | null,
): DeltaTransition {
  if (!from) return 'nouveau'
  if (!to) return 'non_mentionné'

  const fs = from.document_status
  const ts = to.document_status

  if (ts === 'cancelled') return 'annulé'

  if (ts === 'done' && fs !== 'done') {
    return OBSERVATION_FAMILIES.has(from.proposal_family) ? 'levé' : 'réalisé'
  }

  if (fs === 'done' && ts !== null && ts !== 'done' && ts !== 'cancelled') return 'réouvert'

  if ((fs === 'open' || fs === 'in_progress') && ts === 'non_compliant') return 'aggravé'

  if (fs === 'planned' && (ts === 'in_progress' || ts === 'open')) return 'progressé'

  if (fs === ts) return 'maintenu'

  return 'changé'
}

/**
 * Calcule le delta entre deux runs d'extraction du même chantier.
 *
 * Seules les propositions ayant un subject_thread_id participent au diff.
 * Un run sans reconciliation donnera un delta vide (pas d'erreur).
 */
export async function getPvDelta(fromRunId: string, toRunId: string): Promise<PvDelta> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const [{ data: fromRaw, error: fromErr }, { data: toRaw, error: toErr }] = await Promise.all([
    supabase
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, proposal_family, thematic_category, label, document_status')
      .eq('extraction_run_id', fromRunId)
      .not('subject_thread_id', 'is', null),
    supabase
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, proposal_family, thematic_category, label, document_status')
      .eq('extraction_run_id', toRunId)
      .not('subject_thread_id', 'is', null),
  ])

  if (fromErr) throw new Error(fromErr.message)
  if (toErr) throw new Error(toErr.message)

  const fromByThread = new Map<string, ProposalRow>()
  for (const p of (fromRaw ?? []) as ProposalRow[]) {
    fromByThread.set(p.subject_thread_id, p)
  }

  const toByThread = new Map<string, ProposalRow>()
  for (const p of (toRaw ?? []) as ProposalRow[]) {
    toByThread.set(p.subject_thread_id, p)
  }

  const allThreadIds = new Set([...fromByThread.keys(), ...toByThread.keys()])
  const items: DeltaItem[] = []

  for (const threadId of allThreadIds) {
    const from = fromByThread.get(threadId) ?? null
    const to = toByThread.get(threadId) ?? null
    const ref = to ?? from!

    items.push({
      subjectThreadId: threadId,
      family: ref.proposal_family,
      thematicCategory: ref.thematic_category,
      label: to?.label ?? from!.label,
      fromStatus: from?.document_status ?? null,
      toStatus: to?.document_status ?? null,
      transition: computeTransition(from, to),
      fromProposalId: from?.id ?? null,
      toProposalId: to?.id ?? null,
    })
  }

  return { fromRunId, toRunId, items }
}
