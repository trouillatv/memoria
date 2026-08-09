/**
 * Backfill pilote canonical_business_object — G3 et enrobage (OCEF Compostage)
 *
 * Deux étapes :
 *   1. ÉCRITURE : crée les CBO + membres selon la vérité manuelle auditée
 *   2. SHADOW   : Gemini classifie les mêmes objets en dry-run et on compare
 *
 * Vérité pilote :
 *   G3     : 1 CBO action  ← 3 site_action  (toutes formulations du même avis)
 *   Enrobage A : 1 CBO reserve ← 1 site_reserve "largeur tranchée" (res-forecast-*)
 *   Enrobage B : 1 CBO reserve ← 3 site_reserve "épaisseur d'enrobage" (PV suivants)
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/backfill-cbo-pilot-g3-enrobage.ts [--dry-run]
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const DRY_RUN = process.argv.includes('--dry-run')

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const SITE_COMPOSTAGE = '2c939e67-e986-4635-86a0-638cda870480'
const CS_G3    = '714cf080-6970-40bc-87a8-a6777e90c8a5'
const CS_ENROB = '4981ddb0-4fdd-4a60-a216-e18a3ad86cb7'

const MODEL = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'

// ── Helpers ───────────────────────────────────────────────────────────────────

function sep(label: string) {
  console.log(`\n${'─'.repeat(60)}\n${label}\n${'─'.repeat(60)}`)
}

async function getOpenEntitiesForSubject(
  canonicalSubjectId: string,
  targetType: 'site_action' | 'site_reserve',
): Promise<Array<{ entityId: string; label: string; date: string | null; stableKey: string | null; runId: string }>> {
  const { data: ids } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id')
    .eq('canonical_subject_id', canonicalSubjectId)

  const threadIds = (ids ?? []).map((i) => i.subject_thread_id)
  if (!threadIds.length) return []

  const { data: proposals } = await sb
    .from('document_extraction_proposal')
    .select('id, extraction_run_id, stable_key')
    .in('subject_thread_id', threadIds)

  const proposalIds = (proposals ?? []).map((p) => p.id)
  if (!proposalIds.length) return []

  const { data: mats } = await sb
    .from('document_proposal_materialization')
    .select('proposal_id, target_entity_id')
    .in('proposal_id', proposalIds)
    .eq('target_entity_type', targetType)

  if (!mats?.length) return []

  const entityIds = mats.map((m) => m.target_entity_id)

  if (targetType === 'site_action') {
    const { data: actions } = await sb
      .from('site_actions')
      .select('id, title, created_at')
      .in('id', entityIds)

    return (actions ?? []).map((a) => {
      const mat = mats.find((m) => m.target_entity_id === a.id)!
      const prop = proposals?.find((p) => p.id === mat.proposal_id)
      return { entityId: a.id, label: a.title ?? '', date: a.created_at?.slice(0, 10) ?? null, stableKey: prop?.stable_key ?? null, runId: prop?.extraction_run_id ?? '' }
    })
  } else {
    const { data: reserves } = await sb
      .from('site_reserve')
      .select('id, label, issued_on, status')
      .in('id', entityIds)
      .not('status', 'in', '("lifted")')

    return (reserves ?? []).map((r) => {
      const mat = mats.find((m) => m.target_entity_id === r.id)!
      const prop = proposals?.find((p) => p.id === mat.proposal_id)
      return { entityId: r.id, label: r.label ?? '', date: r.issued_on ?? null, stableKey: prop?.stable_key ?? null, runId: prop?.extraction_run_id ?? '' }
    })
  }
}

async function createCBO(opts: {
  siteId: string
  objectType: 'site_reserve' | 'site_action' | 'site_deadline'
  label: string
  canonicalSubjectId: string
  members: Array<{ entityId: string; entityType: string }>
}) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] CBO "${opts.label}" ← ${opts.members.length} membre(s)`)
    return null
  }

  const { data: cbo, error } = await sb
    .from('canonical_business_object')
    .insert({
      site_id: opts.siteId,
      object_type: opts.objectType,
      label: opts.label,
      canonical_subject_id: opts.canonicalSubjectId,
    })
    .select('id')
    .single()

  if (error || !cbo) throw new Error(`Erreur CBO insert: ${error?.message}`)

  const memberRows = opts.members.map((m) => ({
    canonical_business_object_id: cbo.id,
    member_entity_type: m.entityType,
    member_entity_id: m.entityId,
    resolution_source: 'manual' as const,
  }))

  const { error: membErr } = await sb
    .from('canonical_business_object_member')
    .insert(memberRows)

  if (membErr) throw new Error(`Erreur member insert: ${membErr.message}`)

  console.log(`  ✓ CBO "${opts.label}" créé (${cbo.id.slice(0, 8)}) ← ${opts.members.length} membre(s)`)
  return cbo.id
}

// ── Étape 1 : backfill manuel ─────────────────────────────────────────────────

async function backfillG3() {
  sep('ÉTAPE 1A — Backfill G3 (manuel)')

  const entities = await getOpenEntitiesForSubject(CS_G3, 'site_action')
  console.log(`${entities.length} site_action(s) trouvée(s) :`)
  for (const e of entities) {
    console.log(`  [${e.stableKey}] ${e.label.slice(0, 60)}`)
  }

  if (!entities.length) { console.log('  → rien à faire'); return }

  // Vérité pilote : toutes les actions G3 → 1 seul CBO
  await createCBO({
    siteId: SITE_COMPOSTAGE,
    objectType: 'site_action',
    label: 'Avis G3 sur les essais de la plateforme support de dalle',
    canonicalSubjectId: CS_G3,
    members: entities.map((e) => ({ entityId: e.entityId, entityType: 'site_action' })),
  })
}

async function backfillEnrobage() {
  sep('ÉTAPE 1B — Backfill enrobage (manuel)')

  const entities = await getOpenEntitiesForSubject(CS_ENROB, 'site_reserve')
  console.log(`${entities.length} site_reserve(s) trouvée(s) :`)
  for (const e of entities) {
    console.log(`  [${e.stableKey}] ${e.label.slice(0, 60)} — ${e.date}`)
  }

  if (entities.length < 2) { console.log('  → pas assez de membres pour grouper'); return }

  // Vérité pilote :
  //   CBO A = largeur tranchée (stable_key contient "forecast")
  //   CBO B = épaisseur d'enrobage (les autres)
  const cboA = entities.filter((e) => e.stableKey?.includes('forecast'))
  const cboB = entities.filter((e) => !e.stableKey?.includes('forecast'))

  console.log(`\nCBO A (largeur tranchée) : ${cboA.length} membre(s)`)
  console.log(`CBO B (épaisseur enrobage) : ${cboB.length} membre(s)`)

  if (cboA.length > 0) {
    await createCBO({
      siteId: SITE_COMPOSTAGE,
      objectType: 'site_reserve',
      label: 'Largeur de tranchée d'assainissement non conforme',
      canonicalSubjectId: CS_ENROB,
      members: cboA.map((e) => ({ entityId: e.entityId, entityType: 'site_reserve' })),
    })
  }
  if (cboB.length > 0) {
    await createCBO({
      siteId: SITE_COMPOSTAGE,
      objectType: 'site_reserve',
      label: 'Épaisseurs d'enrobage sur les conduites d'assainissement non conforme',
      canonicalSubjectId: CS_ENROB,
      members: cboB.map((e) => ({ entityId: e.entityId, entityType: 'site_reserve' })),
    })
  }
}

// ── Étape 2 : shadow Gemini ───────────────────────────────────────────────────

const SHADOW_SYSTEM = `Tu es un resolver d'identité métier pour une application de suivi de chantier.

On te donne une liste d'objets métier du même type (réserves ou actions) extraits de différents PV.
Ta tâche : regrouper ces objets en identités canoniques — chaque groupe représente UN problème ou UNE action métier réel.

Règles :
- Même formulation dans des PV successifs = même identité (continuation du même problème).
- Formulations différentes mais même non-conformité physique = même identité.
- Deux non-conformités distinctes sur le même ouvrage = identités séparées.
- En cas de doute réel : UNCERTAIN (ne fusionne jamais par défaut).

Pour chaque groupe, donne :
- "label" : libellé canonique court
- "members" : liste des entityId membres
- "decision" : "SAME_OBJECT" (tous les membres sont la même chose) ou "RELATED_BUT_DISTINCT" (liés mais distincts)
- "confidence" : 0.0 à 1.0
- "reasoning" : ≤ 80 mots

Réponds UNIQUEMENT en JSON :
{ "groups": [ { "label": "...", "members": ["id1","id2"], "decision": "SAME_OBJECT|RELATED_BUT_DISTINCT|UNCERTAIN", "confidence": 0.0, "reasoning": "..." } ] }`

async function shadowGemini(
  ai: GoogleGenAI,
  label: string,
  entities: Array<{ entityId: string; label: string; date: string | null; stableKey: string | null }>,
  manualGroups: Array<{ label: string; entityIds: string[] }>,
) {
  sep(`ÉTAPE 2 — Shadow Gemini : ${label}`)

  const userMsg = JSON.stringify(
    entities.map((e) => ({
      entityId: e.entityId,
      label: e.label,
      date: e.date,
      stableKey: e.stableKey,
    })),
    null,
    2,
  )

  console.log('Input Gemini :')
  console.log(userMsg)

  let geminiGroups: Array<{ label: string; members: string[]; decision: string; confidence: number; reasoning: string }> = []

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      config: {
        systemInstruction: SHADOW_SYSTEM,
        temperature: 0.1,
        maxOutputTokens: 600,
        responseMimeType: 'application/json',
      },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
    })
    const text = response.text ?? ''
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1))
      geminiGroups = parsed.groups ?? []
    }
  } catch (e) {
    console.error('  Gemini error:', e)
    return
  }

  console.log('\nRésultat Gemini :')
  for (const g of geminiGroups) {
    console.log(`  [${g.decision} ${(g.confidence * 100).toFixed(0)}%] "${g.label}"`)
    console.log(`    membres: ${g.members.length} — ${g.reasoning}`)
  }

  console.log('\nComparaison avec vérité manuelle :')
  for (const manual of manualGroups) {
    const manualSet = new Set(manual.entityIds)
    const geminiMatch = geminiGroups.find((g) =>
      g.members.some((id) => manualSet.has(id)) &&
      g.members.every((id) => manualSet.has(id)) &&
      manual.entityIds.every((id) => g.members.includes(id)),
    )
    if (geminiMatch) {
      console.log(`  ✓ ACCORD — "${manual.label}" (${manual.entityIds.length} membres)`)
    } else {
      const partial = geminiGroups.find((g) => g.members.some((id) => manualSet.has(id)))
      if (partial) {
        console.log(`  ⚠ ÉCART — "${manual.label}" : Gemini groupe différemment ("${partial.label}", ${partial.members.length} membres)`)
      } else {
        console.log(`  ✗ MANQUÉ — "${manual.label}" : aucun groupe Gemini correspondant`)
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log('\n⚡ DRY-RUN — aucune écriture en base\n')

  // Étape 1 : backfill manuel
  await backfillG3()
  await backfillEnrobage()

  // Étape 2 : shadow Gemini
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) {
    console.log('\n[SKIP] GOOGLE_GENAI_API_KEY manquante — shadow Gemini ignoré')
    return
  }
  const ai = new GoogleGenAI({ apiKey })

  // Shadow G3
  const g3Entities = await getOpenEntitiesForSubject(CS_G3, 'site_action')
  if (g3Entities.length) {
    await shadowGemini(ai, 'Avis G3 (actions)', g3Entities, [
      { label: 'Avis G3 plateforme', entityIds: g3Entities.map((e) => e.entityId) },
    ])
  }

  // Shadow enrobage
  const enrobEntities = await getOpenEntitiesForSubject(CS_ENROB, 'site_reserve')
  if (enrobEntities.length) {
    const enrobA = enrobEntities.filter((e) => e.stableKey?.includes('forecast'))
    const enrobB = enrobEntities.filter((e) => !e.stableKey?.includes('forecast'))
    await shadowGemini(ai, 'Réserves enrobage', enrobEntities, [
      { label: 'Largeur tranchée', entityIds: enrobA.map((e) => e.entityId) },
      { label: 'Épaisseur enrobage', entityIds: enrobB.map((e) => e.entityId) },
    ])
  }

  console.log('\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
