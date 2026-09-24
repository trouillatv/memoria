import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { AIProviderName } from './index'
import type { EngagementCategory, EngagementKind } from '@/types/db'
import { ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1 } from './prompts/engagement-extractor-prescriptif.v1'

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------
//
// Pas de source_page ici : contrairement au label/l'excerpt, une page devinée
// par le modèle n'est jamais une page fiable. L'appelant (orchestrateur) la
// retrouve MÉCANIQUEMENT à partir du marqueur « [[page N]] » qui précède
// l'extrait verbatim dans le texte source — cf. lib/tenders/engagement-provenance.ts
// pour le même principe côté Porte A (AO).

// Pas de .max() ici : un .max(N).catch(v) rejette la valeur ENTIÈRE (remplacée
// par v) dès qu'elle dépasse N, au lieu de la tronquer — un extrait verbatim
// légitime mais long serait silencieusement perdu et remplacé, ce qui casse le
// grounding. Le bornage réel (longueur DB, mig 017) a lieu APRÈS parsing, par
// troncature explicite plus bas (label/sourceExcerpt/frequencyRaw).
const extractedSchema = z.object({
  engagements: z.array(
    z.object({
      label: z.string().catch(''),
      description: z.string().nullable().optional().catch(null),
      source_excerpt: z.string().catch(''),
      category: z.enum([
        'frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other',
      ]).catch('other'),
      kind: z.enum([
        'objectif', 'obligation', 'livrable', 'controle', 'penalite',
      ]).catch('obligation'),
      measurable: z.boolean().catch(false),
      frequency_raw: z.string().nullable().optional().catch(null),
      // Gemini retourne parfois 0-100 au lieu de 0-1
      confidence: z.number().transform(v => v > 1 ? v / 100 : v).catch(0.5),
    })
  ),
})

export interface ExtractedEngagementCandidate {
  label: string
  description: string | null
  sourceExcerpt: string
  /** Suggestion pour la revue humaine — jamais utilisée telle quelle par la matérialisation (mig 436 : p_category vient du CALLER, pas du proposal). */
  categorySuggestion: EngagementCategory
  kind: EngagementKind
  measurable: boolean
  frequencyRaw: string | null
  aiConfidence: number
}

export interface EngagementCandidateExtractionResult {
  candidates: ExtractedEngagementCandidate[]
  metadata: Record<string, unknown>
}

export interface EngagementCandidateExtractionInput {
  /** Texte INTÉGRAL du document contractuel, balisé [[page N]] (services/pdf/extract.ts). */
  sourceText: string
  /** Libellé lisible du document (contexte du prompt + traçabilité). */
  sourceLabel: string
  userId: string | null
}

/**
 * Compose le message soumis à l'agent pour UN appel d'extraction. `sourceText`
 * est soit le document contractuel entier (document court), soit UNE fenêtre
 * de pages d'un document plus long — le découpage en fenêtres, le
 * recouvrement et la déduplication des doublons de frontière sont à la charge
 * de l'orchestrateur (lib/documents/extract-engagement-candidates.ts,
 * lib/documents/page-windows.ts), jamais de cette fonction.
 */
