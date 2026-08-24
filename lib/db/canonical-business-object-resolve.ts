import 'server-only'

// Resolver d'identité métier durable (canonical_business_object) — P1-C2A/C2.
//
// Portée volontairement étroite (cf. docs/memory-longitudinal-v1/P1-C2A-RESOLVER-INFRASTRUCTURE-AUDIT.md) :
//   - Résolution par (canonical_subject_id, object_type) uniquement — jamais de comparaison
//     cross-type (une action ne se regroupe jamais avec une réserve).
//   - Ne lit jamais knowledge_fact ni document_status — la projection d'état (ouvert/clôturé/
//     stagnant) est une préoccupation séparée (P1-C2C), pas celle de ce module.
//   - Identité ≠ occurrences : ce module ne fusionne ni ne supprime aucune ligne
//     site_action/site_reserve/site_deadline. Il ne fait que proposer des regroupements
//     (canonical_business_object + membres) au-dessus des lignes existantes.
//
// Extrait de scripts/backfill-cbo-pilot-g3-enrobage.ts (pilote G3+Enrobage, 2026-08-09),
// généralisé à site_deadline et rebâti sur le pattern fetch()+zod+alias de
// lib/ai/suggest-dependencies.ts plutôt que le SDK brut du script pilote.
//
// Ce module ne fait AUCUNE écriture en base — resolveCanonicalBusinessObjectGroups()
// est un simple appel LLM classificateur. La matérialisation (INSERT canonical_business_object)
// reste un geste explicite de l'appelant (backfill ou, plus tard, du live P1-C2B).

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'

export type CanonicalBusinessObjectEntityType = 'site_action' | 'site_reserve' | 'site_deadline'

export type ResolvableEntity = {
  entityId: string
  label: string
  date: string | null
  stableKey: string | null
}

export type ResolverDecision = 'SAME_OBJECT' | 'RELATED_BUT_DISTINCT' | 'UNCERTAIN'

export type CanonicalBusinessObjectGroup = {
  label: string
  members: string[]
  decision: ResolverDecision
  confidence: number
  reasoning: string
}

// ── Lecture des entités ouvertes d'un sujet (généralisation du pilote) ──────────

/**
 * Récupère les entités matérialisées (site_action | site_reserve | site_deadline)
 * rattachées aux subject_thread d'un canonical_subject, pour un object_type donné.
 *
 * Chemin : subject_thread_identity → document_extraction_proposal
 *          → document_proposal_materialization → table cible.
 *
 * Filtre les entités déjà closes (site_reserve.status='lifted',
 * site_deadline.status in done/cancelled) — seules les entités encore ouvertes
 * sont candidates au regroupement.
 */
export async function getCanonicalSubjectEntities(
  canonicalSubjectId: string,
  targetType: CanonicalBusinessObjectEntityType,
): Promise<ResolvableEntity[]> {
  const sb = createAdminClient()

  const { data: ids } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id')
    .eq('canonical_subject_id', canonicalSubjectId)

  const threadIds = (ids ?? []).map((i) => i.subject_thread_id)
  if (!threadIds.length) return []

  const { data: proposals } = await sb
    .from('document_extraction_proposal')
    .select('id, stable_key')
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
    const { data: rows } = await sb
      .from('site_actions')
      .select('id, title, created_at')
      .in('id', entityIds)

    return (rows ?? []).map((r) => {
      const mat = mats.find((m) => m.target_entity_id === r.id)!
      const prop = proposals?.find((p) => p.id === mat.proposal_id)
      return { entityId: r.id, label: r.title ?? '', date: r.created_at?.slice(0, 10) ?? null, stableKey: prop?.stable_key ?? null }
    })
  }

  if (targetType === 'site_reserve') {
    const { data: rows } = await sb
      .from('site_reserve')
      .select('id, label, issued_on, status')
      .in('id', entityIds)
      .not('status', 'in', '("lifted")')

    return (rows ?? []).map((r) => {
      const mat = mats.find((m) => m.target_entity_id === r.id)!
      const prop = proposals?.find((p) => p.id === mat.proposal_id)
      return { entityId: r.id, label: r.label ?? '', date: r.issued_on ?? null, stableKey: prop?.stable_key ?? null }
    })
  }

  // site_deadline
  const { data: rows } = await sb
    .from('site_deadlines')
    .select('id, title, due_date, status')
    .in('id', entityIds)
    .not('status', 'in', '("done","cancelled")')

  return (rows ?? []).map((r) => {
    const mat = mats.find((m) => m.target_entity_id === r.id)!
    const prop = proposals?.find((p) => p.id === mat.proposal_id)
    return { entityId: r.id, label: r.title ?? '', date: r.due_date ?? null, stableKey: prop?.stable_key ?? null }
  })
}

