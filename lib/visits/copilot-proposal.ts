// Copilote 3C — types et builder déterministe de propositions.
//
// Principe : le classifieur détecte une intention d'écriture et résout le sujet.
// Ce module construit le brouillon affiché à l'utilisateur.
// AUCUNE écriture DB ici — le brouillon est éditable avant confirmation humaine.

import { formatScheduleLabel, parseScheduleFromQuestion } from '@/lib/visits/copilot-schedule-parse'
import { detectIntent, extractObservationMarker, extractFactTemporality } from '@/lib/visits/copilot-intent-router'
import { CHOOSABLE_KNOWLEDGE_KINDS, type KnowledgeEntryKind } from '@/lib/db/site-memory-entries'
import type { RelationClaimType } from '@/lib/visits/copilot-relation-claim'

export type CopilotProposalKind =
  | 'action'
  | 'visit_item'
  | 'schedule_visit'
  | 'schedule_meeting'
  | 'observation'
  | 'fact'
  | 'actor_alias'
  | 'relation_claim'
  | 'watchpoint'
  | 'deadline'
  | 'reserve'
  | 'knowledge_supersession'
  | 'knowledge_archive'

// Libellé court affiché partout où une proposition doit s'identifier sans sa
// carte complète (bandeau de propositions en attente de l'orbe vocal, etc.) —
// un seul point de vérité pour ne pas faire diverger le vocabulaire entre
// surfaces (Vincent, Lot A propositions vocales, 2026-08-18).
export const COPILOT_PROPOSAL_KIND_LABELS: Record<CopilotProposalKind, string> = {
  action: 'Action',
  visit_item: 'Point de visite',
  schedule_visit: 'Visite',
  schedule_meeting: 'Réunion',
  observation: 'Constat',
  fact: 'Information',
  actor_alias: "Correspondance d'identité",
  relation_claim: 'Relation entre sujets',
  watchpoint: 'Point à surveiller',
  deadline: 'Échéance',
  reserve: 'Réserve',
  knowledge_supersession: "Correction d'information",
  knowledge_archive: 'Information obsolète',
}

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
  // Champs RELATION_CLAIM — non nuls uniquement pour kind = 'relation_claim' (P4-D1).
  // Les deux sujets sont déjà résolus avec certitude avant l'appel du builder
  // (ambiguïté/absence → clarification en amont, jamais ici, cf. copilot-free-prepare.ts).
  relationType: RelationClaimType | null
  relationSourceSubjectId: string | null
  relationSourceSubjectLabel: string | null
  relationTargetSubjectId: string | null
  relationTargetSubjectLabel: string | null
  // Champ CREATE_DEADLINE — non nul uniquement pour kind = 'deadline' (P4-E2).
  // null = « à planifier » (état valide, mig 215) — jamais une date inventée ;
  // `body` porte la phrase verbatim et mappe directement sur constraint_text.
  deadlineDueDate: string | null    // yyyy-mm-dd (Pacific/Noumea) ou null
  // Champ CREATE_ACTION — non nul uniquement pour kind = 'action' (P5-F1).
  // null = pas d'échéance détectée dans la phrase (état valide) — jamais une
  // date inventée ; éditable sur le brouillon avant confirmation, comme
  // deadlineDueDate.
  actionDueDate: string | null      // yyyy-mm-dd (Pacific/Noumea) ou null
  // Champ CORRECTION_KNOWLEDGE — non nul uniquement pour kind =
  // 'knowledge_supersession' | 'knowledge_archive' (P5-F2b). Candidats
  // proposés SANS présélection : l'humain choisit, jamais le LLM/routeur
  // (cadrage Vincent) — max 5, ordre = listRecentCurrentInformationEntries.
  // Pour 'knowledge_supersession', la nouvelle information vit dans
  // `title`/`body` (mêmes champs communs que FACT), éditable avant validation.
  knowledgeCandidates: KnowledgeCorrectionCandidate[] | null
}

export type KnowledgeCorrectionCandidate = {
  id: string
  title: string
  body: string | null
  confirmedAt: string
}

// kind = 'reserve' (P4-E3) ne requiert aucun champ dédié : title/body portent
// la réserve, canonicalSubjectId/Label restent l'enrichissement optionnel déjà
// défini plus haut (même doctrine que WATCHPOINT/FACT). Pas de gravité, pas de
// due_date, pas de responsable personne (issuedBy toujours null à l'écriture,
// cf. confirmSiteReserve) — cadrage Vincent explicite.

