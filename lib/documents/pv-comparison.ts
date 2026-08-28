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
  // P0-2c — occurrence-first : le delta entre deux PV se projette depuis la vue canonical unifiée
  // (état = occurrences, présence = propositions), au niveau CANONICAL (dédup des threads). Un sujet
  // présent au PV `to` sans occurrence d'état → 'maintenu' (mention sans nouvel événement) ; gap →
  // 'non_mentionné' ; 1re présence au `to` → 'nouveau'. Aucune proposition ne détermine l'état.
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()
  const { buildSiteSubjectCells, cellDeltaTransition } = await import('./site-occurrence-timeline')

  const { data: runRow } = await supabase.from('document_extraction_run').select('target_site_id').eq('id', toRunId).maybeSingle()
  const siteId = (runRow as { target_site_id: string | null } | null)?.target_site_id ?? null
  if (!siteId) return { fromRunId, toRunId, items: [] }

  const view = await buildSiteSubjectCells(siteId)
  const fromIdx = view.runs.findIndex((r) => r.id === fromRunId)
  const toIdx = view.runs.findIndex((r) => r.id === toRunId)
  if (toIdx < 0) return { fromRunId, toRunId, items: [] }

  const rawEquiv = (s: string | null): string | null => (s === 'resolved' ? 'done' : s === 'open' ? 'open' : null)
  const items: DeltaItem[] = []
  for (const row of view.rows) {
    const toCell = row.cells[toIdx]
    if (!toCell) continue // pas encore apparu au PV `to`
    const fromCell = fromIdx >= 0 ? row.cells[fromIdx] : null
    const t = cellDeltaTransition(toCell, fromCell === null) as DeltaTransition
    items.push({
      subjectThreadId: row.canonicalSubjectId,
      family: row.family,
      thematicCategory: row.thematicCategory,
      label: toCell.label ?? row.label,
      fromStatus: rawEquiv(fromCell?.currentProvenState ?? null),
      toStatus: toCell.observedTriState ? rawEquiv(toCell.observedTriState) : rawEquiv(toCell.currentProvenState),
      transition: t,
      fromProposalId: null,
      toProposalId: null,
    })
  }

  return { fromRunId, toRunId, items }
}
