// Dry-run P0-1 + P0-2 sur le corpus OCEF (site 2c939e67).
// MODE LECTURE SEULE — aucune mutation DB, aucun backfill, aucun commit.
//
// Source : canonical_subject_occurrence (source_kind='historical_pdf') pour OCEF.
//          Ces occurrences ont déjà un canonical_subject_id connu (vérité terrain).
//          Le dry-run teste si P0-1 retrouverait le BON CS, et ne produit pas de faux positif.
//
// Sortie : tableau label_original | label_normalisé | candidat_CS | score_jaccard
//          | correct (même CS ou pas) | verdict_analyzeSubjectPair | action_théorique
//
// Usage : npx tsx scripts/_dry-run-p01-ocef.ts
//
// Paramètres optionnels :
//   DRY_RUN_MAX=N            — limiter à N occurrences (défaut : toutes)
//   DRY_RUN_SKIP_GEMINI=1    — sauter les appels analyzeSubjectPair (P0-1 seul)
//   DRY_RUN_STATE_ONLY=1     — ne tester que les labels avec marqueur d'état (Prévision/Fait/réalisé)

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { normalizeForMatching, P01_NORMALIZED_JACCARD_THRESHOLD } from '../lib/subjects/normalize-for-matching'
import { jaccardSimilarity } from '../lib/documents/subject-reconciliation'

const OCEF_SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'

const MAX = process.env.DRY_RUN_MAX ? Number(process.env.DRY_RUN_MAX) : Infinity
const SKIP_GEMINI = process.env.DRY_RUN_SKIP_GEMINI === '1'
const STATE_ONLY = process.env.DRY_RUN_STATE_ONLY === '1'

const isStateVariant = (label: string) =>
  /pr[ée]vision/i.test(label) ||
  /=\s*Fait/i.test(label) ||
  /r[ée]alis[ée]/i.test(label) ||
  /Gestion\s+des\s+Eaux/i.test(label) ||
  /Terrassement\s+plateforme\s*:/i.test(label) ||
  /reprise\s+[àa]\s+faire/i.test(label)

type OccRow = {
  label: string
  canonical_subject_id: string
  source_kind: string
}

type CsRow = {
  id: string
  label: string
}

