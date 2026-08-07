/**
 * Audit dry-run — 30 liens source=extraction créés par l'ancien suggestDependenciesForRun()
 *
 * Classifie chaque lien selon la doctrine V2 :
 *   keep_as_is            — type et direction prouvés par les extraits
 *   downgrade_to_relates_to — relation réelle mais preuve directionnelle insuffisante
 *   possible_same_subject — A et B sont probablement le même sujet canonique
 *   reject                — cooccurrence pure, contingence mal interprétée, ou contradiction
 *
 * Règles de doctrine appliquées :
 *   - Contingence "si X, alors Y" ≠ enables(X,Y)
 *   - Chronologie seule ≠ directionnel
 *   - semanticEvidence obligatoire pour directionnel
 *   - Jaccard labels ≥ 0.65 ou runOverlap ≥ 0.90 + extraits similaires → possible_same_subject
 *
 * Aucune écriture en base.
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/audit-extraction-links.ts
 */

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!supabaseUrl || !serviceKey) { console.error('[FATAL] env manquantes'); process.exit(1) }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

const SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
function normalizeText(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
function tokenSet(s: string) { return new Set(normalizeText(s).split(' ').filter(t => t.length >= 2)) }
function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 && b.size === 0) return 1
  const inter = [...a].filter(t => b.has(t)).length
  return inter / new Set([...a, ...b]).size
}

// ── Schémas ───────────────────────────────────────────────────────────────────

const CLASSIFICATIONS = ['keep_as_is', 'downgrade_to_relates_to', 'possible_same_subject', 'reject'] as const
type Classification = (typeof CLASSIFICATIONS)[number]

const GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    classification: { type: 'string', enum: [...CLASSIFICATIONS] },
    reasoning: { type: 'string' },
  },
  required: ['classification', 'reasoning'],
}

const ResultSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  reasoning: z.string().min(1),
})

// ── Prompt d'audit ────────────────────────────────────────────────────────────

function buildAuditPrompt(opts: {
  linkType: string; labelA: string; famA: string; labelB: string; famB: string
  justification: string | null; excerpt: string | null; confidence: number | null
}): string {
  return `Tu audites un lien de relation entre deux sujets d'un chantier BTP.
Ce lien a été produit automatiquement par un ancien moteur LLM. Tu dois le reclassifier selon une doctrine plus stricte.

SUJET A : "${opts.labelA}" (${opts.famA})
SUJET B : "${opts.labelB}" (${opts.famB})

LIEN ACTUEL : ${opts.linkType}  (confidence ${opts.confidence ?? '?'})

JUSTIFICATION ORIGINALE : "${opts.justification ?? '(aucune)'}"
EXTRAIT SOURCE : "${opts.excerpt?.slice(0, 400) ?? '(aucun)'}"

DOCTRINE D'AUDIT — applique STRICTEMENT ces règles :

1. CONTINGENCE ≠ DIRECTIONNEL
   "Y à prévoir si X n'est pas fait", "si X, prévoir Y", "en cas de X, Y" → ce sont des scénarios de repli.
   Ils ne prouvent pas requires/enables/causes/validates/replaces.
   → classify : downgrade_to_relates_to ou reject

2. CHRONOLOGIE SEULE ≠ DIRECTIONNEL
   "après A, B", "une fois A terminé, B" sans explication de pourquoi → pas de causalité prouvée.
   → classify : downgrade_to_relates_to

3. DIRECTIONNEL VALIDE
   Exige une formulation explicite dans le texte : "A est nécessaire avant B", "B démarre après validation de A",
   "A valide B", "A remplace B formellement", "A provoque directement B".
   Si présent dans l'extrait ou la justification → keep_as_is.

4. SAME SUBJECT
   Si les labels sont quasi-identiques (même objet, même thème très proche, famille différente) → possible_same_subject.

5. COOCCURRENCE PURE
   Si ni l'extrait ni la justification ne prouvent de lien réel → reject.

CLASSIFICATIONS AUTORISÉES :
  keep_as_is              — preuve directionnelle explicite dans l'extrait ou la justification
  downgrade_to_relates_to — relation existe mais non directionnelle / contingence / chronologie seule
  possible_same_subject   — A et B semblent décrire le même objet (quasi-doublon canonique)
  reject                  — cooccurrence pure, contingence mal interprétée, aucune relation prouvée

reasoning : cite l'élément textuel clé qui justifie ta décision (≤ 150 caractères).`
}