// ── Schéma Gemini (OpenAPI 3.0 subset) ───────────────────────────────────────

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label:      { type: 'string' },
          members:    { type: 'array', items: { type: 'string' } },
          decision:   { type: 'string', enum: ['SAME_OBJECT', 'RELATED_BUT_DISTINCT', 'UNCERTAIN'] },
          confidence: { type: 'number' },
          reasoning:  { type: 'string' },
        },
        required: ['label', 'members', 'decision', 'confidence', 'reasoning'],
      },
    },
  },
  required: ['groups'],
}

const GroupSchema = z.object({
  label: z.string().min(1),
  members: z.array(z.string().min(1)).min(1),
  decision: z.enum(['SAME_OBJECT', 'RELATED_BUT_DISTINCT', 'UNCERTAIN']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
})

const ResolverResponseSchema = z.object({ groups: z.array(GroupSchema) })

// ── Prompt (généralisé depuis SHADOW_SYSTEM du pilote) ──────────────────────────

const RESOLVER_SYSTEM_PROMPT = `Tu es un resolver d'identité métier pour une application de suivi de chantier.

On te donne une liste d'objets métier du même type (réserves, actions ou échéances) extraits de différents PV, tous rattachés au même sujet canonique.
Ta tâche : regrouper ces objets en identités canoniques — chaque groupe représente UN problème, UNE action ou UNE échéance métier réel.

Règles :
- Même formulation dans des PV successifs = même identité (continuation du même problème).
- Formulations différentes mais même non-conformité physique / même action / même échéance = même identité.
- Deux non-conformités, actions ou échéances distinctes sur le même sujet = identités séparées.
- En cas de doute réel : UNCERTAIN (ne fusionne jamais par défaut).
- Chaque entityId fourni en entrée doit apparaître dans exactement un groupe de sortie.

Pour chaque groupe, donne :
- "label" : libellé canonique court
- "members" : liste des entityId membres (alias courts fournis en entrée, ex: "EN001")
- "decision" : "SAME_OBJECT" (tous les membres sont la même chose), "RELATED_BUT_DISTINCT" (liés mais distincts), ou "UNCERTAIN"
- "confidence" : 0.0 à 1.0
- "reasoning" : ≤ 80 mots

Réponds UNIQUEMENT en JSON :
{ "groups": [ { "label": "...", "members": ["EN001","EN002"], "decision": "SAME_OBJECT|RELATED_BUT_DISTINCT|UNCERTAIN", "confidence": 0.0, "reasoning": "..." } ] }`

function buildAliasMap(entities: ResolvableEntity[]): Map<string, string> {
  const alias = new Map<string, string>()
  entities.forEach((e, i) => alias.set(`EN${String(i + 1).padStart(3, '0')}`, e.entityId))
  return alias
}

/**
 * Appelle Gemini pour regrouper une liste d'entités du même (sujet, object_type)
 * en identités métier canoniques.
 *
 * Retourne [] si moins de 2 entités, clé API absente, ou en cas d'échec HTTP/parsing —
 * jamais de throw (cf. doctrine "le resolver ne doit jamais bloquer la création de l'objet source").
 */
export async function resolveCanonicalBusinessObjectGroups(
  entities: ResolvableEntity[],
): Promise<CanonicalBusinessObjectGroup[]> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey || entities.length < 2) return []

  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const alias = buildAliasMap(entities)

  const userMsg = JSON.stringify(
    entities.map((e) => ({
      entityId: [...alias.entries()].find(([, id]) => id === e.entityId)![0],
      label: e.label,
      date: e.date,
      stableKey: e.stableKey,
    })),
    null,
    2,
  )

  try {
    const body = {
      systemInstruction: { parts: [{ text: RESOLVER_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    )
    if (!resp.ok) {
      console.error(`  [Gemini] HTTP ${resp.status}`)
      return []
    }

    const json = await resp.json()
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return []

    const parsed = ResolverResponseSchema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      console.error('  [Gemini] parse error:', parsed.error.issues[0]?.message)
      return []
    }

    const validAliases = new Set(alias.keys())

    return parsed.data.groups.map((g) => ({
      ...g,
      members: g.members
        .filter((m) => validAliases.has(m))
        .map((m) => alias.get(m)!),
    })).filter((g) => g.members.length > 0)
  } catch (e) {
    console.error('  [Gemini] exception:', e)
    return []
  }
}
