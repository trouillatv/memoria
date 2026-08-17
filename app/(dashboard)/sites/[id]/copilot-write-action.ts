'use server'

// Copilote 3C — Server Actions de confirmation.
// Invariant : AUCUNE écriture sans confirmation explicite de l'utilisateur.
// Chaque action est idempotente via copilot_proposal_id (UNIQUE en base).

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { upsertPreparationItem } from '@/lib/db/visit-preparation'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'
import { confirmActorAlias } from '@/lib/db/actor-alias-write'
import { confirmSiteFact } from '@/lib/db/site-fact-write'
import { confirmSiteRelation } from '@/lib/db/canonical-subject-link-write'
import { confirmSiteWatchpoint } from '@/lib/db/site-watchpoint-write'
import { confirmSiteDeadline } from '@/lib/db/site-deadline-write'
import { confirmSiteReserve } from '@/lib/db/site-reserve-write'
import { confirmSiteAction } from '@/lib/db/site-action-write'
import { confirmScheduledEvent } from '@/lib/db/site-scheduled-event-write'
import { confirmSiteObservation } from '@/lib/db/site-observation-write'
import { supersedeKnowledgeEntry, archiveKnowledgeEntry } from '@/lib/db/site-memory-entries'

// ── Créer une action depuis une proposition copilote ─────────────────────────

