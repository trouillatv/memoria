import 'server-only'

// Canal historical_pdf — P0-B2
//
// Crée les canonical_subject_occurrence de canal 'historical_pdf' à partir des
// document_extraction_proposal d'un run de PV historique.
//
// Doctrine (identique à selectBestNote) :
//   - pooler label + description de toutes les propositions d'un groupe (cs, rapport)
//   - filtrer les textes non informatifs
//   - label et description sont choisis indépendamment (le meilleur de chaque)
//   - fallback sur le label canonical uniquement si rien d'informatif
//
// Idempotence : index UNIQUE PARTIEL cso_historical_pdf_uniq sur (canonical_subject_id, source_ref_id)
// evidence_count = nombre de propositions convergentes (multiplicité)

import { createAdminClient } from '@/lib/supabase/admin'
import { makeWinnerResolver, type SubjectRow } from '@/lib/db/canonical-subject-project'
import { detectActorRelations, type ActorSubject } from '@/lib/db/actor-citation'

const ELIGIBLE_FAMILIES = new Set(['action', 'vigilance', 'decision', 'knowledge_fact', 'deadline', 'reservation'])

// Même doctrine que isInformativeText dans produce-relations-from-occurrences.ts
const TEMPORAL_START_RE =
  /^(la\s+semaine|ce\s+(?:soir|matin|midi|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|cette\s+semaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|prochain[e]?|prochainement|demain|[àa]\s+(?:voir|définir|confirmer|planifier|faire|réaliser)|tbd|sous\s+peu|dans\s+(?:la\s+semaine|\d))/i

const MIN_INFORMATIVE_CHARS = 15
const MAX_TEMPORAL_CHARS    = 50

export function isInformativeText(t: string): boolean {
  if (t.length < MIN_INFORMATIVE_CHARS) return false
  if (TEMPORAL_START_RE.test(t) && t.length < MAX_TEMPORAL_CHARS) return false
  return true
}

/** Sélectionne le texte le plus informatif dans un pool de candidats.
 *  Retourne null si aucun n'est informatif (fallback à gérer par l'appelant). */
export function selectBestText(candidates: string[]): string | null {
  const seen = new Set<string>()
  const pool = candidates
    .map(t => t.trim())
    .filter(t => t.length > 0 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
  const informative = pool.filter(isInformativeText)
  if (informative.length === 0) return null
  informative.sort((a, b) => b.length - a.length)
  return informative[0]
}

interface ProposalRow {
  id: string
  proposal_family: string
  label: string
  description: string | null
  subject_thread_id: string | null
}

interface OccurrenceToCreate {
  canonical_subject_id: string
  canonical_label: string  // fallback si pool non informatif
  site_id: string
  source_ref_id: string    // site_reports.id
  effective_date: string
  proposals: ProposalRow[]
}

/**
 * Crée (ou ignore si déjà présentes) les canonical_subject_occurrence de canal
 * 'historical_pdf' pour toutes les propositions éligibles d'un run historique.
 *
 * Appelé à la matérialisation d'un PV historique, après que site_reports.id est créé.
 * Idempotent : utilise INSERT ... ON CONFLICT DO NOTHING via l'index cso_historical_pdf_uniq.
 */
export async function ensureHistoricalPdfOccurrences(params: {
  runId: string
  siteId: string
  siteReportId: string  // site_reports.id créé par materializeHistoricalVisit
  visitDate: string     // YYYY-MM-DD
}): Promise<{ created: number; skipped: number; errors: number }> {
  const { runId, siteId, siteReportId, visitDate } = params
  const supabase = createAdminClient()

  // 1. Charger les propositions éligibles du run avec leur subject_thread_id
  const { data: proposals, error: propErr } = await supabase
    .from('document_extraction_proposal')
    .select('id, proposal_family, label, description, subject_thread_id')
    .eq('extraction_run_id', runId)
    .in('proposal_family', [...ELIGIBLE_FAMILIES])
    .not('subject_thread_id', 'is', null)

  if (propErr) {
    console.error('[historical-occ] proposals fetch failed:', propErr.message)
    return { created: 0, skipped: 0, errors: 1 }
  }
  if (!proposals || proposals.length === 0) return { created: 0, skipped: 0, errors: 0 }

  const eligible = proposals as ProposalRow[]
  const threadIds = [...new Set(eligible.map(p => p.subject_thread_id as string))]

  // 2. Résoudre thread_id → canonical_subject_id via subject_thread_identity
  const { data: stiRows, error: stiErr } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
    .in('subject_thread_id', threadIds)

  if (stiErr) {
    console.error('[historical-occ] STI fetch failed:', stiErr.message)
    return { created: 0, skipped: 0, errors: 1 }
  }

  const threadToCs = new Map((stiRows ?? []).map(s => [s.subject_thread_id as string, s.canonical_subject_id as string]))

  // 3. Résoudre le winner actif de chaque canonical_subject référencé par la STI.
  //    Invariant : toute nouvelle canonical_subject_occurrence pointe vers le
  //    sujet vivant courant, jamais vers un loser fusionné (même si la STI,
  //    elle, n'a pas encore été reroutée — cf. MERGE-REFERENCE).
  const rawCsIds = [...new Set([...threadToCs.values()])]
  const { data: subjectRows } = await supabase
    .from('canonical_subject')
    .select('id, status, merged_into')
    .in('id', rawCsIds)
  const subjectCache = new Map<string, SubjectRow>(
    (subjectRows ?? []).map(r => [r.id as string, r as SubjectRow]),
  )
  const resolveWinner = makeWinnerResolver(supabase, subjectCache)
  const winnerByRawId = new Map<string, string>()
  for (const rawId of rawCsIds) {
    const resolved = await resolveWinner(rawId)
    if (resolved) winnerByRawId.set(rawId, resolved.id)
    // pas de winner résolu (cycle/impasse) → skip silencieux, comme un thread non promu
  }

  const winnerIds = [...new Set([...winnerByRawId.values()])]
  const { data: winnerRows } = await supabase
    .from('canonical_subject')
    .select('id, label')
    .in('id', winnerIds)
  const csLabelMap = new Map((winnerRows ?? []).map(c => [c.id as string, c.label as string]))

  // 3b. Acteurs DU DOCUMENT (kind=actor) — ceux réellement extraits/canonicalisés de CE run
  //     (propositions person/company → thread → canonical_subject), pas tous les acteurs du
  //     site. Sert à lier l'acteur cité dans le texte d'un fait à l'occurrence, avec un rôle.
  //     L'acteur reste une entité LIÉE au fait, jamais le sujet.
  const { data: actorProps } = await supabase
    .from('document_extraction_proposal')
    .select('subject_thread_id')
    .eq('extraction_run_id', runId)
    .in('proposal_family', ['person', 'company'])
    .not('subject_thread_id', 'is', null)
  const actorThreadIds = [...new Set((actorProps ?? []).map(p => p.subject_thread_id as string))]
  let actorList: ActorSubject[] = []
  if (actorThreadIds.length > 0) {
    const { data: actorSti } = await supabase
      .from('subject_thread_identity')
      .select('canonical_subject_id')
      .eq('site_id', siteId)
      .in('subject_thread_id', actorThreadIds)
    const actorCsIds = [...new Set((actorSti ?? []).map(s => s.canonical_subject_id as string))]
    if (actorCsIds.length > 0) {
      const { data: actorRows } = await supabase
        .from('canonical_subject')
        .select('id, label, aliases')
        .in('id', actorCsIds)
        .eq('kind', 'actor')
        .eq('status', 'active')
      actorList = (actorRows ?? []).map(r => ({ id: r.id as string, label: r.label as string, aliases: (r.aliases as string[] | null) ?? [] }))
    }
  }

  // 4. Grouper les propositions par winner résolu (jamais le canonical_subject_id brut)
  const groups = new Map<string, OccurrenceToCreate>()
  for (const p of eligible) {
    const rawCsId = threadToCs.get(p.subject_thread_id as string)
    if (!rawCsId) continue  // thread non encore promu en canonical_subject — skip silencieux
    const csId = winnerByRawId.get(rawCsId)
    if (!csId) continue  // chaîne de fusion cyclique/incomplète — skip silencieux
    if (!groups.has(csId)) {
      groups.set(csId, {
        canonical_subject_id: csId,
        canonical_label: csLabelMap.get(csId) ?? p.label,
        site_id: siteId,
        source_ref_id: siteReportId,
        effective_date: visitDate,
        proposals: [],
      })
    }
    groups.get(csId)!.proposals.push(p)
  }

  // 5. Créer les occurrences — une par groupe (cs, rapport)
  let created = 0
  let skipped = 0
  let errors  = 0

  for (const group of groups.values()) {
    const allLabels      = group.proposals.map(p => p.label)
    const allDescriptions = group.proposals.map(p => p.description ?? '').filter(Boolean)

    // Sélection indépendante du meilleur label et de la meilleure description
    const bestLabel = selectBestText(allLabels) ?? group.canonical_label
    const bestNote  = selectBestText(allDescriptions) ?? null

    const occData = {
      canonical_subject_id: group.canonical_subject_id,
      site_id: group.site_id,
      source_kind: 'historical_pdf' as const,
      source_ref_id: group.source_ref_id,
      source_proposal_id: null,
      visit_status: null,
      label: bestLabel,
      note: bestNote,
      evidence_count: group.proposals.length,  // multiplicité
      effective_date: group.effective_date,
      created_by: null,
      validation_status: 'observed' as const,
      entity_ids: [],
    }

    // INSERT ... ON CONFLICT DO NOTHING : l'index cso_historical_pdf_uniq gère l'idempotence.
    // On récupère l'id (créé OU existant) pour (re)poser les liens acteurs de façon idempotente.
    let occurrenceId: string | null = null
    const { data: ins, error: insertErr } = await supabase
      .from('canonical_subject_occurrence')
      .insert(occData)
      .select('id')
      .maybeSingle()

    if (insertErr) {
      if (insertErr.code === '23505') {
        skipped++
        const { data: existing } = await supabase
          .from('canonical_subject_occurrence')
          .select('id')
          .eq('canonical_subject_id', group.canonical_subject_id)
          .eq('source_ref_id', group.source_ref_id)
          .eq('source_kind', 'historical_pdf')
          .maybeSingle()
        occurrenceId = (existing as { id: string } | null)?.id ?? null
      } else {
        console.error('[historical-occ] insert failed:', group.canonical_subject_id, insertErr.code, insertErr.message)
        errors++
      }
    } else {
      created++
      occurrenceId = (ins as { id: string } | null)?.id ?? null
    }

    // Liens ACTEUR ↔ OCCURRENCE (rôle dans le fait daté). Acteurs cités dans TOUT le texte du
    // fait, restreints aux acteurs du document. Idempotent (unique occ+actor+relation).
    if (occurrenceId && actorList.length > 0) {
      const relations = detectActorRelations([...allLabels, ...allDescriptions], actorList)
      if (relations.length > 0) {
        const { error: linkErr } = await supabase
          .from('canonical_subject_occurrence_actor_link')
          .upsert(
            relations.map(r => ({
              occurrence_id: occurrenceId,
              actor_subject_id: r.actorId,
              relation_type: r.relationType,
              source: 'auto_historical' as const,
              evidence_cue: r.evidenceCue,
            })),
            { onConflict: 'occurrence_id,actor_subject_id,relation_type', ignoreDuplicates: true },
          )
        if (linkErr) console.error('[historical-occ] actor link failed:', occurrenceId, linkErr.message)
      }
    }
  }

  return { created, skipped, errors }
}
