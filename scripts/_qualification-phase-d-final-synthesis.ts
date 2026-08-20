// P0 qualification — synthèse transversale finale : agrège les 25 comparison.json
// (7 Phase C + 18 Phase D) en une matrice recall/precision par famille, pondérée
// par le nombre réel d'éléments. Lecture seule, aucun calcul de correction.
//
// Usage : npx tsx scripts/_qualification-phase-d-final-synthesis.ts
import { readFileSync, writeFileSync } from 'node:fs'

const PHASE_C = ['BTP_008', 'ENV_001', 'IND_002', 'JAR_01', 'LRM_01', 'QHSE_004', 'VRD_002']
const PHASE_D = [
  'LRM_CR04', 'LRM_CR07', 'HER_CR01', 'HER_CR05', 'HER_CR10', 'MEL_CR01', 'MEL_CR03',
  'JAR_CR02', 'JAR_CR04', 'BTP_009', 'EAU_001', 'EAU_002', 'OPC_003', 'OPC_006',
  'QHSE_002', 'REC_001', 'VRD_005', 'AUT_004',
]
const ALL = [...PHASE_C, ...PHASE_D]
const DIR = 'docs/qualification-runs'

// Les 25 comparison.json ont été produits par des agents différents sans schéma
// strictement unique (surtout les 7 Phase C, antérieurs à la formalisation de la
// méthodologie). Cette normalisation tolère toutes les variantes de nommage
// observées à l'inspection manuelle plutôt que de forcer un seul jeu de clés.
type AnyRec = Record<string, unknown>
function num(obj: AnyRec, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && !Number.isNaN(v)) return v
  }
  return 0
}
function normRecall(v: AnyRec) {
  return {
    referenceTotal: num(v, ['referenceTotal', 'totalReference', 'referenceCount', 'total']),
    matched: num(v, ['matched', 'matchedCount']),
    partial: num(v, ['partial']),
    misclassified: num(v, ['misclassified']),
    missed: num(v, ['missed']),
  }
}
function normPrecision(v: AnyRec) {
  return {
    totalProposals: num(v, ['totalProposals', 'proposalsCount', 'total', 'denominator']),
    truePositives: num(v, ['truePositives', 'truePositive']),
    misclassifiedFromOtherFamily: num(v, ['misclassifiedFromOtherFamily']),
    falsePositives: num(v, ['falsePositives', 'falsePositive']),
    legitimateExtra: num(v, ['legitimateExtra']),
  }
}

const recallAgg: Record<string, { referenceTotal: number; matched: number; partial: number; misclassified: number; missed: number; docs: Set<string> }> = {}
const precisionAgg: Record<string, { totalProposals: number; truePositives: number; misclassifiedFromOtherFamily: number; falsePositives: number; legitimateExtra: number; docs: Set<string> }> = {}
const perDocSummary: Array<{ corpusId: string; phase: string; refCount: number; overallRecall: number; propCount: number; overallPrecision: number; falsePositives: number }> = []

function ensureRecall(fam: string) {
  if (!recallAgg[fam]) recallAgg[fam] = { referenceTotal: 0, matched: 0, partial: 0, misclassified: 0, missed: 0, docs: new Set() }
  return recallAgg[fam]
}
function ensurePrecision(fam: string) {
  if (!precisionAgg[fam]) precisionAgg[fam] = { totalProposals: 0, truePositives: 0, misclassifiedFromOtherFamily: 0, falsePositives: 0, legitimateExtra: 0, docs: new Set() }
  return precisionAgg[fam]
}