type ResultRow = {
  label_original: string
  label_normalise: string
  correct_cs_label: string
  candidat_cs_label: string
  candidat_cs_id: string
  is_correct_cs: boolean
  is_false_positive: boolean
  jaccard_score: number
  verdict_p02: string
  action_theorique: string
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  console.log('\n=== DRY-RUN P0-1 + P0-2 — OCEF', OCEF_SITE_ID, '===')
  console.log('  Mode lecture seule — aucune mutation DB')
  console.log('  SKIP_GEMINI:', SKIP_GEMINI, '  STATE_ONLY:', STATE_ONLY, '  MAX:', MAX === Infinity ? 'all' : MAX)
  console.log()

  // 1. Canonical subjects actifs
  const { data: csRows, error: csErr } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', OCEF_SITE_ID)
    .eq('status', 'active')

  if (csErr) { console.error('CS fetch error:', csErr.message); process.exit(1) }
  const existingCs = (csRows ?? []) as CsRow[]
  const csById = new Map(existingCs.map((cs) => [cs.id, cs]))
  console.log(`  ${existingCs.length} canonical_subjects actifs`)

  // 2. Occurrences historiques (source de vérité : on connaît le bon CS)
  const { data: occRows, error: occErr } = await sb
    .from('canonical_subject_occurrence')
    .select('label, canonical_subject_id, source_kind')
    .eq('site_id', OCEF_SITE_ID)
    .eq('source_kind', 'historical_pdf')

  if (occErr) { console.error('Occ fetch error:', occErr.message); process.exit(1) }
  let occurrences = (occRows ?? []) as OccRow[]
  console.log(`  ${occurrences.length} occurrences historical_pdf`)

  if (STATE_ONLY) {
    occurrences = occurrences.filter((o) => isStateVariant(o.label))
    console.log(`  ${occurrences.length} occurrences avec marqueur d'état (filtre STATE_ONLY)`)
  }
  if (MAX !== Infinity) {
    occurrences = occurrences.slice(0, MAX)
  }
  console.log()

  // Lazy load analyzeSubjectPair
  let analyzeSubjectPairFn: typeof import('../lib/subjects/similarity-analyze').analyzeSubjectPair | null = null
  if (!SKIP_GEMINI) {
    const mod = await import('../lib/subjects/similarity-analyze')
    analyzeSubjectPairFn = mod.analyzeSubjectPair
  }

  const results: ResultRow[] = []
  let noCandidate = 0
  let candidateFound = 0
  let truePositive = 0
  let falsePositive = 0
  let p02SameSubject = 0
  let p02Other = 0

  for (const occ of occurrences) {
    const correctCs = csById.get(occ.canonical_subject_id)
    const correctCsLabel = correctCs?.label ?? `[CS ${occ.canonical_subject_id.slice(0, 8)}]`
    const normalized = normalizeForMatching(occ.label)

    const candidates = existingCs
      .map((cs) => ({ cs, score: jaccardSimilarity(normalized, normalizeForMatching(cs.label)) }))
      .filter((c) => c.score >= P01_NORMALIZED_JACCARD_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    if (candidates.length === 0) {
      noCandidate++
      results.push({
        label_original: occ.label,
        label_normalise: normalized,
        correct_cs_label: correctCsLabel,
        candidat_cs_label: '—',
        candidat_cs_id: '—',
        is_correct_cs: false,
        is_false_positive: false,
        jaccard_score: 0,
        verdict_p02: '—',
        action_theorique: 'Phase 2 (pas de candidat P0-1)',
      })
      continue
    }

    candidateFound++
    const best = candidates[0]
    const isCorrCs = best.cs.id === occ.canonical_subject_id

    if (isCorrCs) truePositive++
    else falsePositive++

    let verdict = SKIP_GEMINI ? 'SKIP_GEMINI' : 'pending'
    let action = SKIP_GEMINI
      ? (isCorrCs ? `RATTACHERAIT (correct) → "${best.cs.label.slice(0, 50)}"` : `FAUX POSITIF → "${best.cs.label.slice(0, 50)}"`)
      : 'pending'

    if (!SKIP_GEMINI && analyzeSubjectPairFn) {
      try {
        const res = await analyzeSubjectPairFn(
          { id: 'dry-run-a', label: occ.label, aliases: [] },
          { id: best.cs.id, label: best.cs.label, aliases: [] },
          null,
        )
        verdict = res.verdict
        if (res.verdict === 'same_subject') {
          p02SameSubject++
          action = isCorrCs
            ? `RATTACHERAIT (correct) → CS "${best.cs.label.slice(0, 50)}"`
            : `FAUX POSITIF CONFIRMÉ P0-2 → CS "${best.cs.label.slice(0, 50)}"`
        } else {
          p02Other++
          action = `Phase 2 (P0-2: ${res.verdict})`
        }
      } catch (err) {
        verdict = `ERROR: ${String(err).slice(0, 60)}`
        action = 'Phase 2 (erreur P0-2)'
      }
    }

    results.push({
      label_original: occ.label,
      label_normalise: normalized,
      correct_cs_label: correctCsLabel,
      candidat_cs_label: best.cs.label,
      candidat_cs_id: best.cs.id.slice(0, 8),
      is_correct_cs: isCorrCs,
      is_false_positive: !isCorrCs,
      jaccard_score: best.score,
      verdict_p02: verdict,
      action_theorique: action,
    })
  }

  // ── Affichage ──────────────────────────────────────────────────────────────

  const withCandidate = results.filter((r) => r.candidat_cs_label !== '—')

  if (withCandidate.length > 0) {
    console.log('=== RÉSULTATS AVEC CANDIDAT P0-1 ===\n')
    for (const r of withCandidate) {
      const marker = r.is_correct_cs ? '✓' : '✗ FAUX+'
      console.log(`[${marker}] "${r.label_original}"`)
      console.log(`   normalisé  : "${r.label_normalise}"`)
      console.log(`   CS correct : "${r.correct_cs_label}"`)
      console.log(`   candidat   : "${r.candidat_cs_label}" [${r.candidat_cs_id}] (J=${r.jaccard_score.toFixed(3)})`)
      if (!SKIP_GEMINI) console.log(`   P0-2       : ${r.verdict_p02}`)
      console.log(`   action     : ${r.action_theorique}`)
      console.log()
    }
  }

  // Faux positifs détaillés
  const fps = results.filter((r) => r.is_false_positive)
  if (fps.length > 0) {
    console.log('=== FAUX POSITIFS CANDIDATS P0-1 (à vérifier par P0-2) ===\n')
    for (const r of fps) {
      console.log(`  ORIGINAL : "${r.label_original}"`)
      console.log(`  normalisé: "${r.label_normalise}"`)
      console.log(`  DEVRAIT  : "${r.correct_cs_label}"`)
      console.log(`  CANDIDAT : "${r.candidat_cs_label}" (J=${r.jaccard_score.toFixed(3)})`)
      if (!SKIP_GEMINI) console.log(`  P0-2     : ${r.verdict_p02}`)
      console.log()
    }
  }

  // ── Métriques ──────────────────────────────────────────────────────────────
  console.log('=== MÉTRIQUES ===')
  console.log(`  Occurrences analysées          : ${occurrences.length}`)
  console.log(`  P0-1 candidat trouvé           : ${candidateFound} (${((candidateFound / occurrences.length) * 100).toFixed(1)}%)`)
  console.log(`  Sans candidat (→ Phase 2)      : ${noCandidate}`)
  console.log(`  Vrais positifs (bon CS)        : ${truePositive}`)
  console.log(`  Faux positifs (mauvais CS)     : ${falsePositive}`)
  if (!SKIP_GEMINI) {
    console.log(`  P0-2 same_subject              : ${p02SameSubject}`)
    console.log(`  P0-2 autre verdict             : ${p02Other}`)
  }
  if (candidateFound > 0) {
    const precision = truePositive / candidateFound
    console.log(`  Précision P0-1 (vrais/trouvés) : ${(precision * 100).toFixed(1)}%`)
  }

  // ── Gates ──────────────────────────────────────────────────────────────────
  console.log('\n=== VERDICT ===')

  // P0-1 gate : doit trouver des candidats (signe que normalisation fonctionne)
  const p01Rate = candidateFound / occurrences.length
  let gateP01 = 'PASS'
  if (occurrences.length === 0) {
    gateP01 = 'FAIL — aucune occurrence à analyser'
  } else if (candidateFound === 0 && occurrences.length > 10) {
    gateP01 = 'FAIL — 0 candidat P0-1 sur toutes les occurrences (normalisation inopérante)'
  }

  // P0-1 faux positifs gate : moins de 30% de faux positifs purs
  let gateFP = 'PASS'
  if (candidateFound > 0 && falsePositive / candidateFound > 0.30) {
    gateFP = `WARN — ${((falsePositive / candidateFound) * 100).toFixed(1)}% faux positifs (seuil 30%)`
  }

  // P0-2 gate (si Gemini activé)
  let gateP02 = SKIP_GEMINI ? 'NON ÉVALUÉ (SKIP_GEMINI)' : 'PASS'
  if (!SKIP_GEMINI && candidateFound > 0 && p02SameSubject === 0) {
    gateP02 = 'WARN — 0 same_subject P0-2 parmi les candidats (vérifier les paires)'
  }

  console.log(`  P0-1 candidats trouvés   : ${gateP01}`)
  console.log(`  P0-1 faux positifs       : ${gateFP}`)
  console.log(`  P0-2 décision sémantique : ${gateP02}`)

  const globalPass = gateP01 === 'PASS' && !gateFP.startsWith('FAIL')
  console.log(`\n  VERDICT GLOBAL : ${globalPass ? 'PASS' : 'FAIL'}`)
  console.log()

  if (!globalPass) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
