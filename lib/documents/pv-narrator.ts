import 'server-only'

// Lot 4 — Narration copilote
//
// Lot 4A : generateSincePvSummary(delta)
//   Structure déterministe + narration LLM « Depuis le dernier PV ».
//   Entrée : PvDelta du Lot 2. Aucun recalcul de transitions.
//
// Lot 4B : generateSiteHistoryNarrative(siteId)
//   Récit chronologique du chantier sur tous les PV connus.
//   Charge ses propres données (2 requêtes DB) puis appelle le LLM.
//
// Contrat d'auditabilité :
//   Chaque section est tracée par proposalId.
//   La narration LLM reçoit uniquement les faits issus des sections structurées.
//   Le LLM ne reçoit jamais d'états non prouvés par le diff.

import type { PvDelta } from './pv-comparison'
import { computeHistoryTransition } from './pv-history'
import type { HistoryTransition } from './pv-history'

// ── Types publics ─────────────────────────────────────────────────────────────

export interface TracedItem {
  label: string
  fromStatus: string | null
  toStatus: string | null
  proposalId: string | null  // ID de la proposition source (traçabilité)
}

export type SincePvStructure = Partial<Record<
  | 'nouveau' | 'réalisé' | 'levé' | 'réouvert' | 'aggravé'
  | 'progressé' | 'annulé' | 'maintenu' | 'non_mentionné' | 'changé',
  TracedItem[]
>>

export interface SincePvSummary {
  structure: SincePvStructure
  narrative: string | null  // null si pas de clé API ou delta vide
}

export interface PeriodItem {
  label: string
  transition: HistoryTransition
  proposalId: string | null
}

export interface PeriodSnapshot {
  runId: string
  documentId: string
  effectiveDate: string
  items: PeriodItem[]
}

export interface SiteHistoryNarrative {
  siteId: string
  periods: PeriodSnapshot[]
  narrative: string | null
}

// ── Lot 4A — « Depuis le dernier PV » ────────────────────────────────────────

/**
 * Construit la structure déterministe des changements depuis le PV précédent.
 * Pas d'appel LLM — appelable côté serveur sans clé API.
 */
export function buildSincePvStructure(delta: PvDelta): SincePvStructure {
  const struct: SincePvStructure = {}

  for (const item of delta.items) {
    const key = item.transition as keyof SincePvStructure
    if (!struct[key]) struct[key] = []
    struct[key]!.push({
      label: item.label,
      fromStatus: item.fromStatus,
      toStatus: item.toStatus,
      proposalId: item.toProposalId ?? item.fromProposalId,
    })
  }

  return struct
}

const TRANSITION_LABELS: Record<string, string> = {
  réalisé: 'Réalisés',
  levé: 'Levés / résolus',
  nouveau: 'Nouveaux',
  réouvert: 'Réouverts',
  aggravé: 'Aggravés',
  progressé: 'En progression',
  annulé: 'Annulés',
  non_mentionné: 'Non mentionnés dans ce PV',
  maintenu: 'Maintenus (inchangés)',
  changé: 'Autres changements',
}

function structureToPromptText(struct: SincePvStructure): string {
  const DISPLAY_ORDER: Array<keyof SincePvStructure> = [
    'réalisé', 'levé', 'nouveau', 'aggravé', 'réouvert', 'progressé',
    'annulé', 'non_mentionné', 'changé', 'maintenu',
  ]

  let text = ''
  for (const key of DISPLAY_ORDER) {
    const items = struct[key]
    if (!items?.length) continue
    text += `\n## ${TRANSITION_LABELS[key] ?? key} (${items.length}) :\n`
    for (const item of items) {
      text += `- ${item.label}`
      if (item.fromStatus && item.toStatus && item.fromStatus !== item.toStatus) {
        text += ` (${item.fromStatus} → ${item.toStatus})`
      }
      text += '\n'
    }
  }
  return text.trim()
}

/**
 * Génère la synthèse structurée + narration LLM « Depuis le dernier PV ».
 *
 * - `structure` est toujours retourné (déterministe, auditable).
 * - `narrative` est null si pas de clé API ou si le delta est vide.
 */
export async function generateSincePvSummary(delta: PvDelta): Promise<SincePvSummary> {
  const structure = buildSincePvStructure(delta)

  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey || delta.items.length === 0) return { structure, narrative: null }

  const promptText = structureToPromptText(structure)
  if (!promptText) return { structure, narrative: null }

  const prompt = `Tu es rédacteur technique pour un conducteur de travaux.
Tu dois rédiger un paragraphe de synthèse concis sur l'évolution d'un chantier entre deux comptes-rendus de visite.

RÈGLES IMPÉRATIVES :
- N'utilise QUE les faits listés ci-dessous — n'invente rien.
- Ne déduis pas qu'un sujet est résolu à partir de son absence (un sujet "non mentionné" ne signifie pas levé).
- Commence directement par les avancées concrètes (réalisés, levés).
- Si rien n'a changé de significatif, dis-le sobrement.
- 3 à 5 phrases. Pas d'introduction générique.

FAITS ISSUS DU DIFF :
${promptText}`

  const narrative = await callLlm(prompt)
  return { structure, narrative }
}

