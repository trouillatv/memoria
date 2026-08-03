/**
 * Banc de test faux-éclatements — validation du résolveur sémantique
 *
 * Protocole :
 *   POSITIFS : source = label d'un thread, candidats = tous les canonical_subjects du site
 *              SAUF le propre cs du thread source → évite la tautologie du Lot 1.
 *              Succès = le résolveur choisit un cs du même cluster (même sujet physique).
 *
 *   NÉGATIFS : candidats = liste contrôlée de cs superficiellement proches mais distincts.
 *              Succès = no_match ou confidence < 0.70 (le résolveur ne confond pas).
 *
 * Usage :
 *   npx tsx scripts/test-faux-eclatement.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { GoogleGenAI } from '@google/genai'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

async function sql(query: string): Promise<unknown[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const res = await fetch('https://api.supabase.com/v1/projects/srixnofmaydxouhucawn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

const SITE_COMPOSTAGE = '2c939e67-e986-4635-86a0-638cda870480'
const MODEL = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'

// ── Clusters de faux-éclatements connus ──────────────────────────────────────
// Chaque cluster = plusieurs cs_ids représentant le même sujet physique,
// fragmentés parce que leurs labels ont évolué d'un PV à l'autre.

const CLUSTER_R4 = [
  '024dab7e-16d9-4927-bedc-f92c5ac89a64', // Prévision: Reprise du réseau pour problème regard R4...
  '858a9f11-3190-49e6-ad06-584fb0027b15', // Problème regard R4 manque Chute pour la mise en œuvre...
  '4fb967c3-4432-4bc2-9e47-e626fcd6fa84', // Regard R4 (125x125) avec chute manquante pour mise en...
  'd8861786-2f44-461c-bf57-e873336ac9ea', // Regard R4 chute manquante repris
  'bba40ef0-3192-4aae-ac63-f95be8790926', // Reprise du réseau pour problème regard R4 (manque chute)...
]

const CLUSTER_LAGUNAGE = [
  '185865b3-351a-49a0-92af-c0c61bd2652e', // Raccordement sur le lagunage
  '4d43c82d-3ba1-4310-b609-7eca698f095c', // Raccordement sur le lagunage fera l'objet d'une validation...
  '2bff30b9-8298-4363-89db-45f12eb8c0bd', // Validation du raccordement sur le lagunage
  'b93fafd9-dd27-48bb-babb-094c33e23f53', // Validation raccordement lagunage
]

const CLUSTER_DEBOURBEUR = [
  '27384e81-bbd2-4138-bc4a-653170e479b0', // Assainissement : Mise en place du Débourbeur déshuileur...
  'ce73b108-c4f1-486b-b421-338d44e0943c', // Débourbeur déshuileur
  '966af6f5-9fae-4a9b-8bcb-89983f87ed71', // Fiche technique débourbeur déshuileur conforme
  '7c9b287a-979e-4dd8-a1f6-7c8ddc9bb8b3', // FT débourbeur déshuileur à retransmettre...
  '0e8a3996-0610-421d-898c-199af6536684', // FT débourbeur déshuileur retransmis le 27.04.2026 conforme
  'deeff5d1-0b80-4d30-8527-64e62eff4e23', // Mise en place Débourbeur déshuileur
]

const CLUSTER_GRILLES = [
  '76eb6c35-ae88-426b-afea-ee50c3f5f904', // Fourniture des grilles pour la zone de dalle (3 unités)
  '04880db6-2e07-4530-94ed-a35ebc789f39', // Fourniture grilles zone dalle
]

// ── Cas de test ──────────────────────────────────────────────────────────────

type TestCase = {
  name: string
  kind: 'positive' | 'negative'
  // Label source (l'orphelin à résoudre)
  sourceLabel: string
  // cs_id à exclure des candidats (son propre canonical_subject) — null = pas d'exclusion
  excludeCsId: string | null
  // Pour positifs : ensemble des cs_ids acceptables comme réponse correcte
  acceptableCsIds?: string[]
  // Pour négatifs : liste contrôlée de candidats (on ne veut pas de match)
  controlledCandidates?: Array<{ id: string; label: string; aliases: string[] }>
  // Note explicative
  note: string
}

// ── Utilitaires (réplique de semantic-subject-resolution.ts) ─────────────────

const STOPWORDS = new Set([
  'de','du','la','le','les','des','un','une','et','ou','au','aux',
  'en','par','pour','sur','sous','dans','avec','sans','ce','se',
  'l','d','est','sont','ete','etre','avoir','y','il','ils',
])

function normalize(label: string): Set<string> {
  return new Set(
    label.toLowerCase()
      .normalize('NFD').replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  )
}

function jaccard(a: string, b: string): number {
  const tA = normalize(a)
  const tB = normalize(b)
  if (tA.size === 0 && tB.size === 0) return 1
  if (tA.size === 0 || tB.size === 0) return 0
  let inter = 0
  for (const t of tA) if (tB.has(t)) inter++
  return inter / (tA.size + tB.size - inter)
}

function extractCodes(label: string): Set<string> {
  return new Set(label.toUpperCase().match(/\b([A-Z]{1,4}\d+|\d+[A-Z]{1,3})\b/g) ?? [])
}

function filterCandidates(
  orphanLabel: string,
  all: Array<{ id: string; label: string; aliases: string[] }>,
  max = 80,
): Array<{ id: string; label: string; aliases: string[] }> {
  const orphanCodes = extractCodes(orphanLabel)
  return all
    .filter((c) => {
      if (jaccard(orphanLabel, c.label) > 0.10) return true
      for (const a of (c.aliases ?? [])) if (jaccard(orphanLabel, a) > 0.10) return true
      if (orphanCodes.size > 0) {
        const allLabels = [c.label, ...(c.aliases ?? [])].join(' ')
        const cCodes = extractCodes(allLabels)
        for (const code of orphanCodes) if (cCodes.has(code)) return true
      }
      return false
    })
    .slice(0, max)
}

// ── LLM ──────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un assistant de catégorisation de sujets de chantier BTP.
Tu reçois un label extrait d'un procès-verbal de visite et une liste de sujets canoniques connus.
Ta tâche : identifier si ce label désigne l'un des sujets connus, même si la formulation a changé.
Deux sujets ne sont pas identiques uniquement parce qu'ils partagent la même technique ou le même ouvrage général. Respecte les distinctions de zone, objet, document, phase et finalité. Exemples : accès ≠ plateforme ; plan ≠ implantation ; raccordement ≠ busage ; R3 ≠ R4.
Réponds UNIQUEMENT avec l'un des UUIDs fournis ou null.
N'invente JAMAIS un UUID absent de la liste.
Donne un score model_confidence entre 0.0 et 1.0.
Sois concis dans reasoning (≤ 80 mots).`

async function callLLM(
  ai: GoogleGenAI,
  label: string,
  candidates: Array<{ id: string; label: string; aliases: string[] }>,
): Promise<{ match: string | null; model_confidence: number; reasoning: string } | null> {
  const lines = candidates.map((c) => {
    const al = (c.aliases ?? []).length > 0 ? ` [alias : ${c.aliases.join(', ')}]` : ''
    return `- ${c.id} : ${c.label}${al}`
  })
  const userMessage = [
    `Label à identifier : "${label}"`,
    '',
    'Sujets canoniques connus :',
    ...lines,
    '',
    'Retourne l\'UUID correspondant ou null. Format JSON : {"match":"uuid-ou-null","model_confidence":0.95,"reasoning":"..."}',
  ].join('\n')

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        maxOutputTokens: 400,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
      },
      contents: userMessage,
    })
    const text = (response.text ?? '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(text)
    return {
      match: typeof parsed.match === 'string' ? parsed.match : null,
      model_confidence: typeof parsed.model_confidence === 'number'
        ? (parsed.model_confidence > 1 ? parsed.model_confidence / 100 : parsed.model_confidence)
        : 0,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 500) : '',
    }
  } catch {
    return null
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY manquante')
  const ai = new GoogleGenAI({ apiKey })

  // Charger tous les canonical_subjects du site
  const allCsRaw = await sql(`
    SELECT id, label, aliases FROM canonical_subject
    WHERE site_id = '${SITE_COMPOSTAGE}' AND status = 'active'
    ORDER BY label
  `) as Array<{ id: string; label: string; aliases: string[] }>

  console.log(`Total canonical_subjects disponibles : ${allCsRaw.length}\n`)

  // Chercher le label de chaque cs_id pour les cas de test
  const csById = new Map(allCsRaw.map((c) => [c.id, c]))

  // ── Définition des cas ────────────────────────────────────────────────────

  const TESTS: TestCase[] = [
    // POSITIFS — même sujet physique, formulation différente
    {
      name: 'R4 — P1 : "Regard R4 chute manquante repris"',
      kind: 'positive',
      sourceLabel: 'Regard R4 chute manquante repris',
      excludeCsId: 'd8861786-2f44-461c-bf57-e873336ac9ea',
      acceptableCsIds: CLUSTER_R4.filter((id) => id !== 'd8861786-2f44-461c-bf57-e873336ac9ea'),
      note: 'Label final (résolution) doit trouver le sujet R4 en cours de résolution',
    },
    {
      name: 'R4 — P2 : "Problème regard R4 manque Chute..."',
      kind: 'positive',
      sourceLabel: 'Problème regard R4 manque Chute pour la mise en œuvre du dégrilleur',
      excludeCsId: '858a9f11-3190-49e6-ad06-584fb0027b15',
      acceptableCsIds: CLUSTER_R4.filter((id) => id !== '858a9f11-3190-49e6-ad06-584fb0027b15'),
      note: 'Label intermédiaire (problème en cours) doit trouver un autre cs R4',
    },
    {
      name: 'Lagunage — P3 : "Validation raccordement lagunage"',
      kind: 'positive',
      sourceLabel: 'Validation raccordement lagunage',
      excludeCsId: 'b93fafd9-dd27-48bb-babb-094c33e23f53',
      acceptableCsIds: CLUSTER_LAGUNAGE.filter((id) => id !== 'b93fafd9-dd27-48bb-babb-094c33e23f53'),
      note: 'Label court doit retrouver "Raccordement sur le lagunage" ou "Validation du raccordement..."',
    },
    {
      name: 'Lagunage — P4 : "Raccordement sur le lagunage fera l\'objet d\'une validation..."',
      kind: 'positive',
      sourceLabel: "Raccordement sur le lagunage fera l'objet d'une validation du MOA/MOE",
      excludeCsId: '4d43c82d-3ba1-4310-b609-7eca698f095c',
      acceptableCsIds: CLUSTER_LAGUNAGE.filter((id) => id !== '4d43c82d-3ba1-4310-b609-7eca698f095c'),
      note: 'Label long (détail processus) doit trouver "Raccordement sur le lagunage"',
    },
    {
      name: 'Débourbeur — P5 : "FT débourbeur déshuileur retransmis le 27.04.2026 conforme"',
      kind: 'positive',
      sourceLabel: 'FT débourbeur déshuileur retransmis le 27.04.2026 conforme',
      excludeCsId: '0e8a3996-0610-421d-898c-199af6536684',
      acceptableCsIds: CLUSTER_DEBOURBEUR.filter((id) => id !== '0e8a3996-0610-421d-898c-199af6536684'),
      note: 'Label avec date doit trouver la FT débourbeur sans date',
    },
    {
      name: 'Débourbeur — P6 : "Débourbeur déshuileur"',
      kind: 'positive',
      sourceLabel: 'Débourbeur déshuileur',
      excludeCsId: 'ce73b108-c4f1-486b-b421-338d44e0943c',
      acceptableCsIds: CLUSTER_DEBOURBEUR.filter((id) => id !== 'ce73b108-c4f1-486b-b421-338d44e0943c'),
      note: 'Label générique (2 mots) doit trouver un cs débourbeur plus détaillé',
    },
    {
      name: 'Grilles — P7 : "Fourniture grilles zone dalle"',
      kind: 'positive',
      sourceLabel: 'Fourniture grilles zone dalle',
      excludeCsId: '04880db6-2e07-4530-94ed-a35ebc789f39',
      acceptableCsIds: CLUSTER_GRILLES.filter((id) => id !== '04880db6-2e07-4530-94ed-a35ebc789f39'),
      note: 'Label abrégé doit trouver "Fourniture des grilles pour la zone de dalle (3 unités)"',
    },

    // NÉGATIFS — sujets proches mais distincts, liste contrôlée
    {
      name: 'NEG-N1 : Débourbeur ≠ Dégrilleur (équipements différents)',
      kind: 'negative',
      sourceLabel: 'Mise en place Débourbeur déshuileur',
      excludeCsId: null,
      controlledCandidates: [
        // Uniquement des cs Dégrilleur — équipement différent
        { id: 'f3e6d83d-f4cb-409a-91e3-21705c22231e', label: 'Demande de plan de détail du dégrilleur et plan de détail du débimètre', aliases: [] },
        { id: '8803cfd5-26aa-415b-bacd-bd916936f8c2', label: 'Demande de plan de reprise du réseau d\'assainissement pour dégrilleur et débimètre', aliases: [] },
        { id: '34973091-1a19-47f0-a08d-e49de94cd2c6', label: 'Demande de plans de détail du dégrilleur et du débitmètre', aliases: [] },
        { id: 'd0e47a9c-459e-4b2a-9082-cd2b9888823e', label: 'Fiche technique dégrilleur validation de principe', aliases: [] },
        { id: '12fa1b0e-e7cb-47dd-9a13-870e04f97e00', label: 'Transmettre FT Dégrilleur', aliases: [] },
      ],
      note: '"Débourbeur déshuileur" ne doit pas matcher les sujets Dégrilleur (équipement distinct)',
    },
    {
      name: 'NEG-N2 : Couche de forme accès ≠ Couche de forme terrassement (zones distinctes)',
      kind: 'negative',
      sourceLabel: 'Accès Plateforme - Couche de forme',
      excludeCsId: null,
      controlledCandidates: [
        // Sujets couche de forme d'autres zones
        { id: '90bd548f-ece7-453c-833b-192994896b81', label: 'Terrassement plateforme - Couche de forme', aliases: [] },
        { id: '7f684dad-d939-4580-8d57-dc26a8f2ac9c', label: 'Prévision : Mise en place couche de forme', aliases: [] },
        { id: '8911821a-d691-4c45-a4d8-ea073b7d72d3', label: 'Terrassement plateforme - Purge', aliases: [] },
        { id: 'd91a9c66-374c-4875-9a79-f1090fa9bb5b', label: 'Plan de terrassement', aliases: [] },
      ],
      note: '"Accès Plateforme" est une zone distincte de "Terrassement plateforme" — ne doit pas merger',
    },
    {
      name: 'NEG-N3 : Raccordement lagunage ≠ Busage lagunage (problèmes distincts)',
      kind: 'negative',
      sourceLabel: 'Raccordement sur le lagunage',
      excludeCsId: null,
      controlledCandidates: [
        // Sujets busage (différents du raccordement)
        { id: 'f74148ab-d783-4dee-9022-65d218e5ac8b', label: 'Assainissement - Busage plateforme-lagunage', aliases: [] },
        { id: '541b54fa-b6a9-47b2-91a5-7884f9bdb8eb', label: 'Assainissement : Busage entre la plateforme et le lagunage – Zone de largeur non conforme', aliases: [] },
        { id: '00666bca-81da-4778-9cad-11e694376ec2', label: 'Zone de largeur non conforme pour busage entre plateforme et lagunage', aliases: [] },
        { id: 'd91a9c66-374c-4875-9a79-f1090fa9bb5b', label: 'Plan de terrassement', aliases: [] },
      ],
      note: '"Raccordement" (connexion réalisée) ≠ "Busage" (dimensionnement/pose des conduites)',
    },
    {
      name: 'NEG-N4 : Regard R4 ≠ Couche de forme (domaines complètement différents)',
      kind: 'negative',
      sourceLabel: 'Regard R4 chute manquante repris',
      excludeCsId: null,
      controlledCandidates: [
        // Aucun sujet R4 — uniquement couche de forme et terrassement
        { id: 'c8207deb-28a4-4c2b-951b-cd95d6ff9552', label: 'Accès Plateforme - Couche de forme', aliases: [] },
        { id: '90bd548f-ece7-453c-833b-192994896b81', label: 'Terrassement plateforme - Couche de forme', aliases: [] },
        { id: '3355e3d4-50a5-4309-b6b9-f4a7bad4ac4f', label: 'Couche de forme réalisée', aliases: [] },
        { id: 'd91a9c66-374c-4875-9a79-f1090fa9bb5b', label: 'Plan de terrassement', aliases: [] },
        { id: '7ab8a5aa-b6aa-4cce-b250-c4fe10800fc5', label: 'Terrassement plateforme - Déblais/Remblais', aliases: [] },
      ],
      note: 'R4 est un regard d\'assainissement, les candidats sont tous de la couche de forme — no_match attendu',
    },
    {
      name: 'NEG-N5 : "Plan de terrassement" ≠ "Implantation des terrassements" (phases distinctes)',
      kind: 'negative',
      sourceLabel: 'Plan de terrassement',
      excludeCsId: null,
      controlledCandidates: [
        // Seulement les implantations (action terrain) — pas le plan (document)
        { id: 'e0a5a2b2-0f5d-4640-86a9-758271fc8a98', label: 'Implantation des terrassements', aliases: [] },
        { id: '864abdaa-85c5-44c1-947a-eb6f13064d9c', label: 'Implantation des terrassements', aliases: [] },
        { id: '9192db79-f8a3-4ec0-8a6e-0a7c956f70f4', label: 'Terrassement plateforme : Démarrage purge', aliases: [] },
        { id: '4a240cc6-ce77-492a-98b6-b34838793460', label: 'Terrassement plateforme - Purge complémentaire', aliases: [] },
      ],
      note: '"Plan de terrassement" (document) ≠ "Implantation des terrassements" (action terrain réalisée)',
    },
  ]

  // ── Exécution ─────────────────────────────────────────────────────────────

  type Result = {
    name: string
    kind: 'positive' | 'negative'
    sourceLabel: string
    matchId: string | null
    matchLabel: string | null
    confidence: number
    shadowDecision: string
    candidateCount: number
    expected: string          // description courte du résultat attendu
    correct: boolean
    reasoning: string
  }

  const results: Result[] = []
  let passCount = 0

  for (let i = 0; i < TESTS.length; i++) {
    const tc = TESTS[i]
    console.log(`\n[${i + 1}/${TESTS.length}] ${tc.name}`)

    let candidates: Array<{ id: string; label: string; aliases: string[] }>

    if (tc.kind === 'positive') {
      // Candidats = tous les cs du site SAUF le cs propre du thread source
      const pool = tc.excludeCsId
        ? allCsRaw.filter((c) => c.id !== tc.excludeCsId)
        : allCsRaw
      candidates = filterCandidates(tc.sourceLabel, pool)
    } else {
      // Candidats = liste contrôlée fournie dans le test
      candidates = tc.controlledCandidates ?? []
    }

    console.log(`  Candidats filtrés : ${candidates.length}`)

    if (candidates.length === 0) {
      console.log('  → 0 candidats : no_match automatique')
      const res: Result = {
        name: tc.name,
        kind: tc.kind,
        sourceLabel: tc.sourceLabel,
        matchId: null,
        matchLabel: null,
        confidence: 0,
        shadowDecision: 'no_match',
        candidateCount: 0,
        expected: tc.kind === 'positive' ? 'match dans le cluster' : 'no_match',
        correct: tc.kind === 'negative', // no_match est correct pour un négatif
        reasoning: '0 candidats',
      }
      results.push(res)
      if (res.correct) passCount++
      continue
    }

    const llmResult = await callLLM(ai, tc.sourceLabel, candidates)

    if (!llmResult) {
      console.log('  → LLM error')
      results.push({
        name: tc.name, kind: tc.kind, sourceLabel: tc.sourceLabel,
        matchId: null, matchLabel: null, confidence: 0, shadowDecision: 'error',
        candidateCount: candidates.length, expected: 'N/A', correct: false, reasoning: 'LLM error',
      })
      continue
    }

    // Valider l'UUID (anti-hallucination)
    const candidateIds = new Set(candidates.map((c) => c.id))
    const validatedId = llmResult.match && candidateIds.has(llmResult.match) ? llmResult.match : null
    const conf = llmResult.model_confidence > 1 ? llmResult.model_confidence / 100 : llmResult.model_confidence

    let shadowDecision: string
    if (!validatedId || conf < 0.70) shadowDecision = 'no_match'
    else if (conf >= 0.95) shadowDecision = 'would_auto_assign'
    else shadowDecision = 'would_suggest'

    const matchLabel = validatedId ? (csById.get(validatedId)?.label ?? candidates.find(c => c.id === validatedId)?.label ?? null) : null

    let correct: boolean
    let expected: string

    if (tc.kind === 'positive') {
      correct = !!validatedId && (tc.acceptableCsIds ?? []).includes(validatedId) && conf >= 0.70
      expected = `match dans {${tc.acceptableCsIds?.length} cs du cluster}`
    } else {
      // Négatif : succès si no_match (pas de match avec les mauvais candidats)
      correct = shadowDecision === 'no_match'
      expected = 'no_match (confidence < 0.70 ou null)'
    }

    const icon = correct ? '✓' : '✗'
    console.log(`  ${icon} ${shadowDecision}  conf=${conf.toFixed(2)}`)
    console.log(`    match   : ${matchLabel?.slice(0, 70) ?? '(aucun)'}`)
    console.log(`    raison  : ${llmResult.reasoning.slice(0, 100)}`)

    if (!correct && tc.kind === 'positive') {
      console.log(`    attendu : un cs parmi ${tc.acceptableCsIds?.join(', ')?.slice(0, 80)}`)
    }

    results.push({
      name: tc.name, kind: tc.kind, sourceLabel: tc.sourceLabel,
      matchId: validatedId, matchLabel, confidence: conf, shadowDecision,
      candidateCount: candidates.length, expected, correct, reasoning: llmResult.reasoning,
    })
    if (correct) passCount++
  }

  // ── Rapport final ─────────────────────────────────────────────────────────

  const positives = results.filter((r) => r.kind === 'positive')
  const negatives = results.filter((r) => r.kind === 'negative')
  const passPos = positives.filter((r) => r.correct).length
  const passNeg = negatives.filter((r) => r.correct).length

  console.log('\n')
  console.log('══════════════════════════════════════════════════════')
  console.log('  RAPPORT FAUX-ÉCLATEMENTS')
  console.log('══════════════════════════════════════════════════════')
  console.log(`  Total : ${passCount}/${TESTS.length} PASS`)
  console.log(`  Positifs : ${passPos}/${positives.length} PASS  (résolveur retrouve le bon sujet)`)
  console.log(`  Négatifs : ${passNeg}/${negatives.length} PASS  (résolveur ne confond pas)`)
  console.log()

  if (positives.length > 0) {
    console.log('  ── Positifs ──────────────────────────────────────────')
    for (const r of positives) {
      const icon = r.correct ? '✓' : '✗'
      const conf = r.confidence.toFixed(2)
      console.log(`  ${icon}  ${r.name}`)
      console.log(`       conf=${conf}  match="${r.matchLabel?.slice(0, 60) ?? '(aucun)'}"`)
      if (!r.correct) console.log(`       !! attendu dans le cluster, obtenu hors cluster ou no_match`)
    }
  }

  if (negatives.length > 0) {
    console.log()
    console.log('  ── Négatifs ──────────────────────────────────────────')
    for (const r of negatives) {
      const icon = r.correct ? '✓' : '✗'
      const conf = r.confidence.toFixed(2)
      console.log(`  ${icon}  ${r.name}`)
      if (!r.correct) {
        console.log(`       !! faux positif : conf=${conf}  match="${r.matchLabel?.slice(0, 60)}"`)
        console.log(`       raison : ${r.reasoning.slice(0, 100)}`)
      }
    }
  }

  const allPass = passCount === TESTS.length
  console.log()
  console.log(allPass
    ? '  → CRITÈRE ATTEINT : résolveur valide sur tous les cas de test.'
    : '  → CRITÈRE NON ATTEINT : corriger le résolveur ou le prompt avant activation.')
  console.log('══════════════════════════════════════════════════════')

  if (!allPass) process.exit(1)
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
