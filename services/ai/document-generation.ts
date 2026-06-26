// Sprint 1 — Génération d'un CR/PV de chantier à partir d'une réunion analysée.
//
// UN SEUL appel LLM : il rédige UNIQUEMENT les sections `generative` du template
// à partir du transcript + notes. Les sections `participants`/`actions`/`risks`
// sont assemblées EN CODE depuis les données déjà curées de la réunion
// (Choix A — pas de ré-extraction, discipline coût IA). Aucune invention :
// chaque section narrative doit citer des extraits ; incertain → « (à confirmer) ».

import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import { buildGlossaryPromptBlock } from '@/lib/db/glossary'
import type { AIProviderName } from './index'
import type {
  ReportDocumentSection,
  DbSiteAction,
  SiteReportParticipant,
  SiteReportRisk,
} from '@/types/db'
import type { ReportTemplateSpec } from '@/lib/documents/templates/cr-chantier'

export interface GeneratePvInput {
  template: ReportTemplateSpec
  transcript: string
  notes: string | null
  participants: SiteReportParticipant[]
  risks: SiteReportRisk[]
  /** Actions DÉJÀ curées de la réunion (Choix A). */
  actions: DbSiteAction[]
  meetingTitle: string | null
  meetingDateLabel: string
  /** Bloc « suivi réunion précédente » pré-calculé (déterministe, hors LLM). */
  followupText?: string | null
  userId: string | null
}

export interface GeneratePvResult {
  sections: ReportDocumentSection[]
  provider: string
  model: string
  promptVersion: string
}

const genSchema = z.object({
  sections: z.array(
    z.object({
      key: z.string().catch(''),
      content: z.string().catch(''),
      sources: z.array(z.string().max(400)).catch([]),
    }),
  ).catch([]),
})
type GenParsed = z.infer<typeof genSchema>

// ---------------------------------------------------------------------------
// Formatage des sections DONNÉES (assemblées en code, jamais via LLM).
// ---------------------------------------------------------------------------

function fmtParticipants(participants: SiteReportParticipant[]): string {
  if (participants.length === 0) return 'Aucun participant détecté.'
  return participants
    .map((p) => `- ${p.name}${p.role ? ` — ${p.role}` : ''}`)
    .join('\n')
}

const ACTION_STATUS_LABEL: Record<DbSiteAction['status'], string> = {
  open: 'à faire',
  planned: 'planifiée',
  done: 'faite',
  cancelled: 'annulée',
}

function fmtActions(actions: DbSiteAction[]): string {
  const visible = actions.filter((a) => a.status !== 'cancelled')
  if (visible.length === 0) return 'Aucune action ouverte issue de cette réunion.'
  return visible
    .map((a) => {
      const prefix = a.corps_etat ? `[${a.corps_etat}] ` : ''
      const who = a.assigned_to ? ` — ${a.assigned_to}` : ''
      const confirm = a.due_date_status === 'estimated' ? ' à confirmer' : ''
      const due = a.due_date ? ` (échéance ${a.due_date}${confirm})` : ''
      const state = ` = ${ACTION_STATUS_LABEL[a.status]}`
      return `- ${prefix}${a.title}${who}${due}${state}`
    })
    .join('\n')
}