for (const corpusId of ALL) {
  const phase = PHASE_C.includes(corpusId) ? 'C' : 'D'
  const raw = JSON.parse(readFileSync(`${DIR}/${corpusId}/comparison.json`, 'utf8'))
  const recallByFamily = (raw.recallByFamily ?? {}) as Record<string, AnyRec>
  const precisionByFamily = (raw.precisionByFamily ?? {}) as Record<string, AnyRec>

  let docRefTotal = 0, docMatched = 0, docPartial = 0, docMisclass = 0, docMissed = 0
  let docProps = 0, docTP = 0, docFP = 0, docLegit = 0

  for (const [fam, raw2] of Object.entries(recallByFamily)) {
    if (fam === 'overall') continue
    const v = normRecall(raw2)
    const a = ensureRecall(fam)
    a.referenceTotal += v.referenceTotal
    a.matched += v.matched
    a.partial += v.partial
    a.misclassified += v.misclassified
    a.missed += v.missed
    if (v.referenceTotal > 0) a.docs.add(corpusId)
    docRefTotal += v.referenceTotal
    docMatched += v.matched
    docPartial += v.partial
    docMisclass += v.misclassified
    docMissed += v.missed
  }
  for (const [fam, raw2] of Object.entries(precisionByFamily)) {
    if (fam === 'overall' || fam === 'note') continue
    const v = normPrecision(raw2 as AnyRec)
    const a = ensurePrecision(fam)
    a.totalProposals += v.totalProposals
    a.truePositives += v.truePositives
    a.misclassifiedFromOtherFamily += v.misclassifiedFromOtherFamily
    a.falsePositives += v.falsePositives
    a.legitimateExtra += v.legitimateExtra
    if (v.totalProposals > 0) a.docs.add(corpusId)
    docProps += v.totalProposals
    docTP += v.truePositives
    docFP += v.falsePositives
    docLegit += v.legitimateExtra
  }

  perDocSummary.push({
    corpusId,
    phase,
    refCount: docRefTotal,
    overallRecall: docRefTotal > 0 ? (docMatched + 0.5 * docPartial) / docRefTotal : 0,
    propCount: docProps,
    overallPrecision: docProps > 0 ? docTP / docProps : 0,
    falsePositives: docFP,
  })
}

console.log('=== RECALL PAR FAMILLE (25 documents, Phase C + Phase D) ===\n')
console.log('famille'.padEnd(16), 'ref'.padStart(5), 'matched'.padStart(8), 'partial'.padStart(8), 'misclass'.padStart(9), 'missed'.padStart(7), 'recall'.padStart(8), 'docs'.padStart(5))
const famOrder = ['person', 'company', 'deadline', 'decision', 'action', 'observation', 'knowledge_fact', 'reservation']
for (const fam of famOrder) {
  const a = recallAgg[fam]
  if (!a) continue
  const recall = a.referenceTotal > 0 ? (a.matched + 0.5 * a.partial) / a.referenceTotal : 0
  console.log(
    fam.padEnd(16),
    String(a.referenceTotal).padStart(5),
    String(a.matched).padStart(8),
    String(a.partial).padStart(8),
    String(a.misclassified).padStart(9),
    String(a.missed).padStart(7),
    recall.toFixed(4).padStart(8),
    String(a.docs.size).padStart(5)
  )
}

console.log('\n=== PRECISION PAR FAMILLE (25 documents, Phase C + Phase D) ===\n')
console.log('famille'.padEnd(16), 'props'.padStart(6), 'TP'.padStart(6), 'misclass_in'.padStart(12), 'FP'.padStart(5), 'legit_extra'.padStart(12), 'precision'.padStart(10), 'docs'.padStart(5))
for (const fam of famOrder) {
  const a = precisionAgg[fam]
  if (!a) continue
  const precision = a.totalProposals > 0 ? a.truePositives / a.totalProposals : 0
  console.log(
    fam.padEnd(16),
    String(a.totalProposals).padStart(6),
    String(a.truePositives).padStart(6),
    String(a.misclassifiedFromOtherFamily).padStart(12),
    String(a.falsePositives).padStart(5),
    String(a.legitimateExtra).padStart(12),
    precision.toFixed(4).padStart(10),
    String(a.docs.size).padStart(5)
  )
}

const totalRef = Object.values(recallAgg).reduce((s, a) => s + a.referenceTotal, 0)
const totalMatched = Object.values(recallAgg).reduce((s, a) => s + a.matched, 0)
const totalPartial = Object.values(recallAgg).reduce((s, a) => s + a.partial, 0)
const totalMisclass = Object.values(recallAgg).reduce((s, a) => s + a.misclassified, 0)
const totalMissed = Object.values(recallAgg).reduce((s, a) => s + a.missed, 0)
const totalProps = Object.values(precisionAgg).reduce((s, a) => s + a.totalProposals, 0)
const totalTP = Object.values(precisionAgg).reduce((s, a) => s + a.truePositives, 0)
const totalFP = Object.values(precisionAgg).reduce((s, a) => s + a.falsePositives, 0)
const totalLegitExtra = Object.values(precisionAgg).reduce((s, a) => s + a.legitimateExtra, 0)

