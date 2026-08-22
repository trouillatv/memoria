// P1-5A — Inventaire exhaustif de l'état OCEF + génération des candidats de re-canonicalisation.
// MODE LECTURE SEULE STRICT — aucune mutation DB, aucun merge, aucun backfill, aucun commit.
//
// Sortie : JSON structuré vers stdout (redirigé vers un fichier d'audit) contenant :
//   - inventory : CS actifs/merged, occurrences, threads, proposals, links, suggestions
//   - candidatePairs : paires de CS actifs avec Jaccard >= seuil (sans Gemini ici)
//
// Le verdict P0-2 par paire est réutilisé depuis scripts/_validate-p02-ocef.ts (22 paires
// déjà évaluées) ; ce script ne rappelle Gemini QUE pour les paires candidates non couvertes,
// et seulement si P15A_RUN_GEMINI=1 est passé.
//
// Usage : npx tsx scripts/_p15a-inventory.ts > audit-p15a-inventory.json

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { normalizeForMatching, P01_NORMALIZED_JACCARD_THRESHOLD } from '../lib/subjects/normalize-for-matching'
import { jaccardSimilarity } from '../lib/documents/subject-reconciliation'

const OCEF_SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'

type CsRow = {
  id: string
  label: string
  aliases: string[]
  status: string
  merged_into: string | null
  company_id: string | null
  contact_id: string | null
  created_at: string
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // ── 1. Tous les canonical_subject du site ──────────────────────────────────
  const { data: csRaw, error: csErr } = await sb
    .from('canonical_subject')
    .select('id, label, aliases, status, merged_into, company_id, contact_id, created_at')
    .eq('site_id', OCEF_SITE_ID)
    .order('created_at', { ascending: true })
  if (csErr) throw new Error('CS: ' + csErr.message)
  const allCs = (csRaw ?? []) as CsRow[]
  const active = allCs.filter((c) => c.status === 'active')
  const merged = allCs.filter((c) => c.status === 'merged')
  const split = allCs.filter((c) => c.status === 'split')

  // ── 2. Occurrences par CS ──────────────────────────────────────────────────
  const { data: occRaw } = await sb
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_kind, source_ref_id, source_proposal_id, label, effective_date, visit_status, validation_status')
    .eq('site_id', OCEF_SITE_ID)
    .order('effective_date', { ascending: true })
  const occ = (occRaw ?? []) as Array<{
    id: string; canonical_subject_id: string; source_kind: string; source_ref_id: string
    source_proposal_id: string | null; label: string; effective_date: string
    visit_status: string | null; validation_status: string | null
  }>
  const occByCs = new Map<string, typeof occ>()
  for (const o of occ) {
    const list = occByCs.get(o.canonical_subject_id) ?? []
    list.push(o)
    occByCs.set(o.canonical_subject_id, list)
  }

  // ── 3. subject_thread_identity par CS ──────────────────────────────────────
  const { data: stiRaw } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id, source, confidence')
    .eq('site_id', OCEF_SITE_ID)
  const sti = (stiRaw ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string; source: string; confidence: number | null }>
  const threadsByCs = new Map<string, string[]>()
  for (const s of sti) {
    const list = threadsByCs.get(s.canonical_subject_id) ?? []
    list.push(s.subject_thread_id)
    threadsByCs.set(s.canonical_subject_id, list)
  }

  // ── 4. Propositions matérialisées site_knowledge_proposals.canonical_subject_id ──
  const { data: propRaw } = await sb
    .from('site_knowledge_proposals')
    .select('id, canonical_subject_id, canonical_resolution_status')
    .eq('site_id', OCEF_SITE_ID)
    .not('canonical_subject_id', 'is', null)
  const props = (propRaw ?? []) as Array<{ id: string; canonical_subject_id: string; canonical_resolution_status: string | null }>
  const propsByCs = new Map<string, number>()
  for (const p of props) propsByCs.set(p.canonical_subject_id, (propsByCs.get(p.canonical_subject_id) ?? 0) + 1)

  // ── 5. canonical_subject_similarity_suggestion ─────────────────────────────
  const { data: sugRaw } = await sb
    .from('canonical_subject_similarity_suggestion')
    .select('id, subject_a_id, subject_b_id, score, verdict, recommendation, suggested_link_type, suggested_direction, status, reason')
    .eq('site_id', OCEF_SITE_ID)
  const suggestions = (sugRaw ?? []) as Array<Record<string, unknown>>

  // ── 6. canonical_subject_links ─────────────────────────────────────────────
  const { data: cslRaw } = await sb
    .from('canonical_subject_links')
    .select('id, source_subject_id, target_subject_id, relation_type, status, confidence, justification')
    .eq('site_id', OCEF_SITE_ID)
  const csLinks = (cslRaw ?? []) as Array<Record<string, unknown>>

  // ── 7. subject_thread_links ────────────────────────────────────────────────
  const { data: stlRaw } = await sb
    .from('subject_thread_links')
    .select('id, from_thread_id, to_thread_id, link_type, status, source, justification')
    .eq('site_id', OCEF_SITE_ID)
  const threadLinks = (stlRaw ?? []) as Array<Record<string, unknown>>

  // ── 8. Références downstream : site_actions / site_reserve / site_deadlines / site_decisions ──
  // (via subject_thread_id, pas via CS direct — on compte par thread appartenant à un CS)
  const { data: actRaw } = await sb
    .from('site_actions')
    .select('id, subject_thread_id, status')
    .eq('site_id', OCEF_SITE_ID)
    .not('subject_thread_id', 'is', null)
  const actions = (actRaw ?? []) as Array<{ id: string; subject_thread_id: string; status: string }>
  const threadToCs = new Map<string, string>()
  for (const s of sti) threadToCs.set(s.subject_thread_id, s.canonical_subject_id)
  const actionsByCs = new Map<string, number>()
  for (const a of actions) {
    const cs = threadToCs.get(a.subject_thread_id)
    if (cs) actionsByCs.set(cs, (actionsByCs.get(cs) ?? 0) + 1)
  }

  // ── 9. canonical_subject_merge (journal existant) ──────────────────────────
  const { data: mergeRaw } = await sb
    .from('canonical_subject_merge')
    .select('id, winner_subject_id, loser_subject_id, suggested_label, resolution_source, merged_at, snapshot')
  const merges = (mergeRaw ?? []) as Array<Record<string, unknown>>
  // filtrer sur les CS du site
  const csIdSet = new Set(allCs.map((c) => c.id))
  const siteMerges = merges.filter((m) => csIdSet.has(m.winner_subject_id as string) || csIdSet.has(m.loser_subject_id as string))

  // ── Génération des candidats P0-1 entre CS actifs (hors acteurs) ───────────
  const activeSubjects = active.filter((c) => !c.company_id && !c.contact_id)
  const normCache = new Map<string, string>()
  for (const c of activeSubjects) normCache.set(c.id, normalizeForMatching(c.label))

  type Candidate = {
    aId: string; bId: string; aLabel: string; bLabel: string
    normA: string; normB: string; jaccard: number
    aOcc: number; bOcc: number; aThreads: number; bThreads: number
    aCreated: string; bCreated: string
  }
  const candidates: Candidate[] = []
  for (let i = 0; i < activeSubjects.length; i++) {
    for (let j = i + 1; j < activeSubjects.length; j++) {
      const a = activeSubjects[i], b = activeSubjects[j]
      const normA = normCache.get(a.id)!, normB = normCache.get(b.id)!
      if (!normA || !normB) continue
      const jac = jaccardSimilarity(normA, normB)
      if (jac >= P01_NORMALIZED_JACCARD_THRESHOLD) {
        candidates.push({
          aId: a.id, bId: b.id, aLabel: a.label, bLabel: b.label,
          normA, normB, jaccard: Number(jac.toFixed(3)),
          aOcc: (occByCs.get(a.id) ?? []).length, bOcc: (occByCs.get(b.id) ?? []).length,
          aThreads: (threadsByCs.get(a.id) ?? []).length, bThreads: (threadsByCs.get(b.id) ?? []).length,
          aCreated: a.created_at, bCreated: b.created_at,
        })
      }
    }
  }
  candidates.sort((x, y) => y.jaccard - x.jaccard)

  const output = {
    site: OCEF_SITE_ID,
    generatedAt: new Date().toISOString(),
    counts: {
      cs_total: allCs.length,
      cs_active: active.length,
      cs_active_non_actor: activeSubjects.length,
      cs_merged: merged.length,
      cs_split: split.length,
      occurrences_total: occ.length,
      occurrences_historical: occ.filter((o) => o.source_kind === 'historical_pdf').length,
      occurrences_field: occ.filter((o) => o.source_kind === 'field_visit').length,
      occurrences_meeting: occ.filter((o) => o.source_kind === 'meeting').length,
      sti_total: sti.length,
      proposals_materialized: props.length,
      similarity_suggestions: suggestions.length,
      canonical_subject_links: csLinks.length,
      subject_thread_links: threadLinks.length,
      actions_linked_to_threads: actions.length,
      existing_merges_site: siteMerges.length,
    },
    activeSubjects: activeSubjects.map((c) => ({
      id: c.id, label: c.label, aliases: c.aliases, created_at: c.created_at,
      occ: (occByCs.get(c.id) ?? []).length,
      threads: (threadsByCs.get(c.id) ?? []).length,
      proposals: propsByCs.get(c.id) ?? 0,
      actions: actionsByCs.get(c.id) ?? 0,
      occDates: (occByCs.get(c.id) ?? []).map((o) => o.effective_date),
    })),
    mergedSubjects: merged.map((c) => ({ id: c.id, label: c.label, merged_into: c.merged_into })),
    similaritySuggestions: suggestions,
    canonicalSubjectLinks: csLinks,
    threadLinks,
    existingMerges: siteMerges,
    candidatePairs: candidates,
  }

  process.stdout.write(JSON.stringify(output, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