// ── Lot 4B — Récit historique global du chantier ─────────────────────────────

type RunRow = { id: string; document_id: string; created_at: string }
type PropRow = {
  id: string
  extraction_run_id: string
  proposal_family: string
  document_status: string | null
  subject_thread_id: string
  label: string
}

/**
 * Charge tous les PV du chantier, calcule les transitions en mémoire,
 * génère un récit chronologique avec le LLM.
 *
 * 2 requêtes DB — charge toutes les propositions en une fois.
 */
export async function generateSiteHistoryNarrative(siteId: string): Promise<SiteHistoryNarrative> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const { data: runsRaw, error: runsErr } = await supabase
    .from('document_extraction_run')
    .select('id, document_id, created_at')
    .eq('target_site_id', siteId)
    .eq('status', 'ready_for_review')
    .order('created_at', { ascending: true })
  if (runsErr) throw new Error(runsErr.message)

  const runs = (runsRaw ?? []) as RunRow[]
  if (runs.length === 0) return { siteId, periods: [], narrative: null }

  const runIds = runs.map((r) => r.id)

  const { data: propsRaw, error: propsErr } = await supabase
    .from('document_extraction_proposal')
    .select('id, extraction_run_id, proposal_family, document_status, subject_thread_id, label')
    .in('extraction_run_id', runIds)
    .not('subject_thread_id', 'is', null)
  if (propsErr) throw new Error(propsErr.message)

  const props = (propsRaw ?? []) as PropRow[]

  const byRun = new Map<string, Map<string, PropRow>>()
  for (const run of runs) byRun.set(run.id, new Map())
  for (const p of props) byRun.get(p.extraction_run_id)?.set(p.subject_thread_id, p)

  const periods: PeriodSnapshot[] = []

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    const prevRun = i > 0 ? runs[i - 1] : null
    const curr = byRun.get(run.id)!
    const prev = prevRun ? (byRun.get(prevRun.id) ?? new Map<string, PropRow>()) : new Map<string, PropRow>()

    const items: PeriodItem[] = []
    const allThreads = new Set([...curr.keys(), ...prev.keys()])

    for (const threadId of allThreads) {
      const fromProp = prev.get(threadId) ?? null
      const toProp = curr.get(threadId) ?? null

      let t: HistoryTransition
      if (!fromProp) {
        t = 'nouveau'
      } else if (!toProp) {
        t = 'non_mentionné'
      } else {
        t = computeHistoryTransition(toProp.proposal_family, null, fromProp.document_status, toProp.document_status, false)
      }

      items.push({
        label: toProp?.label ?? fromProp!.label,
        transition: t,
        proposalId: toProp?.id ?? fromProp?.id ?? null,
      })
    }

    periods.push({
      runId: run.id,
      documentId: run.document_id,
      effectiveDate: run.created_at,
      items,
    })
  }

  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey || periods.length === 0) return { siteId, periods, narrative: null }

  const narrative = await callLlm(buildHistoryPrompt(periods))
  return { siteId, periods, narrative }
}

function buildHistoryPrompt(periods: PeriodSnapshot[]): string {
  const NOTEWORTHY: Set<HistoryTransition> = new Set(['réalisé', 'levé', 'nouveau', 'aggravé', 'réouvert', 'annulé'])

  let periodsText = ''
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i]
    const date = p.effectiveDate.slice(0, 10)
    const noteworthy = p.items.filter((item) => NOTEWORTHY.has(item.transition))
    const counts = p.items.reduce<Partial<Record<HistoryTransition, number>>>((acc, item) => {
      acc[item.transition] = (acc[item.transition] ?? 0) + 1
      return acc
    }, {})

    periodsText += `\n### PV ${i + 1} (${date})\n`
    periodsText += `Compteurs : ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}\n`
    if (noteworthy.length > 0) {
      periodsText += `Points notables :\n`
      for (const item of noteworthy.slice(0, 8)) {
        periodsText += `- [${item.transition}] ${item.label}\n`
      }
    }
  }

  return `Tu es rédacteur technique pour un conducteur de travaux.
Tu dois rédiger le récit chronologique de l'avancement d'un chantier à partir des comptes-rendus de visite successifs.

RÈGLES IMPÉRATIVES :
- N'utilise QUE les faits listés ci-dessous.
- Un sujet "non_mentionné" ne signifie PAS qu'il est résolu.
- Une phrase par PV, ou deux si l'avancement est notable.
- Commence chaque période par une phrase de synthèse, pas par la date.
- Format attendu : paragraphes séparés, un par PV, commençant par la date entre crochets.

DONNÉES CHRONOLOGIQUES :
${periodsText.trim()}`
}

// ── LLM helper ───────────────────────────────────────────────────────────────

async function callLlm(prompt: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) return null
  try {
    const model = process.env.AI_MODEL ?? 'gemini-2.5-flash'
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
  } catch {
    return null
  }
}
