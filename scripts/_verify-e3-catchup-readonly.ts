/**
 * Phase 3 (programme Point de suivi) — contrôle de fermeture READ-ONLY.
 *
 * N'écrit rien. Pour les 2 rapports rattrapés par
 * `_recette-e3-catchup-80105e6d.ts`, reconstruit indépendamment :
 *   - le thread + canonical_subject réellement concernés (via
 *     document_extraction_proposal → subject_thread_identity, même chemin
 *     que la fonction de production, aucune supposition sur l'id gagnant) ;
 *   - l'occurrence historical_pdf qui en résulte ;
 *   - un contrôle de doublons sur la clé d'unicité réelle
 *     (canonical_subject_id, source_ref_id, state_key).
 *
 * L'état « avant catch-up » n'est pas rejouable sans écrire (l'écriture a
 * déjà eu lieu) : la preuve d'absence avant Phase 3 est celle déjà établie
 * par P0-1E-COMPLETUDE-MATERIALISATION-AUDIT.md Section I (2 cas
 * resolved_no_occurrence réels, count=0 occurrence à l'époque de l'audit).
 * Ce script prouve uniquement l'état APRÈS, tel qu'il est en production
 * maintenant, et l'absence de doublon introduit par le rattrapage.
 *
 * Lancer : npx tsx --env-file=.env.local scripts/_verify-e3-catchup-readonly.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'

const TARGET_REPORT_IDS = [
  '95269675-fc48-4bd2-a73e-96fc06a78c01',
  '0981eb71-3ecf-4ed9-9795-df44ffe29cdd',
]

function hr(c = '─', n = 100) {
  return c.repeat(n)
}

async function main() {
  const sb = createAdminClient()

  for (const reportId of TARGET_REPORT_IDS) {
    console.log(hr('═'))
    console.log(`RAPPORT ${reportId}`)
    console.log(hr('═'))

    const { data: report } = await sb
      .from('site_reports')
      .select('id, site_id, extraction_run_id')
      .eq('id', reportId)
      .maybeSingle()
    const typedReport = report as { id: string; site_id: string; extraction_run_id: string | null } | null
    if (!typedReport?.extraction_run_id) {
      console.error('  site_reports introuvable ou extraction_run_id NULL — arrêt pour ce rapport.')
      continue
    }
    console.log(`  site_id=${typedReport.site_id}  extraction_run_id=${typedReport.extraction_run_id}`)

    // Même chemin de résolution que ensureHistoricalPdfOccurrences : proposals du
    // run → subject_thread_id → subject_thread_identity → canonical_subject_id.
    const { data: proposals } = await sb
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, proposal_family')
      .eq('extraction_run_id', typedReport.extraction_run_id)
      .not('subject_thread_id', 'is', null)
    const threadIds = [...new Set((proposals ?? []).map((p) => (p as { subject_thread_id: string }).subject_thread_id))]

    const { data: identities } = await sb
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .eq('site_id', typedReport.site_id)
      .in('subject_thread_id', threadIds.length > 0 ? threadIds : ['00000000-0000-0000-0000-000000000000'])
    const threadToCs = new Map(
      (identities ?? []).map((i) => [(i as { subject_thread_id: string }).subject_thread_id, (i as { canonical_subject_id: string }).canonical_subject_id]),
    )

    console.log(`  threads liés à ce run : ${threadIds.length}, dont identité résolue : ${threadToCs.size}`)

    const csIds = [...new Set(threadToCs.values())]

    const { data: occurrences } = await sb
      .from('canonical_subject_occurrence')
      .select('id, canonical_subject_id, source_ref_id, source_kind, state_key, state_status, label, effective_date, created_at')
      .eq('source_ref_id', reportId)
      .eq('source_kind', 'historical_pdf')
    const typedOcc = (occurrences ?? []) as Array<{
      id: string
      canonical_subject_id: string
      source_ref_id: string
      source_kind: string
      state_key: string | null
      state_status: string | null
      label: string
      effective_date: string
      created_at: string
    }>

    console.log(`\n  Occurrences historical_pdf actuelles pour ce rapport (toutes, ${typedOcc.length}) :`)
    for (const o of typedOcc) {
      const threadHit = [...threadToCs.entries()].find(([, cs]) => cs === o.canonical_subject_id)
      console.log(
        `    id=${o.id}\n` +
          `      canonical_subject_id=${o.canonical_subject_id}${threadHit ? `  (thread=${threadHit[0]})` : '  (thread non résolu par ce run — legacy ou autre voie)'}\n` +
          `      state_key=${o.state_key}  state_status=${o.state_status}  effective_date=${o.effective_date}\n` +
          `      label="${o.label}"  created_at=${o.created_at}`,
      )
    }

    // Threads de CE run qui ont une identité canonique mais AUCUNE occurrence pour
    // ce rapport (devrait être vide après rattrapage, sauf famille non state-bearing).
    const csWithOccurrence = new Set(typedOcc.map((o) => o.canonical_subject_id))
    const missing = csIds.filter((cs) => !csWithOccurrence.has(cs))
    console.log(`\n  canonical_subject résolus pour ce run SANS occurrence pour ce rapport : ${missing.length}`)
    if (missing.length > 0) {
      console.log(`    (attendu si la famille du thread n'est pas STATE_BEARING/observation informative — pas une anomalie en soi)`)
      for (const cs of missing) console.log(`    cs=${cs}`)
    }

    // Doublons sur la clé d'unicité réelle (mig 362) : (canonical_subject_id, source_ref_id, state_key).
    const keyCount = new Map<string, number>()
    for (const o of typedOcc) {
      const key = `${o.canonical_subject_id}|${o.source_ref_id}|${o.state_key ?? 'NULL'}`
      keyCount.set(key, (keyCount.get(key) ?? 0) + 1)
    }
    const duplicates = [...keyCount.entries()].filter(([, n]) => n > 1)
    console.log(`\n  Doublons sur la clé d'unicité (canonical_subject_id, source_ref_id, state_key) : ${duplicates.length}`)
    for (const [key, n] of duplicates) console.log(`    ${key} → ${n} lignes`)

    console.log('')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
