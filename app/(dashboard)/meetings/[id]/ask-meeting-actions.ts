'use server'

// « Interroger cette réunion » — agent de Q&A scopé À UNE SEULE RÉUNION (≠ Atelier
// mémoire du site, qui balaie tout le chantier). Le corpus est petit et auto-contenu :
// pas de recherche/RAG, on passe directement au LLM la transcription + les éléments
// structurés de CETTE réunion. L'agent SYNTHÉTISE (il propose, il ne décide pas) et
// CITE des extraits verbatim courts. Les « sources mobilisées » sont déterministes.

import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getAIProvider } from '@/services/ai/factory'
import { withAITracking } from '@/services/ai/tracking'
import { getSiteReport, listProposals } from '@/lib/db/site-reports'
import { listSiteActionsByReport } from '@/lib/db/site-actions'
import { getLatestReportDocument } from '@/lib/db/report-documents'

const TRANSCRIPT_CAP = 16000 // borne de coût : un transcript de réunion tient largement.

const answerSchema = z.object({
  answer: z.string().default(''),
  // Extraits COURTS et verbatim de la transcription appuyant la réponse (grounding).
  citations: z.array(z.string()).default([]),
})
export type MeetingAnswer = z.infer<typeof answerSchema>

const SYSTEM = [
  'Tu es le copilote d\'UNE réunion précise (et d\'elle seule). Tu réponds à la question UNIQUEMENT à partir des éléments fournis de cette réunion : transcription, décisions détectées, actions créées, participants. Tu remplis :',
  '- answer : réponse COURTE, concrète, factuelle, appuyée sur les éléments fournis. Si l\'information n\'y est pas, dis-le franchement plutôt que d\'inventer.',
  '- citations : 0 à 3 extraits COURTS (≤ 200 caractères) et STRICTEMENT VERBATIM de la transcription qui appuient ta réponse (copie exacte, pas de reformulation). Aucune si rien de pertinent.',
  'INTERDITS : inventer un fait absent des éléments fournis ; juger ou comparer des personnes ; sortir du périmètre de cette réunion. Français, phrases courtes.',
  'Réponds STRICTEMENT en JSON : {"answer":"…","citations":["…"]}.',
].join('\n')

function mockAnswer(q: string, transcript: string): MeetingAnswer {
  const firstQuote = transcript.split(/[.\n]/).map((s) => s.trim()).find((s) => s.length > 20)?.slice(0, 180)
  return {
    answer: `(démo locale) Voici ce que je trouve dans cette réunion au sujet de « ${q} ». Configurez une clé IA (Gemini/Anthropic) pour une vraie synthèse.`,
    citations: firstQuote ? [firstQuote] : [],
  }
}

export async function askMeetingAction(
  reportId: string,
  question: string,
): Promise<
  | { ok: true; answer: MeetingAnswer; basedOn: string[]; mock: boolean }
  | { ok: false; error: string }
> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') return { ok: false, error: 'Accès refusé' }
  if (!z.string().uuid().safeParse(reportId).success) return { ok: false, error: 'Réunion invalide' }

  const q = (question ?? '').trim().slice(0, 300)
  if (q.length < 3) return { ok: false, error: 'Question trop courte' }

  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Réunion introuvable' }

  const [proposals, actions, pvDoc] = await Promise.all([
    listProposals(reportId),
    listSiteActionsByReport(reportId),
    getLatestReportDocument(reportId).catch(() => null),
  ])

  const transcriptFull = (report.transcript_corrected || report.transcript_raw || report.text_input || '').trim()
  const transcript = transcriptFull.slice(0, TRANSCRIPT_CAP)
  const decisions = proposals.filter((p) => p.status !== 'rejected')
  const liveActions = actions.filter((a) => a.status !== 'cancelled')
  const participants = (report.participants ?? []).filter(Boolean)
  const pvFinal = pvDoc?.status === 'validated' || pvDoc?.status === 'exported'

  if (!transcript && decisions.length === 0 && liveActions.length === 0) {
    return { ok: false, error: 'Cette réunion n\'a pas encore de contenu à interroger.' }
  }

  // Sources mobilisées — déterministes (affichées « Réponse basée sur »).
  const basedOn: string[] = []
  if (transcript) basedOn.push('Transcription / CR brut')
  if (decisions.length > 0) basedOn.push(`Décisions détectées (${decisions.length})`)
  if (liveActions.length > 0) basedOn.push(`Actions créées (${liveActions.length})`)
  if (participants.length > 0) basedOn.push(`Participants (${participants.length})`)
  if (pvFinal) basedOn.push('PV final')

  const provider = getAIProvider()
  try {
    const answer = await withAITracking('meeting_qa', user.id, async () => {
      let userMessage: string
      if (provider.name === 'mock') {
        userMessage = `__MOCK_FIXTURE__:${JSON.stringify(mockAnswer(q, transcript))}`
      } else {
        const decisionLines = decisions.length > 0
          ? decisions.map((d) => `- (${d.type}) ${d.short_label}${d.corps_etat ? ` [${d.corps_etat}]` : ''}`).join('\n')
          : '(aucune)'
        const actionLines = liveActions.length > 0
          ? liveActions.map((a) => `- ${a.title}${a.assigned_to ? ` → ${a.assigned_to}` : ''}${a.due_date ? ` (échéance ${a.due_date})` : ''}`).join('\n')
          : '(aucune)'
        userMessage = [
          `Question : ${q}`,
          '',
          `=== Participants ===\n${participants.length > 0 ? participants.join(', ') : '(non renseignés)'}`,
          '',
          `=== Décisions détectées ===\n${decisionLines}`,
          '',
          `=== Actions créées ===\n${actionLines}`,
          '',
          `=== Transcription de la réunion${transcriptFull.length > TRANSCRIPT_CAP ? ' (extrait)' : ''} ===`,
          transcript || '(aucune transcription)',
        ].join('\n')
      }
      const r = await provider.complete({ systemPrompt: SYSTEM, userMessage, responseSchema: answerSchema, modelTier: 'light', maxOutputTokens: 700 })
      const parsed = answerSchema.safeParse(r.parsed)
      const result: MeetingAnswer = parsed.success ? parsed.data : { answer: '', citations: [] }
      return { result, tokens: r.tokens, model: r.model, provider: provider.name, durationMs: r.durationMs }
    })
    return { ok: true, answer, basedOn, mock: provider.name === 'mock' }
  } catch {
    return { ok: false, error: 'Synthèse indisponible' }
  }
}
