// Copilote 3C — types et builder déterministe de propositions.
//
// Principe : le classifieur détecte une intention d'écriture et résout le sujet.
// Ce module construit le brouillon affiché à l'utilisateur.
// AUCUNE écriture DB ici — le brouillon est éditable avant confirmation humaine.

import { formatScheduleLabel } from '@/lib/visits/copilot-schedule-parse'
import { detectIntent, extractObservationMarker, extractFactTemporality } from '@/lib/visits/copilot-intent-router'
import { CHOOSABLE_KNOWLEDGE_KINDS, type KnowledgeEntryKind } from '@/lib/db/site-memory-entries'

export type CopilotProposalKind =
  | 'action'
  | 'visit_item'
  | 'schedule_visit'
  | 'schedule_meeting'
  | 'observation'
  | 'fact'
  | 'actor_alias'

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
  // Champs OBSERVATION — non nuls uniquement pour kind = 'observation'.
  observationTemporality: string | null // marqueur littéral détecté (« encore », « ce matin »…)
  observationActorLabel: string | null  // acteur/objet éventuellement mentionné dans le constat
  // Champs CORRECTION_IDENTITY — non nuls uniquement pour kind = 'actor_alias' (P4-B.2).
  aliasText: string | null              // forme mentionnée par l'utilisateur (« Clim Expert »)
  aliasTargetKind: 'company' | 'contact' | null
  aliasTargetId: string | null          // company.id ou company_contact.id résolu, jamais créé
  aliasTargetLabel: string | null       // libellé d'affichage de la cible résolue
  aliasNature: 'business_alias' | 'transcription_alias' | null
  // Champs FACT — non nuls uniquement pour kind = 'fact' (P4-C).
  // factNature reste choisi par l'humain, jamais inféré par le LLM (doctrine explicite).
  factNature: KnowledgeEntryKind | null
  factTemporality: string | null        // marqueur temporel littéral détecté, jamais inventé
}

export const COPILOT_PROMPT_VERSION = '3c-v1'
export const COPILOT_LLM_MODEL = 'classifier-deterministic'

// ── Mapping intent router → CopilotProposalKind ──────────────────────────────

const INTENT_TO_KIND: Partial<Record<string, CopilotProposalKind>> = {
  SCHEDULE_VISIT:   'schedule_visit',
  SCHEDULE_MEETING: 'schedule_meeting',
  ADD_VISIT_ITEM:   'visit_item',
  CREATE_ACTION:    'action',
  OBSERVATION:      'observation',
  FACT:             'fact',
  CORRECTION_IDENTITY: 'actor_alias',
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
  if (label) return label
  if (kind === 'visit_item') return 'Point à vérifier'
  if (kind === 'fact') return 'Nouvelle information'
  return 'Nouvelle action'
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
    observationTemporality: null,
    observationActorLabel: null,
    aliasText: null,
    aliasTargetKind: null,
    aliasTargetId: null,
    aliasTargetLabel: null,
    aliasNature: null,
    factNature: null,
    factTemporality: null,
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
    observationTemporality: null,
    observationActorLabel: null,
    aliasText: null,
    aliasTargetKind: null,
    aliasTargetId: null,
    aliasTargetLabel: null,
    aliasNature: null,
    factNature: null,
    factTemporality: null,
  }
}

/**
 * Builder dédié aux constats OBSERVATION.
 *
 * `body` porte le texte source verbatim (jamais une paraphrase LLM — doctrine
 * anti-faits-fictifs) : c'est lui qui sert de « constat exprimé ». `title` en
 * dérive une version courte pour l'affichage en liste, sans réinterpréter.
 */