export function buildEngagementCandidateExtractionMessage(sourceText: string, sourceLabel: string): string {
  return [
    `=== Document : ${sourceLabel} ===`,
    sourceText,
    '',
    'Extrais les engagements prescrits au format JSON :',
    '{',
    '  "engagements": [',
    '    { "label": "...", "description": "...", "source_excerpt": "...",',
    '      "category": "...", "kind": "...", "measurable": bool, "frequency_raw": "...", "confidence": 0.X },',
    '    ...',
    '  ]',
    '}',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Mock fixture — 7 candidats réalistes, catégories/natures variées
// ---------------------------------------------------------------------------

const MOCK_FIXTURE: z.infer<typeof extractedSchema> = {
  engagements: [
    {
      label: 'Nettoyage quotidien des sanitaires',
      description: 'Nettoyage et désinfection des sanitaires du site tous les jours ouvrés.',
      source_excerpt: 'Le prestataire assure un nettoyage quotidien des sanitaires du site.',
      category: 'frequency',
      kind: 'obligation',
      measurable: true,
      frequency_raw: 'quotidien',
      confidence: 0.92,
    },
    {
      label: 'Rapport d\'intervention à chaque visite',
      description: null,
      source_excerpt: 'Un rapport d\'intervention est remis au client à chaque visite du technicien.',
      category: 'reporting',
      kind: 'livrable',
      measurable: true,
      frequency_raw: null,
      confidence: 0.88,
    },
    {
      label: 'Température chambres froides 0-4°C',
      description: 'Maintien de la chaîne du froid sur l\'ensemble des équipements frigorifiques.',
      source_excerpt: 'La température des chambres froides est maintenue en permanence entre 0 et 4°C.',
      category: 'quality',
      kind: 'objectif',
      measurable: true,
      frequency_raw: null,
      confidence: 0.9,
    },
    {
      label: 'Contrôle qualité trimestriel',
      description: null,
      source_excerpt: 'Un contrôle qualité trimestriel est réalisé par le titulaire du marché.',
      category: 'compliance',
      kind: 'controle',
      measurable: true,
      frequency_raw: 'trimestriel',
      confidence: 0.85,
    },
    {
      label: 'Pénalité retard intervention 150€/jour',
      description: null,
      source_excerpt: 'Le non-respect du délai d\'intervention entraîne une pénalité de 150 euros par jour de retard.',
      category: 'sla',
      kind: 'penalite',
      measurable: true,
      frequency_raw: null,
      confidence: 0.9,
    },
    {
      label: 'Délai de reprise 4h ouvrées',
      description: 'Délai de reprise garanti sur incident signalé, hors weekend et jours fériés.',
      source_excerpt: 'Le prestataire garantit une reprise sous 4 heures ouvrées en cas d\'incident signalé.',
      category: 'sla',
      kind: 'obligation',
      measurable: true,
      frequency_raw: null,
      confidence: 0.87,
    },
    {
      label: 'Certification ISO 9001 maintenue',
      description: null,
      source_excerpt: 'Le titulaire maintient sa certification ISO 9001:2015 pendant toute la durée du marché.',
      category: 'compliance',
      kind: 'obligation',
      measurable: false,
      frequency_raw: null,
      confidence: 0.93,
    },
  ],
}

// Récupère les objets engagement COMPLETS d'une sortie JSON tronquée.
// Parcourt le contenu du tableau "engagements" et ne garde que les objets
// dont les accolades sont équilibrées (le dernier, incomplet, est jeté).
function salvageEngagements(text: string): { engagements: unknown[] } | null {
  const start = text.indexOf('"engagements"')
  if (start === -1) return null
  const bracket = text.indexOf('[', start)
  if (bracket === -1) return null

  const objects: unknown[] = []
  let depth = 0
  let objStart = -1
  let inString = false
  let escaped = false

  for (let i = bracket + 1; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') { if (depth === 0) objStart = i; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0 && objStart !== -1) {
        try { objects.push(JSON.parse(text.slice(objStart, i + 1))) } catch { /* skip */ }
        objStart = -1
      }
    } else if (ch === ']' && depth === 0) break
  }

  return objects.length > 0 ? { engagements: objects } : null
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export async function runEngagementCandidateExtractionAgent(
  input: EngagementCandidateExtractionInput
): Promise<EngagementCandidateExtractionResult> {
  const provider = getAIProvider()
  const feature = 'engagement_prescriptif_extraction'

  const result = await withAITracking(feature, input.userId, async () => {
    let userMessage: string

    if (provider.name === 'mock') {
      userMessage = `__MOCK_FIXTURE__:${JSON.stringify(MOCK_FIXTURE)}`
    } else {
      userMessage = buildEngagementCandidateExtractionMessage(input.sourceText, input.sourceLabel)
    }

    const output = await provider.complete({
      systemPrompt: ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1.system,
      userMessage,
      responseSchema: extractedSchema,
      modelTier: ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1.modelTier,
      // sourceText est au maximum UNE fenêtre de document (lib/documents/
      // page-windows.ts, ~40k chars), jamais le document entier sur les CCTP
      // longs — même plafond que le lecteur d'AO (services/ai/engagement-
      // extraction.ts), déjà généreux pour le volume d'une seule fenêtre.
      maxOutputTokens: 8000,
    })

    let parsed: z.infer<typeof extractedSchema> | undefined

    if (output.parsed !== undefined && output.parsed !== null) {
      const r = extractedSchema.safeParse(output.parsed)
      if (r.success) parsed = r.data
    }

    if (parsed === undefined) {
      try {
        const raw = JSON.parse(output.text)
        const r = extractedSchema.safeParse(raw)
        if (r.success) parsed = r.data
      } catch {
        // ignore
      }
    }

    // Filet anti-troncature : si le JSON est coupé (sortie trop longue), on
    // récupère les objets COMPLETS de la liste plutôt que de tout perdre.
    if (parsed === undefined) {
      const salvaged = salvageEngagements(output.text)
      if (salvaged) {
        const r = extractedSchema.safeParse(salvaged)
        if (r.success) parsed = r.data
      }
    }

    if (parsed === undefined) {
      throw new Error('[runEngagementCandidateExtractionAgent] Failed to parse output')
    }

    return {
      result: parsed,
      tokens: output.tokens,
      model: output.model,
      provider: provider.name as AIProviderName,
      durationMs: output.durationMs,
    }
  })

  // Sanitisation pour respecter les contraintes DB atteintes à la matérialisation
  // (mig 017, table engagements) :
  //   short_label   : length 3..100   → trim + tronque à 100
  //   source_excerpt: length 5..2000  → trim + tronque à 2000 (fallback = label)
  // document_extraction_proposal n'a PAS ces CHECK (mig 257) : un proposal hors
  // bornes serait donc insérable mais ferait échouer la matérialisation bien
  // plus tard, un échec beaucoup plus coûteux à diagnostiquer. On rabote ici.
  const candidates: ExtractedEngagementCandidate[] = result.engagements
    .map((e) => {
      const label = (e.label ?? '').trim().slice(0, 100)
      let sourceExcerpt = (e.source_excerpt ?? '').trim().slice(0, 2000)
      if (sourceExcerpt.length < 5) sourceExcerpt = label
      return {
        label,
        description: e.description?.trim() || null,
        sourceExcerpt,
        categorySuggestion: e.category,
        kind: e.kind,
        measurable: e.measurable,
        frequencyRaw: e.frequency_raw?.trim() || null,
        aiConfidence: e.confidence,
      }
    })
    .filter((e) => e.label.length >= 3 && e.sourceExcerpt.length >= 5)

  const metadata: Record<string, unknown> = {
    provider: provider.name,
    prompt_version: ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1.version,
    source_label: input.sourceLabel,
    source_chars: input.sourceText.length,
    candidates_count: candidates.length,
  }

  return { candidates, metadata }
}
