'use server'

// Création d'un intervenant depuis la surface ACTEURS (parcours transversal).
// Guillaume (manager/admin) crée une personne métier SANS compte, la classe
// (agent interne / contact externe), lui donne éventuellement une entreprise et
// la rattache à zéro, une ou plusieurs équipes — sans ouvrir d'équipe précise.
// AUCUN compte Auth, AUCUN rôle applicatif. La personne peut exister sans équipe.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { createOrgFieldPerson } from '@/lib/db/team-field-members'
import { logAuditEvent } from '@/lib/audit/log'

const schema = z.object({
  fullName: z.string().trim().min(1, 'Le nom est requis').max(120),
  job: z.string().trim().max(80).optional(),
  companyName: z.string().trim().max(120).optional(),
  email: z.string().trim().email('E-mail invalide').max(160).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  isInternalAgent: z.boolean(),
  teamIds: z.array(z.string().uuid()).max(20).optional(),
  organizationId: z.string().uuid().optional(),
})

export interface CreateIntervenantResult {
  ok: boolean
  error?: string
  contactId?: string
  /** Nombre d'équipes dont le rattachement a échoué (la personne est créée quand même). */
  teamsFailed?: number
}

export async function createIntervenantAction(input: {
  fullName: string
  job?: string
  companyName?: string
  email?: string
  phone?: string
  isInternalAgent: boolean
  teamIds?: string[]
  organizationId?: string
}): Promise<CreateIntervenantResult> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  // Surface Acteurs = manager/admin (jamais chef_equipe, qui passe par /equipes).
  if (role !== 'admin' && role !== 'manager') return { ok: false, error: 'Accès refusé' }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }

  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return { ok: false, error: 'Aucune organisation active' }
  let orgId: string
  if (orgIds.length === 1) {
    orgId = orgIds[0]!
  } else {
    if (!parsed.data.organizationId || !orgIds.includes(parsed.data.organizationId)) {
      return { ok: false, error: 'Sélectionnez une organisation' }
    }
    orgId = parsed.data.organizationId
  }

  const res = await createOrgFieldPerson({
    orgId,
    fullName: parsed.data.fullName,
    job: parsed.data.job ?? null,
    companyName: parsed.data.companyName ?? null,
    email: parsed.data.email || null,
    phone: parsed.data.phone ?? null,
    isInternalAgent: parsed.data.isInternalAgent,
    teamIds: parsed.data.teamIds,
    createdBy: user.id,
  })
  if (!res.ok) return { ok: false, error: res.error }

  await logAuditEvent({
    userId: user.id,
    entityType: 'site',
    entityId: res.contactId,
    action: 'created',
    metadata: {
      kind: 'intervenant_created',
      contact_id: res.contactId,
      is_internal_agent: parsed.data.isInternalAgent,
      teams_requested: parsed.data.teamIds?.length ?? 0,
      teams_failed: res.teamsFailed.length,
    },
  })
  revalidatePath('/intervenants')
  if (parsed.data.teamIds?.length) revalidatePath('/equipes')
  return { ok: true, contactId: res.contactId, teamsFailed: res.teamsFailed.length }
}
