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
const ONLY_UNCLASSIFIED = process.argv.includes('--only-unclassified')

if (!SITE_ID) {
  console.error('Usage: npx tsx ... batch-classify-topics.ts <siteId> [--dry-run] [--only-unclassified]')
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
  // 1. Runs réellement matérialisés (site_reports.extraction_run_id), PAS
  //    document_extraction_run.is_canonical seul — même doctrine que
  //    getMaterializedRunIdsForSite (P0-J.3/P1-A.1, GO Vincent 2026-08-24) : un run
  //    peut être marqué canonique sans jamais avoir produit de visite (fantôme), et
  //    un run matérialisé mais pas (encore) marqué canonique doit quand même
  //    apparaître ici. Dupliqué en ligne (pas d'import du helper partagé, gardé
  //    par 'server-only', incompatible avec ce script CLI) — cf. scripts/_guillaume-metrics-snapshot.ts.
  const { data: reports } = await sb
    .from('site_reports')
    .select('extraction_run_id')
    .eq('site_id', siteId)
    .not('extraction_run_id', 'is', null)

  const runIds = [...new Set((reports ?? []).map((r: { extraction_run_id: string }) => r.extraction_run_id))]
  if (!runIds.length) return []

  // 2. Threads présents dans ces runs (+ proposal_family pour dériver kind, cf. §3bis)
  const { data: props } = await sb
    .from('document_extraction_proposal')
    .select('subject_thread_id, proposal_family')
    .in('extraction_run_id', runIds)
    .not('subject_thread_id', 'is', null)

  const threadIds = [...new Set((props ?? []).map((p: { subject_thread_id: string }) => p.subject_thread_id))]
  if (!threadIds.length) return []

  // 3. canonical_subject_ids pour ces threads
  const { data: sti } = await sb
    .from('subject_thread_identity')
    .select('canonical_subject_id, subject_thread_id')
    .in('subject_thread_id', threadIds)

  const csIds = [...new Set((sti ?? []).map((r: { canonical_subject_id: string }) => r.canonical_subject_id).filter(Boolean))]
  if (!csIds.length) return []

  // 3bis. Exclure les acteurs (person/company) — même doctrine que isActorKind()
  //   (lib/subjects/kind.ts) et loadSimilarityContextSubjects() : un thème regroupe
  //   des sujets métier, pas des personnes/entreprises. kind n'est pas une colonne
  //   canonical_subject ; il est dérivé de proposal_family, comme dans
  //   canonical-subject-life.ts. Un sujet est traité comme acteur si AU MOINS une
  //   occurrence porte person/company (conservateur : mieux vaut exclure à tort
  //   qu'inclure un acteur dans un topic métier).
  const threadToCs = new Map(
    (sti ?? []).map((r: { subject_thread_id: string; canonical_subject_id: string }) => [
      r.subject_thread_id,
      r.canonical_subject_id,
    ]),
  )
  const actorCsIds = new Set<string>()
  for (const p of (props ?? []) as Array<{ subject_thread_id: string; proposal_family: string | null }>) {
    if (p.proposal_family !== 'person' && p.proposal_family !== 'company') continue
    const csId = threadToCs.get(p.subject_thread_id)
    if (csId) actorCsIds.add(csId)
  }
  const businessCsIds = csIds.filter((id) => !actorCsIds.has(id))
  if (actorCsIds.size) {
    console.log(`  (${actorCsIds.size} sujet(s) acteur(s) person/company exclu(s) du périmètre thèmes)`)
  }
  if (!businessCsIds.length) return []

  // 4. Sujets canoniques (actifs uniquement — un sujet merged pointe vers son
  //    cible canonique, l'inclure produirait un doublon thématique)
  const { data: subjects } = await sb
    .from('canonical_subject')
    .select('id, label, status')
    .in('id', businessCsIds)
    .eq('status', 'active')

  return (subjects ?? []).map((s: { id: string; label: string }) => ({ id: s.id, label: s.label })) as Array<{
    id: string
    label: string
  }>
}

// ── Gemini classification ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un expert en management de projet de construction et de suivi de chantier.
On te donne une liste de sujets canoniques extraits d'un chantier (id, libellé).

Ta mission : proposer des regroupements thématiques sous forme de canonical_topic.
Un topic doit refléter une famille thématique ou problématique métier commune du chantier (ex : "Enrobage des conduites d'assainissement", "Essais béton / Plateforme G3", "Signalisation de chantier").
Un topic n'implique PAS que ses sujets sont physiquement identiques — deux ascenseurs distincts peuvent partager le même topic "Ascenseurs" sans être confondus.