function fmtRisks(risks: SiteReportRisk[]): string {
  if (risks.length === 0) return 'Aucune réserve ni point bloquant signalé.'
  return risks
    .map((r) => {
      const dep = r.waiting_party && r.awaited ? ` (${r.waiting_party} attend ${r.awaited})` : ''
      return `- ${r.label}${dep}`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// Mock fixture — sections narratives, pour dev/CI sans clé API.
// ---------------------------------------------------------------------------

function mockSections(template: ReportTemplateSpec): GenParsed {
  return {
    sections: template.sections
      .filter((s) => s.source === 'generative')
      .map((s) => ({
        key: s.key,
        content: `[mock] ${s.title} — contenu de démonstration.`,
        sources: [],
      })),
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export async function generatePv(input: GeneratePvInput): Promise<GeneratePvResult> {
  const provider = getAIProvider()
  const { template } = input
  const generativeSections = template.sections.filter((s) => s.source === 'generative')

  const parsed = await withAITracking('pv_generation', input.userId, async () => {
    let userMessage: string

    if (provider.name === 'mock') {
      userMessage = `__MOCK_FIXTURE__:${JSON.stringify(mockSections(template))}`
    } else {
      const sectionsBrief = generativeSections
        .map((s) => `- key="${s.key}" · ${s.title}${s.guidance ? ` : ${s.guidance}` : ''}`)
        .join('\n')
      const glossaryBlock = await buildGlossaryPromptBlock().catch(() => '')
      userMessage = [
        glossaryBlock ? `${glossaryBlock}\n` : '',
        `Réunion : ${input.meetingTitle ?? '(sans titre)'} — ${input.meetingDateLabel}`,
        '',
        '=== Transcription ===',
        input.transcript?.slice(0, 14000) || '(vide)',
        '',
        '=== Notes saisies ===',
        input.notes?.slice(0, 6000) ?? '(aucune)',
        '',
        '=== Sections à rédiger (UNIQUEMENT celles-ci) ===',
        sectionsBrief,
        '',
        'Réponds en JSON : { "sections": [ { "key": "...", "content": "...", "sources": ["extrait verbatim court", ...] } ] }.',
        'Une entrée par key demandée. `content` = texte de la section (puces « - » autorisées).',
        '`sources` = extraits courts du transcript étayant la section. Aucune affirmation sans appui ;',
        'tout élément incertain est suffixé « (à confirmer) ». Ne rédige AUCUNE autre section.',
      ].join('\n')
    }

    const output = await provider.complete({
      systemPrompt: template.systemPrompt,
      userMessage,
      responseSchema: genSchema,
      modelTier: 'heavy',
      maxOutputTokens: 3500,
    })

    let result: GenParsed | undefined
    if (output.parsed !== undefined && output.parsed !== null) {
      const r = genSchema.safeParse(output.parsed)
      if (r.success) result = r.data
    }
    if (result === undefined) {
      try {
        const r = genSchema.safeParse(JSON.parse(output.text))
        if (r.success) result = r.data
      } catch {
        // ignore
      }
    }
    if (result === undefined) throw new Error('[generatePv] Failed to parse output')

    return {
      result,
      tokens: output.tokens,
      model: output.model,
      provider: provider.name as AIProviderName,
      durationMs: output.durationMs,
    }
  })

  const genByKey = new Map(parsed.sections.map((s) => [s.key, s]))

  // Assemblage final, dans l'ordre du template.
  const sections: ReportDocumentSection[] = template.sections.map((spec) => {
    if (spec.source === 'participants') {
      return { key: spec.key, title: spec.title, kind: spec.kind, content: fmtParticipants(input.participants) }
    }
    if (spec.source === 'actions') {
      return { key: spec.key, title: spec.title, kind: spec.kind, content: fmtActions(input.actions) }
    }
    if (spec.source === 'risks') {
      return { key: spec.key, title: spec.title, kind: spec.kind, content: fmtRisks(input.risks) }
    }
    if (spec.source === 'followup') {
      return { key: spec.key, title: spec.title, kind: spec.kind, content: (input.followupText ?? '').trim() }
    }
    if (spec.source === 'meta' || spec.kind === 'fixed') {
      return { key: spec.key, title: spec.title, kind: spec.kind, content: spec.guidance ?? '' }
    }
    // generative
    const g = genByKey.get(spec.key)
    return {
      key: spec.key,
      title: spec.title,
      kind: spec.kind,
      content: (g?.content ?? '').trim(),
      sources: g?.sources && g.sources.length > 0 ? g.sources : undefined,
    }
  })

  return {
    sections,
    provider: provider.name,
    model: provider.name === 'mock' ? 'mock-1' : 'unknown',
    promptVersion: template.key,
  }
}
