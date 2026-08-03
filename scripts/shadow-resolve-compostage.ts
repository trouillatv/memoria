/**
 * Lot 2 — Résolution sémantique shadow sur les orphelins PV001→PV010 (OCEF Compostage)
 *
 * Un "orphelin" ici = subject_thread_id qui n'apparaît que dans 1 run canonique.
 * Le résolveur tente de les rattacher à un canonical_subject existant via LLM.
 * Aucune modification de subject_thread_identity — shadow mode strict.
 *
 * Usage :
 *   npx tsx scripts/shadow-resolve-compostage.ts [--dry-run] [--limit N]
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
const RESOLVER_VERSION = 'v1'
const MAX_CANDIDATES = 80

// ── Fonctions pures (réplique de semantic-subject-resolution.ts) ──────────────

function extractTechnicalCodes(label: string): Set<string> {
  const codes = new Set<string>()
  const matches = label.toUpperCase().match(/\b([A-Z]{1,4}\d+|\d+[A-Z]{1,3})\b/g) ?? []
  for (const m of matches) codes.add(m)
  return codes
}

function normalizeLabel(label: string): string {
  const STOPWORDS = new Set([
    'de','du','la','le','les','des','un','une','et','ou','au','aux',
    'en','par','pour','sur','sous','dans','avec','sans','ce','se',
    'l','d','est','sont','ete','etre','avoir','y','il','ils',
  ])
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .join(' ')
    .trim()
}

function jaccardSimilarity(a: string, b: string): number {
  const tokA = new Set(normalizeLabel(a).split(' ').filter(Boolean))
  const tokB = new Set(normalizeLabel(b).split(' ').filter(Boolean))
  if (tokA.size === 0 && tokB.size === 0) return 1
  if (tokA.size === 0 || tokB.size === 0) return 0
  let inter = 0
  for (const t of tokA) if (tokB.has(t)) inter++
  return inter / (tokA.size + tokB.size - inter)
}

type Candidate = { id: string; label: string; aliases: string[] }

function filterCandidates(orphanLabel: string, all: Candidate[]): Candidate[] {
  const orphanCodes = extractTechnicalCodes(orphanLabel)
  return all
    .filter((c) => {
      if (jaccardSimilarity(orphanLabel, c.label) > 0.10) return true
      for (const a of c.aliases) if (jaccardSimilarity(orphanLabel, a) > 0.10) return true
      if (orphanCodes.size > 0) {
        const allLabels = [c.label, ...c.aliases].join(' ')
        const cCodes = extractTechnicalCodes(allLabels)
        for (const code of orphanCodes) if (cCodes.has(code)) return true
      }
      return false
    })
    .slice(0, MAX_CANDIDATES)
}

function validateAndClassify(
  matchId: string | null,
  confidence: number,
  candidateIds: Set<string>,
): { candidateId: string | null; shadowDecision: 'would_auto_assign' | 'would_suggest' | 'no_match' } {
  const validatedId = matchId && candidateIds.has(matchId) ? matchId : null
  if (!validatedId || confidence < 0.70) return { candidateId: null, shadowDecision: 'no_match' }
  if (confidence >= 0.95) return { candidateId: validatedId, shadowDecision: 'would_auto_assign' }
  return { candidateId: validatedId, shadowDecision: 'would_suggest' }
}

// ── LLM ──────────────────────────────────────────────────────────────────────

const MODEL = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'

const SYSTEM_PROMPT = `Tu es un assistant de catégorisation de sujets de chantier BTP.
Tu reçois un label extrait d'un procès-verbal de visite et une liste de sujets canoniques connus.
Ta tâche : identifier si ce label désigne l'un des sujets connus, même si la formulation a changé.
Deux sujets ne sont pas identiques uniquement parce qu'ils partagent la même technique ou le même ouvrage général. Respecte les distinctions de zone, objet, document, phase et finalité. Exemples : accès ≠ plateforme ; plan ≠ implantation ; raccordement ≠ busage ; R3 ≠ R4.
Réponds UNIQUEMENT avec l'un des UUIDs fournis ou null.
N'invente JAMAIS un UUID absent de la liste.
Donne un score model_confidence entre 0.0 et 1.0.
Sois concis dans reasoning (≤ 80 mots).`

async function callLLM(ai: GoogleGenAI, label: string, candidates: Candidate[]): Promise<{
  match: string | null
  model_confidence: number
  reasoning: string
} | null> {
  const lines = candidates.map((c) => {
    const aliases = c.aliases.length > 0 ? ` [alias : ${c.aliases.join(', ')}]` : ''
    return `- ${c.id} : ${c.label}${aliases}`
  })
  const userMessage = [
    `Label à identifier : "${label}"`,
    '',
    'Sujets canoniques connus :',
    ...lines,
    '',
    "Retourne l'UUID correspondant ou null. Format JSON : {\"match\":\"uuid-ou-null\",\"model_confidence\":0.95,\"reasoning\":\"...\"}",
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
  const dryRun = process.argv.includes('--dry-run')
  const limitIdx = process.argv.indexOf('--limit')
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity

  console.log(`Mode : ${dryRun ? 'DRY-RUN' : 'ÉCRITURE'} | Modèle : ${MODEL}\n`)

  // 1. Orphelins : threads qui n'apparaissent que dans 1 run canonique, non encore résolus
  const orphansRaw = await sql(`
    SELECT DISTINCT ON (dep.subject_thread_id)
      dep.subject_thread_id,
      dep.label AS latest_label,
      dep.proposal_family
    FROM document_extraction_proposal dep
    JOIN document_extraction_run der ON der.id = dep.extraction_run_id
    WHERE der.target_site_id = '${SITE_COMPOSTAGE}'
      AND der.is_canonical = true
      AND dep.subject_thread_id IS NOT NULL
      AND dep.label IS NOT NULL
      AND dep.subject_thread_id IN (
        SELECT dep2.subject_thread_id
        FROM document_extraction_proposal dep2
        JOIN document_extraction_run der2 ON der2.id = dep2.extraction_run_id
        WHERE der2.target_site_id = '${SITE_COMPOSTAGE}'
          AND der2.is_canonical = true
          AND dep2.subject_thread_id IS NOT NULL
        GROUP BY dep2.subject_thread_id
        HAVING COUNT(DISTINCT der2.id) = 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM canonical_subject_suggestion css
        WHERE css.subject_thread_id = dep.subject_thread_id
          AND css.resolver_version = '${RESOLVER_VERSION}'
      )
    ORDER BY dep.subject_thread_id, der.created_at DESC
  `) as Array<{ subject_thread_id: string; latest_label: string; proposal_family: string }>

  const orphans = orphansRaw.slice(0, isFinite(limit) ? limit : orphansRaw.length)
  console.log(`Orphelins mono-PV à résoudre : ${orphans.length} (total trouvés : ${orphansRaw.length})\n`)

  if (orphans.length === 0) {
    console.log('[OK] Rien à résoudre.')
    return
  }

  if (dryRun) {
    for (const o of orphans.slice(0, 10)) {
      console.log(`  + ${o.proposal_family.padEnd(20)} ${o.latest_label.slice(0, 60)}`)
    }
    if (orphans.length > 10) console.log(`  ... et ${orphans.length - 10} autres`)
    console.log('\nDRY-RUN : relancez sans --dry-run pour appliquer.')
    return
  }

  // 2. Candidats (canonical_subjects actifs du site)
  const candidatesRaw = await sql(`
    SELECT id, label, aliases FROM canonical_subject
    WHERE site_id = '${SITE_COMPOSTAGE}' AND status = 'active'
  `) as Candidate[]

  console.log(`Candidats disponibles : ${candidatesRaw.length}`)
  console.log()

  // 3. Initialiser Gemini
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY manquante')
  const ai = new GoogleGenAI({ apiKey })

  // 4. Résoudre chaque orphelin
  const results: Array<{
    subject_thread_id: string; label: string; family: string; candidateId: string | null
    shadowDecision: string; confidence: number | null; reasoning: string | null
    candidateLabel: string | null; candidateCount: number
  }> = []

  let autoAssign = 0, suggest = 0, noMatch = 0

  for (let i = 0; i < orphans.length; i++) {
    const o = orphans[i]
    const candidates = filterCandidates(o.latest_label, candidatesRaw)
    const candidateIds = new Set(candidates.map((c) => c.id))

    if (candidates.length === 0) {
      results.push({ subject_thread_id: o.subject_thread_id, label: o.latest_label, family: o.proposal_family, candidateId: null, shadowDecision: 'no_match', confidence: null, reasoning: null, candidateLabel: null, candidateCount: 0 })
      noMatch++
      process.stdout.write(`\r[${i + 1}/${orphans.length}] noMatch (0 candidats)                    `)
      continue
    }

    const llmResult = await callLLM(ai, o.latest_label, candidates)

    if (!llmResult) {
      results.push({ subject_thread_id: o.subject_thread_id, label: o.latest_label, family: o.proposal_family, candidateId: null, shadowDecision: 'no_match', confidence: null, reasoning: 'LLM failed', candidateLabel: null, candidateCount: candidates.length })
      noMatch++
      continue
    }

    const { candidateId, shadowDecision } = validateAndClassify(llmResult.match, llmResult.model_confidence, candidateIds)
    const candidateLabel = candidateId ? (candidatesRaw.find((c) => c.id === candidateId)?.label ?? null) : null

    results.push({ subject_thread_id: o.subject_thread_id, label: o.latest_label, family: o.proposal_family, candidateId, shadowDecision, confidence: llmResult.model_confidence, reasoning: llmResult.reasoning, candidateLabel, candidateCount: candidates.length })

    if (shadowDecision === 'would_auto_assign') autoAssign++
    else if (shadowDecision === 'would_suggest') suggest++
    else noMatch++

    process.stdout.write(`\r[${i + 1}/${orphans.length}] ${shadowDecision.padEnd(20)} conf=${llmResult.model_confidence.toFixed(2)} "${o.latest_label.slice(0, 30)}"`)
  }

  console.log('\n')

  // 5. Écriture en DB
  const insertValues = results.map((r) => {
    const esc = (s: string | null) => s ? `'${s.replace(/'/g, "''").slice(0, 1000)}'` : 'NULL'
    return `(
      '${SITE_COMPOSTAGE}',
      '${r.subject_thread_id}',
      ${esc(r.label)},
      '${r.family}',
      ${r.candidateId ? `'${r.candidateId}'` : 'NULL'},
      ${r.confidence !== null ? r.confidence.toFixed(3) : 'NULL'},
      ${esc(r.reasoning)},
      '${r.shadowDecision}',
      '${RESOLVER_VERSION}',
      '${MODEL}',
      ${r.candidateCount}
    )`
  }).join(',\n')

  await sql(`
    INSERT INTO canonical_subject_suggestion
      (site_id, subject_thread_id, proposal_label, proposal_family,
       candidate_canonical_subject_id, model_confidence, reasoning,
       shadow_decision, resolver_version, model_name, candidate_count)
    VALUES ${insertValues}
    ON CONFLICT (subject_thread_id, resolver_version) DO NOTHING
  `)

  // 6. Rapport
  console.log('=== RAPPORT SHADOW ===\n')
  console.log(`Total orphelins traités : ${orphans.length}`)
  console.log(`  would_auto_assign (>= 0.90) : ${autoAssign}  (${pct(autoAssign, orphans.length)})`)
  console.log(`  would_suggest (0.70–0.89)   : ${suggest}  (${pct(suggest, orphans.length)})`)
  console.log(`  no_match (< 0.70 ou vide)   : ${noMatch}  (${pct(noMatch, orphans.length)})`)

  const matchedResults = results.filter((r) => r.candidateId)

  console.log('\n--- Distribution model_confidence (matchés seulement) ---')
  const ranges = [
    { label: '0.90–1.00', lo: 0.90, hi: 1.01 },
    { label: '0.80–0.89', lo: 0.80, hi: 0.90 },
    { label: '0.70–0.79', lo: 0.70, hi: 0.80 },
    { label: '0.00–0.69', lo: 0.00, hi: 0.70 },
  ]
  for (const r of ranges) {
    const count = matchedResults.filter((m) => m.confidence !== null && m.confidence >= r.lo && m.confidence < r.hi).length
    console.log(`  ${r.label} : ${count}`)
  }

  console.log('\n--- Sujets clés ---')
  const tracked = [
    { name: 'Regard R4',             search: 'r4' },
    { name: 'Raccordement lagunage', search: 'lagunage' },
    { name: 'FT Débourbeur',         search: 'debourbeur' },
  ]
  for (const { name, search } of tracked) {
    const match = results.find((r) => r.label.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(search))
    if (!match) { console.log(`\n  [${name}] non trouvé dans les orphelins`); continue }
    console.log(`\n  [${name}]`)
    console.log(`    label    : ${match.label.slice(0, 70)}`)
    console.log(`    decision : ${match.shadowDecision}  conf=${match.confidence?.toFixed(2) ?? 'N/A'}`)
    console.log(`    candidat : ${match.candidateLabel ?? '(aucun)'}`)
    console.log(`    raison   : ${match.reasoning?.slice(0, 100) ?? ''}`)
  }

  console.log('\n--- Top would_auto_assign >= 0.90 ---')
  const topAuto = results
    .filter((r) => r.shadowDecision === 'would_auto_assign' && r.confidence !== null)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 15)
  for (const r of topAuto) {
    console.log(`  [${r.confidence?.toFixed(2)}]  "${r.label.slice(0, 50)}"`)
    console.log(`         → "${r.candidateLabel?.slice(0, 50)}"`)
  }
}

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round(100 * n / total)} %` : '0 %'
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