// ── Appel Gemini ──────────────────────────────────────────────────────────────

async function classifyLink(opts: Parameters<typeof buildAuditPrompt>[0]): Promise<{ classification: Classification; reasoning: string } | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) { console.error('[classify] GOOGLE_GENAI_API_KEY manquante'); return null }

  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const prompt = buildAuditPrompt(opts)

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 512, temperature: 0.0,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_SCHEMA,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    )
    if (!resp.ok) { console.error(`  HTTP ${resp.status}`); return null }
    const json = await resp.json()
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null
    const parsed = ResultSchema.safeParse(JSON.parse(text))
    if (!parsed.success) { console.error('  Parse error:', parsed.error.issues[0]?.message); return null }
    return parsed.data
  } catch (e) {
    console.error('  Exception:', e)
    return null
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Audit liens source=extraction (ancien moteur) ===')
  console.log(`Site : ${SITE_ID}\n`)

  // 1. Tous les liens extraction du site
  const { data: links, error: eLinks } = await supabase
    .from('subject_thread_links')
    .select('id,from_thread_id,to_thread_id,link_type,status,source,confidence,justification,evidence_run_id,evidence_proposal_id,created_at')
    .eq('site_id', SITE_ID)
    .eq('source', 'extraction')
  if (eLinks) { console.error('[FATAL]', eLinks.message); process.exit(1) }
  console.log(`Liens source=extraction : ${links?.length ?? 0}`)

  // 2. Thread → canonical_subject
  const { data: sti } = await supabase
    .from('subject_thread_identity').select('subject_thread_id, canonical_subject_id')
    .eq('site_id', SITE_ID)
  const threadToCS = new Map<string, string>()
  for (const r of sti ?? []) threadToCS.set(r.subject_thread_id, r.canonical_subject_id)

  // 3. Canonical subjects
  const { data: canonicals } = await supabase
    .from('canonical_subject').select('id, label, aliases, status')
    .eq('site_id', SITE_ID)
  const csLabel  = new Map((canonicals ?? []).map(c => [c.id, c.label as string]))

  // 4. Familles (proposition majority vote)
  const { data: runRows } = await supabase
    .from('document_extraction_run').select('id')
    .eq('target_site_id', SITE_ID).eq('is_canonical', true)
    .neq('status', 'failed').neq('status', 'pending')
  const canonicalRunIds = (runRows ?? []).map(r => r.id as string)

  const allProps: { subject_thread_id: string; proposal_family: string }[] = []
  for (let i = 0; i < canonicalRunIds.length; i += 100) {
    const { data } = await supabase.from('document_extraction_proposal')
      .select('subject_thread_id, proposal_family')
      .in('extraction_run_id', canonicalRunIds.slice(i, i + 100))
      .not('subject_thread_id', 'is', null)
    allProps.push(...(data ?? []))
  }
  const threadFamily = new Map<string, Map<string, number>>()
  for (const p of allProps) {
    if (!threadFamily.has(p.subject_thread_id)) threadFamily.set(p.subject_thread_id, new Map())
    const fm = threadFamily.get(p.subject_thread_id)!
    fm.set(p.proposal_family, (fm.get(p.proposal_family) ?? 0) + 1)
  }
  function getBestFamily(threadId: string): string {
    const fm = threadFamily.get(threadId)
    if (!fm) return '?'
    let best = '?', bestN = 0
    for (const [f, n] of fm) { if (n > bestN) { best = f; bestN = n } }
    return best
  }

  // 5. Résultats compteurs
  const counts: Record<Classification | 'error', number> = {
    keep_as_is: 0, downgrade_to_relates_to: 0, possible_same_subject: 0, reject: 0, error: 0,
  }
  const byType: Record<string, Record<Classification | 'error', number>> = {}
  const results: Array<{
    i: number; linkType: string; status: string; labelA: string; labelB: string
    justification: string | null; excerpt: string | null; confidence: number | null
    classification: Classification | 'error'; reasoning: string
    labelJaccard: number
  }> = []

  console.log()

  for (let idx = 0; idx < (links ?? []).length; idx++) {
    const l = links![idx]
    const csIdA = threadToCS.get(l.from_thread_id)
    const csIdB = threadToCS.get(l.to_thread_id)
    const labelA = (csIdA ? csLabel.get(csIdA) : null) ?? l.from_thread_id.slice(0, 8)
    const labelB = (csIdB ? csLabel.get(csIdB) : null) ?? l.to_thread_id.slice(0, 8)
    const famA   = getBestFamily(l.from_thread_id)
    const famB   = getBestFamily(l.to_thread_id)
    const labelJaccard = jaccard(tokenSet(labelA), tokenSet(labelB))

    // Extrait de preuve
    let excerpt: string | null = null
    if (l.evidence_proposal_id) {
      const { data: prop } = await supabase.from('document_extraction_proposal')
        .select('source_excerpt').eq('id', l.evidence_proposal_id).single()
      excerpt = prop?.source_excerpt ?? null
    }

    process.stdout.write(`[${String(idx + 1).padStart(2)}/${links!.length}] ${l.link_type.padEnd(12)} ${labelA.slice(0, 30).padEnd(31)} ↔ ${labelB.slice(0, 30).padEnd(31)} `)

    const result = await classifyLink({
      linkType: l.link_type,
      labelA, famA, labelB, famB,
      justification: l.justification,
      excerpt,
      confidence: l.confidence,
    })

    const classification = result?.classification ?? 'error'
    const reasoning      = result?.reasoning ?? '(erreur)'
    counts[classification]++
    if (!byType[l.link_type]) byType[l.link_type] = { keep_as_is: 0, downgrade_to_relates_to: 0, possible_same_subject: 0, reject: 0, error: 0 }
    byType[l.link_type][classification]++

    const marker = {
      keep_as_is:             '✓',
      downgrade_to_relates_to:'↓',
      possible_same_subject:  '≈',
      reject:                 '✗',
      error:                  '?',
    }[classification]
    console.log(`${marker} ${classification}`)
    results.push({ i: idx + 1, linkType: l.link_type, status: l.status, labelA, labelB, justification: l.justification, excerpt, confidence: l.confidence, classification, reasoning, labelJaccard })

    await sleep(400)
  }

  // ── Rapport détaillé ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(100))
  console.log('  RAPPORT DÉTAILLÉ')
  console.log('═'.repeat(100))

  for (const r of results) {
    const marker = { keep_as_is: '✓ KEEP', downgrade_to_relates_to: '↓ DOWNGRADE', possible_same_subject: '≈ SAME_SUBJ', reject: '✗ REJECT', error: '? ERROR' }[r.classification]
    console.log(`\n[${String(r.i).padStart(2)}] ${marker}  —  ${r.linkType.toUpperCase()}  (${r.status})  conf=${r.confidence ?? '?'}  jaccard=${r.labelJaccard.toFixed(2)}`)
    console.log(`    A : "${r.labelA}"`)
    console.log(`    B : "${r.labelB}"`)
    if (r.justification) console.log(`    Justification ancienne : "${r.justification.slice(0, 200)}"`)
    if (r.excerpt)        console.log(`    Extrait               : "${r.excerpt.slice(0, 300)}"`)
    console.log(`    → ${r.reasoning}`)
  }

  // ── Récapitulatif ─────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(100))
  console.log('  RÉCAPITULATIF')
  console.log('═'.repeat(100))
  console.log(`  Total liens audités      : ${links!.length}`)
  console.log(`  ✓ keep_as_is             : ${counts.keep_as_is}`)
  console.log(`  ↓ downgrade_to_relates_to: ${counts.downgrade_to_relates_to}`)
  console.log(`  ≈ possible_same_subject  : ${counts.possible_same_subject}`)
  console.log(`  ✗ reject                 : ${counts.reject}`)
  if (counts.error > 0) console.log(`  ? erreurs                : ${counts.error}`)
  console.log()
  console.log('  Par type de lien :')
  for (const [type, c] of Object.entries(byType)) {
    const total = Object.values(c).reduce((a, b) => a + b, 0)
    const keep  = c.keep_as_is
    const down  = c.downgrade_to_relates_to
    const same  = c.possible_same_subject
    const rej   = c.reject
    console.log(`    ${type.padEnd(14)} ${String(total).padStart(2)} liens  |  ✓${keep} ↓${down} ≈${same} ✗${rej}`)
  }
  console.log()
  console.log('[DRY-RUN] Aucune écriture en base.')
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1) })
