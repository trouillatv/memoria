/**
 * Phase 3 (programme Point de suivi) — rattrapage ponctuel des 2 cas
 * `resolved_no_occurrence` réels connus (P0-1E Section B/I) : le correctif
 * systémique (`catchUpOrphanedHistoricalOccurrences`, wired dans
 * historical-import-post-processing.ts) empêche toute NOUVELLE occurrence
 * d'être orpheline, mais ne peut pas rattraper rétroactivement ces 2 cas :
 * leur `subject_thread_identity` existe déjà depuis que le bug a frappé, donc
 * ils ne généreront plus jamais de `runWrites > 0` dans un futur passage de
 * `reconcileHistoricalCorpusForSite`.
 *
 * Appelle directement la fonction réelle de production `ensureHistoricalPdfOccurrences`
 * (aucune réimplémentation de sa logique) pour les 2 rapports connus :
 *   - 95269675-fc48-4bd2-a73e-96fc06a78c01 (site bebcdf12…) → thread 0dd79c8b →
 *     canonical_subject 634478f6 — cas étalon `80105e6d` (proposal_id)
 *   - 0981eb71… (site à résoudre par requête)
 *
 * N'écrit RIEN d'autre : mêmes garanties que le flux normal (idempotent via
 * cso_historical_pdf_uniq, ne crée ni run ni site_report, ne rejoue jamais
 * materialize_historical_visit, ne touche ni actions ni décisions ni échéances).
 *
 * Lancer : npx tsx --env-file=.env.local scripts/_recette-e3-catchup-80105e6d.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureHistoricalPdfOccurrences } from '@/lib/db/canonical-subject-historical-occurrence'

const KNOWN_ORPHANED_REPORT_PREFIXES = ['95269675', '0981eb71']

function hr(c = '─', n = 90) { return c.repeat(n) }

async function main() {
  const sb = createAdminClient()

  const { data: allReports, error } = await sb
    .from('site_reports')
    .select('id, site_id, extraction_run_id, started_at, source_document_id')
  if (error || !allReports) {
    console.error('site_reports fetch failed:', error?.message)
    process.exit(1)
  }

  const targets = (allReports as Array<{ id: string; site_id: string; extraction_run_id: string | null; started_at: string | null; source_document_id: string | null }>)
    .filter((r) => KNOWN_ORPHANED_REPORT_PREFIXES.some((p) => r.id.startsWith(p)))

  // Rapport historique (origin=import) : started_at n'est jamais renseigné — la
  // date de visite vient du document source (mêmes règles que le correctif E3).
  const docIds = [...new Set(targets.map((t) => t.source_document_id).filter((id): id is string => !!id))]
  const docEffectiveDate = new Map<string, string | null>()
  if (docIds.length > 0) {
    const { data: docs } = await sb.from('documents').select('id, effective_date').in('id', docIds)
    for (const d of (docs ?? []) as Array<{ id: string; effective_date: string | null }>) {
      docEffectiveDate.set(d.id, d.effective_date)
    }
  }
  const visitDateOf = (t: { started_at: string | null; source_document_id: string | null }): string | null =>
    t.started_at ?? (t.source_document_id ? docEffectiveDate.get(t.source_document_id) ?? null : null)

  console.log(hr('═'))
  console.log('RECETTE Phase 3 — rattrapage ponctuel des cas resolved_no_occurrence connus')
  console.log(hr('═'))
  console.log(`Rapports ciblés trouvés : ${targets.length}/${KNOWN_ORPHANED_REPORT_PREFIXES.length}`)
  for (const t of targets) console.log(`  ${t.id}  site=${t.site_id}  run=${t.extraction_run_id}  started_at=${t.started_at}`)

  if (targets.length === 0) {
    console.error('Aucun rapport cible trouvé — arrêt.')
    process.exit(1)
  }

  // Étalon 80105e6d — état AVANT (doit être absent). uuid → filtre en JS (ilike
  // sur colonne uuid échoue silencieusement côté PostgREST, jamais sur le texte).
  const ETALON_CS_PREFIX = '634478f6'
  const etalonReport = targets.find((t) => t.id.startsWith('95269675'))
  if (etalonReport) {
    const { data: beforeAll } = await sb
      .from('canonical_subject_occurrence')
      .select('id, canonical_subject_id, source_ref_id, source_kind')
      .eq('source_ref_id', etalonReport.id)
      .eq('source_kind', 'historical_pdf')
    const before = (beforeAll ?? []).filter((o) => (o as { canonical_subject_id: string }).canonical_subject_id.startsWith(ETALON_CS_PREFIX))
    console.log(`\nÉtalon 80105e6d — occurrences AVANT (cs=634478f6…, report=${etalonReport.id}) : ${before.length}`)
  }

  console.log(`\n${hr()}\nAppel ensureHistoricalPdfOccurrences par rapport ciblé\n${hr()}`)
  for (const t of targets) {
    const visitDate = visitDateOf(t)
    if (!t.extraction_run_id || !visitDate) {
      console.warn(`  SKIP ${t.id} — extraction_run_id ou date de visite (started_at/document.effective_date) NULL`)
      continue
    }
    const result = await ensureHistoricalPdfOccurrences({
      runId: t.extraction_run_id,
      siteId: t.site_id,
      siteReportId: t.id,
      visitDate,
    })
    console.log(`  ${t.id} (${visitDate}) → created=${result.created} skipped=${result.skipped} errors=${result.errors}`)
  }

  if (etalonReport) {
    const { data: afterAll } = await sb
      .from('canonical_subject_occurrence')
      .select('id, canonical_subject_id, source_ref_id, source_kind, state_key, label, effective_date')
      .eq('source_ref_id', etalonReport.id)
      .eq('source_kind', 'historical_pdf')
    const after = (afterAll ?? []).filter((o) => (o as { canonical_subject_id: string }).canonical_subject_id.startsWith(ETALON_CS_PREFIX))
    console.log(`\n${hr()}\nÉtalon 80105e6d — occurrences APRÈS (cs=634478f6…, report=${etalonReport.id}) : ${after.length}`)
    for (const o of after) {
      console.log(`  id=${(o as { id: string }).id} state_key=${(o as { state_key: string }).state_key} label="${(o as { label: string }).label}" effective_date=${(o as { effective_date: string }).effective_date}`)
    }
    if (after.length > 0) {
      console.log('\nVERDICT étalon 80105e6d : PASS — occurrence désormais présente.')
    } else {
      console.log('\nVERDICT étalon 80105e6d : FAIL — toujours absente après rattrapage.')
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
