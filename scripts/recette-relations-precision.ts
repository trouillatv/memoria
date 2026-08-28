/** Recette PRÉCISION du juge relationnel — READ-ONLY, aucune écriture DB.
 *  Exerce directement qualifyLinkCandidate (le LLM juge de produceRelationsFromOccurrences)
 *  sur des paires synthétiques contrôlées. Objectif : prouver 0 faux positif avant de
 *  brancher le moteur en écriture prod. Doctrine : faux négatif > faux positif.
 *
 *  MUST_RELATE   → un type directionnel (requires/enables/validates/causes/replaces).
 *  MUST_NOT_RELATE → no_relation OU relates_to (relates_to = rejeté par la whitelist serveur,
 *                    donc jamais écrit → pas un faux positif). Un type directionnel = FAUX POSITIF.
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

interface Case { name: string; kind: 'MUST_RELATE' | 'MUST_NOT'; p: CandidatePair }

const CASES: Case[] = [
  // ── MUST_RELATE ──────────────────────────────────────────────────────────
  { name: 'électrique après validation plans', kind: 'MUST_RELATE',
    p: pair(
      'Travaux électriques', 'Les travaux électriques ne pourront commencer qu\'après validation des plans par la MOE.',
      'Validation des plans', 'La validation des plans conditionne le démarrage des travaux électriques.') },
  { name: 'mise en service cuisine conditionnée levée NC élec', kind: 'MUST_RELATE',
    p: pair(
      'Mise en service cuisine', 'La mise en service de la cuisine est conditionnée à la levée des non-conformités électriques.',
      'Installations électriques', 'Non-conformités électriques à lever avant mise en service de la cuisine.') },
  { name: 'hotte impossible tant que alim élec non reprise', kind: 'MUST_RELATE',
    p: pair(
      'Hotte cuisine', 'Impossible de terminer la hotte tant que l\'alimentation électrique n\'est pas reprise.',
      'Alimentation électrique', 'Reprise de l\'alimentation électrique nécessaire pour achever la hotte.') },
  // ── MUST_NOT_RELATE ──────────────────────────────────────────────────────
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
  let fp = 0, fn = 0
  console.log('════════ RECETTE PRÉCISION — juge relationnel (Gemini, temp 0) ════════\n')
  for (const c of CASES) {
    const r = await qualifyLinkCandidate(c.p)
    const lt = r?.linkType ?? 'null'
    const isDir = r ? DIRECTIONAL.has(r.linkType) : false
    let verdict: string
    if (c.kind === 'MUST_RELATE') {
      const ok = isDir
      if (!ok) fn++
      verdict = ok ? '✅' : '❌ FAUX NÉGATIF'
    } else {
      const ok = !isDir // no_relation ou relates_to = pas un faux positif (relates_to rejeté whitelist)
      if (!ok) fp++
      verdict = ok ? '✅' : '❌ FAUX POSITIF'
    }
    console.log(`${verdict}  [${c.kind}] ${c.name}`)
    console.log(`      → ${lt}${r?.direction && isDir ? ` (${r.direction})` : ''} conf=${r?.confidence?.toFixed(2) ?? '—'}`)
    if (r?.justification) console.log(`      « ${r.justification.slice(0, 160)} »`)
    console.log()
  }
  console.log('─'.repeat(70))
  console.log(`FAUX POSITIFS (MUST_NOT devenus directionnels) : ${fp}   ← doit être 0`)
  console.log(`faux négatifs (MUST_RELATE ratés)              : ${fn}   (tolérés, doctrine)`)
  console.log(fp === 0 ? '\n✅ PRÉCISION OK — 0 faux positif' : '\n❌ PRÉCISION INSUFFISANTE — STOP, ne pas brancher')
  process.exit(fp === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