// kind = 'watchpoint' (P4-E1) ne requiert aucun champ dédié : title/body
// portent le point de vigilance, canonicalSubjectId/Label restent
// l'enrichissement optionnel déjà défini plus haut (même doctrine que FACT —
// jamais de FK bloquante). La phrase de clôture montrée à l'utilisateur
// (« Ce point restera actif… ») est fixe et vit dans WatchpointProposalCard,
// pas dans la donnée du brouillon.

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
  CORRECTION_KNOWLEDGE: 'knowledge_supersession',
  RELATION_CLAIM:   'relation_claim',
  CREATE_WATCHPOINT: 'watchpoint',
  CREATE_DEADLINE:  'deadline',
  CREATE_RESERVE:   'reserve',
}

/** Délègue au routeur centralisé et mappe vers CopilotProposalKind. */
export function detectKind(question: string): CopilotProposalKind {
  const { intent } = detectIntent(question)
  return INTENT_TO_KIND[intent] ?? 'action'
}

// ── Builders ──────────────────────────────────────────────────────────────────

// Verbes de vigilance en tête de phrase ("Surveille…", "Garde un œil sur…") —
// strippés UNIQUEMENT pour kind = 'watchpoint', avant le strip générique
// ci-dessous : ni "cr[eé]e"/"ajoute" ni "surveille"/"garde" ne se recouvrent,
// chaque kind ne subit que le strip qui le concerne.
const WATCHPOINT_TITLE_PREFIX_RE =
  /^(?:surveill[a-zé]*|garde[zr]?\s+(?:un\s+)?(?:a\s+l['’]?\s*)?(?:œil|oeil)(?:\s+sur)?)\s*/i

function buildTitle(question: string, kind: CopilotProposalKind, subjectLabel: string | null): string {
  if (kind === 'visit_item' && subjectLabel) return `Vérifier : ${subjectLabel}`
  let source = question.trim()
  if (kind === 'watchpoint') source = source.replace(WATCHPOINT_TITLE_PREFIX_RE, '')
  const clean = source
    .replace(/^(cr[eé]e[rz]?|ajoute[rz]?|planifie[rz]?|note[rz]?|programme[rz]?|mets?\s+en\s+plan)\s+/i, '')
    .replace(/^(une?\s+|l[ae]\s+)/i, '')
  const clipped = clean.length > 90 ? clean.slice(0, 87) + '…' : clean
  const label = clipped.charAt(0).toUpperCase() + clipped.slice(1)
  if (label) return label
  if (kind === 'visit_item') return 'Point à vérifier'
  if (kind === 'fact') return 'Nouvelle information'
  if (kind === 'watchpoint') return 'Point à surveiller'
  if (kind === 'deadline') return 'Nouvelle échéance'
  if (kind === 'reserve') return 'Nouvelle réserve'
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
  const actionDueDate = kind === 'action' ? (parseScheduleFromQuestion(question)?.date ?? null) : null

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
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: null,
    actionDueDate,
    knowledgeCandidates: null,
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
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: null,
    actionDueDate: null,
    knowledgeCandidates: null,
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
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: null,
    actionDueDate: null,
    knowledgeCandidates: null,
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
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: null,
    actionDueDate: null,
    knowledgeCandidates: null,
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
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: null,
    actionDueDate: null,
    knowledgeCandidates: null,
  }
}

// Libellés d'affichage français pour chaque relation_type (mig 316) — utilisés
// UNIQUEMENT en présentation (title/whyText), jamais en persistance : la valeur
// écrite reste toujours l'enum anglais canonical_subject_links.relation_type.
const RELATION_TYPE_LABEL_FR: Record<RelationClaimType, string> = {
  requires:  'dépend de',
  enables:   'permet',
  validates: 'valide',
  causes:    'cause',
  replaces:  'remplace',
}

/**
 * Builder dédié aux relations entre deux sujets canoniques (RELATION_CLAIM, P4-D1).
 *
 * Les deux sujets DOIVENT déjà être résolus avec certitude par l'appelant —
 * ambiguïté ou absence de résolution sur l'un des deux = clarification en
 * amont, jamais d'appel à ce builder (garantie du mandat Vincent 2026-08-17).
 * `body` porte la phrase source verbatim : c'est elle qui devient
 * `canonical_subject_link_evidence.evidence_text` à la confirmation — jamais
 * une reformulation.
 */
export function buildRelationClaimProposal(params: {
  question: string
  relationType: RelationClaimType
  sourceSubjectId: string
  sourceSubjectLabel: string
  targetSubjectId: string
  targetSubjectLabel: string
}): CopilotProposal {
  const { question, relationType, sourceSubjectId, sourceSubjectLabel, targetSubjectId, targetSubjectLabel } = params

  const verbLabel = RELATION_TYPE_LABEL_FR[relationType]
  const title = `${sourceSubjectLabel} ${verbLabel} ${targetSubjectLabel}`
  const whyText = `Relation « ${verbLabel} » entre « ${sourceSubjectLabel} » et « ${targetSubjectLabel} », d'après votre phrase. Sera enregistrée immédiatement comme confirmée (pas une suggestion).`

  return {
    proposalId: crypto.randomUUID(),
    kind: 'relation_claim',
    title,
    body: question.trim(),
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
    aliasText: null,
    aliasTargetKind: null,
    aliasTargetId: null,
    aliasTargetLabel: null,
    aliasNature: null,
    factNature: null,
    factTemporality: null,
    relationType,
    relationSourceSubjectId: sourceSubjectId,
    relationSourceSubjectLabel: sourceSubjectLabel,
    relationTargetSubjectId: targetSubjectId,
    relationTargetSubjectLabel: targetSubjectLabel,
    deadlineDueDate: null,
    actionDueDate: null,
    knowledgeCandidates: null,
  }
}

/**
 * Builder dédié aux points de vigilance (CREATE_WATCHPOINT, P4-E1).
 *
 * `body` porte le texte source verbatim (même doctrine anti-faits-fictifs que
 * FACT/OBSERVATION). `canonicalSubjectId` reste un enrichissement optionnel,
 * jamais requis — même doctrine que FACT : si la résolution de sujet est
 * ambiguë ou absente, la vigilance se crée quand même, sans lien.
 *
 * Cette proposition naît TOUJOURS 'active' — la fermeture (résolu/converti en
 * réserve) reste un geste humain exclusif, jamais proposé ni décidé ici.
 */
export function buildWatchpointProposal(params: {
  question: string
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
}): CopilotProposal {
  const { question, canonicalSubjectId, canonicalSubjectLabel } = params

  const title = buildTitle(question, 'watchpoint', canonicalSubjectLabel)
  const subject = canonicalSubjectLabel
    ? `Relié au sujet « ${canonicalSubjectLabel} ».`
    : "Sans sujet canonique associé."
  const whyText = `${subject} Restera actif sur le chantier jusqu'à ce que vous le marquiez résolu — aucune fermeture automatique.`

  return {
    proposalId: crypto.randomUUID(),
    kind: 'watchpoint',
    title,
    body: question.trim(),
    canonicalSubjectId,
    canonicalSubjectLabel,
    confidence: canonicalSubjectId ? 'strong' : 'medium',
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
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: null,
    actionDueDate: null,
    knowledgeCandidates: null,
  }
}

/**
 * Builder dédié aux échéances (CREATE_DEADLINE, P4-E2).
 *
 * `body` porte le texte source verbatim (même doctrine anti-faits-fictifs que
 * FACT/WATCHPOINT) et devient `constraint_text` à la confirmation — jamais une
 * reformulation. `deadlineDueDate` est extrait par le même parseur que
 * SCHEDULE_VISIT/SCHEDULE_MEETING ; `null` reste un état valide (« à
 * planifier », doctrine mig 215), jamais une date inventée. Aucun sujet requis
 * en V1 (audit p4-e2-audit-deadline : `createSiteDeadline` n'expose pas de
 * `subject_id`, aucune colonne `canonical_subject_id` n'existe sur
 * `site_deadlines`) — `canonicalSubjectId` reste un enrichissement d'affichage
 * optionnel, même doctrine que FACT/WATCHPOINT.
 */
export function buildDeadlineProposal(params: {
  question: string
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
}): CopilotProposal {
  const { question, canonicalSubjectId, canonicalSubjectLabel } = params

  const title = buildTitle(question, 'deadline', canonicalSubjectLabel)
  const dueDate = parseScheduleFromQuestion(question)?.date ?? null
  const subject = canonicalSubjectLabel
    ? `Reliée au sujet « ${canonicalSubjectLabel} ».`
    : "Sans sujet canonique associé."
  let whyText = `${subject} Sera enregistrée comme échéance sur ce chantier.`
  if (!dueDate) whyText += ' Pensez à préciser la date avant de valider, ou laissez « à planifier ».'

  return {
    proposalId: crypto.randomUUID(),
    kind: 'deadline',
    title,
    body: question.trim(),
    canonicalSubjectId,
    canonicalSubjectLabel,
    confidence: canonicalSubjectId ? 'strong' : 'medium',
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
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: dueDate,
    actionDueDate: null,
    knowledgeCandidates: null,
  }
}

/**
 * Builder dédié aux réserves (CREATE_RESERVE, P4-E3).
 *
 * `body` porte le texte source verbatim (même doctrine anti-faits-fictifs que
 * FACT/WATCHPOINT/DEADLINE). Aucun champ de gravité, de date d'échéance ou de
 * responsable — cadrage Vincent explicite : `issuedBy` reste toujours null à
 * l'écriture (confirmSiteReserve), `issuedOn` est daté du jour de création,
 * jamais un champ du brouillon. `canonicalSubjectId` reste un enrichissement
 * d'affichage optionnel, même doctrine que FACT/WATCHPOINT/DEADLINE —
 * `site_reserve` n'a pas de colonne `canonical_subject_id`.
 */
export function buildReserveProposal(params: {
  question: string
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
}): CopilotProposal {
  const { question, canonicalSubjectId, canonicalSubjectLabel } = params

  const title = buildTitle(question, 'reserve', canonicalSubjectLabel)
  const subject = canonicalSubjectLabel
    ? `Reliée au sujet « ${canonicalSubjectLabel} ».`
    : "Sans sujet canonique associé."
  const whyText = `${subject} Sera enregistrée comme réserve ouverte sur ce chantier.`

  return {
    proposalId: crypto.randomUUID(),
    kind: 'reserve',
    title,
    body: question.trim(),
    canonicalSubjectId,
    canonicalSubjectLabel,
    confidence: canonicalSubjectId ? 'strong' : 'medium',
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
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: null,
    actionDueDate: null,
    knowledgeCandidates: null,
  }
}

/**
 * Builder dédié à la supersession d'une information mémorisée (CORRECTION_KNOWLEDGE,
 * mode 'supersede', P5-F2b).
 *
 * `candidates` sont les entrées `current_information` actives proposées à
 * l'utilisateur, SANS présélection — cf. listRecentCurrentInformationEntries.
 * `title`/`body` portent la nouvelle information verbatim (même doctrine
 * anti-faits-fictifs que FACT), éditable avant confirmation. L'écriture réelle
 * (choix du candidat remplacé, ou création indépendante via « Aucune de
 * celles-ci ») se décide sur la carte, jamais ici.
 */
export function buildKnowledgeSupersessionProposal(params: {
  newTitle: string
  candidates: KnowledgeCorrectionCandidate[]
}): CopilotProposal {
  const { newTitle, candidates } = params

  const title = newTitle || 'Nouvelle information'
  const whyText = candidates.length > 0
    ? `Correction détectée. Choisissez quelle information actuelle remplacer parmi les ${candidates.length} plus récente(s), ou « Aucune de celles-ci » pour créer une information indépendante.`
    : "Correction détectée, mais aucune information actuelle n'est enregistrée sur ce chantier — sera créée comme information indépendante."

  return {
    proposalId: crypto.randomUUID(),
    kind: 'knowledge_supersession',
    title,
    body: null,
    canonicalSubjectId: null,
    canonicalSubjectLabel: null,
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
    factTemporality: null,
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: null,
    actionDueDate: null,
    knowledgeCandidates: candidates,
  }
}

/**
 * Builder dédié à l'archivage d'une information mémorisée (CORRECTION_KNOWLEDGE,
 * mode 'archive', P5-F2b).
 *
 * Aucune nouvelle valeur à saisir — seulement le choix du candidat à marquer
 * obsolète, SANS présélection, même doctrine que la supersession ci-dessus.
 */
export function buildKnowledgeArchiveProposal(params: {
  candidates: KnowledgeCorrectionCandidate[]
}): CopilotProposal {
  const { candidates } = params

  const whyText = candidates.length > 0
    ? `Obsolescence détectée. Choisissez quelle information actuelle marquer comme obsolète parmi les ${candidates.length} plus récente(s).`
    : "Obsolescence détectée, mais aucune information actuelle n'est enregistrée sur ce chantier."

  return {
    proposalId: crypto.randomUUID(),
    kind: 'knowledge_archive',
    title: 'Marquer une information comme obsolète',
    body: null,
    canonicalSubjectId: null,
    canonicalSubjectLabel: null,
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
    factTemporality: null,
    relationType: null,
    relationSourceSubjectId: null,
    relationSourceSubjectLabel: null,
    relationTargetSubjectId: null,
    relationTargetSubjectLabel: null,
    deadlineDueDate: null,
    actionDueDate: null,
    knowledgeCandidates: candidates,
  }
}
