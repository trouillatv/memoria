/**
 * Apply production — 2 relations validées manuellement (calibration 2026-08-08)
 *
 * Décisions de validation humaine :
 *   [2] Interdiction étaler déblais ↔ Rapport mairie      → INSÉRER  relates_to
 *   [8] Mise en place balisage      ↔ Assainissement Busages → INSÉRER  relates_to
 *   [7] Essais bétons (×2)          → SKIP (lien existant, revue type séparée)
 *  [14] Avis G3 ↔ Plan de VRD       → REJETÉ (cooccurrence documentaire, preuve insuffisante)
 *  [18] Balisage ↔ Plan de VRD      → REJETÉ (même raison, risque hub artificiel)
 *
 * Doctrine de calibration :
 *   semanticEvidence  = les extraits contiennent des éléments reliant réellement A et B
 *   cooccurrenceEvidence = A et B sont simplement présents dans le même document
 *   Une relation ne devient suggested que sur semanticEvidence.
 *   La confiance LLM (0.80) ne suffit pas si l'évidence est purement cooccurrenceEvidence.
 *
 * Idempotence : ON CONFLICT DO NOTHING sur la contrainte UNIQUE(site_id, from, to, link_type)
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/apply-top2-relations.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!supabaseUrl || !serviceKey) {
  console.error('[FATAL] Variables d\'environnement manquantes')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

const SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'

// Canonical subject IDs des 2 paires validées (issus de review-top5-relations.ts)
const VALIDATED_PAIRS = [
  {
    label: '[2] Interdiction déblais ↔ Rapport mairie',
    csIdA: '29d49afd-1371-49b2-b520-58808cf7f130',
    csIdB: '4b8207d9-2d6c-4737-8106-2fce474cb6cc',
    confidence: 0.80,
    justification: "Interdiction d'étaler les déblais et Rapport mairie co-documentés dans les mêmes PVs : le rapport mairie est mentionné comme 'transmis par l'entreprise' dans le contexte de l'interdiction.",
  },
  {
    label: '[8] Balisage regards ↔ Assainissement/Busages',
    csIdA: '63cbf067-c5a6-489e-aa83-eb7a7d101f3e',
    csIdB: 'f5cf3a19-be97-40ec-891f-0b1e88cd245a',
    confidence: 0.80,
    justification: "Balisage et couvertures provisoires des regards ouverts et Assainissement/Busages/fonds de regard portent sur le même objet physique (regards du réseau d'assainissement).",
  },
] as const

async function main() {
  console.log('=== Apply top-2 relations validées ===')
  console.log(`Site : ${SITE_ID}\n`)

  // Récupérer les thread IDs pour chaque canonical_subject
  const allCsIds = VALIDATED_PAIRS.flatMap(p => [p.csIdA, p.csIdB])
  const { data: stiRows, error: eSti } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', SITE_ID)
    .in('canonical_subject_id', allCsIds)
  if (eSti) { console.error('[FATAL] subject_thread_identity :', eSti.message); process.exit(1) }

  // cs_id → premier thread_id trouvé
  const csToThread = new Map<string, string>()
  for (const r of stiRows ?? []) {
    if (!csToThread.has(r.canonical_subject_id)) {
      csToThread.set(r.canonical_subject_id, r.subject_thread_id)
    }
  }

  // Récupérer un run de preuve commun pour chaque paire
  const { data: runs } = await supabase
    .from('document_extraction_run').select('id')
    .eq('target_site_id', SITE_ID).eq('is_canonical', true)
    .neq('status', 'failed').neq('status', 'pending')
  const canonicalRunIds = (runs ?? []).map(r => r.id as string)

  const allProps: { subject_thread_id: string; extraction_run_id: string }[] = []
  for (let i = 0; i < canonicalRunIds.length; i += 100) {
    const { data } = await supabase
      .from('document_extraction_proposal')
      .select('subject_thread_id, extraction_run_id')
      .in('extraction_run_id', canonicalRunIds.slice(i, i + 100))
      .not('subject_thread_id', 'is', null)
    allProps.push(...(data ?? []))
  }

  // thread_id → set de run_ids
  const threadRuns = new Map<string, Set<string>>()
  for (const p of allProps) {
    if (!threadRuns.has(p.subject_thread_id)) threadRuns.set(p.subject_thread_id, new Set())
    threadRuns.get(p.subject_thread_id)!.add(p.extraction_run_id)
  }

  let inserted = 0
  let skipped  = 0

  for (const pair of VALIDATED_PAIRS) {
    const threadA = csToThread.get(pair.csIdA)
    const threadB = csToThread.get(pair.csIdB)

    if (!threadA || !threadB) {
      console.error(`[SKIP] Thread manquant pour ${pair.label}`)
      console.error(`       csA=${pair.csIdA} → thread=${threadA ?? 'INTROUVABLE'}`)
      console.error(`       csB=${pair.csIdB} → thread=${threadB ?? 'INTROUVABLE'}`)
      skipped++
      continue
    }

    // Trouver un run commun comme preuve
    const runsA  = threadRuns.get(threadA) ?? new Set<string>()
    const runsB  = threadRuns.get(threadB) ?? new Set<string>()
    const common = [...runsA].find(r => runsB.has(r)) ?? null

    // Ordre canonique : from = lesser UUID (garantit unicité pour relates_to undirected)
    const fromId = threadA < threadB ? threadA : threadB
    const toId   = threadA < threadB ? threadB : threadA

    console.log(`→ ${pair.label}`)
    console.log(`    from_thread_id : ${fromId}`)
    console.log(`    to_thread_id   : ${toId}`)
    console.log(`    evidence_run   : ${common ?? '(aucun)'}`)

    const { error } = await supabase.from('subject_thread_links').insert({
      site_id:         SITE_ID,
      from_thread_id:  fromId,
      to_thread_id:    toId,
      link_type:       'relates_to',
      status:          'suggested',
      source:          'cooccurrence',
      confidence:      pair.confidence,
      justification:   pair.justification,
      evidence_run_id: common,
    })

    if (error) {
      if (error.code === '23505') {
        console.log(`    → SKIP (lien already exists — idempotent)`)
        skipped++
      } else {
        console.error(`    [ERREUR] ${error.message}`)
        skipped++
      }
    } else {
      console.log(`    → INSÉRÉ ✓`)
      inserted++
    }
    console.log()
  }

  console.log('═'.repeat(50))
  console.log(`  Insérés : ${inserted}`)
  console.log(`  Skippés : ${skipped}`)
  console.log()
  console.log('Paires rejetées (exemples négatifs de calibration) :')
  console.log('  [14] Avis G3 ↔ Plan de VRD      — cooccurrenceEvidence uniquement (B = "Plan de VRD ; VISA FAIT")')
  console.log('  [18] Balisage ↔ Plan de VRD     — même raison ; risque hub artificiel sur Plan de VRD')
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1) })
