import 'server-only'

// Moteur canonique de transitions inter-PV.
//
// Source unique de vérité pour :
//   - la logique de cell-state (absent / first / open / non_compliant / done / reopened)
//   - la logique de transition canonique (appeared / resolved / aggravated / …)
//   - les constantes d'exclusion opérationnelle partagées
//
// Invariants fondamentaux :
//   - absence ≠ résolution : null toStatus → notMentioned, jamais resolved
//   - done → absent = notMentioned
//   - done → open/in_progress = reopened
//   - plusieurs threads du même canonical_subject → statut le plus sévère (STATUS_RANK)
//   - person / company / knowledge_fact exclus des métriques opérationnelles

// ── Constantes partagées ─────────────────────────────────────────────────────

/** Priorité décroissante : 0 = plus sévère. */
export const STATUS_RANK: Record<string, number> = {
  non_compliant: 0, open: 1, awaiting_validation: 2, in_progress: 3, planned: 4, done: 5, cancelled: 5, informational: 6,
}

/** Familles exclues de tous les compteurs de transition opérationnels. */
export const OPERATIONAL_EXCLUDED_FAMILIES = new Set(['person', 'company', 'knowledge_fact'])

// ── Types ────────────────────────────────────────────────────────────────────

/** État d'une cellule (canonical_subject × run) dans la grille d'activité. */
export type CanonicalCellState = 'absent' | 'first' | 'open' | 'non_compliant' | 'done' | 'reopened'

/** Transition entre deux PV au niveau canonical_subject. */
export type CanonicalTransition =
  | 'appeared'      // absent → présent (nouveau)
  | 'notMentioned'  // présent → absent
  | 'resolved'      // ouvert → done/informational (réalisé + levé fusionnés)
  | 'reopened'      // done → ouvert
  | 'aggravated'    // open/in_progress/planned → non_compliant
  | 'progressed'    // planned → in_progress/open
  | 'stillOpen'     // présent dans les deux runs, encore ouvert
  | 'cancelled'     // → cancelled

export interface CanonicalDeltaItem {
  canonicalSubjectId: string
  label: string
  thematicCategory: string | null
  family: string
  fromStatus: string | null
  toStatus: string | null
  transition: CanonicalTransition
}

export interface CanonicalDelta {
  fromRunId: string
  toRunId: string
  items: CanonicalDeltaItem[]
}

// ── Fonctions pures ──────────────────────────────────────────────────────────

/**
 * Calcule l'état de cellule d'un canonical_subject dans la grille d'activité,
 * en fonction de son état dans le run précédent et le run courant.
 *
 * L'appelant gère "absent" (status null) en dehors de cette fonction.
 */
export function computeCanonicalCellState(
  prevStatus: string | null,
  currentStatus: string,
): CanonicalCellState {
  if (prevStatus === null) return 'first'
  if (currentStatus === 'non_compliant') return 'non_compliant'
  if (currentStatus === 'done' || currentStatus === 'cancelled' || currentStatus === 'informational') return 'done'
  if (prevStatus === 'done' || prevStatus === 'cancelled' || prevStatus === 'informational') return 'reopened'
  return 'open'
}

/**
 * Calcule la transition entre deux runs pour un canonical_subject.
 *
 * fromStatus null = sujet absent du run précédent → appeared.
 * toStatus null   = sujet absent du run suivant   → notMentioned.
 */
export function computeCanonicalTransition(
  fromStatus: string | null,
  toStatus: string | null,
): CanonicalTransition {
  if (!fromStatus) return 'appeared'
  if (!toStatus) return 'notMentioned'
  if (toStatus === 'cancelled') return 'cancelled'

  const isDone = (s: string) => s === 'done' || s === 'informational'

  if (!isDone(fromStatus) && isDone(toStatus)) return 'resolved'
  if (isDone(fromStatus) && !isDone(toStatus)) return 'reopened'

  if (
    (fromStatus === 'open' || fromStatus === 'in_progress' || fromStatus === 'planned') &&
    toStatus === 'non_compliant'
  ) return 'aggravated'

  if (fromStatus === 'planned' && (toStatus === 'in_progress' || toStatus === 'open')) return 'progressed'

  return 'stillOpen'
}

// ── Moteur de delta canonique ────────────────────────────────────────────────

