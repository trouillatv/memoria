/**
 * Batch classification canonical_topic — V1
 *
 * Propose des regroupements thématiques (canonical_topic) pour les canonical_subject
 * d'un chantier donné, via Gemini. Persiste directement (auto-persist V1).
 *
 * Règles Gemini :
 *   - 5 à 12 topics maximum selon le volume
 *   - 1 topic = au minimum 2 sujets
 *   - 1 sujet → 1 seul topic (UNIQUE contrainte en DB)
 *   - Sujets non classifiables : laissés sans topic (pas de topic singleton)
 *   - source = 'llm', confidence et reasoning stockés
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/batch-classify-topics.ts <siteId> [--dry-run]
 *
 * Exemple :
 *   npx tsx --env-file=.env.local scripts/batch-classify-topics.ts 2c939e67-e986-4635-86a0-638cda870480
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const SITE_ID = process.argv[2]
const DRY_RUN = process.argv.includes('--dry-run')

if (!SITE_ID) {
  console.error('Usage: npx tsx ... batch-classify-topics.ts <siteId> [--dry-run]')
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

// ── Fetch canonical subjects ──────────────────────────────────────────────────

async function fetchSubjects(siteId: string) {
  // Subjects liés au site via subject_thread → canonical_subject
  const { data: threads } = await sb
    .from('subject_thread_identity')
    .select('canonical_subject_id')

  const csIds = [...new Set((threads ?? []).map((t) => t.canonical_subject_id).filter(Boolean))]
  if (!csIds.length) return []

  // Filtrer par site : on passe par les proposals
  const { data: proposals } = await sb
    .from('document_extraction_proposal')
    .select('subject_thread_id, target_site_id, proposal_family')
    .eq('target_site_id', siteId)
    .not('subject_thread_id', 'is', null)

  const threadIdsForSite = new Set((proposals ?? []).map((p) => p.subject_thread_id))

  const { data: stiForSite } = await sb
    .from('subject_thread_identity')
    .select('canonical_subject_id')
    .in('subject_thread_id', [...threadIdsForSite])

  const csIdsForSite = [...new Set((stiForSite ?? []).map((r) => r.canonical_subject_id).filter(Boolean))]
  if (!csIdsForSite.length) return []

  const { data: subjects } = await sb
    .from('canonical_subject')
    .select('id, label, primary_family')
    .in('id', csIdsForSite)

  return (subjects ?? []) as Array<{ id: string; label: string; primary_family: string | null }>
}

// ── Gemini classification ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un expert en management de projet de construction et de suivi de chantier.
On te donne une liste de sujets canoniques extraits d'un chantier (id, libellé, famille métier).

Ta mission : proposer des regroupements thématiques sous forme de canonical_topic.
Un topic doit refléter une réalité physique ou métier commune du chantier (ex : "Enrobage des conduites d'assainissement", "Essais béton / Plateforme G3", "Signalisation de chantier").

Règles strictes :
- 5 à 12 topics maximum selon le volume (vise la synthèse, pas l'exhaustivité)
- Un topic regroupe AU MINIMUM 2 sujets — jamais de topic singleton
- Un sujet ne peut appartenir qu'à un seul topic
- Les sujets qui ne correspondent clairement à aucun groupe existant restent sans topic (ne crée pas de topic artificiel pour les inclure)
- Libellés courts et précis : 4-8 mots maximum
- Préfère des termes techniques du BTP plutôt que des catégories administratives

Pour chaque group proposé, donne :
- "label" : libellé synthétique du topic (4-8 mots)
- "subjectIds" : liste des id membres
- "confidence" : 0.0 à 1.0 (ta confiance dans ce regroupement)
- "reasoning" : justification en ≤ 40 mots

Réponds UNIQUEMENT en JSON valide :
{
  "topics": [
    {
      "label": "...",
      "subjectIds": ["uuid1", "uuid2"],
      "confidence": 0.85,
      "reasoning": "..."
    }
  ]
}`

async function classifyWithGemini(
  ai: GoogleGenAI,
  subjects: Array<{ id: string; label: string; primary_family: string | null }>,
) {
  const userMsg = JSON.stringify(
    subjects.map((s) => ({
      id: s.id,
      label: s.label,
      famille: s.primary_family ?? 'unknown',
    })),
    null,
    2,
  )

  console.log(`\nEnvoi de ${subjects.length} sujets à Gemini (${MODEL})…`)

  const response = await ai.models.generateContent({
    model: MODEL,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.2,
      maxOutputTokens: 2000,
    },
    contents: [{ role: 'user', parts: [{ text: userMsg }] }],
  })

  const text = response.text ?? ''
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    console.error('Réponse Gemini non parseable :\n', text.slice(0, 500))
    return []
  }

  const parsed = JSON.parse(text.slice(start, end + 1))
  return (parsed.topics ?? []) as Array<{
    label: string
    subjectIds: string[]
    confidence: number
    reasoning: string
  }>
}

// ── Persist ───────────────────────────────────────────────────────────────────

async function persistTopics(
  siteId: string,
  topics: Array<{ label: string; subjectIds: string[]; confidence: number; reasoning: string }>,
  validSubjectIds: Set<string>,
) {
  sep('Persistance')

  // Dédupliquer : un sujet ne peut appartenir qu'à un seul topic
  const assignedSubjects = new Set<string>()
  let topicsCreated = 0
  let membersCreated = 0

  for (const topic of topics) {
    // Filtrer : membres valides et non encore assignés
    const validMembers = topic.subjectIds.filter(
      (id) => validSubjectIds.has(id) && !assignedSubjects.has(id),
    )

    if (validMembers.length < 2) {
      console.log(`  SKIP "${topic.label}" — ${validMembers.length} membre(s) valide(s) (min 2)`)
      continue
    }

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Topic "${topic.label}" (conf ${(topic.confidence * 100).toFixed(0)}%) ← ${validMembers.length} sujets`)
      validMembers.forEach((id) => assignedSubjects.add(id))
      continue
    }

    const { data: cto, error: ctoErr } = await sb
      .from('canonical_topic')
      .insert({
        site_id: siteId,
        label: topic.label,
        resolution_source: 'llm',
        llm_confidence: topic.confidence,
      })
      .select('id')
      .single()

    if (ctoErr || !cto) {
      console.error(`  ERREUR insert topic "${topic.label}":`, ctoErr?.message)
      continue
    }

    const memberRows = validMembers.map((csId) => ({
      canonical_topic_id: cto.id,
      canonical_subject_id: csId,
      resolution_source: 'llm' as const,
      llm_confidence: topic.confidence,
      llm_reasoning: topic.reasoning,
    }))

    const { error: mErr } = await sb
      .from('canonical_topic_subject')
      .insert(memberRows)

    if (mErr) {
      console.error(`  ERREUR insert membres topic "${topic.label}":`, mErr.message)
      continue
    }

    validMembers.forEach((id) => assignedSubjects.add(id))
    topicsCreated++
    membersCreated += validMembers.length
    console.log(`  ✓ Topic "${topic.label}" (${cto.id.slice(0, 8)}) ← ${validMembers.length} sujets`)
  }

  const unassigned = [...validSubjectIds].filter((id) => !assignedSubjects.has(id))
  console.log(`\nRésumé :`)
  console.log(`  ${topicsCreated} topics créés`)
  console.log(`  ${membersCreated} sujets classifiés`)
  console.log(`  ${unassigned.length} sujets sans topic`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log('\n⚡ DRY-RUN — aucune écriture en base\n')

  sep(`Chantier : ${SITE_ID}`)

  const subjects = await fetchSubjects(SITE_ID)
  console.log(`${subjects.length} canonical_subject(s) trouvés`)

  if (subjects.length < 2) {
    console.log('Pas assez de sujets pour classifier. Abandon.')
    return
  }

  // Vérifier si des topics existent déjà pour ce site
  const { data: existingTopics } = await sb
    .from('canonical_topic')
    .select('id, label')
    .eq('site_id', SITE_ID)

  if (existingTopics?.length) {
    console.log(`\n⚠ ${existingTopics.length} topic(s) déjà existant(s) pour ce site :`)
    existingTopics.forEach((t) => console.log(`  - "${t.label}" (${t.id.slice(0, 8)})`))
    console.log('\nAbandon — supprimez les topics existants avant de relancer.')
    console.log('DELETE FROM canonical_topic WHERE site_id = \'<site_id>\';')
    return
  }

  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) {
    console.error('GOOGLE_GENAI_API_KEY manquante')
    process.exit(1)
  }
  const ai = new GoogleGenAI({ apiKey })

  const topics = await classifyWithGemini(ai, subjects)
  console.log(`\n${topics.length} topic(s) proposés par Gemini :`)
  for (const t of topics) {
    console.log(`  [${(t.confidence * 100).toFixed(0)}%] "${t.label}" — ${t.subjectIds.length} sujets`)
    console.log(`         ${t.reasoning}`)
  }

  const validIds = new Set(subjects.map((s) => s.id))
  await persistTopics(SITE_ID, topics, validIds)
  console.log('\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