const createActionSchema = z.object({
  siteId: z.string().uuid(),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  canonicalSubjectId: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  copilotProposalId: z.string().uuid(),
  llmModel: z.string().max(100),
  promptVersion: z.string().max(50),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotActionResult =
  | { ok: true; actionId: string }
  | { ok: false; error: string }

export async function createCopilotAction(rawInput: unknown): Promise<CreateCopilotActionResult> {
  const parsed = createActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  // canonicalSubjectId : site_actions n'a pas de colonne dédiée à l'écriture copilote
  // (même divergence que FACT/WATCHPOINT/DEADLINE) — reste un enrichissement d'affichage.
  const { siteId, title, body, dueDate, copilotProposalId, llmModel, promptVersion, interactionId } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteAction({
    siteId,
    userId: user.id,
    title,
    body: body ?? null,
    dueDate: dueDate ?? null,
    copilotProposalId,
    llmModel,
    promptVersion,
    interactionId: interactionId ?? null,
  })
}

// ── Ajouter au plan de visite depuis une proposition copilote ────────────────

const addToBriefingSchema = z.object({
  siteId: z.string().uuid(),
  label: z.string().min(1).max(255),
  canonicalSubjectId: z.string().uuid().nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
  reason: z.string().max(500).optional(),
})

export type AddCopilotToBriefingResult =
  | { ok: true }
  | { ok: false; error: string }

export async function addCopilotToBriefing(rawInput: unknown): Promise<AddCopilotToBriefingResult> {
  const parsed = addToBriefingSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, label, canonicalSubjectId, copilotProposalId, interactionId, reason } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  const orgIds = await getOrgIdsOfUser().catch(() => [] as string[])
  if (orgIds.length === 0) return { ok: false, error: 'Organisation introuvable.' }

  try {
    await upsertPreparationItem({
      siteId,
      organizationId: orgIds[0],
      stableKey: `copilot:${copilotProposalId}`,
      label,
      sourceKind: 'copilot_suggestion',
      sourceRef: copilotProposalId,
      canonicalSubjectId: canonicalSubjectId ?? null,
      priority: 'normal',
      reason: reason ?? 'Proposé par le Copilote',
      preparedBy: user.id,
    })
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true }
}

// ── Planifier un événement depuis une proposition copilote ────────────────────

const createScheduledEventSchema = z.object({
  siteId: z.string().uuid(),
  type: z.enum(['visit', 'meeting']),
  title: z.string().min(1).max(255),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format de date invalide (yyyy-mm-dd)'),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)'),
  objective: z.string().max(500).nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotScheduledEventResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string }

export async function createCopilotScheduledEvent(
  rawInput: unknown,
): Promise<CreateCopilotScheduledEventResult> {
  const parsed = createScheduledEventSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, type, title, scheduledDate, scheduledTime, objective, copilotProposalId, interactionId } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmScheduledEvent({
    siteId,
    userId: user.id,
    type,
    title,
    scheduledDate,
    scheduledTime,
    objective: objective ?? null,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Enregistrer un constat OBSERVATION depuis une proposition copilote ───────
//
// P4-A — canal séparé des 3 actions ci-dessus : écrit directement dans
// canonical_subject_occurrence (source_kind='copilot', mig 326), pas dans
// site_actions/visit_preparation/site_scheduled_events. canonical_subject_id
// est NOT NULL en base : un constat sans sujet résolu ne peut pas être
// confirmé (le brouillon n'est même pas construit dans ce cas, voir
// copilot-free-prepare.ts). validation_status='confirmed' d'emblée : cette
// action ne s'exécute qu'après confirmation humaine explicite. Aucune écriture
// de lastMeaningfulChangeAt ici — la doctrine Fact Ledger décide "évolution ou
// pas" après matérialisation, jamais à l'écriture.

const createObservationSchema = z.object({
  siteId: z.string().uuid(),
  canonicalSubjectId: z.string().uuid(),
  label: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotObservationResult =
  | { ok: true; occurrenceId: string }
  | { ok: false; error: string }

export async function createCopilotObservation(rawInput: unknown): Promise<CreateCopilotObservationResult> {
  const parsed = createObservationSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, canonicalSubjectId, label, body, copilotProposalId, interactionId } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteObservation({
    siteId,
    userId: user.id,
    canonicalSubjectId,
    label,
    body: body ?? null,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Confirmer une correspondance d'identité d'acteur (P4-B.2) ───────────────
//
// « Retenir que "Clim Expert" désigne Clim Expair ? » → actor_alias(status=
// 'confirmed'). La cible (company OU company_contact) doit déjà exister —
// cette action ne crée jamais d'acteur, elle enregistre une correspondance.
//
// Correction #2 (Vincent, mandat P4-B.2) : ne JAMAIS faire confiance à un
// organization_id transmis par le client. `organizationId` vient uniquement
// de `requireSiteAccess`, et la cible est revérifiée serveur pour confirmer
// qu'elle appartient bien à cette organisation avant toute écriture.

const createActorAliasSchema = z.object({
  siteId: z.string().uuid(),
  alias: z.string().min(1).max(255),
  targetKind: z.enum(['company', 'contact']),
  targetId: z.string().uuid(),
  aliasNature: z.enum(['business_alias', 'transcription_alias']),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotActorAliasResult =
  | { ok: true; aliasId: string }
  | { ok: false; error: string }

export async function createCopilotActorAlias(rawInput: unknown): Promise<CreateCopilotActorAliasResult> {
  const parsed = createActorAliasSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, alias, targetKind, targetId, aliasNature, copilotProposalId, interactionId } = parsed.data

  let organizationId: string
  try {
    const access = await requireSiteAccess(siteId)
    organizationId = access.organizationId
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmActorAlias({
    organizationId,
    userId: user.id,
    alias,
    targetKind,
    targetId,
    aliasNature,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Retenir une information depuis une proposition copilote (P4-C, FACT) ────
//
// La nature (current_information / durable_knowledge) est choisie par
// l'humain sur le brouillon — jamais déduite ici ni en amont. Écrit
// directement dans site_knowledge_entries, pas de résolution de sujet
// requise en V1 (cadrage Vincent).

const createFactSchema = z.object({
  siteId: z.string().uuid(),
  kind: z.enum(['current_information', 'durable_knowledge']),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotFactResult =
  | { ok: true; entryId: string }
  | { ok: false; error: string }

export async function createCopilotFact(rawInput: unknown): Promise<CreateCopilotFactResult> {
  const parsed = createFactSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, kind, title, body, copilotProposalId, interactionId } = parsed.data

  let organizationId: string
  try {
    const access = await requireSiteAccess(siteId)
    organizationId = access.organizationId
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteFact({
    organizationId,
    siteId,
    userId: user.id,
    kind,
    title,
    body: body ?? null,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Confirmer une relation entre deux sujets (P4-D1, RELATION_CLAIM) ────────
//
// « Le SSI dépend de la mise sous tension » → canonical_subject_links,
// status='confirmed' d'emblée (l'utilisateur affirme ET valide lui-même —
// pas une suggestion statistique du moteur P0-B1). evidenceText = phrase
// verbatim de l'utilisateur (invariant canonical_subject_link_evidence.
// evidence_text, mig 316). Aucune résolution ni création de sujet ici : les
// deux id ont déjà été résolus avec certitude dans copilot-free-prepare.ts.

const createRelationClaimSchema = z.object({
  siteId: z.string().uuid(),
  relationType: z.enum(['requires', 'enables', 'validates', 'causes', 'replaces']),
  sourceSubjectId: z.string().uuid(),
  targetSubjectId: z.string().uuid(),
  evidenceText: z.string().min(1).max(2000),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotRelationClaimResult =
  | { ok: true; linkId: string }
  | { ok: false; error: string }

export async function createCopilotRelationClaim(rawInput: unknown): Promise<CreateCopilotRelationClaimResult> {
  const parsed = createRelationClaimSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, relationType, sourceSubjectId, targetSubjectId, evidenceText, copilotProposalId, interactionId } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteRelation({
    siteId,
    userId: user.id,
    relationType,
    sourceSubjectId,
    targetSubjectId,
    evidenceText,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Retenir un point de vigilance depuis une proposition copilote (P4-E1) ───
//
// « Surveille le SSI tant que ce n'est pas réglé » → site_watchpoints,
// status='active' (défaut de la table). Aucune nature à choisir (contrairement
// à FACT) : un point de vigilance n'a qu'une seule forme. Pas de résolution ni
// de FK de sujet ici — même doctrine que FACT (canonicalSubjectId reste un
// enrichissement d'affichage du brouillon, jamais persisté). La fermeture
// (résolu/converti en réserve) reste un geste humain exclusif, hors périmètre
// de cette action.

const createWatchpointSchema = z.object({
  siteId: z.string().uuid(),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotWatchpointResult =
  | { ok: true; watchpointId: string }
  | { ok: false; error: string }

export async function createCopilotWatchpoint(rawInput: unknown): Promise<CreateCopilotWatchpointResult> {
  const parsed = createWatchpointSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, title, body, copilotProposalId, interactionId } = parsed.data

  let organizationId: string
  try {
    const access = await requireSiteAccess(siteId)
    organizationId = access.organizationId
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteWatchpoint({
    organizationId,
    siteId,
    userId: user.id,
    title,
    body: body ?? null,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Créer une échéance depuis une proposition copilote (P4-E2) ──────────────
//
// « Le SSI doit être réglé avant vendredi » → site_deadlines. `dueDate` null
// reste un état valide (« à planifier », doctrine mig 215) — jamais rejeté ni
// forcé. Pas de sujet ni de nature à choisir ici — même doctrine que FACT/
// WATCHPOINT (canonicalSubjectId n'existe même pas comme colonne sur
// site_deadlines, audit p4-e2-audit-deadline). `body` (constraint_text) porte
// la phrase verbatim, jamais une date déduite du texte.

const createDeadlineSchema = z.object({
  siteId: z.string().uuid(),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotDeadlineResult =
  | { ok: true; deadlineId: string }
  | { ok: false; error: string }

export async function createCopilotDeadline(rawInput: unknown): Promise<CreateCopilotDeadlineResult> {
  const parsed = createDeadlineSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, title, body, dueDate, copilotProposalId, interactionId } = parsed.data

  let organizationId: string
  try {
    const access = await requireSiteAccess(siteId)
    organizationId = access.organizationId
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteDeadline({
    organizationId,
    siteId,
    userId: user.id,
    title,
    constraintText: body ?? null,
    dueDate: dueDate ?? null,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Créer une réserve depuis une proposition copilote (P4-E3) ───────────────
//
// « Crée une réserve sur le portail cassé » → site_reserve, status='open'
// (défaut de la table). Pas de gravité, pas de date d'échéance, pas de
// responsable (issuedBy reste null — confirmSiteReserve), pas de sujet
// canonique forcé — cadrage Vincent explicite (2026-08-17). Divergence
// délibérée par rapport à WATCHPOINT/DEADLINE ci-dessus : la permission suit
// le flux terrain existant (chef_equipe/manager/admin via
// requireSiteWriteAccess), PAS `requireSiteAccess` (membership seul, sans
// contrôle de rôle) — le formulaire desktop de réserve est manager-only, mais
// le Copilote doit rester utilisable par un chef d'équipe sur le terrain,
// comme pour toute autre proposition Copilote de ce fichier.
//
// Pas de champ `body` ici (contrairement à WATCHPOINT/DEADLINE) : site_reserve
// n'a qu'une colonne `label`, aucune colonne de détail libre — ajouter un tel
// champ serait un nouveau champ métier, hors mandat P4-E3.

const createReserveSchema = z.object({
  siteId: z.string().uuid(),
  title: z.string().min(1).max(255),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotReserveResult =
  | { ok: true; reserveId: string }
  | { ok: false; error: string }

export async function createCopilotReserve(rawInput: unknown): Promise<CreateCopilotReserveResult> {
  const parsed = createReserveSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, title, copilotProposalId, interactionId } = parsed.data

  const access = await requireSiteWriteAccess(siteId, 'operator')
  if (!access.ok) return { ok: false, error: access.error }

  return confirmSiteReserve({
    organizationId: access.organizationId,
    siteId,
    userId: access.userId,
    label: title,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Corriger/périmer une information mémorisée (P5-F2b, CORRECTION_KNOWLEDGE) ─
//
// Deux gestes distincts, deux actions distinctes — même séparation que le
// reste du fichier :
//
//   SUPERSESSION : `oldEntryId` porte le choix de l'utilisateur sur la carte.
//   `null` = « Aucune de celles-ci » → crée une information `current_information`
//   indépendante, EXACTEMENT le chemin FACT (confirmSiteFact), pas un nouveau
//   chemin d'écriture. Un id non nul appelle `supersedeKnowledgeEntry` (RPC
//   transactionnelle mig 334, F2a) : soit la nouvelle entrée existe et
//   l'ancienne est supersédée, soit rien ne change.
//
//   ARCHIVAGE : `entryId` est TOUJOURS requis — pas d'équivalent « Aucune de
//   celles-ci » ici, archiver sans candidat n'a pas de sens. Passe par
//   `archiveKnowledgeEntry` (F2a), déjà idempotent par construction (no-op sur
//   une entrée déjà 'archived'/'superseded').

const createKnowledgeSupersessionSchema = z.object({
  siteId: z.string().uuid(),
  oldEntryId: z.string().uuid().nullable(),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotKnowledgeSupersessionResult =
  | { ok: true; entryId: string }
  | { ok: false; error: string }

export async function createCopilotKnowledgeSupersession(rawInput: unknown): Promise<CreateCopilotKnowledgeSupersessionResult> {
  const parsed = createKnowledgeSupersessionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, oldEntryId, title, body, copilotProposalId, interactionId } = parsed.data

  let organizationId: string
  try {
    const access = await requireSiteAccess(siteId)
    organizationId = access.organizationId
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  if (!oldEntryId) {
    return confirmSiteFact({
      organizationId,
      siteId,
      userId: user.id,
      kind: 'current_information',
      title,
      body: body ?? null,
      copilotProposalId,
      interactionId: interactionId ?? null,
    })
  }

  const result = await supersedeKnowledgeEntry({
    organizationId,
    siteId,
    oldEntryId,
    title,
    body: body ?? null,
    confirmedBy: user.id,
    copilotProposalId,
  })
  if (!result.ok) return { ok: false, error: result.error }
  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true, entryId: result.newEntryId }
}

const createKnowledgeArchiveSchema = z.object({
  siteId: z.string().uuid(),
  entryId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotKnowledgeArchiveResult =
  | { ok: true }
  | { ok: false; error: string }

export async function createCopilotKnowledgeArchive(rawInput: unknown): Promise<CreateCopilotKnowledgeArchiveResult> {
  const parsed = createKnowledgeArchiveSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, entryId, interactionId } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  try {
    await archiveKnowledgeEntry(entryId, siteId)
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Impossible de marquer cette information comme obsolète.' }
  }

  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true }
}
