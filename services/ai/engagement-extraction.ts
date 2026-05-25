import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { AIProviderName } from './index'
import type { EngagementCategory, EngagementSourceType } from '@/types/db'
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
      short_label: 'Pénalité 2% par manquement',
      measurable: true,
      confidence: 0.9,
    },
  ],
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
      maxOutputTokens: 2000,
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

  const engagements: ExtractedEngagement[] = result.engagements.map((e) => ({
    source_type: e.source_type,
    source_excerpt: e.source_excerpt,
    source_ref: e.source_ref ?? null,
    category: e.category,
    short_label: e.short_label,
    measurable: e.measurable,
    ai_confidence: e.confidence,
  }))

  const metadata: Record<string, unknown> = {
    provider: provider.name,
    prompt_version: ENGAGEMENT_EXTRACTOR_V1.version,
  }

  return { engagements, metadata }
}
