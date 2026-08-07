/**
 * Apply — nettoyage des liens source=extraction (ancien moteur suggestDependenciesForRun)
 *
 * Décisions appliquées sur les liens status='suggested' uniquement :
 *   keep_as_is            → aucun changement
 *   downgrade_to_relates_to → link_type='relates_to' + audit_note en justification
 *   reject                → status='rejected' + audit_note en justification
 *   possible_same_subject → aucun changement automatique (pipeline fusion séparé)
 *
 * Règle absolue : ne jamais toucher aux liens status='confirmed'.
 *
 * Idempotence :
 *   - Si link_type déjà 'relates_to' → unchanged
 *   - Si status déjà 'rejected'      → skipped
 *   - Le filtre ON CONFLICT n'est pas nécessaire : UPDATE sur critères explicites
 *
 * Trace d'audit : préfixe ajouté à la justification :
 *   [AUDIT 2026-08-08 — legacy_directional_overreach]
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/apply-audit-extraction-links.ts
 */

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!supabaseUrl || !serviceKey) { console.error('[FATAL] env manquantes'); process.exit(1) }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

const SITE_ID    = '2c939e67-e986-4635-86a0-638cda870480'
const AUDIT_TAG  = '[AUDIT 2026-08-08 — legacy_directional_overreach] '

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── Classification Gemini ──────────────────────────────────────────────────────

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

DOCTRINE D'AUDIT :

1. CONTINGENCE ≠ DIRECTIONNEL
   "Y à prévoir si X", "si X, prévoir Y", "en cas de X, Y" = scénarios de repli → downgrade_to_relates_to ou reject.

2. CHRONOLOGIE SEULE ≠ DIRECTIONNEL
   "après A, B", "avant remblaiement" sans explication de causalité → downgrade_to_relates_to.

3. DIRECTIONNEL VALIDE
   Preuve explicite requise : "A est nécessaire avant B", "B démarre après validation de A",
   "Validation effectuée par A", "A remplace B formellement" → keep_as_is.

4. REJECT si le sujet B n'est pas mentionné dans l'extrait ou la justification du lien.

CLASSIFICATIONS :
  keep_as_is              — preuve directionnelle explicite dans l'extrait/justification
  downgrade_to_relates_to — relation réelle mais chronologie/contingence/cooccurrence
  possible_same_subject   — quasi-doublon canonique (labels très proches)
  reject                  — B non mentionné dans l'extrait, hallucination, cooccurrence pure

reasoning : ≤ 120 caractères, cite l'élément clé.`
}

