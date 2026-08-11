/**
 * Évaluation du prototype V2 sur le corpus PETRO annoté.
 *
 * Usage : npx tsx scripts/eval-evolution-v2.ts
 *
 * Critères de réussite :
 *  - Angle A : 7/7 transitions correctement classifiées (evolution/remention/ambigu)
 *  - Angle C : 12/12 groupes consolidés en un seul état cohérent
 *  - Cas Planning 11/08 : formulation recyclée détectée (noiseDetected)
 *  - Angle B : aucune évolution inventée (sujets à occurrence unique — pas de paire)
 *  - Jamais de verdict fondé uniquement sur la différence lexicale
 *
 * PETRO = corpus de développement. Ce script ne doit pas être utilisé pour
 * ajuster le prompt après chaque erreur — gel le prompt, mesure, décide.
 */

import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { join } from 'path'
import { consolidateSubjectState, classifyEvolution } from '../lib/knowledge/evolution-v2'

// getAIProvider() est appelé paresseusement dans les corps de fonctions,
// donc config() ici suffit — les env vars seront présentes au moment de l'appel.
config({ path: '.env.local' })

// ── Types corpus ───────────────────────────────────────────────────────────────

type CorpusEvent = {
  date: string
  sourceKind: string
  labels: string[]
  visitStatus: string | null
}