type PropRow = {
  subject_thread_id: string
  proposal_family: string
  thematic_category: string | null
  label: string
  document_status: string | null
}

type CsState = {
  status: string
  label: string
  family: string
  thematicCategory: string | null
  families: Set<string>
}

function aggregateByCanonical(
  map: Map<string, CsState>,
  row: PropRow,
  threadToCs: Map<string, string>,
) {
  const csId  = threadToCs.get(row.subject_thread_id)
  if (!csId) return
  const status = row.document_status ?? 'open'
  const cur    = map.get(csId)
  if (!cur) {
    map.set(csId, {
      status,
      label:            row.label,
      family:           row.proposal_family,
      thematicCategory: row.thematic_category,
      families:         new Set([row.proposal_family]),
    })
  } else {
    cur.families.add(row.proposal_family)
    // Worst status wins (lower STATUS_RANK rank = higher severity)
    if ((STATUS_RANK[status] ?? 99) < (STATUS_RANK[cur.status] ?? 99)) {
      cur.status           = status
      cur.label            = row.label
      cur.family           = row.proposal_family
      cur.thematicCategory = row.thematic_category
    }
  }
}

/**
 * Calcule le delta entre deux runs au niveau canonical_subject.
 *
 * Garanties :
 *   - plusieurs threads d'un même canonical → statut le plus sévère (STATUS_RANK)
 *   - canonical dont toutes les familles sont dans OPERATIONAL_EXCLUDED_FAMILIES → exclu
 *   - threads sans canonical_subject_id → ignorés
 */
export async function getCanonicalDelta(fromRunId: string, toRunId: string): Promise<CanonicalDelta> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const [{ data: fromRaw, error: fromErr }, { data: toRaw, error: toErr }] = await Promise.all([
    supabase
      .from('document_extraction_proposal')
      .select('subject_thread_id, proposal_family, thematic_category, label, document_status')
      .eq('extraction_run_id', fromRunId)
      .not('subject_thread_id', 'is', null),
    supabase
      .from('document_extraction_proposal')
      .select('subject_thread_id, proposal_family, thematic_category, label, document_status')
      .eq('extraction_run_id', toRunId)
      .not('subject_thread_id', 'is', null),
  ])
  if (fromErr) throw new Error(fromErr.message)
  if (toErr)   throw new Error(toErr.message)

  const fromRows = (fromRaw ?? []) as PropRow[]
  const toRows   = (toRaw   ?? []) as PropRow[]

  const allThreadIds = new Set([
    ...fromRows.map((p) => p.subject_thread_id),
    ...toRows.map((p)   => p.subject_thread_id),
  ])
  if (allThreadIds.size === 0) return { fromRunId, toRunId, items: [] }

  type StiRow = { subject_thread_id: string; canonical_subject_id: string }
  const { data: stiData } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('subject_thread_id', [...allThreadIds])

  const threadToCs = new Map(
    ((stiData ?? []) as StiRow[]).map((r) => [r.subject_thread_id, r.canonical_subject_id]),
  )

  const fromByCs = new Map<string, CsState>()
  const toByCs   = new Map<string, CsState>()

  for (const p of fromRows) aggregateByCanonical(fromByCs, p, threadToCs)
  for (const p of toRows)   aggregateByCanonical(toByCs,   p, threadToCs)

  const allCsIds = new Set([...fromByCs.keys(), ...toByCs.keys()])
  const items: CanonicalDeltaItem[] = []

  for (const csId of allCsIds) {
    const from = fromByCs.get(csId) ?? null
    const to   = toByCs.get(csId)   ?? null
    const allFamilies = new Set([...(from?.families ?? []), ...(to?.families ?? [])])
    if (allFamilies.size > 0 && [...allFamilies].every((f) => OPERATIONAL_EXCLUDED_FAMILIES.has(f))) continue

    const ref = to ?? from!
    items.push({
      canonicalSubjectId: csId,
      label:            to?.label ?? from!.label,
      thematicCategory: ref.thematicCategory,
      family:           ref.family,
      fromStatus:       from?.status ?? null,
      toStatus:         to?.status   ?? null,
      transition:       computeCanonicalTransition(from?.status ?? null, to?.status ?? null),
    })
  }

  return { fromRunId, toRunId, items }
}
