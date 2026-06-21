import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { AIProviderName } from './index'
import type { EngagementCategory, EngagementKind, EngagementSourceType } from '@/types/db'
import { ENGAGEMENT_EXTRACTOR_V1 } from './prompts/engagement-extractor.v1'

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

const extractedSchema = z.object({
  engagements: z.array(
    z.object({
      source_type: z.enum(['ao_clause', 'memoire_engagement']).catch('ao_clause'),
      source_excerpt: z.string().max(1500).catch(''),
      source_ref: z.record(z.string(), z.unknown()).nullable().optional().catch(null),
      category: z.enum([
        'frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other',
      ]).catch('other'),
      kind: z.enum([
        'objectif', 'obligation', 'livrable', 'controle', 'penalite',
      ]).catch('obligation'),
      short_label: z.string().max(200).catch(''),
      measurable: z.boolean().catch(false),
      // Gemini retourne parfois 0-100 au lieu de 0-1
      confidence: z.number().transform(v => v > 1 ? v / 100 : v).catch(0.5),
    })
  ),
})

export interface ExtractedEngagement {
  source_type: EngagementSourceType
  source_excerpt: string
  source_ref: Record<string, unknown> | null
  category: EngagementCategory
  kind: EngagementKind
  short_label: string
  measurable: boolean
  ai_confidence: number
}

export interface EngagementExtractionResult {
  engagements: ExtractedEngagement[]
  metadata: Record<string, unknown>
}

export interface EngagementExtractionInput {
  aoText: string
  memoireTechniqueText: string | null
  userId: string | null
}

// ---------------------------------------------------------------------------
// Mock fixture — 5 realistic engagements covering 5 categories
// ---------------------------------------------------------------------------

const MOCK_FIXTURE: z.infer<typeof extractedSchema> = {
  engagements: [
    {
      source_type: 'memoire_engagement',
      source_excerpt:
        'Désinfection biquotidienne des sanitaires avec produits écolabel certifiés',
      source_ref: { page: 12, section: '3.2' },
      category: 'frequency',
      kind: 'obligation',
      short_label: 'Sanitaires 2x/jour avec écolabel',
      measurable: true,
      confidence: 0.92,
    },
    {
      source_type: 'ao_clause',
      source_excerpt:
        'Audit qualité hebdomadaire avec rapport écrit transmis sous 48h',
      source_ref: { page: 22, section: '4.7.1' },
      category: 'reporting',
      kind: 'controle',
      short_label: 'Audit qualité hebdomadaire',
      measurable: true,
      confidence: 0.88,
    },
    {
      source_type: 'memoire_engagement',
      source_excerpt:
        'Certification ISO 9001:2015 maintenue pendant toute la durée du marché',
      source_ref: { page: 8, section: '2.1' },
      category: 'compliance',
      kind: 'obligation',
      short_label: 'ISO 9001 maintenue',
      measurable: false,
      confidence: 0.95,
    },
    {
      source_type: 'ao_clause',
      source_excerpt:
        "Délai de reprise sous 4h ouvrées 7j/7 en cas d'incident signalé",
      source_ref: { page: 14, section: '3.5' },
      category: 'sla',
      kind: 'obligation',
      short_label: 'Reprise 4h ouvrées 7j/7',
      measurable: true,
      confidence: 0.9,
    },
    {
      source_type: 'memoire_engagement',
      source_excerpt:
        'Reporting mensuel avec photos avant/après et indicateurs qualité',
      source_ref: { page: 18, section: '4.2' },
      category: 'reporting',
      kind: 'livrable',
      short_label: 'Reporting mensuel photos avant/après',
      measurable: true,
      confidence: 0.85,
    },
    {
      // Clause à pénalité → destination suggérée 'vigilance' (démo du pattern).
      source_type: 'ao_clause',
      source_excerpt:
        "Pénalité de 2% du montant mensuel par manquement constaté lors d'un contrôle inopiné",
      source_ref: { page: 27, section: '6.3' },
      category: 'compliance',
      kind: 'penalite',
      short_label: 'Pénalité 2% par manquement',
      measurable: true,
      confidence: 0.9,
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

export async function runEngagementExtractionAgent(
  input: EngagementExtractionInput
): Promise<EngagementExtractionResult> {
  const provider = getAIProvider()
  const feature = 'engagement_extraction'

  const result = await withAITracking(feature, input.userId, async () => {
    let userMessage: string

    if (provider.name === 'mock') {
      userMessage = `__MOCK_FIXTURE__:${JSON.stringify(MOCK_FIXTURE)}`
    } else {
      userMessage = [
        '=== AO source (texte extrait) ===',
        input.aoText.slice(0, 12000),
        '',
        '=== Mémoire technique (si disponible) ===',
        input.memoireTechniqueText?.slice(0, 8000) ?? '(non fourni)',
        '',
        'Extrais les engagements au format JSON :',
        '{',
        '  "engagements": [',
        '    { "source_type": "...", "source_excerpt": "...", "source_ref": { "page": N, "section": "..." },',
        '      "category": "...", "short_label": "...", "measurable": bool, "confidence": 0.X },',
        '    ...',
        '  ]',
        '}',
      ].join('\n')
    }

    const output = await provider.complete({
      systemPrompt: ENGAGEMENT_EXTRACTOR_V1.system,
      userMessage,
      responseSchema: extractedSchema,
      modelTier: ENGAGEMENT_EXTRACTOR_V1.modelTier,
      // Un CCTP dense produit 20-30 engagements : à 2000 tokens le JSON était
      // tronqué en plein milieu → parse échec → « 0 engagement extrait ».
      // 8000 (comme lecteur-ao) couvre largement le pire cas observé (~2600).
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
      throw new Error('[runEngagementExtractionAgent] Failed to parse output')
    }

    return {
      result: parsed,
      tokens: output.tokens,
      model: output.model,
      provider: provider.name as AIProviderName,
      durationMs: output.durationMs,
    }
  })

  // Sanitisation pour respecter les contraintes DB (mig 017) :
  //   short_label   : length 3..100   → trim + tronque à 100
  //   source_excerpt: length 5..2000  → trim + tronque à 2000 (fallback = label)
  // Une seule ligne hors-bornes faisait échouer TOUT le batch d'insertion.
  // On rabote ce qui peut l'être et on écarte les lignes inexploitables.
  const engagements: ExtractedEngagement[] = result.engagements
    .map((e) => {
      const short_label = (e.short_label ?? '').trim().slice(0, 100)
      let source_excerpt = (e.source_excerpt ?? '').trim().slice(0, 2000)
      if (source_excerpt.length < 5) source_excerpt = short_label
      return {
        source_type: e.source_type,
        source_excerpt,
        source_ref: e.source_ref ?? null,
        category: e.category,
        kind: e.kind,
        short_label,
        measurable: e.measurable,
        ai_confidence: e.confidence,
      }
    })
    .filter((e) => e.short_label.length >= 3 && e.source_excerpt.length >= 5)

  const metadata: Record<string, unknown> = {
    provider: provider.name,
    prompt_version: ENGAGEMENT_EXTRACTOR_V1.version,
  }

  return { engagements, metadata }
}
