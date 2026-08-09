import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { CanonicalSubjectLife } from '@/lib/db/canonical-subject-life'

// ── Types publics ──────────────────────────────────────────────────────────────

export interface SubjectActor {
  name: string
  role: 'person' | 'company'
}

export interface CanonicalSubjectIntelligence {
  daysPresent: number | null
  lastMeaningfulChangeAt: string | null
  /** Ancre HTML vers l'occurrence du fil métier où la dernière évolution réelle s'est produite. */
  lastMeaningfulOccurrenceAnchor: string | null
  isStagnant: boolean
  stagnationDays: number | null
  consecutiveMentionsWithoutChange: number
  /** Ancre HTML vers la première occurrence stagnante (juste après la dernière évolution réelle). */
  firstStagnantOccurrenceAnchor: string | null
  actor: SubjectActor | null
  openItemCount: number
}

// ── Assembleur ────────────────────────────────────────────────────────────────
//
// Prend une CanonicalSubjectLife déjà chargée (lecture seule, pas de recalcul)
// et l'enrichit avec une seule requête : l'identité de l'acteur lié.
// Toutes les autres données proviennent directement de `life`.

export async function buildCanonicalSubjectIntelligence(
  canonicalSubjectId: string,
  life: CanonicalSubjectLife,
): Promise<CanonicalSubjectIntelligence> {
  const sb = createAdminClient()

  // Jours de présence depuis la première mention
  let daysPresent: number | null = null
  if (life.firstSeenAt) {
    daysPresent = Math.floor((Date.now() - new Date(life.firstSeenAt).getTime()) / 86_400_000)
  }

  // Acteur lié (contact ou entreprise) — 1 ou 2 requêtes légères
  let actor: SubjectActor | null = null
  const { data: cs } = await sb
    .from('canonical_subject')
    .select('contact_id, company_id')
    .eq('id', canonicalSubjectId)
    .maybeSingle()

  if (cs?.contact_id) {
    const { data: c } = await sb
      .from('company_contacts')
      .select('full_name')
      .eq('id', cs.contact_id as string)
      .maybeSingle()
    if (c?.full_name) actor = { name: c.full_name as string, role: 'person' }
  } else if (cs?.company_id) {
    const { data: c } = await sb
      .from('companies')
      .select('name')
      .eq('id', cs.company_id as string)
      .maybeSingle()
    if (c?.name) actor = { name: c.name as string, role: 'company' }
  }

  // Objets encore ouverts : réserves et échéances sans clôture
  // (pas des "blocages" au sens strict — une réserve ouverte n'empêche pas forcément d'avancer)
  const openItemCount = life.materializedEvents.filter((e) => {
    if (e.entityType === 'site_reserve')
      return !['lifted', 'done', 'cancelled'].includes(e.status ?? '')
    if (e.entityType === 'site_deadline')
      return !['done', 'cancelled', 'superseded'].includes(e.status ?? '')
    return false
  }).length

  // Ancres vers le fil métier — indices dans life.occurrences (correspond aux id="occ-{i}" de la page)
  let lastMeaningfulOccurrenceAnchor: string | null = null
  let firstStagnantOccurrenceAnchor: string | null = null

  if (life.lastMeaningfulChangeAt) {
    const lmcIdx = life.occurrences.findIndex(
      (o) => !o.isGap && o.effectiveDate === life.lastMeaningfulChangeAt,
    )
    if (lmcIdx >= 0) lastMeaningfulOccurrenceAnchor = `occ-${lmcIdx}`

    if (life.isStagnant) {
      // Première occurrence RÉELLE après la dernière évolution significative
      const firstStagnantIdx = life.occurrences.findIndex(
        (o) => !o.isGap && o.effectiveDate > life.lastMeaningfulChangeAt!,
      )
      if (firstStagnantIdx >= 0) firstStagnantOccurrenceAnchor = `occ-${firstStagnantIdx}`
    }
  }

  return {
    daysPresent,
    lastMeaningfulChangeAt: life.lastMeaningfulChangeAt,
    lastMeaningfulOccurrenceAnchor,
    isStagnant: life.isStagnant,
    stagnationDays: life.stagnationDays,
    consecutiveMentionsWithoutChange: life.consecutiveMentionsWithoutChange,
    firstStagnantOccurrenceAnchor,
    actor,
    openItemCount,
  }
}
