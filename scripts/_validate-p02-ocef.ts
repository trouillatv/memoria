// Validation terrain P0-2 — analyzeSubjectPair() sur corpus OCEF.
// MODE LECTURE SEULE — aucune mutation DB, aucun backfill, aucun commit.
//
// Trois catégories de paires :
//   SAME     — grappes UNDER_MERGE connues (doivent retourner same_subject)
//   DISTINCT — gardes COLL (ne doivent JAMAIS retourner same_subject)
//   BORDER   — frontières sémantiques (UNCERTAIN/RELATED attendus, pas SAME)
//
// Usage : npx tsx scripts/_validate-p02-ocef.ts
//
// Gate :
//   FAIL immédiat si un garde DISTINCT reçoit same_subject (faux SAME = over-merge)
//   SAME recall < 50% = WARN
//   Verdict final : P0-2 PASS ou P0-2 FAIL

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { analyzeSubjectPair } from '../lib/subjects/similarity-analyze'
import type { SubjectInput } from '../lib/subjects/similarity-analyze'

const OCEF_SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'

type PairCategory = 'SAME' | 'DISTINCT' | 'BORDER'

interface TestPair {
  category: PairCategory
  labelA: string
  labelB: string
  proposal_family: string
  expected: string
  note: string
}

// Paires de validation — labels OCEF réels (IDs résolus depuis la DB)
const TEST_PAIRS: TestPair[] = [
  // ── Catégorie SAME : grappes UNDER_MERGE du rapport Opus ─────────────────
  {
    category: 'SAME',
    labelA: 'Coordination Réseaux sous-dalle LOT01 et LOT02',
    labelB: 'Coordination à faire entre LOT01 et LOT02',
    proposal_family: 'action',
    expected: 'same_subject',
    note: 'G1-SAME : deux formulations du même sujet coordination LOT01/LOT02',
  },
  {
    category: 'SAME',
    labelA: 'Coordination réseaux sous-dalle (LOT01 & LOT02)',
    labelB: 'Coordination à faire entre LOT01 et LOT02',
    proposal_family: 'action',
    expected: 'same_subject',
    note: 'G1-SAME variante 2 : parens vs texte',
  },
  {
    category: 'SAME',
    labelA: 'Gestion des Eaux (GDE) : Busage Provisoire',
    labelB: 'GDE - Busage Provisoire',
    proposal_family: 'knowledge_fact',
    expected: 'same_subject',
    note: 'G2a-SAME : forme longue vs abréviation GDE Busage',
  },
  {
    category: 'SAME',
    labelA: 'GDE - Fossé',
    labelB: 'Gestion des Eaux : Fossé',
    proposal_family: 'knowledge_fact',
    expected: 'same_subject',
    note: 'G2b-SAME : GDE Fossé deux formulations',
  },
  {
    category: 'SAME',
    labelA: 'Transmission des fiches techniques matériaux',
    labelB: 'Transmettre les fiches techniques des matériaux et équipements',
    proposal_family: 'action',
    expected: 'same_subject',
    note: 'G3-SAME : transmission FT — verbe vs substantif',
  },
  {
    category: 'SAME',
    labelA: 'Transmission plan de gestion des eaux',
    labelB: 'Transmettre le plan de gestion des eaux',
    proposal_family: 'action',
    expected: 'same_subject',
    note: 'G3b-SAME : transmission plan GDE deux formulations',
  },
  {
    category: 'SAME',
    labelA: 'Accès Plateforme : Déblais réalisés',
    labelB: 'Accès Plateforme - Travaux réalisés',
    proposal_family: 'action',
    expected: 'same_subject',
    note: 'G4-SAME : Accès Plateforme deux états différents',
  },
  {
    category: 'SAME',
    labelA: 'Déblais/Remblais plateforme',
    labelB: 'Terrassement Plateforme Déblais/Remblais',
    proposal_family: 'knowledge_fact',
    expected: 'same_subject',
    note: 'G5-SAME : Déblais/Remblais avec/sans préfixe catégoriel',
  },
  {
    category: 'SAME',
    labelA: 'Présentation des situations mensuelles',
    labelB: 'Présentation des situations du mois',
    proposal_family: 'action',
    expected: 'same_subject',
    note: 'G6-SAME : situations mensuelles deux formulations',
  },
  {
    category: 'SAME',
    labelA: 'Récolement et essais pour réception du lot 02',
    labelB: 'Réception du lot 02 (Récolement & Essais)',
    proposal_family: 'deadline',
    expected: 'same_subject',
    note: 'G7-SAME : récolement + réception lot 02',
  },

  // ── Catégorie DISTINCT : gardes COLL — ne JAMAIS retourner same_subject ──
  {
    category: 'DISTINCT',
    labelA: 'GDE - Busage Provisoire',
    labelB: 'GDE - Fossé',
    proposal_family: 'knowledge_fact',
    expected: 'distinct',
    note: 'COLL-1 : GDE Busage ≠ GDE Fossé (localisations distinctes)',
  },
  {
    category: 'DISTINCT',
    labelA: 'Transmission des fiches techniques matériaux',
    labelB: 'Transmettre les relevés météo',
    proposal_family: 'action',
    expected: 'distinct',
    note: 'COLL-2a : FT ≠ météo (objets de transmission différents)',
  },
  {
    category: 'DISTINCT',
    labelA: 'Transmission plan de gestion des eaux',
    labelB: 'Transmettre les relevés météo',
    proposal_family: 'action',
    expected: 'distinct',
    note: 'COLL-2b : plan GDE ≠ météo',
  },
  {
    category: 'DISTINCT',
    labelA: 'Essais Plateforme 20.02 Non Conformes',
    labelB: 'Essais plateforme du 30/03',
    proposal_family: 'observation',
    expected: 'distinct',
    note: 'COLL-3 : essais 20/02 ≠ essais 30/03 (dates différentes, résultats différents)',
  },
  {
    category: 'DISTINCT',
    labelA: 'Intempéries du 16/02 au 06/03',
    labelB: 'Intempéries du 24/03 au 26/03',
    proposal_family: 'knowledge_fact',
    expected: 'distinct',
    note: 'COLL-4 : deux épisodes intempéries dates différentes',
  },
  {
    category: 'DISTINCT',
    labelA: 'BECIB interlocuteur privilégié pour le lot 01',
    labelB: 'BECIB',
    proposal_family: 'knowledge_fact',
    expected: 'distinct',
    note: 'COLL-5 : rôle BECIB (knowledge_fact) ≠ entité BECIB (company)',
  },
  {
    category: 'DISTINCT',
    labelA: 'Accès au site',
    labelB: 'Accès Plateforme',
    proposal_family: 'action',
    expected: 'distinct',
    note: 'COLL-6 : Accès au site ≠ Accès Plateforme (localisations distinctes)',
  },

  // ── Catégorie BORDER : frontières sémantiques — UNCERTAIN ou RELATED, pas SAME ──
  {
    category: 'BORDER',
    labelA: 'Démarrage purge',
    labelB: 'Purge de la plateforme',
    proposal_family: 'action',
    expected: 'related',
    note: 'BORDER-1 : démarrage purge vs purge — étapes liées mais phases distinctes',
  },
  {
    category: 'BORDER',
    labelA: 'Moyens humains et matériels sur site',
    labelB: 'Moyens matériels sur site',
    proposal_family: 'knowledge_fact',
    expected: 'related',
    note: 'BORDER-2 : moyens humains+matériels vs matériels seuls — partiel ≠ total',
  },
  {
    category: 'BORDER',
    labelA: 'Couche de forme Accès Plateforme',
    labelB: 'GNT sur plateforme',
    proposal_family: 'knowledge_fact',
    expected: 'related',
    note: 'BORDER-3 : couche de forme accès vs GNT sur plateforme — matériau commun, zones distinctes ?',
  },
  {
    category: 'BORDER',
    labelA: 'Terrassement plateforme : Purge = Fait',
    labelB: 'Purge complémentaire',
    proposal_family: 'knowledge_fact',
    expected: 'related',
    note: 'BORDER-4 : purge initiale terminée vs purge complémentaire — phases successives',
  },
  {
    category: 'BORDER',
    labelA: 'Accès Plateforme : Reprise accès Est = Fait',
    labelB: 'Accès Plateforme - Travaux réalisés',
    proposal_family: 'action',
    expected: 'related',
    note: 'BORDER-5 : reprise est vs travaux réalisés — sous-zone vs ensemble',
  },
]

