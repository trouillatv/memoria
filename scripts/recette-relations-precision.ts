/** Recette PRÉCISION + DIRECTION/TYPE du juge relationnel — READ-ONLY, aucune écriture DB.
 *  Exerce directement qualifyLinkCandidate (Gemini temp 0) sur des paires synthétiques.
 *  Prouve, avant tout branchement : 0 faux positif, 0 direction inversée, 0 type faux sur
 *  MUST_RELATE, abstention si ambigu. Inclut le cas OCEF réel (corrective inversée).
 *
 *  Convention : pairs csIdA='A', csIdB='B'. r.fromId==='A' ⇒ source = A.
 *  MUST_RELATE   → type directionnel attendu + bonne source.
 *  MUST_NOT      → no_relation OU relates_to (rejeté whitelist) ; directionnel = FAUX POSITIF.
 */
import { qualifyLinkCandidate, type CandidatePair } from '../lib/ai/qualify-link-candidates'

const DIRECTIONAL = new Set(['requires', 'enables', 'validates', 'causes', 'replaces'])

function pair(labelA: string, exA: string, labelB: string, exB: string): CandidatePair {
  return {
    csIdA: 'A', labelA, famA: 'observation',
    csIdB: 'B', labelB, famB: 'observation',
    countA: 3, countB: 3, countAB: 3, N: 5,
    lift: 2.0, confAB: 0.8, confBA: 0.8,
    evidence: [{ runId: 'r1', runDate: '2026-05-01', excerptA: exA, excerptB: exB, proposalIdA: '', proposalIdB: '' }],
  }
}

interface Case {
  name: string
  kind: 'MUST_RELATE' | 'MUST_NOT'
  expect?: { type: string; sourceIsA: boolean } // pour MUST_RELATE
  p: CandidatePair
}

const CASES: Case[] = [
  // ── MUST_RELATE : type + direction attendus ──────────────────────────────
  { name: 'prérequis : travaux après validation plans', kind: 'MUST_RELATE',
    expect: { type: 'requires', sourceIsA: true }, // Travaux(A) requires Validation(B)
    p: pair(
      'Travaux électriques', 'Les travaux électriques ne pourront commencer qu\'après validation des plans par la MOE.',
      'Validation des plans', 'La validation des plans conditionne le démarrage des travaux électriques.') },
  { name: 'prérequis : mise en service cuisine ← levée NC élec', kind: 'MUST_RELATE',
    expect: { type: 'requires', sourceIsA: true }, // Cuisine(A) requires Élec(B)
    p: pair(
      'Mise en service cuisine', 'La mise en service de la cuisine est conditionnée à la levée des non-conformités électriques.',
      'Installations électriques', 'Non-conformités électriques à lever avant mise en service de la cuisine.') },
  { name: 'prérequis : hotte ← reprise alim élec', kind: 'MUST_RELATE',
    expect: { type: 'requires', sourceIsA: true }, // Hotte(A) requires Alim(B)
    p: pair(
      'Hotte cuisine', 'Impossible de terminer la hotte tant que l\'alimentation électrique n\'est pas reprise.',
      'Alimentation électrique', 'Reprise de l\'alimentation électrique nécessaire pour achever la hotte.') },
  // ── CAS OCEF RÉEL : corrective inversée — le verrou de ce lot ─────────────
  { name: 'CORRECTIVE (OCEF) : non-conformité EXIGE reprise nivellement', kind: 'MUST_RELATE',
    expect: { type: 'requires', sourceIsA: false }, // Non-conformité(B) requires Reprise(A) → source = B
    p: pair(
      'Reprise nivellement général', 'Une reprise du nivellement est nécessaire suivant le plan annexé au VISA, car une zone est hors tolérance.',
      'Non-conformité zone après la dalle', 'La zone après la dalle est non conforme ; un OS de mise en demeure est en cours et un plan de reprise attendu.') },
  // ── VRAIE CAUSE : le défaut est la conséquence ───────────────────────────
  { name: 'CAUSE réelle : défaut compactage → non-conformité', kind: 'MUST_RELATE',
    expect: { type: 'causes', sourceIsA: true }, // Défaut(A) causes Non-conformité(B)
    p: pair(
      'Défaut de compactage', 'La non-conformité de la zone est causée par un défaut de compactage du remblai.',
      'Non-conformité de la zone', 'Zone non conforme en raison d\'un défaut de compactage constaté.') },
  // ── ENABLES ──────────────────────────────────────────────────────────────
  { name: 'ENABLES : validation plans permet démarrage travaux', kind: 'MUST_RELATE',
    expect: { type: 'enables', sourceIsA: true }, // Validation(A) enables Travaux(B)
    p: pair(
      'Validation des plans', 'La validation des plans permet le démarrage des travaux de gros œuvre.',
      'Travaux gros œuvre', 'Démarrage des travaux de gros œuvre rendu possible par la validation des plans.') },
  // ── VALIDATES ─────────────────────────────────────────────────────────────
  { name: 'VALIDATES : contrôle valide la conformité', kind: 'MUST_RELATE',
    expect: { type: 'validates', sourceIsA: true }, // Contrôle(A) validates Conformité(B)
    p: pair(
      'Contrôle de conformité électrique', 'Le contrôle de conformité électrique valide la conformité de l\'installation.',
      'Conformité de l\'installation électrique', 'Conformité de l\'installation validée par le contrôle.') },
  // ── MUST_NOT_RELATE : 0 directionnel ─────────────────────────────────────
  { name: 'deux sujets même phrase, tous deux réalisés', kind: 'MUST_NOT',
    p: pair(
      'Nettoyage des conduits', 'Le nettoyage des conduits et le contrôle électrique ont été réalisés cette semaine.',
      'Contrôle électrique', 'Le contrôle électrique et le nettoyage des conduits ont été réalisés cette semaine.') },
  { name: 'deux contrôles même domaine', kind: 'MUST_NOT',
    p: pair(
      'Contrôle électrique tableau A', 'Contrôle de conformité du tableau électrique A effectué.',
      'Contrôle électrique tableau B', 'Contrôle de conformité du tableau électrique B effectué.') },
  { name: 'même acteur sur deux sujets', kind: 'MUST_NOT',
    p: pair(
      'Ventilation', 'L\'entreprise DUMEZ intervient sur la ventilation.',
      'Plomberie', 'L\'entreprise DUMEZ intervient également sur la plomberie.') },
  { name: 'même localisation sans dépendance', kind: 'MUST_NOT',
    p: pair(
      'Réfectoire', 'Le réfectoire est situé au rez-de-chaussée.',
      'Local technique', 'Le local technique est également au rez-de-chaussée.') },
  { name: 'vague « concernant » sans causalité', kind: 'MUST_NOT',
    p: pair(
      'Cuisine', 'Un point a été abordé concernant la cuisine et la ventilation.',
      'Ventilation', 'Un point a été abordé concernant la ventilation et la cuisine.') },
]

