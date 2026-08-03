// Suggestion de dépendances entre sujets canoniques — extraction relationnelle par run.
//
// Doctrine V1 :
//   - Co-présence seule ≠ dépendance
//   - Relation extraite uniquement si explicitement établie par le texte source
//   - Types autorisés : requires | enables | causes | validates | replaces
//   - Maximum MAX_SUGGESTIONS_PER_RUN relations par PV
//   - Confidence minimum : 0.70

import { z } from 'zod'

export const MAX_SUGGESTIONS_PER_RUN = 5
export const MIN_CONFIDENCE = 0.70

export const ALLOWED_LINK_TYPES = ['requires', 'enables', 'causes', 'validates', 'replaces'] as const
export type AllowedLinkType = (typeof ALLOWED_LINK_TYPES)[number]

export interface SubjectInRun {
  canonicalSubjectId: string
  threadId: string
  label: string
  proposalId: string
  sourceExcerpt: string
}

export interface SuggestedDependency {
  fromCanonicalSubjectId: string
  toCanonicalSubjectId: string
  fromThreadId: string
  toThreadId: string
  linkType: AllowedLinkType
  confidence: number
  evidenceProposalId: string
  justification: string
}

// ── Schéma Gemini (OpenAPI 3.0 subset) ───────────────────────────────────────

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fromCanonicalSubjectId: { type: 'string' },
          toCanonicalSubjectId:   { type: 'string' },
          linkType: {
            type: 'string',
            enum: ['requires', 'enables', 'causes', 'validates', 'replaces'],
          },
          confidence:         { type: 'number' },
          evidenceProposalId: { type: 'string' },
          justification:      { type: 'string' },
        },
        required: ['fromCanonicalSubjectId', 'toCanonicalSubjectId', 'linkType',
                   'confidence', 'evidenceProposalId', 'justification'],
      },
    },
  },
  required: ['relations'],
}

const RelationSchema = z.object({
  fromCanonicalSubjectId: z.string().min(1),
  toCanonicalSubjectId:   z.string().min(1),
  linkType:               z.enum(['requires', 'enables', 'causes', 'validates', 'replaces']),
  confidence:             z.number().min(0).max(1),
  evidenceProposalId:     z.string().min(1),
  justification:          z.string().min(1),
})

const GeminiResponseSchema = z.object({
  relations: z.array(RelationSchema),
})

// ── Prompt ────────────────────────────────────────────────────────────────────

// Alias courts pour éviter que Gemini confonde les UUIDs avec des indices [1][2]
export type AliasMap = {
  csAlias: Map<string, string>    // alias → canonicalSubjectId
  propAlias: Map<string, string>  // alias → proposalId
}

export function buildAliases(subjects: SubjectInRun[]): AliasMap {
  const csAlias   = new Map<string, string>()
  const propAlias = new Map<string, string>()
  subjects.forEach((s, i) => {
    csAlias.set(`CS${String(i + 1).padStart(3, '0')}`, s.canonicalSubjectId)
    propAlias.set(`PR${String(i + 1).padStart(3, '0')}`, s.proposalId)
  })
  return { csAlias, propAlias }
}

function buildPrompt(subjects: SubjectInRun[], effectiveDate: string, aliases: AliasMap): string {
  const csEntries   = [...aliases.csAlias.entries()]   // alias → csId
  const propEntries = [...aliases.propAlias.entries()] // alias → propId

  const list = subjects
    .map((s, i) => {
      const csAlias   = csEntries[i][0]
      const propAlias = propEntries[i][0]
      return (
        `sujetID="${csAlias}"  preuveID="${propAlias}"\n` +
        `  label: "${s.label}"\n` +
        `  extrait: "${s.sourceExcerpt.slice(0, 300)}"`
      )
    })
    .join('\n\n')

  return `Tu analyses les sujets du PV de chantier daté du ${effectiveDate}.

SUJETS PRÉSENTS (liste fermée — utilise UNIQUEMENT les sujetID et preuveID ci-dessous, jamais d'autres valeurs) :

${list}

MISSION : Identifie parmi ces sujets les relations causales EXPLICITEMENT établies par les extraits. Maximum ${MAX_SUGGESTIONS_PER_RUN} relations.

RÈGLES ABSOLUES :
- La co-présence, l'appartenance au même domaine, ou une proximité sémantique ne constituent PAS une dépendance.
- Ne propose une relation que si le texte établit explicitement un ordre, une condition, une conséquence, une validation ou un remplacement.
- Types autorisés uniquement :
    requires  — A ne peut pas avancer sans B réalisé au préalable
    enables   — A permet à B de démarrer ou de progresser
    causes    — A déclenche ou provoque B directement
    validates — A valide, qualifie ou lève B
    replaces  — A rend B obsolète ou le remplace formellement
- Si aucune relation n'est clairement établie : retourner une liste vide.
- fromCanonicalSubjectId = sujetID de la source (ex: "CS001"). toCanonicalSubjectId = sujetID de la cible.
- evidenceProposalId = preuveID du sujet portant la preuve textuelle (ex: "PR001").
- La justification doit citer l'élément textuel qui établit la relation (< 150 caractères).
- confidence : 0.9+ preuve verbatim · 0.7–0.9 implication forte · < 0.7 ne pas proposer.`
}

// ── Export principal ──────────────────────────────────────────────────────────

/**
 * Appelle Gemini pour extraire les relations causales entre sujets d'un run.
 *
 * Validation fermée après réponse :
 *   - IDs et proposalIds doivent appartenir à la liste du run
 *   - Pas d'auto-lien
 *   - Confidence ≥ MIN_CONFIDENCE
 *
 * Retourne [] en cas d'erreur, de réponse invalide ou d'absence de preuve.
 */
export async function suggestDependenciesForRun(
  subjects: SubjectInRun[],
  effectiveDate: string,
): Promise<Array<Omit<SuggestedDependency, 'fromThreadId' | 'toThreadId'>>> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey || subjects.length < 2) return []

  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const aliases = buildAliases(subjects)
  const prompt = buildPrompt(subjects, effectiveDate, aliases)

  try {
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.0,
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

    const parsed = GeminiResponseSchema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      console.error('  [Gemini] parse error:', parsed.error.issues[0]?.message)
      return []
    }

    // Résolution des alias CS001/PR001 → vrais UUIDs
    const resolved = parsed.data.relations.map((r) => ({
      ...r,
      fromCanonicalSubjectId: aliases.csAlias.get(r.fromCanonicalSubjectId) ?? r.fromCanonicalSubjectId,
      toCanonicalSubjectId:   aliases.csAlias.get(r.toCanonicalSubjectId)   ?? r.toCanonicalSubjectId,
      evidenceProposalId:     aliases.propAlias.get(r.evidenceProposalId)   ?? r.evidenceProposalId,
    }))

    // Validation fermée
    const validCsIds     = new Set(subjects.map((s) => s.canonicalSubjectId))
    const validProposals = new Set(subjects.map((s) => s.proposalId))

    return resolved
      .filter((r) =>
        validCsIds.has(r.fromCanonicalSubjectId) &&
        validCsIds.has(r.toCanonicalSubjectId) &&
        r.fromCanonicalSubjectId !== r.toCanonicalSubjectId &&
        validProposals.has(r.evidenceProposalId) &&
        r.confidence >= MIN_CONFIDENCE,
      )
      .slice(0, MAX_SUGGESTIONS_PER_RUN)
  } catch (e) {
    console.error('  [Gemini] exception:', e)
    return []
  }
}
