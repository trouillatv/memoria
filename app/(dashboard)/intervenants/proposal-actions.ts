'use server'

// Actions org de la file « Acteurs à confirmer » (manager/admin). Elles COMPOSENT
// des briques existantes — jamais un second flux : createOrgFieldPerson (créer une
// personne), findOrCreateCompanyByName (créer/dédupliquer une entreprise),
// openSiteIntervenant (casting facultatif et EXPLICITE), dismissProposal (écarter),
// puis confirmActorProposal marque la proposition confirmée + la relie à l'acteur.
// Aucun compte Auth, aucun rôle applicatif. Isolation stricte par organisation.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { createOrgFieldPerson } from '@/lib/db/team-field-members'
import { findOrCreateCompanyByName, findOrCreatePlaceholderCompany } from '@/lib/db/companies'
import { openSiteIntervenant } from '@/lib/db/site-intervenants'
import { dismissProposal } from '@/lib/db/knowledge-proposals'
import {
  confirmActorProposal, getActorProposalForConfirm, getContactCompanyInOrg,
  companyInOrg, siteInOrg, searchOrgActorTargets, type ActorTarget,
} from '@/lib/db/actor-proposals'
import { logAuditEvent } from '@/lib/audit/log'

type Guard = { ok: true; userId: string; orgIds: string[] } | { ok: false; error: string }

/** Manager/admin uniquement (jamais chef_equipe, cf. surface Acteurs) + org active. */
async function guard(): Promise<Guard> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { ok: false, error: 'Accès refusé' }
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return { ok: false, error: 'Aucune organisation active' }
  return { ok: true, userId: user.id, orgIds }
}

const confirmSchema = z.object({
  proposalId: z.string().uuid(),
  mode: z.enum(['create_person', 'create_company', 'associate_contact', 'associate_company']),
  fullName: z.string().trim().max(120).optional(),
  job: z.string().trim().max(80).optional(),
  companyName: z.string().trim().max(120).optional(),
  email: z.string().trim().email('E-mail invalide').max(160).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  isInternalAgent: z.boolean().optional(),
  teamIds: z.array(z.string().uuid()).max(20).optional(),
  targetId: z.string().uuid().optional(),
  /** Casting sur le chantier source : décision EXPLICITE, jamais automatique. */
  castOnSite: z.boolean().optional(),
  role: z.string().trim().max(80).optional(),
})

export type ConfirmActorProposalInput = z.input<typeof confirmSchema>

export interface ConfirmActorProposalResult {
  ok: boolean
  error?: string
  /** L'acteur (personne/entreprise/casting) résultant, pour feedback. */
  actorKind?: 'person' | 'company'
}

