// Dry-run relations OCEF Compostage — P0-B2 validation
//
// Objectif : valider que le corpus historique (200 occurrences historical_pdf)
// fait émerger des relations directionnelles fiables.
//
// Quatre indicateurs clés :
//   1. Nombre de paires candidates générées
//   2. Répartition no_relation / relates_to / directional
//   3. Qualité humaine d'un échantillon des directionnelles
//   4. Taux de faux positifs
//
// Configuration :
//   minCooccurrences = 2 (filtre plus strict qu'une calibration PETRO)
//   minLift = 1.5 (conservé)
//   maxCandidatesPerRun = 30 (top 30 pour un audit humain complet)
//   dryRun = true (aucune écriture)

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { produceRelationsFromOccurrences } from '../lib/ai/produce-relations-from-occurrences'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SITE_ID      = process.env.TARGET_SITE_ID ?? '2c939e67-e986-4635-86a0-638cda870480'

function hr(c = '─', n = 80) { return c.repeat(n) }

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // ── 1. Chantier ────────────────────────────────────────────────────────────
  const { data: sites } = await admin.from('sites').select('id, name').eq('id', SITE_ID)
  const siteName = sites?.[0]?.name ?? SITE_ID
  console.log(`\nChantier : ${siteName}`)
  console.log(`Configuration : minCooccurrences=2 | minLift=1.5 | maxCandidates=30 | dryRun=true`)
  console.log(hr())

  // ── 2. Corpus disponible ───────────────────────────────────────────────────
  const { data: allOcc } = await admin
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_ref_id, source_kind, effective_date, label, note')
    .eq('site_id', SITE_ID)
    .in('source_kind', ['field_visit', 'meeting', 'historical_pdf'])

  if (!allOcc || allOcc.length === 0) {
    console.error('Aucune occurrence disponible.')
    process.exit(1)
  }

  const byKind = {
    field_visit:   allOcc.filter(o => o.source_kind === 'field_visit').length,
    meeting:       allOcc.filter(o => o.source_kind === 'meeting').length,
    historical_pdf: allOcc.filter(o => o.source_kind === 'historical_pdf').length,
  }
  const visitIds     = new Set(allOcc.map(o => o.source_ref_id as string))
  const distinctCS   = new Set(allOcc.map(o => o.canonical_subject_id as string))
  const withNote     = allOcc.filter(o => o.note && (o.note as string).trim())

  console.log(`Occurrences totales : ${allOcc.length}`)
  console.log(`  field_visit     : ${byKind.field_visit}`)
  console.log(`  meeting         : ${byKind.meeting}`)
  console.log(`  historical_pdf  : ${byKind.historical_pdf}`)
  console.log(`Visites/rapports  : ${visitIds.size}`)
  console.log(`Sujets distincts  : ${distinctCS.size}`)
  console.log(`Avec note réelle  : ${withNote.length}  (${allOcc.length - withNote.length} label seul)`)

  // ── 3. Dry-run moteur ───────────────────────────────────────────────────────
  console.log(`\n${hr()}`)
  console.log('DRY-RUN — aucune écriture')
  console.log(hr())

  const result = await produceRelationsFromOccurrences({
    siteId:         SITE_ID,
    admin,
    dryRun:         true,
    configOverride: { minCooccurrences: 2, maxCandidatesPerRun: 30 },
  })

  // ── 4. Compteurs globaux ────────────────────────────────────────────────────
  console.log(`\n${hr('═')}`)
  console.log('COMPTEURS')
  console.log(hr('═'))
  console.log(`totalVisits              : ${result.totalVisits}`)
  console.log(`totalPairs               : ${result.totalPairs}`)
  console.log(`filteredLowCooccurrence  : ${result.filteredLowCooccurrence}`)
  console.log(`filteredLowLift          : ${result.filteredLowLift}`)
  console.log(`filteredExistingLink     : ${result.filteredExistingLink}`)
  console.log(`skippedTopN              : ${result.skippedTopN}   (au-delà du top 30)`)
  console.log(hr())
  console.log(`candidatesEvaluated      : ${result.candidatesEvaluated}`)
  console.log(`  sameSubjectDetected    : ${result.sameSubjectDetected}`)
  console.log(`  skippedNoEvidence      : ${result.skippedNoEvidence}`)
  console.log(`  noRelation             : ${result.noRelation}`)
  console.log(`  relates_to (rejeté)    : ${result.relatesTo}`)
  console.log(`  directional            : ${result.directional}`)
  console.log(`    skippedLowConf       : ${result.skippedLowConf}`)
  console.log(`    errors               : ${result.errors}`)
  console.log(hr())
  console.log(`finalRelations           : ${result.written}`)
  console.log(hr('═'))

  if (!result.trace || result.trace.length === 0) {
    console.log('\nAucun candidat soumis à Gemini.')
    return
  }

  // ── 5. Répartition des verdicts ────────────────────────────────────────────
  const verdictCounts = result.trace.reduce((acc, c) => {
    acc[c.decision] = (acc[c.decision] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  console.log(`\nRÉPARTITION VERDICTS (${result.trace.length} candidats évalués par Gemini)`)
  for (const [verdict, count] of Object.entries(verdictCounts).sort(([, a], [, b]) => b - a)) {
    const pct = ((count / result.trace.length) * 100).toFixed(0)
    console.log(`  ${verdict.padEnd(25)} : ${count}  (${pct}%)`)
  }

  // ── 6. Détail par candidat ──────────────────────────────────────────────────
  console.log(`\n${hr('═')}`)
  console.log(`CANDIDATS DÉTAIL (${result.trace.length})`)

  for (let i = 0; i < result.trace.length; i++) {
    const c = result.trace[i]
    console.log(`\n${hr()}`)
    console.log(`[${i + 1}/${result.trace.length}]  DÉCISION : ${c.decision.toUpperCase()}`)
    console.log(`  A : "${c.labelA}"`)
    console.log(`  B : "${c.labelB}"`)
    console.log(`  Stats : cooc=${c.cooccurrences}/${c.N}  lift=${c.lift.toFixed(2)}  confAB=${c.confAB.toFixed(2)}  confBA=${c.confBA.toFixed(2)}`)

    for (const ev of c.evidences) {
      console.log(`\n  ── ${ev.visitDate} ──────────────────────────────`)
      const flagA = ev.sourceA === 'subject_label_fallback' ? ' [FALLBACK]' : ''
      const flagB = ev.sourceB === 'subject_label_fallback' ? ' [FALLBACK]' : ''
      console.log(`    A${flagA}: "${ev.excerptSentA.slice(0, 200)}"`)
      console.log(`    B${flagB}: "${ev.excerptSentB.slice(0, 200)}"`)
    }

    if (c.gemini) {
      const dir = c.gemini.direction === 'A_to_B' ? '→' : c.gemini.direction === 'B_to_A' ? '←' : '↔'
      console.log(`\n  Gemini : A ${dir} ${c.gemini.linkType} ${dir} B  conf=${c.gemini.confidence.toFixed(2)}`)
      console.log(`  Justif : "${c.gemini.justification.slice(0, 300)}"`)
    } else {
      console.log('\n  Gemini → (non soumis)')
    }

    const allFallback = c.evidences.length > 0 && c.evidences.every(e =>
      e.sourceA === 'subject_label_fallback' && e.sourceB === 'subject_label_fallback'
    )
    if (allFallback) console.log('  ⚠  Toutes preuves = labels (fallback)')
  }

  // ── 7. Récapitulatif pour audit humain ──────────────────────────────────────
  console.log(`\n${hr('═')}`)
  console.log('RELATIONS RETENUES — audit humain')
  console.log('Verdicts : VALID | WRONG_TYPE | WRONG_DIRECTION | SHOULD_NOT_EXIST')
  console.log(hr('═'))

  const toWrite = result.trace.filter(c => c.decision === 'written')

  if (toWrite.length === 0) {
    console.log('  (aucune relation directionnelle retenue)')
    console.log()
    if (result.relatesTo > 0) {
      console.log(`  ${result.relatesTo} relates_to rejeté(s) par la whitelist — attendu.`)
    }
    if (result.noRelation > 0) {
      console.log(`  ${result.noRelation} no_relation — corpus insuffisant ou paires trop faibles.`)
    }
  } else {
    for (let i = 0; i < toWrite.length; i++) {
      const c = toWrite[i]
      const allFallback = c.evidences.every(e =>
        e.sourceA === 'subject_label_fallback' && e.sourceB === 'subject_label_fallback'
      )
      const w   = allFallback ? '  ⚠ preuves=labels' : ''
      const dir = c.gemini!.direction === 'A_to_B' ? '→' : c.gemini!.direction === 'B_to_A' ? '←' : '↔'
      console.log(`  [${i + 1}] "${c.labelA}"`)
      console.log(`       ${dir} ${c.gemini!.linkType} (conf=${c.gemini!.confidence.toFixed(2)})${w}`)
      console.log(`       "${c.labelB}"`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
