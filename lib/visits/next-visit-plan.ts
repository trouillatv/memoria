import 'server-only'

// PLAN DE VISITE next_visit du Copilote (WOW-2E) — MÊME population que le Briefing
// et le seed. La chaîne autoritative est object-first :
//   buildVisitCandidatePreview → Briefing == seed == next_visit
// Même identité (source_kind + source_ref), même verificationMode, même mémoire
// WOW-2A′, même ordre, même cap.
//
// Doctrine figée (Vincent 2026-09-05) :
//   • Le plan de visite = ce que MemorIA propose de FAIRE pendant cette visite,
//     pas « tout ce qui mérite de l'attention ». Les signaux subject-first sans
//     ObjectVisitCandidate (échéances, stagnation, subject_changed, sujets sans
//     objet opérationnel) NE créent plus de ligne ici — ils restent dans leurs
//     autres surfaces (Attention, Aperçu, échéances, sujets à garder en tête).
//   • VisitControl (buildVisitPlan) devient une COUCHE D'ENRICHISSEMENT : il peut
//     compléter un candidat existant (why / lastKnown / changeSinceLastVisit)
//     quand un rattachement DÉTERMINISTE au même canonicalSubjectId existe. Il ne
//     peut JAMAIS créer un item. Aucun fuzzy, aucun rattachement par label, aucun
//     LLM pour la jointure — pas de cs déterministe ⇒ aucun enrichissement.

import { createAdminClient } from '@/lib/supabase/admin'
import { watchlistSourceKey } from '@/lib/visits/watchlist-not-applicable-memory'
import type { ObjectVisitCandidate, VerificationMode } from '@/lib/visits/visit-candidates'

/** Libellé du geste de visite (= le mode), utilisé aussi comme `tierLabel` du
 *  contrat oral. Ce n'est PAS une conversion de VisitControlTier : c'est le mode. */
export const MODE_LABEL: Record<VerificationMode, string> = {
  field_check: 'À constater sur place',
  ask_confirm: 'À demander / confirmer',
}

/** Faits déterministes qu'un VisitControl peut prêter à un candidat rattaché. */
export interface SubjectEnrichmentFacts {
  why: string
  lastKnown: string | null
  changeSinceLastVisit: string | null
}

/** Un item du plan next_visit, object-first, éventuellement enrichi subject-first.
 *  Porte `id/label/tierLabel` pour rester compatible avec le contrat oral. */
export interface NextVisitPlanItem {
  id: string
  sourceKind: string
  sourceRef: string
  label: string
  reason: string | null
  verificationMode: VerificationMode
  /** = MODE_LABEL[verificationMode]. Sert de `tierLabel` au contrat oral. */
  tierLabel: string
  canonicalSubjectId?: string
  // Enrichissement subject-first (VisitControl) — présent SEULEMENT si rattachement déterministe.
  why?: string
  lastKnown?: string | null
  changeSinceLastVisit?: string | null
}

/**
 * Assemble le plan next_visit à partir de la population machine (candidats), en
 * conservant l'ORDRE et le CAP de la preview (aucun retri, aucun ajout). Enrichit
 * un candidat UNIQUEMENT si `subjectByRef` donne un canonicalSubjectId déterministe
 * ET que `controlByCs` en connaît les faits. Fonction PURE.
 */
export function buildNextVisitPlan(
  candidates: ObjectVisitCandidate[],
  subjectByRef: ReadonlyMap<string, string>,
  controlByCs: ReadonlyMap<string, SubjectEnrichmentFacts>,
): NextVisitPlanItem[] {
  return candidates.map((c) => {
    const key = watchlistSourceKey(c.sourceKind, c.sourceRef)
    const cs = subjectByRef.get(key)
    const item: NextVisitPlanItem = {
      id: cs ?? `${c.sourceKind}:${c.sourceRef}`,
      sourceKind: c.sourceKind,
      sourceRef: c.sourceRef,
      label: c.label,
      reason: c.reason,
      verificationMode: c.verificationMode,
      tierLabel: MODE_LABEL[c.verificationMode],
    }
    const facts = cs ? controlByCs.get(cs) : undefined
    if (cs && facts) {
      item.canonicalSubjectId = cs
      item.why = facts.why
      item.lastKnown = facts.lastKnown
      item.changeSinceLastVisit = facts.changeSinceLastVisit
    }
    return item
  })
}

/**
 * Rattachement DÉTERMINISTE candidat → canonicalSubjectId (aucun fuzzy, aucun
 * label) : les réserves et actions portent `canonical_subject_id` en base. Les
 * décisions/obligations sont hors canon → jamais rattachées (map sans la clé).
 */
export async function loadCandidateSubjectRefs(
  siteId: string,
  candidates: ObjectVisitCandidate[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const reserveRefs = candidates.filter((c) => c.sourceKind === 'reserve_open').map((c) => c.sourceRef)
  const actionRefs = candidates
    .filter((c) => c.sourceKind === 'action_overdue' || c.sourceKind === 'proof_window_closing')
    .map((c) => c.sourceRef)
  if (reserveRefs.length === 0 && actionRefs.length === 0) return out
  const admin = createAdminClient()
  const [res, act] = await Promise.all([
    reserveRefs.length
      ? admin.from('site_reserve').select('id, canonical_subject_id').eq('site_id', siteId).in('id', reserveRefs)
      : Promise.resolve({ data: [] as Array<{ id: string; canonical_subject_id: string | null }> }),
    actionRefs.length
      ? admin.from('site_actions').select('id, canonical_subject_id').eq('site_id', siteId).in('id', actionRefs)
      : Promise.resolve({ data: [] as Array<{ id: string; canonical_subject_id: string | null }> }),
  ])
  for (const r of res.data ?? []) {
    if (r.canonical_subject_id) out.set(watchlistSourceKey('reserve_open', r.id as string), r.canonical_subject_id as string)
  }
  for (const a of act.data ?? []) {
    if (a.canonical_subject_id) {
      const cs = a.canonical_subject_id as string
      out.set(watchlistSourceKey('action_overdue', a.id as string), cs)
      out.set(watchlistSourceKey('proof_window_closing', a.id as string), cs)
    }
  }
  return out
}