console.log('\n=== GLOBAL CORPUS (25 documents, tous scorables) ===')
console.log(`Éléments de référence : ${totalRef}`)
console.log(`  MATCHED : ${totalMatched} | PARTIAL : ${totalPartial} | MISCLASSIFIED : ${totalMisclass} | MISSED : ${totalMissed}`)
console.log(`  Recall global (strict familles) : ${((totalMatched + 0.5 * totalPartial) / totalRef * 100).toFixed(2)}%`)
console.log(`  "Contenu retrouvé" (MATCHED+PARTIAL+MISCLASSIFIED, ignorant la famille) : ${((totalMatched + totalPartial + totalMisclass) / totalRef * 100).toFixed(2)}%`)
console.log(`Propositions MemorIA : ${totalProps}`)
console.log(`  Vrais positifs (bonne famille) : ${totalTP} | FAUX POSITIFS (fabrication) : ${totalFP} | Legitimate extra : ${totalLegitExtra}`)
console.log(`  Precision globale (bonne famille) : ${(totalTP / totalProps * 100).toFixed(2)}%`)
console.log(`  Taux de fabrication (FP/total propositions) : ${(totalFP / totalProps * 100).toFixed(2)}%`)

console.log('\n=== BASELINE PAR DOCUMENT ===')
console.log('corpusId'.padEnd(12), 'phase'.padStart(6), 'ref'.padStart(5), 'recall'.padStart(8), 'props'.padStart(6), 'precision'.padStart(10), 'FP'.padStart(4))
for (const d of perDocSummary) {
  console.log(
    d.corpusId.padEnd(12),
    d.phase.padStart(6),
    String(d.refCount).padStart(5),
    d.overallRecall.toFixed(4).padStart(8),
    String(d.propCount).padStart(6),
    d.overallPrecision.toFixed(4).padStart(10),
    String(d.falsePositives).padStart(4)
  )
}

const outJson = {
  corpusScored: ALL,
  technicalFailures: ['QHSE_003 (timeout persistant, jamais résolu, exclu du scoring)'],
  transientTechnicalRecovery: ['BTP_009 (timeout au 1er essai à 246900ms, succès au 2e essai identique à 152016ms)'],
  semanticFailureZeroRecall: [
    'ENV_001 (Phase C — succès technique, 0 proposition produite sur 34 éléments réels de référence)',
    'OPC_006 (Phase D — succès technique, 0 proposition produite sur 38 éléments réels de référence)',
  ],
  zeroToleranceDocuments: ['BTP_008 (0 élément réel en référence — vérification anti-hallucination pure, PASS)'],
  recallByFamily: Object.fromEntries(famOrder.filter((f) => recallAgg[f]).map((f) => {
    const a = recallAgg[f]
    return [f, { referenceTotal: a.referenceTotal, matched: a.matched, partial: a.partial, misclassified: a.misclassified, missed: a.missed, recall: a.referenceTotal > 0 ? (a.matched + 0.5 * a.partial) / a.referenceTotal : 0, docCount: a.docs.size }]
  })),
  precisionByFamily: Object.fromEntries(famOrder.filter((f) => precisionAgg[f]).map((f) => {
    const a = precisionAgg[f]
    return [f, { totalProposals: a.totalProposals, truePositives: a.truePositives, misclassifiedFromOtherFamily: a.misclassifiedFromOtherFamily, falsePositives: a.falsePositives, legitimateExtra: a.legitimateExtra, precision: a.totalProposals > 0 ? a.truePositives / a.totalProposals : 0, docCount: a.docs.size }]
  })),
  global: {
    referenceTotal: totalRef, matched: totalMatched, partial: totalPartial, misclassified: totalMisclass, missed: totalMissed,
    recallStrict: (totalMatched + 0.5 * totalPartial) / totalRef,
    contentFoundIgnoringFamily: (totalMatched + totalPartial + totalMisclass) / totalRef,
    totalProposals: totalProps, truePositives: totalTP, falsePositives: totalFP, legitimateExtra: totalLegitExtra,
    precision: totalTP / totalProps,
    fabricationRate: totalFP / totalProps,
  },
  perDocument: perDocSummary,
}
writeFileSync(`${DIR}/phase-d-final-synthesis-data.json`, JSON.stringify(outJson, null, 2))
console.log(`\n-> ${DIR}/phase-d-final-synthesis-data.json écrit`)
