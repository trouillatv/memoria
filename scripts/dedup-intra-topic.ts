/**
 * Dédup intra-topic — V1
 *
 * Pour chaque canonical_topic d'un chantier, envoie les sujets à Gemini
 * et demande d'identifier les paires candidates à la fusion.
 *
 * Ne fusionne pas directement : sort uniquement une liste de paires triées
 * par confiance décroissante, pour revue humaine.
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/dedup-intra-topic.ts <siteId> [--dry-run] [--topic <topicId>]
 *
 * Exemples :
 *   npx tsx --env-file=.env.local scripts/dedup-intra-topic.ts 2c939e67-... --dry-run
 *   npx tsx --env-file=.env.local scripts/dedup-intra-topic.ts 2c939e67-... --topic 8fab8b6a-...
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const SITE_ID = process.argv[2]
const FILTER_TOPIC = (() => {
  const idx = process.argv.indexOf('--topic')
  return idx !== -1 ? process.argv[idx + 1] : null
})()

if (!SITE_ID) {
  console.error('Usage: npx tsx ... dedup-intra-topic.ts <siteId> [--topic <topicId>]')
  process.exit(1)
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const MODEL = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'

function sep(label: string) {
  console.log(`\n${'─'.repeat(60)}\n${label}\n${'─'.repeat(60)}`)
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MergeCandidate {
  topicLabel: string
  subjectAId: string
  subjectALabel: string
  subjectBId: string
  subjectBLabel: string
  confidence: number
  reason: string
}

// ── Gemini ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un expert en management de chantier BTP.
On te donne une liste de sujets appartenant au même thème d'un chantier (id, libellé).

Ta mission : identifier les paires de sujets qui semblent décrire la même réalité métier
et qui seraient candidats à une fusion (un seul canonical_subject).

Critères de fusion :
- Même problème physique ou opérationnel, reformulé différemment
- Même action ou réserve, libellée avec des variations mineures
- Sujets qui se dupliquent à travers plusieurs PV avec des libellés proches

Ne pas fusionner :
- Deux actions distinctes qui portent sur le même domaine thématique mais pas le même problème
- Un sujet général et un sujet spécifique qui méritent d'exister séparément
- Des sujets proches mais avec des niveaux de précision vraiment différents

Pour chaque paire candidate, donne :
- "a" : indice du premier sujet
- "b" : indice du second sujet
- "confidence" : 0.0 à 1.0 (>= 0.8 = quasi-certain, 0.6-0.8 = probable, < 0.6 = incertain)
- "reason" : une phrase courte expliquant pourquoi ces deux sujets semblent identiques

Si aucune paire n'est candidate, retourne {"pairs": []}.

Réponds UNIQUEMENT en JSON valide :
{"pairs":[{"a":0,"b":2,"confidence":0.95,"reason":"Même réserve d'enrobage, libellé abrégé vs complet"}]}`

async function findDuplicatesInTopic(
  ai: GoogleGenAI,
  topicLabel: string,
  subjects: Array<{ id: string; label: string }>,
): Promise<MergeCandidate[]> {
  if (subjects.length < 2) return []

  const indexToId = subjects.map((s) => s.id)
  const userMsg = JSON.stringify(subjects.map((s, i) => ({ i, label: s.label })), null, 2)

  const response = await ai.models.generateContent({
    model: MODEL,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
    contents: [{ role: 'user', parts: [{ text: userMsg }] }],
  })

  const text = response.text ?? ''
  if (!text.trim()) return []

  let parsed: { pairs?: unknown[] }
  try {
    parsed = JSON.parse(text)
  } catch {
    console.error(`  Parse error dans topic "${topicLabel}"`)
    return []
  }

  const rawPairs = (parsed.pairs ?? []) as Array<{
    a: number; b: number; confidence: number; reason: string
  }>

  return rawPairs
    .filter((p) => indexToId[p.a] && indexToId[p.b] && p.confidence >= 0.6)
    .map((p) => ({
      topicLabel,
      subjectAId: indexToId[p.a],
      subjectALabel: subjects[p.a]?.label ?? '?',
      subjectBId: indexToId[p.b],
      subjectBLabel: subjects[p.b]?.label ?? '?',
      confidence: p.confidence,
      reason: p.reason,
    }))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  sep(`Chantier : ${SITE_ID}`)

  // 1. Récupérer les topics du site
  let topicsQuery = sb
    .from('canonical_topic')
    .select('id, label')
    .eq('site_id', SITE_ID)
    .order('label')

  if (FILTER_TOPIC) {
    topicsQuery = topicsQuery.eq('id', FILTER_TOPIC) as typeof topicsQuery
  }

  const { data: topics, error: topicsErr } = await topicsQuery
  if (topicsErr || !topics?.length) {
    console.error('Aucun topic trouvé :', topicsErr?.message ?? 'résultat vide')
    process.exit(1)
  }

  console.log(`${topics.length} topic(s) à analyser`)

  // 2. Pour chaque topic, récupérer les sujets membres
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) { console.error('GOOGLE_GENAI_API_KEY manquante'); process.exit(1) }
  const ai = new GoogleGenAI({ apiKey })

  const allCandidates: MergeCandidate[] = []

  for (const topic of topics) {
    const { data: members } = await sb
      .from('canonical_topic_subject')
      .select('canonical_subject_id')
      .eq('canonical_topic_id', topic.id)

    const csIds = (members ?? []).map((m: { canonical_subject_id: string }) => m.canonical_subject_id)
    if (csIds.length < 2) {
      console.log(`  SKIP "${topic.label}" — ${csIds.length} sujet(s), minimum 2 pour analyser`)
      continue
    }

    const { data: subjects } = await sb
      .from('canonical_subject')
      .select('id, label')
      .in('id', csIds)
      .neq('status', 'merged')

    const validSubjects = (subjects ?? []) as Array<{ id: string; label: string }>
    if (validSubjects.length < 2) continue

    console.log(`\nAnalyse "${topic.label}" (${validSubjects.length} sujets)…`)

    const candidates = await findDuplicatesInTopic(ai, topic.label, validSubjects)

    if (candidates.length === 0) {
      console.log('  → Aucun doublon détecté')
    } else {
      for (const c of candidates) {
        const pct = (c.confidence * 100).toFixed(0)
        console.log(`  [${pct}%] "${c.subjectALabel}"`)
        console.log(`       ↔  "${c.subjectBLabel}"`)
        console.log(`       ${c.reason}`)
      }
    }

    allCandidates.push(...candidates)
  }

  // 3. Rapport final trié par confiance décroissante
  sep('Récapitulatif — candidats à la fusion')

  if (allCandidates.length === 0) {
    console.log('Aucun doublon probable détecté.')
    return
  }

  allCandidates.sort((a, b) => b.confidence - a.confidence)

  console.log(`${allCandidates.length} paire(s) candidate(s) :\n`)

  for (const c of allCandidates) {
    const pct = (c.confidence * 100).toFixed(0)
    console.log(`[${pct}%] ${c.topicLabel}`)
    console.log(`  A: ${c.subjectALabel}`)
    console.log(`     id: ${c.subjectAId}`)
    console.log(`  B: ${c.subjectBLabel}`)
    console.log(`     id: ${c.subjectBId}`)
    console.log(`  → ${c.reason}`)
    console.log()
  }

  console.log('Pour fusionner une paire, utiliser la matrice (menu ⋮ ou drag-and-drop).')
  console.log('Les IDs ci-dessus permettent aussi une fusion directe via merge-actions.ts.')
}

main().catch((e) => { console.error(e); process.exit(1) })