Règles strictes :
- 5 à 12 topics maximum selon le volume (vise la synthèse, pas l'exhaustivité)
- Un topic regroupe AU MINIMUM 2 sujets — jamais de topic singleton
- Un sujet ne peut appartenir qu'à un seul topic
- Les sujets qui ne correspondent clairement à aucun groupe existant restent sans topic (ne crée pas de topic artificiel pour les inclure)
- Libellés courts et précis : 4-8 mots maximum
- Préfère des termes techniques du BTP plutôt que des catégories administratives

Pour chaque groupe proposé, donne :
- "label" : libellé synthétique du topic (4-8 mots)
- "indices" : liste des indices (champ "i") des membres
- "confidence" : 0.0 à 1.0

Réponds UNIQUEMENT en JSON valide, sans aucun autre texte :
{"topics":[{"label":"...","indices":[0,3,7],"confidence":0.85}]}`

async function classifyWithGemini(
  ai: GoogleGenAI,
  subjects: Array<{ id: string; label: string }>,
) {
  // Use short indices instead of UUIDs to minimize output token count
  const indexToId = subjects.map((s) => s.id)
  const userMsg = JSON.stringify(
    subjects.map((s, i) => ({ i, label: s.label })),
    null,
    2,
  )

  console.log(`\nEnvoi de ${subjects.length} sujets à Gemini (${MODEL})…`)

  const response = await ai.models.generateContent({
    model: MODEL,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.2,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
    },
    contents: [{ role: 'user', parts: [{ text: userMsg }] }],
  })

  const text = response.text ?? ''
  if (!text.trim()) {
    console.error('Réponse Gemini vide')
    return []
  }

  let parsed: { topics?: unknown[] }
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    console.error('Parse error:', (e as Error).message)
    console.error('Texte brut (600 chars) :\n', text.slice(0, 600))
    return []
  }
  const rawTopics = (parsed.topics ?? []) as Array<{
    label: string
    indices: number[]
    confidence: number
  }>

  // Map indices back to UUIDs
  return rawTopics.map((t) => ({
    label: t.label,
    subjectIds: (t.indices ?? []).map((i: number) => indexToId[i]).filter(Boolean),
    confidence: t.confidence,
    reasoning: '',
  }))
}

// ── Persist ───────────────────────────────────────────────────────────────────

async function persistTopics(
  siteId: string,
  topics: Array<{ label: string; subjectIds: string[]; confidence: number; reasoning: string }>,
  validSubjectIds: Set<string>,
  labelById: Map<string, string>,
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
      for (const id of validMembers) console.log(`      - ${labelById.get(id) ?? id}`)
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
  for (const id of unassigned) console.log(`    - ${labelById.get(id) ?? id}`)
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

  if (existingTopics?.length && !ONLY_UNCLASSIFIED) {
    console.log(`\n⚠ ${existingTopics.length} topic(s) déjà existant(s) pour ce site.`)
    console.log('Utilisez --only-unclassified pour ne traiter que les sujets sans topic.')
    console.log('Ou supprimez les topics existants avant de relancer :')
    console.log(`DELETE FROM canonical_topic WHERE site_id = '${SITE_ID}';`)
    return
  }

  if (existingTopics?.length) {
    console.log(`\n${existingTopics.length} topic(s) existant(s) — mode --only-unclassified actif.`)
  }

  // En mode --only-unclassified, filtrer les sujets déjà assignés
  let subjectsToClassify = subjects
  if (ONLY_UNCLASSIFIED) {
    const { data: alreadyAssigned } = await sb
      .from('canonical_topic_subject')
      .select('canonical_subject_id')
      .in('canonical_subject_id', subjects.map((s) => s.id))
    const assignedIds = new Set(
      (alreadyAssigned ?? []).map((r: { canonical_subject_id: string }) => r.canonical_subject_id),
    )
    subjectsToClassify = subjects.filter((s) => !assignedIds.has(s.id))
    console.log(`${subjectsToClassify.length} sujets non classifiés (sur ${subjects.length} total)`)
  }

  if (subjectsToClassify.length < 2) {
    console.log('Pas assez de sujets non classifiés pour proposer un nouveau topic. Abandon.')
    return
  }

  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) {
    console.error('GOOGLE_GENAI_API_KEY manquante')
    process.exit(1)
  }
  const ai = new GoogleGenAI({ apiKey })

  const topics = await classifyWithGemini(ai, subjectsToClassify)
  console.log(`\n${topics.length} topic(s) proposés par Gemini :`)
  for (const t of topics) {
    console.log(`  [${(t.confidence * 100).toFixed(0)}%] "${t.label}" — ${t.subjectIds.length} sujets`)
    console.log(`         ${t.reasoning}`)
  }

  const validIds = new Set(subjectsToClassify.map((s) => s.id))
  const labelById = new Map(subjectsToClassify.map((s) => [s.id, s.label]))
  await persistTopics(SITE_ID, topics, validIds, labelById)
  console.log('\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