async function classify(opts: Parameters<typeof buildAuditPrompt>[0]): Promise<{ classification: Classification; reasoning: string } | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) return null
  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildAuditPrompt(opts) }] }],
          generationConfig: {
            maxOutputTokens: 256, temperature: 0.0,
            responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    )
    if (!resp.ok) return null
    const json = await resp.json()
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null
    const parsed = ResultSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Apply — nettoyage liens extraction (suggested seulement) ===')
  console.log(`Site : ${SITE_ID}\n`)

  // 1. Tous les liens extraction
  const { data: links, error: eLinks } = await supabase
    .from('subject_thread_links')
    .select('id,from_thread_id,to_thread_id,link_type,status,source,confidence,justification,evidence_proposal_id')
    .eq('site_id', SITE_ID).eq('source', 'extraction')
  if (eLinks) { console.error('[FATAL]', eLinks.message); process.exit(1) }
  console.log(`Liens source=extraction : ${links!.length}`)
  console.log(`  confirmed (intouchables) : ${links!.filter(l => l.status === 'confirmed').length}`)
  console.log(`  suggested (candidats)    : ${links!.filter(l => l.status === 'suggested').length}\n`)

  // 2. Thread → canonical_subject
  const { data: sti } = await supabase
    .from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', SITE_ID)
  const threadToCS = new Map<string, string>()
  for (const r of sti ?? []) threadToCS.set(r.subject_thread_id, r.canonical_subject_id)

  const { data: canonicals } = await supabase
    .from('canonical_subject').select('id, label').eq('site_id', SITE_ID)
  const csLabel = new Map((canonicals ?? []).map(c => [c.id, c.label as string]))

  // 3. Familles
  const { data: runRows } = await supabase.from('document_extraction_run').select('id')
    .eq('target_site_id', SITE_ID).eq('is_canonical', true).neq('status', 'failed').neq('status', 'pending')
  const canonicalRunIds = (runRows ?? []).map(r => r.id as string)
  const allProps: { subject_thread_id: string; proposal_family: string }[] = []
  for (let i = 0; i < canonicalRunIds.length; i += 100) {
    const { data } = await supabase.from('document_extraction_proposal')
      .select('subject_thread_id, proposal_family')
      .in('extraction_run_id', canonicalRunIds.slice(i, i + 100))
      .not('subject_thread_id', 'is', null)
    allProps.push(...(data ?? []))
  }
  const threadFamily = new Map<string, string>()
  for (const p of allProps) {
    if (!threadFamily.has(p.subject_thread_id)) threadFamily.set(p.subject_thread_id, p.proposal_family)
  }

  // 4. Compteurs
  const counts = { updated_to_relates_to: 0, rejected: 0, unchanged: 0, skipped_confirmed: 0, errors: 0 }

  console.log('Traitement des liens...\n')

  for (let idx = 0; idx < links!.length; idx++) {
    const l = links![idx]

    if (l.status === 'confirmed') {
      process.stdout.write(`[${String(idx + 1).padStart(2)}] SKIP confirmed  ${l.link_type.padEnd(12)}\n`)
      counts.skipped_confirmed++
      continue
    }

    // Idempotence : déjà au bon état ?
    if (l.link_type === 'relates_to' && l.status === 'suggested') {
      process.stdout.write(`[${String(idx + 1).padStart(2)}] unchanged (already relates_to)\n`)
      counts.unchanged++
      continue
    }
    if (l.status === 'rejected') {
      process.stdout.write(`[${String(idx + 1).padStart(2)}] unchanged (already rejected)\n`)
      counts.unchanged++
      continue
    }

    const csIdA  = threadToCS.get(l.from_thread_id)
    const csIdB  = threadToCS.get(l.to_thread_id)
    const labelA = (csIdA ? csLabel.get(csIdA) : null) ?? l.from_thread_id.slice(0, 8)
    const labelB = (csIdB ? csLabel.get(csIdB) : null) ?? l.to_thread_id.slice(0, 8)
    const famA   = threadFamily.get(l.from_thread_id) ?? '?'
    const famB   = threadFamily.get(l.to_thread_id) ?? '?'

    let excerpt: string | null = null
    if (l.evidence_proposal_id) {
      const { data: prop } = await supabase.from('document_extraction_proposal')
        .select('source_excerpt').eq('id', l.evidence_proposal_id).single()
      excerpt = prop?.source_excerpt ?? null
    }

    process.stdout.write(`[${String(idx + 1).padStart(2)}] ${l.link_type.padEnd(12)} "${labelA.slice(0, 28)}" ↔ "${labelB.slice(0, 28)}" ... `)

    const result = await classify({ linkType: l.link_type, labelA, famA, labelB, famB, justification: l.justification, excerpt, confidence: l.confidence })

    if (!result) {
      console.log('ERROR (Gemini)')
      counts.errors++
      await sleep(400)
      continue
    }

    const { classification, reasoning } = result
    const auditNote = `${AUDIT_TAG}${reasoning}`

    if (classification === 'keep_as_is') {
      console.log('→ keep_as_is (no change)')
      counts.unchanged++
    } else if (classification === 'downgrade_to_relates_to' || classification === 'possible_same_subject') {
      // possible_same_subject traité comme downgrade pour l'instant (pas de fusion auto)
      const newJustification = l.justification
        ? `${auditNote} | Original: ${l.justification}`
        : auditNote
      const { error } = await supabase.from('subject_thread_links')
        .update({ link_type: 'relates_to', justification: newJustification })
        .eq('id', l.id).eq('status', 'suggested')  // garde-fou : ne touche pas les confirmed
      if (error) {
        console.log(`ERROR update: ${error.message}`)
        counts.errors++
      } else {
        console.log(`→ ↓ relates_to`)
        counts.updated_to_relates_to++
      }
    } else if (classification === 'reject') {
      const newJustification = l.justification
        ? `${auditNote} | Original: ${l.justification}`
        : auditNote
      const { error } = await supabase.from('subject_thread_links')
        .update({ status: 'rejected', justification: newJustification })
        .eq('id', l.id).eq('status', 'suggested')  // garde-fou
      if (error) {
        console.log(`ERROR update: ${error.message}`)
        counts.errors++
      } else {
        console.log(`→ ✗ rejected`)
        counts.rejected++
      }
    }

    await sleep(400)
  }

  // ── Rapport final ─────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70))
  console.log('  RAPPORT APPLY')
  console.log('═'.repeat(70))
  console.log(`  ↓ updated_to_relates_to  : ${counts.updated_to_relates_to}`)
  console.log(`  ✗ rejected               : ${counts.rejected}`)
  console.log(`  — unchanged / keep_as_is : ${counts.unchanged}`)
  console.log(`  — skipped (confirmed)    : ${counts.skipped_confirmed}`)
  if (counts.errors > 0)
    console.log(`  ? erreurs                : ${counts.errors}`)
  console.log()
  console.log('Confirmed intouchables (revue humaine séparée) :')
  for (const l of links!.filter(lk => lk.status === 'confirmed')) {
    const csIdA = threadToCS.get(l.from_thread_id)
    const csIdB = threadToCS.get(l.to_thread_id)
    const la = (csIdA ? csLabel.get(csIdA) : null) ?? l.from_thread_id.slice(0, 8)
    const lb = (csIdB ? csLabel.get(csIdB) : null) ?? l.to_thread_id.slice(0, 8)
    console.log(`  ${l.link_type.padEnd(12)} "${la.slice(0, 40)}" → "${lb.slice(0, 40)}"`)
  }
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1) })
