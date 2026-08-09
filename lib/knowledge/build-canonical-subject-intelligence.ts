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
  isStagnant: boolean
  stagnationDays: number | null
  consecutiveMentionsWithoutChange: number
  actor: SubjectActor | null
  openBlockerCount: number
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

  // Blocages actifs : réserves ouvertes + échéances non résolues
  const openBlockerCount = life.materializedEvents.filter((e) => {
    if (e.entityType === 'site_reserve')
      return !['lifted', 'done', 'cancelled'].includes(e.status ?? '')
    if (e.entityType === 'site_deadline')
      return !['done', 'cancelled', 'superseded'].includes(e.status ?? '')
    return false
  }).length

  return {
    daysPresent,
    lastMeaningfulChangeAt: life.lastMeaningfulChangeAt,
    isStagnant: life.isStagnant,
    stagnationDays: life.stagnationDays,
    consecutiveMentionsWithoutChange: life.consecutiveMentionsWithoutChange,
    actor,
    openBlockerCount,
  }
}
