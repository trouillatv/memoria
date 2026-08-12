// Backfill P0-B2 — canonical_subject_occurrence source_kind='historical_pdf'
//
// Crée les occurrences manquantes pour les PV historiques déjà matérialisés.
// Idempotent : réexécuter ne crée pas de doublons.
//
// Portée : tous les rapports origin=import d'un site donné (ou OCEF Compostage par défaut).
//
// Usage :
//   npx tsx --env-file=.env.local scripts/backfill-historical-pdf-occurrences.ts
//   npx tsx --env-file=.env.local scripts/backfill-historical-pdf-occurrences.ts --write

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const DRY_RUN      = !process.argv.includes('--write')

// Site cible par défaut — OCEF Compostage
const SITE_ID = process.env.TARGET_SITE_ID ?? '2c939e67-e986-4635-86a0-638cda870480'

const ELIGIBLE_FAMILIES = ['action', 'vigilance', 'decision', 'knowledge_fact', 'deadline', 'reservation']

const TEMPORAL_START_RE =
  /^(la\s+semaine|ce\s+(?:soir|matin|midi|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|cette\s+semaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|prochain[e]?|prochainement|demain|[àa]\s+(?:voir|définir|confirmer|planifier|faire|réaliser)|tbd|sous\s+peu|dans\s+(?:la\s+semaine|\d))/i

const MIN_INFORMATIVE_CHARS = 15
const MAX_TEMPORAL_CHARS    = 50

function isInformativeText(t: string): boolean {
  if (t.length < MIN_INFORMATIVE_CHARS) return false
  if (TEMPORAL_START_RE.test(t) && t.length < MAX_TEMPORAL_CHARS) return false
  return true
}

function selectBestText(candidates: string[]): string | null {
  const seen = new Set<string>()
  const pool = candidates
    .map(t => t.trim())
    .filter(t => t.length > 0 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
  const informative = pool.filter(isInformativeText)
  if (informative.length === 0) return null
  informative.sort((a, b) => b.length - a.length)
  return informative[0]
}

function hr(c = '─', n = 80) { return c.repeat(n) }

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  console.log(`\nBackfill historical_pdf occurrences — ${DRY_RUN ? 'DRY-RUN' : 'ÉCRITURE RÉELLE'}`)
  console.log(`Site : ${SITE_ID}`)
  console.log(hr())

  // ── 1. Rapports historiques matérialisés (origin=import, avec extraction_run_id) ──
  const { data: reports, error: repErr } = await admin
    .from('site_reports')
    .select('id, started_at, extraction_run_id')
    .eq('site_id', SITE_ID)
    .eq('origin', 'import')
    .not('extraction_run_id', 'is', null)
    .order('started_at', { ascending: true })

  if (repErr || !reports || reports.length === 0) {
    console.error('Aucun rapport historique matérialisé trouvé:', repErr?.message)
    process.exit(1)
  }

  console.log(`Rapports historiques matérialisés : ${reports.length}`)
  for (const r of reports) {
    const dateStr = r.started_at ? (r.started_at as string).slice(0, 10) : 'null'
    console.log(`  ${r.id}  ${dateStr}  run=${r.extraction_run_id}`)
  }

  // ── 2. Pour chaque rapport, construire les groupes (cs, rapport) ──────────────
  let totalCreated = 0
  let totalSkipped = 0
  let totalErrors  = 0

  for (const report of reports) {
    const runId      = report.extraction_run_id as string
    const reportId   = report.id as string
    if (!report.started_at) {
      console.warn(`  SKIP ${reportId} — started_at NULL`)
      continue
    }
    const visitDate  = (report.started_at as string).slice(0, 10)

    // Propositions éligibles du run avec subject_thread_id
    const { data: proposals } = await admin
      .from('document_extraction_proposal')
      .select('id, proposal_family, label, description, subject_thread_id')
      .eq('extraction_run_id', runId)
      .in('proposal_family', ELIGIBLE_FAMILIES)
      .not('subject_thread_id', 'is', null)

    if (!proposals || proposals.length === 0) {
      console.log(`  ${visitDate} : 0 propositions éligibles`)
      continue
    }

    const threadIds = [...new Set((proposals as { subject_thread_id: string }[]).map(p => p.subject_thread_id))]

    // Thread → canonical_subject
    const { data: stiRows } = await admin
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .eq('site_id', SITE_ID)
      .in('subject_thread_id', threadIds)

    const threadToCs = new Map((stiRows ?? []).map(s => [s.subject_thread_id as string, s.canonical_subject_id as string]))

    // CS labels (fallback)
    const csIds = [...new Set([...threadToCs.values()])]
    const { data: csRows } = await admin.from('canonical_subject').select('id, label').in('id', csIds)
    const csLabelMap = new Map((csRows ?? []).map(c => [c.id as string, c.label as string]))

    // Groupement par canonical_subject_id
    const groups = new Map<string, { canonical_label: string; labels: string[]; descriptions: string[]; count: number }>()
    for (const p of proposals as { id: string; proposal_family: string; label: string; description: string | null; subject_thread_id: string }[]) {
      const csId = threadToCs.get(p.subject_thread_id)
      if (!csId) continue
      if (!groups.has(csId)) {
        groups.set(csId, { canonical_label: csLabelMap.get(csId) ?? p.label, labels: [], descriptions: [], count: 0 })
      }
      const g = groups.get(csId)!
      g.labels.push(p.label)
      if (p.description) g.descriptions.push(p.description)
      g.count++
    }

    console.log(`  ${visitDate} : ${proposals.length} propositions → ${groups.size} groupes (canonical_subject)`)

    for (const [csId, g] of groups) {
      const bestLabel = selectBestText(g.labels) ?? g.canonical_label
      const bestNote  = selectBestText(g.descriptions) ?? null

      const occData = {
        canonical_subject_id: csId,
        site_id: SITE_ID,
        source_kind: 'historical_pdf',
        source_ref_id: reportId,
        source_proposal_id: null,
        visit_status: null,
        label: bestLabel,
        note: bestNote,
        evidence_count: g.count,
        effective_date: visitDate,
        created_by: null,
        validation_status: 'observed',
        entity_ids: [],
      }

      if (DRY_RUN) {
        console.log(`    [DRY] cs=${csId.slice(0, 8)} label="${bestLabel.slice(0, 50)}" evidence=${g.count}`)
        totalCreated++
        continue
      }

      const { error: insertErr } = await admin
        .from('canonical_subject_occurrence')
        .insert(occData)

      if (insertErr) {
        if (insertErr.code === '23505') {
          totalSkipped++
        } else {
          console.error(`    ✗ ${csId} — ${insertErr.code} ${insertErr.message}`)
          totalErrors++
        }
      } else {
        totalCreated++
      }
    }
  }

  console.log(`\n${hr('═')}`)
  if (DRY_RUN) {
    console.log(`DRY-RUN : ${totalCreated} occurrences seraient créées, ${totalErrors} erreurs`)
    console.log(`Relancer avec --write pour appliquer.`)
  } else {
    console.log(`Créées : ${totalCreated}  Déjà présentes : ${totalSkipped}  Erreurs : ${totalErrors}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