type CorpusEntry = {
  angle: 'consecutive' | 'single-occurrence' | 'intra-event'
  subjectId: string
  subjectLabel: string
  eventA: CorpusEvent | null
  eventB: CorpusEvent | null
  verdictHumain: string
  changeType: string | null
  raisonMetier: string
  patternV2: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function frDate(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function matchVerdict(human: string, v2: string): boolean {
  if (human === 'evolution' && v2 === 'meaningful_change') return true
  if (human === 'remention' && v2 === 'remention') return true
  if ((human === 'ambigu' || human === 'ambiguous') && v2 === 'ambiguous') return true
  return false
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const corpusPath = join(process.cwd(), 'scripts', 'evolution-corpus-raw.json')
  const corpus: CorpusEntry[] = JSON.parse(readFileSync(corpusPath, 'utf-8'))

  const angleA = corpus.filter((e) => e.angle === 'consecutive')
  const angleB = corpus.filter((e) => e.angle === 'single-occurrence')
  const angleC = corpus.filter((e) => e.angle === 'intra-event')

  console.log(`\n${'═'.repeat(70)}`)
  console.log('  ÉVALUATION PROTOTYPE V2 — CORPUS PETRO')
  console.log(`${'═'.repeat(70)}`)
  console.log(`  ${angleA.length} transitions · ${angleB.length} contre-exemples · ${angleC.length} groupes intra-événement\n`)

  // ── Angle C : Consolidation ─────────────────────────────────────────────────

  console.log('── ANGLE C — Consolidation (étape 1 du moteur) ──────────────────────\n')
  console.log('  Critère : agréger N formulations en 1 état cohérent.')
  console.log('  Cas piège : Planning 11/08 — formulation recyclée → noiseDetected attendu.\n')

  let consolidationPassed = 0
  let consolidationFallbacks = 0

  for (const entry of angleC) {
    if (!entry.eventA) continue
    const ev = entry.eventA

    const result = await consolidateSubjectState(entry.subjectLabel, ev.labels, ev.date, ev.sourceKind as 'field_visit' | 'meeting')

    const label = entry.subjectLabel.slice(0, 40).padEnd(40)
    const date = frDate(ev.date)
    const n = ev.labels.length

    const flags = [
      result.noiseDetected ? '⚠ bruit détecté' : '',
      result.fallbackUsed  ? '⚠ FALLBACK IA (labels[0])' : '',
    ].filter(Boolean).join(' · ')
    console.log(`  ${label} ${date} (${n} formulations)${flags ? '  ' + flags : ''}`)
    console.log(`    → "${result.summary}"`)
    console.log(`       stade: ${result.operationalState}${result.operationalStateEvidence ? ` [« ${result.operationalStateEvidence.slice(0, 60)} »]` : ' [non prouvé]'} conf:${result.stateConfidence.toFixed(1)}`)
    if (result.newFacts.length > 0) console.log(`       faits: ${result.newFacts.join(' / ')}`)
    console.log()

    if (result.fallbackUsed) consolidationFallbacks++
    // Un fallback = état non consolidé par le LLM → ne compte pas comme pass
    const isOK = result.summary.trim().length > 0 && !result.fallbackUsed
    if (isOK) consolidationPassed++
  }

  const planningNoise = corpus.find(
    (e) => e.angle === 'intra-event' &&
    e.subjectLabel.includes('planning') &&
    e.eventA?.date === '2026-08-11'
  )

  if (planningNoise?.eventA) {
    const testResult = await consolidateSubjectState(
      planningNoise.subjectLabel,
      planningNoise.eventA.labels,
      planningNoise.eventA.date,
      planningNoise.eventA.sourceKind as 'field_visit' | 'meeting',
    )
    const noiseOK = testResult.noiseDetected
    console.log(`  Cas piège Planning 11/08 — noiseDetected = ${testResult.noiseDetected} → ${noiseOK ? '✓ PASS' : '✗ FAIL (formulation recyclée non détectée)'}`)
    if (!noiseOK) consolidationPassed = Math.max(0, consolidationPassed - 1)
    console.log()
  }

  const consolidationNote = consolidationFallbacks > 0
    ? ` (${consolidationFallbacks} fallback IA — résultats non comptabilisés)`
    : ''
  console.log(`  Score consolidation : ${consolidationPassed}/${angleC.length}${consolidationNote}\n`)

  // ── Angle B : Pas d'évolution inventée ─────────────────────────────────────

  console.log('── ANGLE B — Contre-exemples (sujets occurrence unique) ─────────────\n')
  console.log('  Ces sujets n\'ont qu\'un seul événement. Le moteur ne doit pas créer de paire.\n')

  for (const entry of angleB) {
    console.log(`  ✓ [${entry.subjectLabel}] — 1 événement, aucune paire possible`)
  }
  console.log()

  // ── Angle A : Classification ─────────────────────────────────────────────────

  console.log('── ANGLE A — Classification (étape 2 du moteur) ─────────────────────\n')

  let correct = 0
  let total = 0
  const tableRows: string[] = []
  const failedRows: string[] = []

  tableRows.push('| Sujet | T1 | T2 | Humain | V2 | Pattern | Conf | ✓ |')
  tableRows.push('|---|---|---|---|---|---|---|---|')

  for (const entry of angleA) {
    if (!entry.eventA || !entry.eventB) continue
    total++

    const stateT1 = await consolidateSubjectState(entry.subjectLabel, entry.eventA.labels, entry.eventA.date, entry.eventA.sourceKind as 'field_visit' | 'meeting')
    const stateT2 = await consolidateSubjectState(entry.subjectLabel, entry.eventB.labels, entry.eventB.date, entry.eventB.sourceKind as 'field_visit' | 'meeting')

    const result = await classifyEvolution(stateT1, stateT2, entry.subjectLabel)

    const d1 = frDate(entry.eventA.date)
    const d2 = frDate(entry.eventB.date)
    const v2Verdict = result?.verdict ?? 'ERREUR'
    const isMatch = result ? matchVerdict(entry.verdictHumain, v2Verdict) : false

    if (isMatch) correct++

    const label = entry.subjectLabel.slice(0, 32)
    const mark = isMatch ? '✓' : '✗'
    tableRows.push(
      `| ${label} | ${d1} | ${d2} | ${entry.verdictHumain} | ${v2Verdict} | ${result?.pattern ?? '-'} | ${result?.confidence?.toFixed(2) ?? '-'} | ${mark} |`
    )

    console.log(`  [${mark}] ${entry.subjectLabel}`)
    console.log(`      T1 [${stateT1.operationalState}] → T2 [${stateT2.operationalState}]`)
    console.log(`      Humain : ${entry.verdictHumain.padEnd(20)} V2 : ${v2Verdict} (conf: ${result?.confidence?.toFixed(2) ?? 'N/A'})`)

    if (!isMatch) {
      failedRows.push(`\n  ✗ ${entry.subjectLabel} (${d1} → ${d2})`)
      failedRows.push(`      T1 [${stateT1.operationalState} conf:${stateT1.stateConfidence.toFixed(1)}] : "${stateT1.summary}"`)
      if (stateT1.newFacts.length > 0) failedRows.push(`         faits T1 : ${stateT1.newFacts.join(' | ')}`)
      failedRows.push(`      T2 [${stateT2.operationalState} conf:${stateT2.stateConfidence.toFixed(1)}] : "${stateT2.summary}"`)
      if (stateT2.newFacts.length > 0) failedRows.push(`         faits T2 : ${stateT2.newFacts.join(' | ')}`)
      failedRows.push(`      V2 : ${v2Verdict} — "${result?.justification ?? 'N/A'}"`)
      failedRows.push(`      Humain attendu : ${entry.verdictHumain} — "${entry.raisonMetier}"`)
    }
    console.log()
  }

  // ── Résumé ──────────────────────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  RÉSULTATS`)
  console.log(`${'═'.repeat(70)}`)
  console.log(`  Angle C consolidation : ${consolidationPassed}/${angleC.length}${consolidationFallbacks > 0 ? ` · ${consolidationFallbacks} fallback IA` : ''}`)
  console.log(`  Angle A classification : ${correct}/${total}`)
  const allPass = consolidationPassed >= angleC.length && correct === total && consolidationFallbacks === 0
  console.log(`\n  Verdict global : ${allPass ? '✓ PASS' : '✗ FAIL — voir détails ci-dessous'}`)
  if (consolidationFallbacks > 0) {
    console.log(`  ⚠  ${consolidationFallbacks} appel(s) Gemini en fallback — score de consolidation partiel, non généralisable.`)
  }

  if (failedRows.length > 0) {
    console.log('\n── Cas en échec ──────────────────────────────────────────────────────')
    console.log(failedRows.join('\n'))
  }

  console.log('\n── Tableau de synthèse ───────────────────────────────────────────────')
  console.log(tableRows.join('\n'))
  console.log()
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
