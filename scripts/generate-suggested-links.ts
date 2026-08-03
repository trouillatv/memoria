/**
 * Génération des suggestions de dépendances inter-sujets canoniques (V1)
 *
 * Approche : extraction relationnelle bornée par run/PV.
 * Pour chaque PV canonique du chantier, on identifie les sujets présents ayant
 * un sourceExcerpt, puis on demande à Gemini de trouver (≤5) relations
 * explicitement démontrées par le texte. Aucune promotion confirmed automatique.
 *
 * Idempotence : la contrainte UNIQUE (site_id, from_thread_id, to_thread_id, link_type)
 * empêche les doublons. Les paires rejected ou déjà suggested sont filtrées avant appel.
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/generate-suggested-links.ts --site <siteId>
 *   npx tsx --env-file=.env.local scripts/generate-suggested-links.ts --site <siteId> --live
 */

import { createClient } from '@supabase/supabase-js'
import { suggestDependenciesForRun } from '../lib/ai/suggest-dependencies'
import type { SubjectInRun } from '../lib/ai/suggest-dependencies'

// ── Config ────────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceKey) {
  console.error('[FATAL] NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

// ── Args ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const siteIdx = argv.indexOf('--site')
const SITE_ID = siteIdx >= 0 ? argv[siteIdx + 1] : null
const DRY_RUN = !argv.includes('--live')

if (!SITE_ID) {
  console.error('Usage : npx tsx --env-file=.env.local scripts/generate-suggested-links.ts --site <siteId> [--live]')
  process.exit(1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function runEffectiveDate(run: { created_at: string; documents: { effective_date: string | null } | null }): string {
  return run.documents?.effective_date ?? run.created_at
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== generate-suggested-links — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} ===\n`)

  // ── 1. Site ──────────────────────────────────────────────────────────────────

  const { data: site } = await supabase.from('sites').select('id, name').eq('id', SITE_ID).maybeSingle()
  if (!site) { console.error('[FATAL] Site introuvable :', SITE_ID); process.exit(1) }
  console.log(`Chantier : "${site.name}" (${SITE_ID?.slice(0, 8)}…)\n`)

  // ── 2. Runs canoniques ───────────────────────────────────────────────────────

  const { data: rawRuns, error: runErr } = await supabase
    .from('document_extraction_run')
    .select('id, document_id, created_at, documents!document_id(effective_date)')
    .eq('target_site_id', SITE_ID)
    .eq('is_canonical', true)
    .order('created_at', { ascending: true })

  if (runErr) { console.error('[FATAL] runs:', runErr.message); process.exit(1) }

  type RunRow = { id: string; document_id: string; created_at: string; documents: { effective_date: string | null } | null }
  const runs = ((rawRuns ?? []) as unknown as RunRow[]).sort((a, b) => {
    const da = runEffectiveDate(a), db = runEffectiveDate(b)
    return da !== db ? da.localeCompare(db) : a.created_at.localeCompare(b.created_at)
  })

  console.log(`Runs canoniques : ${runs.length}`)

  // ── 3. STI : thread_id → canonical_subject_id pour ce chantier ──────────────

  const { data: stiRows } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', SITE_ID)

  type StiRow = { subject_thread_id: string; canonical_subject_id: string }
  const threadToCs = new Map<string, string>()
  const csToThread = new Map<string, string>() // un thread représentatif par canonical
  for (const r of (stiRows ?? []) as StiRow[]) {
    threadToCs.set(r.subject_thread_id, r.canonical_subject_id)
    if (!csToThread.has(r.canonical_subject_id)) csToThread.set(r.canonical_subject_id, r.subject_thread_id)
  }

  // ── 4. Labels canoniques ─────────────────────────────────────────────────────

  const { data: csRows } = await supabase
    .from('canonical_subject')
    .select('id, label, family')
    .eq('site_id', SITE_ID)

  type CsRow = { id: string; label: string; family: string | null }
  const csLabels   = new Map<string, string>()
  const csFamilies = new Map<string, string>()
  for (const r of (csRows ?? []) as CsRow[]) {
    csLabels.set(r.id, r.label)
    if (r.family) csFamilies.set(r.id, r.family)
  }

  // ── 5. Liens existants — pour filtrage des doublons ──────────────────────────

  const { data: existingLinks } = await supabase
    .from('subject_thread_links')
    .select('from_thread_id, to_thread_id, link_type, status')
    .eq('site_id', SITE_ID)

  type LinkRow = { from_thread_id: string; to_thread_id: string; link_type: string; status: string }
  const existingSet = new Set<string>()
  for (const l of (existingLinks ?? []) as LinkRow[]) {
    existingSet.add(`${l.from_thread_id}:${l.to_thread_id}:${l.link_type}`)
    existingSet.add(`${l.to_thread_id}:${l.from_thread_id}:${l.link_type}`) // symétrie pour éviter l'inverse aussi
  }

  // ── 6. Boucle par run ────────────────────────────────────────────────────────

  let totalCandidateRuns  = 0
  let totalSuggestionsRaw = 0
  let totalInserted       = 0
  let totalSkipped        = 0

  for (const run of runs) {
    const effectiveDate = runEffectiveDate(run)

    // Propositions du run avec sourceExcerpt non vide
    const { data: props } = await supabase
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, label, source_excerpt')
      .eq('extraction_run_id', run.id)
      .not('subject_thread_id', 'is', null)
      .not('source_excerpt', 'is', null)
      .neq('source_excerpt', '')

    type PropRow = { id: string; subject_thread_id: string; label: string; source_excerpt: string }
    const propRows = (props ?? []) as PropRow[]

    // Grouper par canonical_subject_id — un seul extrait représentatif par canonical
    const byCs = new Map<string, SubjectInRun>()
    for (const p of propRows) {
      const csId = threadToCs.get(p.subject_thread_id)
      if (!csId) continue
      const family = csFamilies.get(csId)
      if (family === 'person' || family === 'company') continue
      if (byCs.has(csId)) continue // premier extrait gagné
      byCs.set(csId, {
        canonicalSubjectId: csId,
        threadId: csToThread.get(csId) ?? p.subject_thread_id,
        label: csLabels.get(csId) ?? p.label,
        proposalId: p.id,
        sourceExcerpt: p.source_excerpt,
      })
    }

    const subjects = [...byCs.values()]
    if (subjects.length < 2) continue // pas assez de sujets distincts

    totalCandidateRuns++
    process.stdout.write(`  PV ${effectiveDate} — ${subjects.length} sujets avec extrait... `)

    const suggestions = await suggestDependenciesForRun(subjects, effectiveDate)
    totalSuggestionsRaw += suggestions.length

    if (suggestions.length === 0) {
      console.log('0 relation détectée.')
      continue
    }

    console.log(`${suggestions.length} relation(s) :`)

    for (const s of suggestions) {
      const fromThread = csToThread.get(s.fromCanonicalSubjectId)
      const toThread   = csToThread.get(s.toCanonicalSubjectId)
      if (!fromThread || !toThread) { totalSkipped++; continue }

      const key = `${fromThread}:${toThread}:${s.linkType}`
      const fromLabel = csLabels.get(s.fromCanonicalSubjectId) ?? s.fromCanonicalSubjectId.slice(0, 8)
      const toLabel   = csLabels.get(s.toCanonicalSubjectId)   ?? s.toCanonicalSubjectId.slice(0, 8)
      const conf      = Math.round(s.confidence * 100)

      if (existingSet.has(key)) {
        console.log(`    ⏭  [${conf}%] "${fromLabel}" ──${s.linkType}──▶ "${toLabel}" (déjà présent)`)
        totalSkipped++
        continue
      }

      console.log(`    ${DRY_RUN ? '🔍' : '✅'} [${conf}%] "${fromLabel}" ──${s.linkType}──▶ "${toLabel}"`)
      console.log(`       Justification : ${s.justification}`)

      if (!DRY_RUN) {
        const { error } = await supabase.from('subject_thread_links').insert({
          site_id:              SITE_ID,
          from_thread_id:       fromThread,
          to_thread_id:         toThread,
          link_type:            s.linkType,
          status:               'suggested',
          source:               'extraction',
          confidence:           s.confidence,
          justification:        s.justification,
          evidence_run_id:      run.id,
          evidence_proposal_id: s.evidenceProposalId,
        })
        if (error) {
          // Conflit unique = déjà présent entre sessions ou race condition
          if (error.code === '23505') {
            console.log(`       ⏭  Doublon ignoré (contrainte unique).`)
            totalSkipped++
          } else {
            console.error(`       ❌ Erreur INSERT :`, error.message)
          }
        } else {
          totalInserted++
          existingSet.add(key) // éviter doublon intra-session
        }
      } else {
        totalInserted++ // compteur dry-run
      }
    }
  }

  // ── 7. Résumé ─────────────────────────────────────────────────────────────────

  console.log('\n=== Résumé ===')
  console.log(`  PVs avec ≥2 sujets analysés : ${totalCandidateRuns} / ${runs.length}`)
  console.log(`  Relations détectées par LLM  : ${totalSuggestionsRaw}`)
  console.log(`  Relations déjà présentes     : ${totalSkipped}`)
  console.log(DRY_RUN
    ? `  Relations à créer (dry-run)  : ${totalInserted}`
    : `  Relations insérées           : ${totalInserted}`)

  if (DRY_RUN && totalInserted > 0) {
    console.log('\n🔍 DRY RUN — aucune écriture. Relancer avec --live pour appliquer.')
  } else if (!DRY_RUN && totalInserted === 0) {
    console.log('\n✅ Aucune nouvelle suggestion — base déjà à jour.')
  } else if (!DRY_RUN) {
    console.log('\n✅ Suggestions insérées. Ouvrir les fiches des sujets pour Accepter / Refuser.')
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1) })
