import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { AIProviderName } from './index'
import type { SiteReportProposalType } from '@/types/db'
import { SITE_REPORT_ANALYZER_V1 } from './prompts/site-report-analyzer.v1'

// ---------------------------------------------------------------------------
// Output schema — tolérant (Gemini dérive) : .catch() partout.
// Une proposition = une DÉCISION détectée, routée selon sa nature.
// ---------------------------------------------------------------------------

const PROPOSAL_TYPES = [
  'action', 'intervention', 'mission', 'anomaly',
  'vigilance', 'note', 'proof_request', 'client_memory',
] as const

const ANOMALY_CATEGORIES = [
  'eau_coupee', 'electricite_coupee', 'materiel_casse', 'acces_bloque',
  'produit_manquant', 'zone_non_prete', 'danger_securite', 'livraison_probleme', 'autre',
] as const

const missionLinkSchema = z.object({
  mode: z.enum(['existing', 'new']).catch('new'),
  existing_mission_id: z.string().nullable().catch(null),
  new_mission_name: z.string().max(120).nullable().catch(null),
  new_mission_cadence: z
    .enum(['daily', 'weekly', 'biweekly', 'monthly', 'on_demand'])
    .nullable()
    .catch(null),
}).nullable().catch(null)

const analysisSchema = z.object({
  proposals: z.array(
    z.object({
      type: z.enum(PROPOSAL_TYPES).catch('action'),
      short_label: z.string().max(140).catch(''),
      rationale: z.string().max(1000).catch(''),
      corps_etat: z.string().max(60).nullable().catch(null),
      assigned_to: z.string().max(120).nullable().catch(null),
      ai_confidence: z.number().transform((v) => (v > 1 ? v / 100 : v)).catch(0.5),
      anomaly_category: z.enum(ANOMALY_CATEGORIES).nullable().catch(null),
      mission_link: missionLinkSchema,
      suggested_date: z.string().max(20).nullable().catch(null),
    }),
  ).catch([]),
})

type AnalysisParsed = z.infer<typeof analysisSchema>

export interface SiteReportProposal {
  type: SiteReportProposalType
  short_label: string
  rationale: string | null
  category: string | null
  corps_etat: string | null
  assigned_to: string | null
  ai_confidence: number | null
  // Champs spécifiques rangés dans payload côté DB
  payload: Record<string, unknown>
}

export interface SiteReportAnalysisResult {
  proposals: SiteReportProposal[]
  metadata: Record<string, unknown>
}

export interface SiteReportAnalysisInput {
  transcript: string
  textInput: string | null
  attachmentNames: string[]
  userId: string | null
}

// ---------------------------------------------------------------------------
// Mock fixture — réunion de chantier réaliste (exemple Adrien), couvre tous
// les types pour que le flux marche en dev/CI sans clé API.
// ---------------------------------------------------------------------------