export async function confirmActorProposalAction(input: ConfirmActorProposalInput): Promise<ConfirmActorProposalResult> {
  const g = await guard()
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = confirmSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  const p = parsed.data

  const proposal = await getActorProposalForConfirm(p.proposalId, g.orgIds)
  if (!proposal) return { ok: false, error: 'Proposition introuvable ou déjà traitée' }

  // ── Résoudre l'acteur (identité réutilisable) ──────────────────────────────
  let promotedType: 'company_contact' | 'company'
  let promotedId: string
  let contactId: string | null = null
  let companyId: string | null = null
  let actorKind: 'person' | 'company'

  if (p.mode === 'create_person') {
    const fullName = (p.fullName ?? proposal.title).trim()
    const res = await createOrgFieldPerson({
      orgId: proposal.orgId,
      fullName,
      job: p.job ?? null,
      companyName: p.companyName ?? null,
      email: p.email || null,
      phone: p.phone ?? null,
      isInternalAgent: p.isInternalAgent ?? false,
      teamIds: p.teamIds,
      createdBy: g.userId,
    })
    if (!res.ok) return { ok: false, error: res.error }
    contactId = res.contactId
    promotedType = 'company_contact'; promotedId = res.contactId; actorKind = 'person'
  } else if (p.mode === 'associate_contact') {
    if (!p.targetId) return { ok: false, error: 'Sélectionnez la personne à associer' }
    const c = await getContactCompanyInOrg(p.targetId, g.orgIds)
    if (!c) return { ok: false, error: 'Personne introuvable dans votre organisation' }
    contactId = p.targetId; companyId = c.companyId
    promotedType = 'company_contact'; promotedId = p.targetId; actorKind = 'person'
  } else if (p.mode === 'create_company') {
    const name = (p.companyName ?? proposal.title).trim()
    if (!name) return { ok: false, error: 'Le nom de l’entreprise est requis' }
    // findOrCreateCompanyByName dédoublonne par nom normalisé : « créer » une
    // entreprise déjà connue l'associe (pas de doublon).
    companyId = await findOrCreateCompanyByName(proposal.orgId, name)
    promotedType = 'company'; promotedId = companyId; actorKind = 'company'
  } else {
    // associate_company
    if (!p.targetId) return { ok: false, error: 'Sélectionnez l’entreprise à associer' }
    if (!(await companyInOrg(p.targetId, g.orgIds))) return { ok: false, error: 'Entreprise introuvable dans votre organisation' }
    companyId = p.targetId
    promotedType = 'company'; promotedId = p.targetId; actorKind = 'company'
  }

  // ── Casting FACULTATIF et explicite sur le chantier source ──────────────────
  if (p.castOnSite) {
    const role = (p.role ?? '').trim()
    if (!role) return { ok: false, error: 'Indiquez le rôle pour l’ajout au casting' }
    // Vérifier le rattachement au chantier source (isolation stricte).
    if (!(await siteInOrg(proposal.siteId, g.orgIds))) return { ok: false, error: 'Chantier source hors de votre organisation' }
    // Le casting n'exige PLUS d'entreprise (mig 320, P0-3C) : une personne sans
    // entreprise est une participation au niveau 3 — company_id reste NULL,
    // aucune entreprise d'attente n'est inventée. C'était le DERNIER créateur
    // implicite de placeholder ; « À identifier » ne naît plus nulle part.
    let castCompanyId: string | null = companyId
    if (!castCompanyId && p.companyName?.trim()) {
      castCompanyId = await findOrCreateCompanyByName(proposal.orgId, p.companyName.trim())
    }
    const intervenantId = await openSiteIntervenant({
      siteId: proposal.siteId,
      role,
      companyId: castCompanyId,
      mainContactId: contactId,
      sourceReportId: proposal.reportId,
    })
    // Le casting devient l'objet promu (relie à la mention exacte).
    const confirmed = await confirmActorProposal({ proposalId: p.proposalId, orgIds: g.orgIds, promotedType: 'site_intervenant', promotedId: intervenantId, reviewedBy: g.userId })
    if (!confirmed.ok) return { ok: false, error: 'Proposition déjà traitée' }
  } else {
    const confirmed = await confirmActorProposal({ proposalId: p.proposalId, orgIds: g.orgIds, promotedType, promotedId, reviewedBy: g.userId })
    if (!confirmed.ok) return { ok: false, error: 'Proposition déjà traitée' }
  }

  await logAuditEvent({
    userId: g.userId,
    entityType: 'site',
    entityId: proposal.id,
    action: 'updated',
    metadata: {
      kind: 'actor_proposal_confirmed',
      proposal_id: proposal.id,
      mode: p.mode,
      cast_on_site: !!p.castOnSite,
      actor_kind: actorKind,
    },
  })
  revalidatePath('/intervenants')
  return { ok: true, actorKind }
}

const dismissSchema = z.object({ proposalId: z.string().uuid(), reason: z.string().trim().max(200).optional() })

export async function dismissActorProposalAction(input: { proposalId: string; reason?: string }): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = dismissSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Champs invalides' }
  // Résout l'org de la proposition (garde fail-closed) avant d'écarter.
  const proposal = await getActorProposalForConfirm(parsed.data.proposalId, g.orgIds)
  if (!proposal) return { ok: false, error: 'Proposition introuvable ou déjà traitée' }
  await dismissProposal(parsed.data.proposalId, g.userId, parsed.data.reason, proposal.orgId)
  await logAuditEvent({
    userId: g.userId,
    entityType: 'site',
    entityId: proposal.id,
    action: 'updated',
    metadata: { kind: 'actor_proposal_dismissed', proposal_id: proposal.id },
  })
  revalidatePath('/intervenants')
  return { ok: true }
}

export async function searchActorTargetsAction(input: { query: string }): Promise<{ ok: true; hits: ActorTarget[] } | { ok: false; error: string }> {
  const g = await guard()
  if (!g.ok) return { ok: false, error: g.error }
  const q = (input.query ?? '').trim()
  if (q.length < 2) return { ok: true, hits: [] }
  const hits = await searchOrgActorTargets(g.orgIds, q)
  return { ok: true, hits }
}
