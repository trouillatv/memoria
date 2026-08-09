/**
 * Déduplication intra-topic des canonical_subject — V1
 *
 * Pour chaque topic d'un site, envoie les sujets membres à Gemini avec leur
 * contexte métier. Gemini identifie les clusters de même sujet réel.
 *
 * Modes :
 *   (défaut) analyse seulement — aucune écriture
 *   --apply   fusionne les clusters SAME_SUBJECT avec confidence ≥ seuil
 *
 * Fusion non destructive :
 *   - winner = sujet avec le plus de threads (minimise les mutations FK)
 *   - loser.status = 'merged', loser.merged_into = winner.id
 *   - subject_thread_identity rerouté vers winner
 *   - canonical_subject_occurrence rerouté vers winner
 *   - winner.label = suggestedLabel, winner.aliases étendu
 *   - loser retiré de canonical_topic_subject
 *   - trace dans canonical_subject_merge (snapshot réversible)
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/batch-deduplicate-subjects.ts --site=<siteId>
 *   npx tsx --env-file=.env.local scripts/batch-deduplicate-subjects.ts --site=<siteId> --apply
 *   npx tsx --env-file=.env.local scripts/batch-deduplicate-subjects.ts --site=<siteId> --apply --topic=<topicId>
 *   npx tsx --env-file=.env.local scripts/batch-deduplicate-subjects.ts --site=<siteId> --apply --min-confidence=0.95
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`))
  return flag?.split('=').slice(1).join('=')
}

const SITE_ID = arg('site')
const TOPIC_FILTER = arg('topic')
const APPLY = process.argv.includes('--apply')
const MIN_CONFIDENCE = parseFloat(arg('min-confidence') ?? '0.90')

if (!SITE_ID) {
  console.error('Usage: batch-deduplicate-subjects --site=<siteId> [--apply] [--topic=<topicId>] [--min-confidence=0.90]')
  process.exit(1)
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const MODEL = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'

// ── Helpers ───────────────────────────────────────────────────────────────────

function sep(label: string) {
  console.log(`\n${'─'.repeat(60)}\n${label}\n${'─'.repeat(60)}`)
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SubjectContext {
  id: string
  label: string
  aliases: string[]
  threadCount: number
  occurrenceCount: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  snippets: string[]
}

interface GeminiCluster {
  indices: number[]
  verdict: 'SAME_SUBJECT' | 'RELATED_BUT_DISTINCT' | 'UNCERTAIN'
  suggestedLabel: string
  confidence: number
  reasoning: string
}

interface MergeProposal {
  winnerId: string
  winnerLabel: string
  loserIds: string[]
  suggestedLabel: string
  confidence: number
  reasoning: string
  subjects: SubjectContext[]
}

// ── Fetch context ─────────────────────────────────────────────────────────────

async function fetchSubjectContext(subjectIds: string[]): Promise<Map<string, SubjectContext>> {
  if (!subjectIds.length) return new Map()

  const [{ data: subjects }, { data: threads }, { data: occurrences }] = await Promise.all([
    sb.from('canonical_subject').select('id, label, aliases').in('id', subjectIds),
    sb.from('subject_thread_identity').select('canonical_subject_id').in('canonical_subject_id', subjectIds),
    sb.from('canonical_subject_occurrence')
      .select('canonical_subject_id, effective_date, label')
      .in('canonical_subject_id', subjectIds)
      .order('effective_date', { ascending: true }),
  ])

  const threadCount = new Map<string, number>()
  for (const t of threads ?? []) {
    threadCount.set(t.canonical_subject_id, (threadCount.get(t.canonical_subject_id) ?? 0) + 1)
  }

  const occsBySubject = new Map<string, Array<{ effective_date: string; label: string }>>()
  for (const o of occurrences ?? []) {
    if (!occsBySubject.has(o.canonical_subject_id)) occsBySubject.set(o.canonical_subject_id, [])
    occsBySubject.get(o.canonical_subject_id)!.push(o)
  }

  const result = new Map<string, SubjectContext>()
  for (const s of subjects ?? []) {
    const occs = occsBySubject.get(s.id) ?? []
    const distinctLabels = [...new Set(occs.map((o) => o.label).filter(Boolean))]
    result.set(s.id, {
      id: s.id,
      label: s.label,
      aliases: s.aliases ?? [],
      threadCount: threadCount.get(s.id) ?? 0,
      occurrenceCount: occs.length,
      firstSeenAt: occs[0]?.effective_date ?? null,
      lastSeenAt: occs[occs.length - 1]?.effective_date ?? null,
      snippets: distinctLabels.slice(0, 4),
    })
  }
  return result
}

// ── Gemini ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un expert en suivi de chantier BTP.
On te donne une liste de sujets canoniques appartenant au même thème (même topic), avec leur contexte métier.
Ta mission : identifier les groupes de sujets qui représentent le MÊME fil métier réel (même objet physique, même campagne, même problème).

ATTENTION : deux sujets peuvent sembler similaires mais être distincts s'ils concernent :
- deux zones ou ouvrages différents (ex. Regard R4 vs Regard R7)
- deux campagnes d'essais séparées dans le temps
- deux entreprises ou lots différents
- deux non-conformités successives sur des zones différentes

Pour chaque groupe de sujets que tu identifies comme le même fil, donne :
- "indices" : liste des indices (champ "i") des membres du groupe (min 2)
- "verdict" : "SAME_SUBJECT" | "RELATED_BUT_DISTINCT" | "UNCERTAIN"
- "suggestedLabel" : meilleur libellé canonique court pour ce fil (si SAME_SUBJECT)
- "confidence" : 0.0 à 1.0 (sois conservateur — préfère UNCERTAIN à un faux SAME_SUBJECT)
- "reasoning" : justification en ≤ 15 mots

RELATED_BUT_DISTINCT : proches thématiquement mais clairement séparables.
UNCERTAIN : tu manques de contexte pour décider avec certitude.
Les sujets non regroupés ne figurent pas dans la réponse.

Réponds UNIQUEMENT en JSON valide :
{"clusters":[{"indices":[0,3],"verdict":"SAME_SUBJECT","suggestedLabel":"...","confidence":0.92,"reasoning":"..."}]}`

async function classifyTopicWithGemini(
  ai: GoogleGenAI,
  subjects: SubjectContext[],
  topicLabel: string,
): Promise<GeminiCluster[]> {
  const userMsg = JSON.stringify(
    subjects.map((s, i) => ({
      i,
      label: s.label,
      ...(s.aliases.length && { aliases: s.aliases }),
      firstSeen: s.firstSeenAt?.slice(0, 10),
      lastSeen: s.lastSeenAt?.slice(0, 10),
      occurrences: s.occurrenceCount,
      ...(s.snippets.length && { extraits: s.snippets }),
    })),
    null,
    2,
  )

  const response = await ai.models.generateContent({
    model: MODEL,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
    contents: [{ role: 'user', parts: [{ text: `Topic : "${topicLabel}"\n\nSujets :\n${userMsg}` }] }],
  })

  const text = response.text ?? ''
  if (!text.trim()) return []

  let parsed: { clusters?: GeminiCluster[] }
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    console.error(`  Parse error: ${(e as Error).message}`)
    return []
  }

  return (parsed.clusters ?? []).filter(
    (c) =>
      Array.isArray(c.indices) &&
      c.indices.length >= 2 &&
      ['SAME_SUBJECT', 'RELATED_BUT_DISTINCT', 'UNCERTAIN'].includes(c.verdict),
  )
}

// ── Build proposals ───────────────────────────────────────────────────────────

function buildProposals(clusters: GeminiCluster[], subjects: SubjectContext[]): MergeProposal[] {
  const proposals: MergeProposal[] = []
  const used = new Set<number>()

  for (const c of clusters) {
    if (c.verdict !== 'SAME_SUBJECT') continue
    const valid = c.indices.filter((i) => i >= 0 && i < subjects.length && !used.has(i))
    if (valid.length < 2) continue

    valid.forEach((i) => used.add(i))

    const clusterSubjects = valid.map((i) => subjects[i])
    // Winner = most threads (most history, minimises FK remapping)
    const winner = clusterSubjects.reduce((a, b) => (a.threadCount >= b.threadCount ? a : b))
    const losers = clusterSubjects.filter((s) => s.id !== winner.id)

    proposals.push({
      winnerId: winner.id,
      winnerLabel: winner.label,
      loserIds: losers.map((s) => s.id),
      suggestedLabel: c.suggestedLabel || winner.label,
      confidence: c.confidence,
      reasoning: c.reasoning,
      subjects: clusterSubjects,
    })
  }

  return proposals
}

// ── Apply merge ───────────────────────────────────────────────────────────────

async function applyMerge(proposal: MergeProposal): Promise<void> {
  const { winnerId, loserIds, suggestedLabel, confidence, reasoning } = proposal

  // Fetch winner state once, update locally as we process losers
  const { data: winnerRow } = await sb
    .from('canonical_subject')
    .select('label, aliases')
    .eq('id', winnerId)
    .single()

  if (!winnerRow) {
    console.error(`    ERREUR : winner ${winnerId} introuvable`)
    return
  }

  let currentLabel = winnerRow.label as string
  let currentAliases: string[] = winnerRow.aliases ?? []

  for (const loserId of loserIds) {
    const { data: loserRow } = await sb
      .from('canonical_subject')
      .select('label, aliases')
      .eq('id', loserId)
      .single()

    if (!loserRow) {
      console.error(`    ERREUR : loser ${loserId} introuvable`)
      continue
    }

    // Collect IDs for snapshot
    const [{ data: movedThreads }, { data: movedOccs }] = await Promise.all([
      sb.from('subject_thread_identity').select('id').eq('canonical_subject_id', loserId),
      sb.from('canonical_subject_occurrence').select('id').eq('canonical_subject_id', loserId),
    ])

    const movedThreadIds = (movedThreads ?? []).map((t: { id: string }) => t.id)
    const movedOccurrenceIds = (movedOccs ?? []).map((o: { id: string }) => o.id)

    const snapshot = {
      moved_thread_ids: movedThreadIds,
      moved_occurrence_ids: movedOccurrenceIds,
      winner_label_before: currentLabel,
      winner_aliases_before: [...currentAliases],
      loser_label: loserRow.label,
      loser_aliases: loserRow.aliases ?? [],
    }

    // Reroute threads
    if (movedThreadIds.length) {
      const { error } = await sb
        .from('subject_thread_identity')
        .update({ canonical_subject_id: winnerId })
        .eq('canonical_subject_id', loserId)
      if (error) { console.error(`    ERREUR threads: ${error.message}`); continue }
    }

    // Reroute occurrences
    if (movedOccurrenceIds.length) {
      const { error } = await sb
        .from('canonical_subject_occurrence')
        .update({ canonical_subject_id: winnerId })
        .eq('canonical_subject_id', loserId)
      if (error) { console.error(`    ERREUR occurrences: ${error.message}`); continue }
    }

    // Mark loser as merged
    const { error: mergeErr } = await sb
      .from('canonical_subject')
      .update({ status: 'merged', merged_into: winnerId })
      .eq('id', loserId)
    if (mergeErr) { console.error(`    ERREUR mark loser: ${mergeErr.message}`); continue }

    // Remove loser from topic membership
    await sb.from('canonical_topic_subject').delete().eq('canonical_subject_id', loserId)

    // Record merge trace
    await sb.from('canonical_subject_merge').insert({
      winner_subject_id: winnerId,
      loser_subject_id: loserId,
      suggested_label: suggestedLabel,
      resolution_source: 'llm',
      llm_confidence: confidence,
      llm_reasoning: reasoning,
      snapshot,
    })

    // Accumulate aliases locally (next loser snapshot will see updated state)
    currentAliases = [
      ...new Set([...currentAliases, ...(loserRow.aliases ?? []), loserRow.label as string]),
    ].filter((a) => a !== suggestedLabel)

    console.log(
      `    ✓ "${loserRow.label}" fusionné [${movedThreadIds.length} threads, ${movedOccurrenceIds.length} occ]`,
    )
  }

  // Update winner label + merged aliases in one final write
  const { error: updateErr } = await sb
    .from('canonical_subject')
    .update({ label: suggestedLabel, aliases: currentAliases })
    .eq('id', winnerId)
  if (updateErr) console.error(`    ERREUR update winner: ${updateErr.message}`)
  else console.log(`    ★ Winner "${currentLabel}" → "${suggestedLabel}" (${currentAliases.length} aliases)`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  sep(APPLY ? `Déduplication APPLY — seuil ${(MIN_CONFIDENCE * 100).toFixed(0)}%` : 'Déduplication ANALYSE SEULEMENT')
  if (!APPLY) console.log('(Passer --apply pour appliquer les fusions)\n')

  let topicQuery = sb
    .from('canonical_topic')
    .select('id, label, canonical_topic_subject(canonical_subject_id)')
    .eq('site_id', SITE_ID)

  if (TOPIC_FILTER) topicQuery = topicQuery.eq('id', TOPIC_FILTER)

  const { data: topics } = await topicQuery

  if (!topics?.length) {
    console.log('Aucun topic trouvé pour ce site.')
    return
  }

  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) { console.error('GOOGLE_GENAI_API_KEY manquante'); process.exit(1) }
  const ai = new GoogleGenAI({ apiKey })

  let totalProposals = 0
  let totalApplied = 0

  for (const topic of topics) {
    const memberIds = (topic.canonical_topic_subject as Array<{ canonical_subject_id: string }>)
      .map((m) => m.canonical_subject_id)

    if (memberIds.length < 2) continue

    sep(`"${topic.label}" — ${memberIds.length} sujets`)

    const contextMap = await fetchSubjectContext(memberIds)
    const subjects = memberIds.map((id) => contextMap.get(id)).filter(Boolean) as SubjectContext[]
    if (subjects.length < 2) continue

    console.log(`Envoi à Gemini…`)
    const clusters = await classifyTopicWithGemini(ai, subjects, topic.label)

    const proposals = buildProposals(clusters, subjects)
    const informational = clusters.filter((c) => c.verdict !== 'SAME_SUBJECT')

    if (!proposals.length && !informational.length) {
      console.log('  → Aucun doublon détecté')
      continue
    }

    for (const p of proposals) {
      const eligible = p.confidence >= MIN_CONFIDENCE
      const badge = APPLY && eligible ? '🔴 FUSION' : eligible ? '🔴 PROPOSÉ' : '🟡 SOUS SEUIL'
      console.log(`\n  ${badge} [${(p.confidence * 100).toFixed(0)}%] "${p.suggestedLabel}"`)
      for (const s of p.subjects) {
        const role = s.id === p.winnerId ? '★ winner' : '  loser '
        console.log(`    ${role} "${s.label}"  (${s.threadCount} threads · ${s.occurrenceCount} occ)`)
      }
      console.log(`    ${p.reasoning}`)
      totalProposals++

      if (APPLY && eligible) {
        await applyMerge(p)
        totalApplied++
      }
    }

    for (const c of informational) {
      const badge = c.verdict === 'RELATED_BUT_DISTINCT' ? '🟠 DISTINCT' : '⚪ UNCERTAIN'
      const names = c.indices.map((i) => `"${subjects[i]?.label ?? i}"`).join(' / ')
      console.log(`\n  ${badge} [${(c.confidence * 100).toFixed(0)}%] ${names}`)
      console.log(`    ${c.reasoning}`)
    }
  }

  sep('Résumé')
  console.log(`  ${totalProposals} fusion(s) SAME_SUBJECT proposée(s)`)
  if (APPLY) console.log(`  ${totalApplied} cluster(s) fusionné(s)`)
  else console.log('  Aucune écriture (mode analyse)')
  console.log()
}

main().catch((e) => { console.error(e); process.exit(1) })