const MOCK_FIXTURE: AnalysisParsed = {
  proposals: [
    {
      type: 'action',
      short_label: 'Le plombier doit revenir poser les évacuations',
      rationale: 'le plombier doit revenir mardi',
      corps_etat: 'Plomberie',
      assigned_to: 'Plombier',
      ai_confidence: 0.9,
      anomaly_category: null,
      mission_link: null,
      suggested_date: null,
    },
    {
      type: 'action',
      short_label: 'Finir la pose des portes étage 2',
      rationale: 'il faut finir les portes',
      corps_etat: 'Menuiserie',
      assigned_to: null,
      ai_confidence: 0.85,
      anomaly_category: null,
      mission_link: null,
      suggested_date: null,
    },
    {
      type: 'action',
      short_label: 'Reprendre réservations électriques A203',
      rationale: 'réservations cuisine A203 à reprendre',
      corps_etat: 'Électricité',
      assigned_to: null,
      ai_confidence: 0.8,
      anomaly_category: null,
      mission_link: null,
      suggested_date: null,
    },
    {
      type: 'action',
      short_label: 'Livraison BA13 décalée — recaler la date',
      rationale: 'la livraison BA13 est décalée',
      corps_etat: 'Livraison',
      assigned_to: null,
      ai_confidence: 0.8,
      anomaly_category: null,
      mission_link: null,
      suggested_date: null,
    },
    {
      type: 'intervention',
      short_label: 'Contrôle SOCOTEC sur site',
      rationale: 'SOCOTEC passe jeudi',
      corps_etat: 'Contrôle (SOCOTEC)',
      assigned_to: 'SOCOTEC',
      ai_confidence: 0.88,
      anomaly_category: null,
      mission_link: { mode: 'new', existing_mission_id: null, new_mission_name: 'Contrôle SOCOTEC', new_mission_cadence: 'on_demand' },
      suggested_date: null,
    },
    {
      type: 'vigilance',
      short_label: 'Zone sud reste humide après fortes pluies',
      rationale: 'attention humidité zone sud',
      corps_etat: 'Gros œuvre',
      assigned_to: null,
      ai_confidence: 0.75,
      anomaly_category: null,
      mission_link: null,
      suggested_date: null,
    },
    {
      type: 'client_memory',
      short_label: 'Client très sensible aux retards',
      rationale: 'le client est très sensible aux retards',
      corps_etat: null,
      assigned_to: null,
      ai_confidence: 0.9,
      anomaly_category: null,
      mission_link: null,
      suggested_date: null,
    },
    {
      type: 'proof_request',
      short_label: 'Fournir le PV de réception des portes',
      rationale: 'il faudra le PV de réception',
      corps_etat: 'Menuiserie',
      assigned_to: null,
      ai_confidence: 0.7,
      anomaly_category: null,
      mission_link: null,
      suggested_date: null,
    },
  ],
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export async function runSiteReportAnalysisAgent(
  input: SiteReportAnalysisInput,
): Promise<SiteReportAnalysisResult> {
  const provider = getAIProvider()
  const feature = 'site_report_analysis'

  const parsed = await withAITracking(feature, input.userId, async () => {
    let userMessage: string

    if (provider.name === 'mock') {
      userMessage = `__MOCK_FIXTURE__:${JSON.stringify(MOCK_FIXTURE)}`
    } else {
      userMessage = [
        '=== Transcription corrigée ===',
        input.transcript?.slice(0, 12000) || '(vide)',
        '',
        '=== Notes saisies ===',
        input.textInput?.slice(0, 6000) ?? '(aucune)',
        '',
        '=== Pièces jointes (noms de fichiers uniquement) ===',
        input.attachmentNames.length > 0 ? input.attachmentNames.join('\n') : '(aucune)',
        '',
        'Extrais les décisions au format JSON { "proposals": [ ... ] }.',
      ].join('\n')
    }

    const output = await provider.complete({
      systemPrompt: SITE_REPORT_ANALYZER_V1.system,
      userMessage,
      responseSchema: analysisSchema,
      modelTier: SITE_REPORT_ANALYZER_V1.modelTier,
      maxOutputTokens: 2500,
    })

    let result: AnalysisParsed | undefined

    if (output.parsed !== undefined && output.parsed !== null) {
      const r = analysisSchema.safeParse(output.parsed)
      if (r.success) result = r.data
    }

    if (result === undefined) {
      try {
        const raw = JSON.parse(output.text)
        const r = analysisSchema.safeParse(raw)
        if (r.success) result = r.data
      } catch {
        // ignore
      }
    }

    if (result === undefined) {
      throw new Error('[runSiteReportAnalysisAgent] Failed to parse output')
    }

    return {
      result,
      tokens: output.tokens,
      model: output.model,
      provider: provider.name as AIProviderName,
      durationMs: output.durationMs,
    }
  })

  const proposals: SiteReportProposal[] = parsed.proposals
    .filter((p) => p.short_label.trim().length > 0)
    .map((p) => ({
      type: p.type,
      short_label: p.short_label.slice(0, 140),
      rationale: p.rationale || null,
      category: p.type === 'anomaly' ? (p.anomaly_category ?? 'autre') : null,
      corps_etat: p.corps_etat,
      assigned_to: p.assigned_to,
      ai_confidence: p.ai_confidence,
      payload: {
        mission_link: p.mission_link,
        suggested_date: p.suggested_date,
        anomaly_category: p.anomaly_category,
      },
    }))

  return {
    proposals,
    metadata: {
      provider: provider.name,
      prompt_version: SITE_REPORT_ANALYZER_V1.version,
    },
  }
}
