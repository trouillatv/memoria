/**
 * Batch d'analyse de similarité entre canonical_subject d'un chantier.
 *
 * Comportement :
 * - Charge les canonical_subject actifs du site avec leur topic
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

import { createClient } from '@supabase/supabase-js'
import { generateCandidates, normalizePairKey, type SubjectForCandidates } from '../lib/subjects/similarity-candidates'
import { analyzeSubjectPair, upsertSuggestion, type SubjectInput } from '../lib/subjects/similarity-analyze'

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
const MIN_HEURISTIC = Number(getArg('min-heuristic') ?? '25')

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

// ── Chargement des sujets ─────────────────────────────────────────────────────

interface SubjectRow {
  id: string
  label: string
  aliases: string[]
  contact_id: string | null
  company_id: string | null
  topic_id: string | null
  topic_label: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  pv_count: number
  native_count: number
  current_status: string | null
  is_stagnant: boolean
  active_actions: number
  active_reserves: number
  active_decisions: number
  active_deadlines: number
}

async function fetchSubjects(siteId: string): Promise<SubjectRow[]> {
  // Sujets actifs avec leur topic
  const { data: csRows, error: csErr } = await sb
    .from('canonical_subject')
    .select('id, label, aliases, contact_id, company_id')
    .eq('site_id', siteId)
    .eq('status', 'active')

  if (csErr) throw new Error(csErr.message)
  if (!csRows?.length) return []

  const csIds = csRows.map((r: { id: string }) => r.id)

  // Topics
  const { data: topicRows } = await sb
    .from('canonical_topic_subject')
    .select('canonical_subject_id, canonical_topic_id, canonical_topic(label)')
    .in('canonical_subject_id', csIds)

  const topicMap = new Map<string, { topicId: string; topicLabel: string }>()
  for (const row of topicRows ?? []) {
    const r = row as { canonical_subject_id: string; canonical_topic_id: string; canonical_topic: { label: string } | null }
    if (r.canonical_topic) {
      topicMap.set(r.canonical_subject_id, {
        topicId: r.canonical_topic_id,
        topicLabel: r.canonical_topic.label,
      })
    }
  }

  // Stats de base (occurrences, statut) — via canonical_subject_occurrence
  const { data: occRows } = await sb
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, validation_status')
    .in('canonical_subject_id', csIds)
    .in('validation_status', ['observed', 'confirmed'])

  const pvCountMap = new Map<string, number>()
  const nativeCountMap = new Map<string, number>()
  for (const row of occRows ?? []) {
    const r = row as { canonical_subject_id: string; validation_status: string }
    pvCountMap.set(r.canonical_subject_id, (pvCountMap.get(r.canonical_subject_id) ?? 0) + 1)
  }

  // Assembler
  const subjectMap = new Map<string, SubjectRow>()
  for (const cs of csRows) {
    const topic = topicMap.get(cs.id)
    subjectMap.set(cs.id, {
      id: cs.id,
      label: cs.label,
      aliases: cs.aliases ?? [],
      contact_id: cs.contact_id,
      company_id: cs.company_id,
      topic_id: topic?.topicId ?? null,
      topic_label: topic?.topicLabel ?? null,
      first_seen_at: null,
      last_seen_at: null,
      pv_count: pvCountMap.get(cs.id) ?? 0,
      native_count: nativeCountMap.get(cs.id) ?? 0,
      current_status: null,
      is_stagnant: false,
      active_actions: 0,
      active_reserves: 0,
      active_decisions: 0,
      active_deadlines: 0,
    })
  }

  return Array.from(subjectMap.values())
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  sep(`Analyze subject similarities — site ${SITE_ID}`)

  // 1. Charger les sujets
  const allSubjects = await fetchSubjects(SITE_ID!)
  // Exclure personnes et entreprises (pas de topics)
  const businessSubjects = allSubjects.filter((s) => !s.contact_id && !s.company_id)
  console.log(`${businessSubjects.length} sujets métier actifs (${allSubjects.length - businessSubjects.length} acteurs exclus)`)

  // 2. Filtrer par topics si demandé
  let subjects = businessSubjects
  if (TOPICS_FILTER) {
    subjects = businessSubjects.filter(
      (s) => s.topic_id && TOPICS_FILTER!.includes(s.topic_id) || !s.topic_id,
    )
    console.log(`Filtre topics : ${subjects.length} sujets retenus`)
  }

  if (!subjects.length) { console.log('Aucun sujet à analyser.'); return }

  // 3. Paires déjà rejetées (à ne pas reproposer sauf --force)
  let rejectedPairs = new Set<string>()
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

  // 4. Générer les paires candidates
  const forCandidates: SubjectForCandidates[] = subjects.map((s) => ({
    id: s.id,
    label: s.label,
    aliases: s.aliases,
    topicId: s.topic_id,
  }))

  const candidates = generateCandidates(forCandidates, rejectedPairs)
  console.log(`${candidates.length} paires candidates (heuristique ≥ ${MIN_HEURISTIC})`)

  if (!candidates.length) { console.log('Aucun candidat. Arrêt.'); return }

  // 5. Afficher les candidats
  const subjectIndex = new Map(subjects.map((s) => [s.id, s]))
  let geminiCount = 0
  let persistedCount = 0
  let errorCount = 0

  sep('Analyse Gemini des paires candidates')

  for (const candidate of candidates) {
    const sA = subjectIndex.get(candidate.a.id)!
    const sB = subjectIndex.get(candidate.b.id)!

    const inputA: SubjectInput = {
      id: sA.id, label: sA.label, aliases: sA.aliases,
      topicLabel: sA.topic_label,
      firstSeenAt: sA.first_seen_at, lastSeenAt: sA.last_seen_at,
      pvCount: sA.pv_count, nativeOccurrenceCount: sA.native_count,
      currentStatus: sA.current_status, isStagnant: sA.is_stagnant,
      activeObjects: { actionsOpen: sA.active_actions, reservesOpen: sA.active_reserves, decisionsOpen: sA.active_decisions, deadlinesActive: sA.active_deadlines },
    }
    const inputB: SubjectInput = {
      id: sB.id, label: sB.label, aliases: sB.aliases,
      topicLabel: sB.topic_label,
      firstSeenAt: sB.first_seen_at, lastSeenAt: sB.last_seen_at,
      pvCount: sB.pv_count, nativeOccurrenceCount: sB.native_count,
      currentStatus: sB.current_status, isStagnant: sB.is_stagnant,
      activeObjects: { actionsOpen: sB.active_actions, reservesOpen: sB.active_reserves, decisionsOpen: sB.active_decisions, deadlinesActive: sB.active_deadlines },
    }

    const blockReason = candidate.fusionBlockReason
    const warningReason = candidate.fusionWarningReason
    const typeTag = `[${candidate.typeHintA}/${candidate.typeHintB}]`

    try {
      const result = await analyzeSubjectPair(inputA, inputB, null, {
        typeHintA: candidate.typeHintA,
        typeHintB: candidate.typeHintB,
        fusionBlockReason: blockReason,
        fusionWarningReason: warningReason,
      })
      geminiCount++

      const icon = scoreColor(result.score)
      const guardTag = blockReason ? ' 🚫' : warningReason ? ' ⚡' : ''
      console.log(
        `${icon} ${result.score}% [${result.verdict}/${result.recommendation}]${guardTag} ${typeTag} ` +
        `"${sA.label}" ↔ "${sB.label}" — ${result.reason}`,
      )
      if (blockReason) console.log(`   🚫 Fusion bloquée : ${blockReason}`)
      if (warningReason) console.log(`   ⚡ Avertissement : ${warningReason}`)
      if (result.suggested_label) console.log(`   → Libellé proposé : "${result.suggested_label}"`)
      if (result.suggested_link_type) console.log(`   → Lien : ${result.suggested_link_type} (${result.suggested_direction ?? '?'})`)

      if (!DRY_RUN) {
        const saved = await upsertSuggestion(sb, SITE_ID!, sA.id, sB.id, result)
        if ('error' in saved) {
          console.error(`   ✗ Persistance échouée : ${saved.error}`)
          errorCount++
        } else {
          persistedCount++
        }
      }
    } catch (e) {
      const msg = (e as Error).message
      console.error(`✗ Erreur "${sA.label}" ↔ "${sB.label}" : ${msg}`)
      errorCount++
    }
  }

  const blockedCount = candidates.filter((c) => c.fusionBlockReason !== null).length
  const warningCount = candidates.filter((c) => c.fusionWarningReason !== null).length
  sep('Résumé')
  console.log(`Candidats : ${candidates.length} total | ${blockedCount} 🚫 bloquée | ${warningCount} ⚡ avertissement | ${candidates.length - blockedCount - warningCount} sans garde`)
  console.log(`Analysés par Gemini : ${geminiCount} / ${candidates.length}`)
  if (!DRY_RUN) console.log(`Persistées : ${persistedCount} | Erreurs : ${errorCount}`)
  else console.log('[dry-run] Rien persisté. Relancer avec --apply.')
}

main().catch((e) => { console.error(e); process.exit(1) })