export function buildObservationProposal(params: {
  question: string
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
  resolvedWithConfidence: boolean
  actorLabel: string | null
}): CopilotProposal {
  const { question, canonicalSubjectId, canonicalSubjectLabel, resolvedWithConfidence, actorLabel } = params

  const title = buildTitle(question, 'action', canonicalSubjectLabel)
  const temporality = extractObservationMarker(question)
  const subject = canonicalSubjectLabel
    ? `Constat relié au sujet « ${canonicalSubjectLabel} ».`
    : "Constat sans sujet canonique résolu avec certitude — à confirmer."
  const whyText = `${subject} Sera enregistré comme observation datée d'aujourd'hui.`

  const confidence: CopilotConfidence = resolvedWithConfidence
    ? 'strong'
    : canonicalSubjectId
    ? 'medium'
    : 'suggestion'

  return {
    proposalId: crypto.randomUUID(),
    kind: 'observation',
    title,
    body: question.trim(),
    canonicalSubjectId,
    canonicalSubjectLabel,
    confidence,
    whyText,
    llmModel: COPILOT_LLM_MODEL,
    promptVersion: COPILOT_PROMPT_VERSION,
    scheduledDate: null,
    scheduledTime: null,
    scheduledObjective: null,
    observationTemporality: temporality,
    observationActorLabel: actorLabel,
    aliasText: null,
    aliasTargetKind: null,
    aliasTargetId: null,
    aliasTargetLabel: null,
    aliasNature: null,
    factNature: null,
    factTemporality: null,
  }
}

/**
 * Builder dédié aux corrections d'identité d'acteur (CORRECTION_IDENTITY, P4-B.2).
 *
 * La cible doit déjà être résolue avec certitude (resolveActorTarget → 'resolved')
 * avant d'appeler ce builder — l'ambiguïté ou l'absence de cible sont traitées en
 * amont (clarification), jamais ici. `aliasNature` reste modifiable par
 * l'utilisateur avant confirmation : ce n'est qu'une proposition initiale.
 */
export function buildIdentityCorrectionProposal(params: {
  alias: string
  targetKind: 'company' | 'contact'
  targetId: string
  targetLabel: string
  proposedNature: 'business_alias' | 'transcription_alias'
}): CopilotProposal {
  const { alias, targetKind, targetId, targetLabel, proposedNature } = params

  const title = `Retenir que « ${alias} » désigne ${targetLabel} ?`
  const whyText = `MemorIA a compris que « ${alias} » et « ${targetLabel} » désignent le même acteur. ` +
    "Cette correspondance sera mémorisée et réutilisée pour la reconnaissance vocale et l'affichage."

  return {
    proposalId: crypto.randomUUID(),
    kind: 'actor_alias',
    title,
    body: null,
    canonicalSubjectId: null,
    canonicalSubjectLabel: null,
    confidence: 'strong',
    whyText,
    llmModel: COPILOT_LLM_MODEL,
    promptVersion: COPILOT_PROMPT_VERSION,
    scheduledDate: null,
    scheduledTime: null,
    scheduledObjective: null,
    observationTemporality: null,
    observationActorLabel: null,
    aliasText: alias,
    aliasTargetKind: targetKind,
    aliasTargetId: targetId,
    aliasTargetLabel: targetLabel,
    aliasNature: proposedNature,
    factNature: null,
    factTemporality: null,
  }
}

/**
 * Builder dédié aux informations FACT (P4-C).
 *
 * `body` porte le texte source verbatim (même doctrine anti-faits-fictifs que
 * OBSERVATION) : jamais de paraphrase LLM. `factNature` reste `null` tant que
 * l'humain n'a pas choisi entre information actuelle et connaissance durable —
 * ce choix n'est jamais déduit ici. `canonicalSubjectId` n'est pas exigé en V1.
 */
export function buildFactProposal(params: {
  question: string
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
}): CopilotProposal {
  const { question, canonicalSubjectId, canonicalSubjectLabel } = params

  const title = buildTitle(question, 'fact', canonicalSubjectLabel)
  const temporality = extractFactTemporality(question)
  const subject = canonicalSubjectLabel
    ? `Reliée au sujet « ${canonicalSubjectLabel} ».`
    : "Sans sujet canonique associé."
  const whyText = `${subject} Choisissez si cette information est vraie en ce moment ou durablement avant de valider.`

  return {
    proposalId: crypto.randomUUID(),
    kind: 'fact',
    title,
    body: question.trim(),
    canonicalSubjectId,
    canonicalSubjectLabel,
    confidence: 'medium',
    whyText,
    llmModel: COPILOT_LLM_MODEL,
    promptVersion: COPILOT_PROMPT_VERSION,
    scheduledDate: null,
    scheduledTime: null,
    scheduledObjective: null,
    observationTemporality: null,
    observationActorLabel: null,
    aliasText: null,
    aliasTargetKind: null,
    aliasTargetId: null,
    aliasTargetLabel: null,
    aliasNature: null,
    factNature: null,
    factTemporality: temporality,
  }
}
