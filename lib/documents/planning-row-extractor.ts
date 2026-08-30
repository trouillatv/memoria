import 'server-only'
import { z } from 'zod'
import type { PlanningGroup } from './structured-table-context'

// ─── Schéma LLM Planning dédié — sans dueDate, sans deadline ─────────────────

const PlanningQualificationRowSchema = z.object({
  rowKey: z.string(),
  kind: z.enum(['task', 'milestone']),
  label: z.string().min(2),
  description: z.string().nullish(),
})

const PlanningQualificationSchema = z.object({
  rows: z.array(PlanningQualificationRowSchema),
})

// Schéma Gemini (sous-ensemble OpenAPI 3.0) — physiquement sans dueDate
const PLANNING_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rowKey: { type: 'string' },
          kind: { type: 'string', enum: ['task', 'milestone'] },
          label: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['rowKey', 'kind', 'label'],
      },
    },
  },
  required: ['rows'],
}

export interface QualifiedPlanningRow {
  rowKey: string
  groupKey: string
  kind: 'task' | 'milestone'
  label: string
  description: string | null
}

// ─── Prompt de qualification ──────────────────────────────────────────────────

function buildQualificationPrompt(groups: PlanningGroup[]): string {
  const lines = groups
    .map((g) => {
      const header = `Groupe ${g.groupKey} | Date: ${g.rawDateText ?? '?'} | Semaine: ${g.rawWeekText ?? '?'}`
      const rows = g.rows.map((r) => `  ${r.rowKey}: ${r.description}`).join('\n')
      return `${header}\n${rows}`
    })
    .join('\n\n')

  return `Tu reçois les lignes de travaux d'un planning de chantier, extraites géométriquement d'un tableau PDF.

RÈGLES STRICTES :
- Pour chaque ligne, restitue son rowKey IDENTIQUE à l'entrée.
- N'invente PAS de nouvelle ligne.
- Ne supprime PAS de ligne.
- Ne déplace PAS une ligne vers un autre groupe.
- Ne calcule PAS de date, semaine ni année.
- Le schéma ne contient PAS de champ dueDate — ne produis rien hors schéma.

Pour chaque ligne, qualifie uniquement :
- kind : "task" pour un travail à réaliser, "milestone" pour un jalon ou réception
- label : libellé métier normalisé en français, concis
- description (optionnel) : précision complémentaire si la description source est longue

Lignes :
${lines}`
}

// ─── Appel Gemini ─────────────────────────────────────────────────────────────

/**
 * Envoie les groupes planning à Gemini pour qualification métier uniquement.
 * La temporalité n'est PAS demandée au LLM — elle sera calculée côté serveur.
 * Valide les rowKeys après réponse : rejet si inconnu, doublon ou inventé.
 */
export async function qualifyPlanningRows(
  groups: PlanningGroup[],
  apiKey: string,
  model = 'gemini-2.5-flash',
): Promise<QualifiedPlanningRow[]> {
  if (groups.length === 0 || groups.every((g) => g.rows.length === 0)) return []

  // Index de référence : rowKey → groupKey
  const validKeys = new Map<string, string>()
  for (const g of groups) {
    for (const r of g.rows) validKeys.set(r.rowKey, g.groupKey)
  }

  const prompt = buildQualificationPrompt(groups)

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 16_384,
          responseMimeType: 'application/json',
          responseSchema: PLANNING_GEMINI_SCHEMA,
        },
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini planning qualification — HTTP ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> }; finishReason?: string }>
  }
  const candidate = data.candidates?.[0]
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error('Gemini planning — output tronqué (MAX_TOKENS)')
  }

  const outputText = candidate?.content?.parts?.[0]?.text ?? ''
  if (!outputText) throw new Error('Gemini planning — réponse vide')

  const parsed = PlanningQualificationSchema.parse(JSON.parse(outputText))

  // ── Validation des rowKeys ────────────────────────────────────────────────
  const seen = new Set<string>()
  const result: QualifiedPlanningRow[] = []

  for (const row of parsed.rows) {
    const groupKey = validKeys.get(row.rowKey)
    if (!groupKey) throw new Error(`rowKey inconnu restitué par le LLM : "${row.rowKey}"`)
    if (seen.has(row.rowKey)) throw new Error(`rowKey en doublon restitué par le LLM : "${row.rowKey}"`)
    seen.add(row.rowKey)
    result.push({
      rowKey: row.rowKey,
      groupKey,
      kind: row.kind,
      label: row.label,
      description: row.description ?? null,
    })
  }

  // Rows manquants : non-fatal, loggé (une row peut être classée non-planning)
  for (const [rowKey] of validKeys) {
    if (!seen.has(rowKey)) {
      console.warn(`[planning-row-extractor] rowKey non restitué par le LLM : ${rowKey}`)
    }
  }

  return result
}
