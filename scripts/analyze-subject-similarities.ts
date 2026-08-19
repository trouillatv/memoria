/**
 * Batch d'analyse de similarité entre canonical_subject d'un chantier.
 *
 * Comportement :
 * - Charge les canonical_subject actifs du site avec leur contexte réel
 *   (loadSimilarityContextSubjects — même chargeur que le déclenchement produit)
 * - Génère les paires candidates via heuristique déterministe (sans LLM)
 * - Envoie uniquement les paires plausibles à Gemini
 * - Persiste les résultats dans canonical_subject_similarity_suggestion
 * - Ignore les paires déjà rejetées humainement (sauf si --force)
 * - Ne fusionne rien automatiquement
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/analyze-subject-similarities.ts --site=<siteId>
 *   npx tsx --env-file=.env.local scripts/analyze-subject-similarities.ts --site=<siteId> --topics=topicId1,topicId2
 *   npx tsx --env-file=.env.local scripts/analyze-subject-similarities.ts --site=<siteId> --apply
 *   npx tsx --env-file=.env.local scripts/analyze-subject-similarities.ts --site=<siteId> --dry-run
 *
 * Par défaut : --dry-run implicite. --apply pour persister.
 *
 * Pilote OCEF (3 topics) :
 *   npx tsx --env-file=.env.local scripts/analyze-subject-similarities.ts \
 *     --site=2c939e67-e986-4635-86a0-638cda870480 \
 *     --apply
 */

import { normalizePairKey } from '../lib/subjects/similarity-candidates'
import { loadSimilarityContextSubjects, type SimilarityContextSubject } from '../lib/subjects/similarity-context'
import { runSimilarityAnalysisForSubjects } from '../lib/subjects/similarity-run'
import { createClient } from '@supabase/supabase-js'

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const getArg = (name: string) => {
  const found = args.find((a) => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : null
}

const SITE_ID = getArg('site')
const TOPICS_FILTER = getArg('topics')?.split(',').filter(Boolean) ?? null
const DRY_RUN = !args.includes('--apply') || args.includes('--dry-run')
const FORCE = args.includes('--force')

if (!SITE_ID) {
  console.error('Usage: analyze-subject-similarities.ts --site=<uuid> [--topics=id1,id2] [--apply] [--force]')
  process.exit(1)
}

if (DRY_RUN) console.log('[dry-run] Aucune persistance. Ajouter --apply pour sauvegarder.')

// ── Supabase (service role) ───────────────────────────────────────────────────

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function sep(label: string) {
  console.log(`\n${'─'.repeat(60)}\n${label}\n${'─'.repeat(60)}`)
}

function scoreColor(score: number) {
  if (score >= 90) return '🟢'
  if (score >= 75) return '🟡'
  if (score >= 50) return '🔵'
  return '⚪'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  sep(`Analyze subject similarities — site ${SITE_ID}`)

  // 1. Charger le contexte réel (même chargeur que le déclenchement produit)
  const allSubjects = await loadSimilarityContextSubjects(SITE_ID!)
  console.log(`${allSubjects.length} sujets métier actifs`)

  // 2. Filtrer par topics si demandé
  let subjects: SimilarityContextSubject[] = allSubjects
  if (TOPICS_FILTER) {
    subjects = allSubjects.filter(
      (s) => (s.forCandidates.topicId && TOPICS_FILTER!.includes(s.forCandidates.topicId)) || !s.forCandidates.topicId,
    )
    console.log(`Filtre topics : ${subjects.length} sujets retenus`)
  }

  if (!subjects.length) { console.log('Aucun sujet à analyser.'); return }

  // 3. Paires déjà rejetées (à ne pas reproposer sauf --force)
  const rejectedPairs = new Set<string>()
  if (!FORCE) {
    const { data: rejected } = await sb
      .from('canonical_subject_similarity_suggestion')
      .select('subject_a_id, subject_b_id')
      .eq('site_id', SITE_ID)
      .eq('status', 'rejected')

    for (const r of rejected ?? []) {
      rejectedPairs.add(normalizePairKey(r.subject_a_id, r.subject_b_id))
    }
    if (rejectedPairs.size) console.log(`${rejectedPairs.size} paires rejetées exclues (--force pour ignorer)`)
  }

  // 4. Analyser (candidats + Gemini + persistance) via le pipeline partagé
  sep('Analyse Gemini des paires candidates')

  const summary = await runSimilarityAnalysisForSubjects(subjects, {
    siteId: SITE_ID!,
    rejectedPairs,
    dryRun: DRY_RUN,
    onPairAnalyzed: ({ subjectA, subjectB, candidate, result }) => {
      const blockReason = candidate.fusionBlockReason
      const warningReason = candidate.fusionWarningReason
      const typeTag = `[${candidate.typeHintA}/${candidate.typeHintB}]`
      const icon = scoreColor(result.score)
      const guardTag = blockReason ? ' 🚫' : warningReason ? ' ⚡' : ''
      console.log(
        `${icon} ${result.score}% [${result.verdict}/${result.recommendation}]${guardTag} ${typeTag} ` +
        `"${subjectA.forCandidates.label}" ↔ "${subjectB.forCandidates.label}" — ${result.reason}`,
      )
      if (blockReason) console.log(`   🚫 Fusion bloquée : ${blockReason}`)
      if (warningReason) console.log(`   ⚡ Avertissement : ${warningReason}`)
      if (result.suggested_label) console.log(`   → Libellé proposé : "${result.suggested_label}"`)
      if (result.suggested_link_type) console.log(`   → Lien : ${result.suggested_link_type} (${result.suggested_direction ?? '?'})`)
    },
    onPairError: ({ subjectA, subjectB, error }) => {
      console.error(`✗ Erreur "${subjectA.forCandidates.label}" ↔ "${subjectB.forCandidates.label}" : ${error}`)
    },
  })

  if (!summary.candidateCount) { console.log('Aucun candidat. Arrêt.'); return }

  sep('Résumé')
  console.log(`Candidats : ${summary.candidateCount} total`)
  console.log(`Analysés par Gemini : ${summary.analyzedCount} / ${summary.candidateCount}`)
  if (!DRY_RUN) console.log(`Persistées : ${summary.persistedCount} | Erreurs : ${summary.errorCount}`)
  else console.log('[dry-run] Rien persisté. Relancer avec --apply.')
}

main().catch((e) => { console.error(e); process.exit(1) })
