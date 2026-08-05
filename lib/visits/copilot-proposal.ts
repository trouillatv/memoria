// Copilote 3C — types et builder déterministe de propositions.
//
// Principe : le classifieur détecte une intention d'écriture et résout le sujet.
// Ce module construit le brouillon affiché à l'utilisateur.
// AUCUNE écriture DB ici — le brouillon est éditable avant confirmation humaine.

import { formatScheduleLabel } from '@/lib/visits/copilot-schedule-parse'
import { detectIntent } from '@/lib/visits/copilot-intent-router'

export type CopilotProposalKind = 'action' | 'visit_item' | 'schedule_visit' | 'schedule_meeting'

export type CopilotConfidence = 'strong' | 'medium' | 'suggestion'

export type CopilotProposal = {
  proposalId: string
  kind: CopilotProposalKind
  title: string
  body: string | null
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
  confidence: CopilotConfidence
  whyText: string
  llmModel: string
  promptVersion: string
  // Champs de planification — non nuls uniquement pour schedule_visit / schedule_meeting.
  scheduledDate: string | null      // yyyy-mm-dd (date civile Pacific/Noumea)
  scheduledTime: string | null      // HH:MM (Pacific/Noumea) ou null
  scheduledObjective: string | null // objectif visite ou ordre du jour réunion
}

export const COPILOT_PROMPT_VERSION = '3c-v1'
export const COPILOT_LLM_MODEL = 'classifier-deterministic'

// ── Mapping intent router → CopilotProposalKind ──────────────────────────────

const INTENT_TO_KIND: Partial<Record<string, CopilotProposalKind>> = {
  SCHEDULE_VISIT:   'schedule_visit',
  SCHEDULE_MEETING: 'schedule_meeting',
  ADD_VISIT_ITEM:   'visit_item',
  CREATE_ACTION:    'action',
}

/** Délègue au routeur centralisé et mappe vers CopilotProposalKind. */
export function detectKind(question: string): CopilotProposalKind {
  const { intent } = detectIntent(question)
  return INTENT_TO_KIND[intent] ?? 'action'
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildTitle(question: string, kind: CopilotProposalKind, subjectLabel: string | null): string {
  if (kind === 'visit_item' && subjectLabel) return `Vérifier : ${subjectLabel}`
  const clean = question
    .trim()
    .replace(/^(cr[eé]e[rz]?|ajoute[rz]?|planifie[rz]?|note[rz]?|programme[rz]?|mets?\s+en\s+plan)\s+/i, '')
    .replace(/^(une?\s+|l[ae]\s+)/i, '')
  const clipped = clean.length > 90 ? clean.slice(0, 87) + '…' : clean
  const label = clipped.charAt(0).toUpperCase() + clipped.slice(1)
  return label || (kind === 'visit_item' ? 'Point à vérifier' : 'Nouvelle action')
}

function buildWhyText(kind: CopilotProposalKind, subjectLabel: string | null): string {
  const subject = subjectLabel
    ? `Associé au sujet « ${subjectLabel} ».`
    : "Aucun sujet canonique identifié — vous pouvez l'associer manuellement après création."
  const ctx = kind === 'visit_item'
    ? ' Sera ajouté à votre plan de prochaine visite.'
    : ' Deviendra une action ouverte sur ce chantier.'
  return subject + ctx
}

/** Builder pour les propositions de type action / visit_item. */
export function buildCopilotProposal(params: {
  question: string
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
  resolvedWithConfidence: boolean
}): CopilotProposal {
  const { question, canonicalSubjectId, canonicalSubjectLabel, resolvedWithConfidence } = params

  const kind = detectKind(question)
  const title = buildTitle(question, kind, canonicalSubjectLabel)
  const whyText = buildWhyText(kind, canonicalSubjectLabel)

  const confidence: CopilotConfidence = resolvedWithConfidence
    ? 'strong'
    : canonicalSubjectId
    ? 'medium'
    : 'suggestion'

  return {
    proposalId: crypto.randomUUID(),
    kind,
    title,
    body: null,
    canonicalSubjectId,
    canonicalSubjectLabel,
    confidence,
    whyText,
    llmModel: COPILOT_LLM_MODEL,
    promptVersion: COPILOT_PROMPT_VERSION,
    scheduledDate: null,
    scheduledTime: null,
    scheduledObjective: null,
  }
}

/** Builder dédié aux propositions de planification (schedule_visit / schedule_meeting). */
export function buildScheduleProposal(params: {
  kind: 'schedule_visit' | 'schedule_meeting'
  parsedDate: string
  parsedTime: string | null
  conflictWarning: string | null
}): CopilotProposal {
  const { kind, parsedDate, parsedTime, conflictWarning } = params

  const typeLabel = kind === 'schedule_visit' ? 'Visite de chantier' : 'Réunion de chantier'
  const scheduleLabel = formatScheduleLabel(parsedDate, parsedTime)

  let whyText = `Planification ${scheduleLabel}.`
  if (conflictWarning) whyText += ` ⚠️ ${conflictWarning}`
  if (!parsedTime) whyText += " Pensez à préciser l'heure avant de valider."

  return {
    proposalId: crypto.randomUUID(),
    kind,
    title: typeLabel,
    body: null,
    canonicalSubjectId: null,
    canonicalSubjectLabel: null,
    confidence: 'strong',
    whyText,
    llmModel: COPILOT_LLM_MODEL,
    promptVersion: COPILOT_PROMPT_VERSION,
    scheduledDate: parsedDate,
    scheduledTime: parsedTime,
    scheduledObjective: null,
  }
}
