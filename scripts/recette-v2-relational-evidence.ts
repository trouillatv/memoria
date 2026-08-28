/** Recette V2 — subject_relational_evidence. Prouve : conservation phrase 21/21 (extraction pure),
 *  0 occurrence modifiée, idempotence sur replay. Écrit UNIQUEMENT sur 1 report de test (nettoyé ensuite),
 *  PAS de backfill du corpus. */
import { createClient } from '@supabase/supabase-js'
import { extractRelationalEvidence, captureRelationalEvidenceForReport, type RelSource, type RelSubject } from '../lib/db/subject-relational-evidence'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function reloadCache() {
  await sb.rpc('exec_sql', { sql: "notify pgrst, 'reload schema'" })
  await new Promise((r) => setTimeout(r, 1500))
}

async function main() {
  await reloadCache()

  // ── 1. Conservation phrase-level (extraction PURE, aucune écriture) sur tout le corpus visite ──
  const { data: fv } = await sb.from('canonical_subject_occurrence').select('site_id').eq('source_kind', 'field_visit')
  const siteIds = [...new Set((fv ?? []).map((o: Record<string, unknown>) => o.site_id as string))]
  let persistable = 0, subjectSum = 0, multi = 0
  const firstReportPerSite: Array<{ siteId: string; reportId: string }> = []

  for (const siteId of siteIds) {
    const { data: cs } = await sb.from('canonical_subject').select('id, label, company_id, contact_id').eq('site_id', siteId).eq('status', 'active')
    const allSubjects = (cs ?? []).filter((c: Record<string, unknown>) => !c.company_id && !c.contact_id)
    const { data: occ } = await sb.from('canonical_subject_occurrence').select('source_ref_id, canonical_subject_id').eq('site_id', siteId).eq('source_kind', 'field_visit')
    const reportIds = [...new Set((occ ?? []).map((o: Record<string, unknown>) => o.source_ref_id as string))]
    for (const reportId of reportIds) {
      // même restriction que le module : sujets présents dans CE report
      const inReport = new Set((occ ?? []).filter((o: Record<string, unknown>) => o.source_ref_id === reportId).map((o: Record<string, unknown>) => o.canonical_subject_id as string))
      const subjects: RelSubject[] = allSubjects.filter((c: Record<string, unknown>) => inReport.has(c.id as string)).map((c: Record<string, unknown>) => ({ id: c.id as string, label: c.label as string }))
      const { data: rep } = await sb.from('site_reports').select('debrief_analysis').eq('id', reportId).maybeSingle()
      const da = ((rep as Record<string, unknown>)?.debrief_analysis ?? {}) as Record<string, unknown>
      const { data: props } = await sb.from('site_knowledge_proposals').select('id, title, body').eq('report_id', reportId)
      const sources: RelSource[] = [
        { text: String(da.summary ?? '') },
        ...((da.actions as Array<Record<string, unknown>> ?? []).map((a) => ({ text: String(a.rationale ?? '') }))),
        ...((props ?? []) as Array<Record<string, unknown>>).map((p) => ({ text: `${p.title ?? ''}. ${p.body ?? ''}`, sourceProposalId: p.id as string })),
      ]
      const ev = extractRelationalEvidence(sources, subjects)
      persistable += ev.length
      for (const e of ev) { subjectSum += e.subjectIds.length; if (e.subjectIds.length > 2) multi++ }
      if (ev.length > 0 && !firstReportPerSite.find((r) => r.siteId === siteId)) firstReportPerSite.push({ siteId, reportId })
    }
  }
  console.log('════════ RECETTE V2 — subject_relational_evidence ════════\n')
  console.log(`1. CONSERVATION (extraction pure, 0 écriture) :`)
  console.log(`   phrases persistables (≥1 sujet) = ${persistable}   [spec AVANT=2/21 conservées, APRÈS attendu=21/21]`)
  console.log(`   duplication moyenne (sujets/preuve) = ${persistable ? (subjectSum / persistable).toFixed(2) : 0}   [attendu ≈1,19]`)
  console.log(`   phrases >2 sujets = ${multi}`)

  // ── 2. Occurrences INCHANGÉES : empreinte avant/après capture ──────────────
  const testReport = firstReportPerSite[0]
  if (!testReport) { console.log('\n(aucun report avec preuve — corpus insuffisant)'); return }
  const occBefore = await sb.from('canonical_subject_occurrence').select('id, label, note, updated_at').eq('source_ref_id', testReport.reportId)
  const fp = (rows: unknown) => JSON.stringify(rows)

  // ── 3. Capture réelle (1 report de test) + idempotence + nettoyage ─────────
  const sourceKind = 'field_visit' as const
  console.log(`\n2. CAPTURE réelle sur 1 report de test ${testReport.reportId.slice(0, 8)} (nettoyé après) :`)
  const r1 = await captureRelationalEvidenceForReport({ admin: sb, siteId: testReport.siteId, reportId: testReport.reportId, sourceKind })
  console.log(`   passe 1 : candidats=${r1.candidates} persistées=${r1.persisted} doublons=${r1.duplicatesIgnored} err=${r1.errors}`)
  const r2 = await captureRelationalEvidenceForReport({ admin: sb, siteId: testReport.siteId, reportId: testReport.reportId, sourceKind })
  console.log(`   passe 2 (replay) : persistées=${r2.persisted} doublons=${r2.duplicatesIgnored}  → IDEMPOTENT: ${r2.persisted === 0 ? '✅' : '❌'}`)

  const occAfter = await sb.from('canonical_subject_occurrence').select('id, label, note, updated_at').eq('source_ref_id', testReport.reportId)
  console.log(`\n3. OCCURRENCES INCHANGÉES : ${fp(occBefore.data) === fp(occAfter.data) ? '✅ identiques' : '❌ MODIFIÉES'}`)

  // Vérif : evidence en base pour ce report
  const { data: stored } = await sb.from('subject_relational_evidence').select('evidence_text, subject_ids').eq('source_ref_id', testReport.reportId)
  console.log(`\n4. Preuves en base pour ce report = ${(stored ?? []).length}`)
  for (const s of (stored ?? []).slice(0, 3) as Array<Record<string, unknown>>) console.log(`   • [${(s.subject_ids as string[]).length} sujets] « ${String(s.evidence_text).slice(0, 120)} »`)

  // ── 4. Nettoyage — PAS de backfill : on retire les preuves du report de test ──
  const del = await sb.from('subject_relational_evidence').delete().eq('source_ref_id', testReport.reportId)
  console.log(`\n5. Nettoyage report de test (aucun backfill conservé) : ${del.error ? '❌ ' + del.error.message : '✅ supprimé'}`)
  const { count } = await sb.from('subject_relational_evidence').select('id', { count: 'exact', head: true })
  console.log(`   subject_relational_evidence total en base après nettoyage = ${count}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
