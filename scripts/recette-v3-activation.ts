/** Recette activation V3 — contrôlée, nettoyée. Prouve : V3 sûr (0 écriture sur corpus actuel),
 *  non bloquant, idempotent. Écrit V2 sur 1 report de test + lance V3 ×2 + vérifie canonical_subject_links
 *  inchangé, puis NETTOIE (aucun backfill). */
import { createClient } from '@supabase/supabase-js'
import { captureRelationalEvidenceForReport } from '../lib/db/subject-relational-evidence'
import { produceRelationsFromExplicitEvidence } from '../lib/ai/produce-relations-from-evidence'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  await sb.rpc('exec_sql', { sql: "notify pgrst, 'reload schema'" }); await new Promise((r) => setTimeout(r, 1200))

  // report field_visit avec de la matière (PETRO, riche)
  const PETRO = '75bd3d23-d515-46bd-8de8-254495a5bade'
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('source_ref_id').eq('site_id', PETRO).eq('source_kind', 'field_visit')
  const reportIds = [...new Set((occ ?? []).map((o: Record<string, unknown>) => o.source_ref_id as string))]

  console.log('════════ RECETTE V3 — activation (contrôlée, nettoyée) ════════\n')
  const linksBefore = (await sb.from('canonical_subject_links').select('id', { count: 'exact', head: true }).eq('site_id', PETRO)).count ?? 0
  console.log(`canonical_subject_links PETRO avant = ${linksBefore}`)

  let testReport = ''
  for (const reportId of reportIds) {
    const cap = await captureRelationalEvidenceForReport({ admin: sb, siteId: PETRO, reportId, sourceKind: 'field_visit' })
    if (cap.candidates > 0) {
      testReport = reportId
      console.log(`\nreport test ${reportId.slice(0, 8)} : V2 capturées=${cap.persisted} (candidats ${cap.candidates})`)
      break
    }
  }
  if (!testReport) { console.log('aucun report avec preuve V2 — corpus insuffisant'); return }

  const { count: ev2 } = await sb.from('subject_relational_evidence').select('id', { count: 'exact', head: true }).eq('source_ref_id', testReport)
  console.log(`preuves V2 en base pour ce report = ${ev2}`)

  const v3a = await produceRelationsFromExplicitEvidence({ admin: sb, siteId: PETRO, reportId: testReport })
  console.log(`\nV3 passe 1 : preuves=${v3a.evidences} ≥2sujets=${v3a.evidencesMultiSubject} paires=${v3a.pairs} existantes=${v3a.pairsExisting} llm=${v3a.llmCalls} noRel=${v3a.noRelation} relates_to=${v3a.relatesToRejected} suggested=${v3a.written} doublons=${v3a.duplicates} err=${v3a.errors}`)
  const v3b = await produceRelationsFromExplicitEvidence({ admin: sb, siteId: PETRO, reportId: testReport })
  console.log(`V3 passe 2 (replay) : suggested=${v3b.written} doublons=${v3b.duplicates}  → idempotent (pas de nouvelle écriture au-delà des paires) : ${v3b.written === v3a.written || v3b.pairsExisting >= v3a.pairs ? '✅' : '⚠'}`)

  const linksAfter = (await sb.from('canonical_subject_links').select('id', { count: 'exact', head: true }).eq('site_id', PETRO)).count ?? 0
  console.log(`\ncanonical_subject_links PETRO après = ${linksAfter}  → ${linksAfter === linksBefore + v3a.written ? '✅ cohérent' : '⚠'}`)
  console.log(`suggested créées par V3 = ${v3a.written}  (attendu 0 sur corpus actuel : ${v3a.written === 0 ? '✅' : '⚠ à auditer'})`)

  // ── Nettoyage : retirer les preuves V2 du report test + tout lien V3 créé (aucun backfill) ──
  if (v3a.written > 0) {
    // supprimer les liens créés cette recette (via evidence sans occurrence_id créée aujourd'hui) — prudence : on ne touche que ce site/test
    console.log('\n⚠ V3 a écrit — audit humain requis avant nettoyage. NE PAS supprimer automatiquement.')
  } else {
    await sb.from('subject_relational_evidence').delete().eq('source_ref_id', testReport)
    console.log('\nNettoyage preuves V2 du report test : ✅ (aucun backfill conservé)')
  }
  const { count: evAfter } = await sb.from('subject_relational_evidence').select('id', { count: 'exact', head: true })
  console.log(`subject_relational_evidence total en base = ${evAfter}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