async function main() {
  let fp = 0, fn = 0, wrongDir = 0, wrongType = 0
  console.log('════════ RECETTE PRÉCISION + DIRECTION/TYPE — juge relationnel (Gemini temp 0) ════════\n')
  for (const c of CASES) {
    const r = await qualifyLinkCandidate(c.p)
    const lt = r?.linkType ?? 'null'
    const isDir = r ? DIRECTIONAL.has(r.linkType) : false
    const srcIsA = r?.fromId === 'A'
    let verdict = '✅'
    if (c.kind === 'MUST_RELATE') {
      if (!isDir) { fn++; verdict = '❌ FAUX NÉGATIF (abstention sur vraie relation)' }
      else {
        if (r!.linkType !== c.expect!.type) { wrongType++; verdict = `❌ TYPE FAUX (attendu ${c.expect!.type})` }
        if (srcIsA !== c.expect!.sourceIsA) { wrongDir++; verdict = (verdict === '✅' ? '❌' : verdict) + ' DIRECTION INVERSÉE' }
      }
    } else {
      if (isDir) { fp++; verdict = '❌ FAUX POSITIF' }
    }
    const srcLabel = r ? (srcIsA ? c.p.labelA : c.p.labelB) : '—'
    const tgtLabel = r ? (srcIsA ? c.p.labelB : c.p.labelA) : '—'
    console.log(`${verdict}  [${c.kind}] ${c.name}`)
    if (isDir) console.log(`      → « ${srcLabel} » ${lt} « ${tgtLabel} »  conf=${r?.confidence?.toFixed(2)}`)
    else console.log(`      → ${lt} conf=${r?.confidence?.toFixed(2) ?? '—'}`)
    console.log()
  }
  console.log('─'.repeat(72))
  console.log(`FAUX POSITIFS (MUST_NOT → directionnel)   : ${fp}   ← 0`)
  console.log(`faux négatifs (MUST_RELATE → abstention)  : ${fn}   ← 0`)
  console.log(`DIRECTIONS INVERSÉES                      : ${wrongDir}   ← 0`)
  console.log(`TYPES FAUX sur MUST_RELATE                : ${wrongType}   ← 0`)
  const clean = fp === 0 && fn === 0 && wrongDir === 0 && wrongType === 0
  console.log(clean ? '\n✅ DRY-RUN PROPRE — direction & type maîtrisés' : '\n❌ NON PROPRE — ne pas brancher')
  process.exit(clean ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