// Lookup CS par label dans OCEF (meilleur match exact puis contains)
async function lookupCsId(
  sb: ReturnType<typeof createClient>,
  label: string,
): Promise<{ id: string; label: string } | null> {
  const { data } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', OCEF_SITE_ID)
    .eq('status', 'active')
    .ilike('label', label)
    .limit(1)
    .maybeSingle()
  if (data) return data as { id: string; label: string }

  // Fallback : contains
  const { data: data2 } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', OCEF_SITE_ID)
    .eq('status', 'active')
    .ilike('label', `%${label.slice(0, 30)}%`)
    .limit(1)
    .maybeSingle()
  return data2 as { id: string; label: string } | null
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  console.log('\n=== VALIDATION TERRAIN P0-2 — analyzeSubjectPair() sur corpus OCEF ===')
  console.log('  Mode lecture seule — aucune mutation DB')
  console.log(`  ${TEST_PAIRS.length} paires à évaluer`)
  console.log()

  type ResultRow = {
    category: PairCategory
    note: string
    labelA: string
    labelB: string
    proposal_family: string
    expected: string
    verdict: string
    confidence: number
    reason: string
    pass: boolean
    falseSame: boolean
  }

  const results: ResultRow[] = []
  let falseSameCount = 0

  for (const pair of TEST_PAIRS) {
    process.stdout.write(`  [${pair.category}] ${pair.note.slice(0, 60)}...`)

    // Trouver ou créer des SubjectInput depuis les labels
    // Si le CS existe en DB → utiliser son vrai ID ; sinon utiliser un ID synthétique
    const [csA, csB] = await Promise.all([
      lookupCsId(sb, pair.labelA),
      lookupCsId(sb, pair.labelB),
    ])

    const subjectA: SubjectInput = {
      id: csA?.id ?? `dry-run-a-${Date.now()}`,
      label: csA?.label ?? pair.labelA,
      aliases: [],
    }
    const subjectB: SubjectInput = {
      id: csB?.id ?? `dry-run-b-${Date.now()}`,
      label: csB?.label ?? pair.labelB,
      aliases: [],
    }

    let verdict = 'error'
    let confidence = 0
    let reason = 'erreur'

    try {
      const res = await analyzeSubjectPair(subjectA, subjectB, null)
      verdict = res.verdict
      confidence = res.score ?? 0
      reason = res.explanation ?? ''
    } catch (err) {
      reason = String(err).slice(0, 100)
    }

    // Évaluation PASS/FAIL
    let pass = false
    const isFalseSame = pair.category === 'DISTINCT' && verdict === 'same_subject'
    if (isFalseSame) falseSameCount++

    if (pair.category === 'SAME') {
      pass = verdict === 'same_subject'
    } else if (pair.category === 'DISTINCT') {
      pass = verdict !== 'same_subject'   // tout sauf same_subject est acceptable pour un garde
    } else {
      // BORDER : on attend que ce ne soit PAS same_subject (RELATED ou UNCERTAIN sont OK)
      pass = verdict !== 'same_subject'
    }

    const status = isFalseSame ? ' ← FAUX SAME !!!' : pass ? ' OK' : ' MISS'
    console.log(` ${verdict.toUpperCase()} (${confidence})${status}`)

    results.push({
      category: pair.category,
      note: pair.note,
      labelA: subjectA.label,
      labelB: subjectB.label,
      proposal_family: pair.proposal_family,
      expected: pair.expected,
      verdict,
      confidence,
      reason: reason.slice(0, 120),
      pass,
      falseSame: isFalseSame,
    })
  }

  // ── Tableau détaillé ──────────────────────────────────────────────────────
  console.log('\n\n=== TABLEAU DÉTAILLÉ ===\n')
  const header = 'label A | label B | famille | attendu | verdict | conf | PASS/FAIL'
  console.log(header)
  console.log('-'.repeat(120))
  for (const r of results) {
    const labelA = r.labelA.slice(0, 38).padEnd(38)
    const labelB = r.labelB.slice(0, 38).padEnd(38)
    const fam = r.proposal_family.padEnd(14)
    const exp = r.expected.padEnd(12)
    const ver = r.verdict.padEnd(12)
    const conf = String(r.confidence).padStart(3)
    const pf = r.falseSame ? 'FAUX SAME !!!' : r.pass ? 'PASS' : 'MISS (recall)'
    console.log(`${labelA} | ${labelB} | ${fam} | ${exp} | ${ver} | ${conf} | ${pf}`)
    if (r.reason) console.log(`  → raison: ${r.reason}`)
    console.log()
  }

  // ── Métriques par catégorie ───────────────────────────────────────────────
  const sameResults = results.filter((r) => r.category === 'SAME')
  const distinctResults = results.filter((r) => r.category === 'DISTINCT')
  const borderResults = results.filter((r) => r.category === 'BORDER')

  const samePass = sameResults.filter((r) => r.pass).length
  const distinctPass = distinctResults.filter((r) => r.pass).length
  const borderPass = borderResults.filter((r) => r.pass).length

  console.log('=== MÉTRIQUES ===')
  console.log(`  SAME attendus        : ${samePass}/${sameResults.length}`)
  console.log(`  DISTINCT protégés    : ${distinctPass}/${distinctResults.length}`)
  console.log(`  BORDER conservés     : ${borderPass}/${borderResults.length}`)
  console.log(`  Faux SAME (COLL)     : ${falseSameCount}`)
  console.log()

  // Détail des SAME manqués
  const sameMissed = sameResults.filter((r) => !r.pass)
  if (sameMissed.length > 0) {
    console.log('SAME manqués (recall) :')
    for (const r of sameMissed) {
      console.log(`  "${r.labelA}" vs "${r.labelB}" → ${r.verdict} (${r.confidence})`)
      console.log(`  raison : ${r.reason}`)
    }
    console.log()
  }

  // Détail des gardes DISTINCT cassés
  const distinctFailed = distinctResults.filter((r) => !r.pass)
  if (distinctFailed.length > 0) {
    console.log('GARDES DISTINCT CASSÉS (OVER-MERGE) :')
    for (const r of distinctFailed) {
      console.log(`  !!! "${r.labelA}" vs "${r.labelB}" → ${r.verdict} (${r.confidence})`)
      console.log(`  raison : ${r.reason}`)
    }
    console.log()
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  console.log('=== VERDICT ===')

  const failFalseSame = falseSameCount > 0
  const warnRecall = samePass < Math.ceil(sameResults.length * 0.5)

  if (failFalseSame) {
    console.log(`  P0-1 PASS / P0-2 FAIL`)
    console.log(`  Raison : ${falseSameCount} faux SAME sur garde DISTINCT (over-merge détecté)`)
  } else if (warnRecall) {
    console.log(`  P0-1 PASS / P0-2 FAIL`)
    console.log(`  Raison : recall SAME trop faible (${samePass}/${sameResults.length} < 50%) — P0-2 n'est pas utile`)
  } else {
    console.log(`  P0-1 PASS / P0-2 PASS`)
    console.log(`  0 faux SAME, recall ${samePass}/${sameResults.length}, gardes DISTINCT ${distinctPass}/${distinctResults.length}`)
  }

  console.log()

  if (failFalseSame || warnRecall) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
