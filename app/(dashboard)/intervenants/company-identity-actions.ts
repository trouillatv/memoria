'use server'

// ── IDENTITÉ ENTREPRISE — Renommer / Fusionner avec… (P0-INT-1) ────────────────
// Geste humain EXPLICITE uniquement, jamais un rapprochement automatique/fuzzy
// (doctrine mig 407). « Fusionner avec… » ne détruit rien : l'entreprise choisie
// devient un ALIAS (status='alias' + alias_of_company_id) de l'entreprise cible ;
// ses relations existantes (casting, actions, contacts, sujets) restent inchangées
// et continuent de résoudre vers l'identité canonique partout ailleurs (P0-3A).
// setCompanyAlias/updateCompany/searchOrgCompanies existaient déjà : ce fichier
// n'ajoute qu'un accès manager/admin par server action, aucune nouvelle logique
// d'écriture.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getCompany, updateCompany, setCompanyAlias, searchOrgCompanies, type CompanySearchHit, type Company } from '@/lib/db/companies'
import { logAuditEvent } from '@/lib/audit/log'

type Guard = { ok: true; userId: string; orgIds: string[] } | { ok: false; error: string }

/** Manager/admin uniquement — l'identité entreprise est une donnée structurante
 *  partagée par toute l'organisation, pas un geste terrain. */
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

async function companyInGuardedOrg(companyId: string, orgIds: string[]): Promise<Company | null> {
  const company = await getCompany(companyId)
  if (!company || !company.organizationId || !orgIds.includes(company.organizationId)) return null
  return company
}

const renameSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1, 'Le nom est requis').max(160),
})

export async function renameCompanyAction(input: { companyId: string; name: string }): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = renameSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  const company = await companyInGuardedOrg(parsed.data.companyId, g.orgIds)
  if (!company) return { ok: false, error: 'Entreprise introuvable dans votre organisation' }
  await updateCompany(company.organizationId as string, company.id, { name: parsed.data.name })
  await logAuditEvent({
    userId: g.userId,
    entityType: 'site',
    entityId: company.id,
    action: 'updated',
    metadata: { kind: 'company_renamed', company_id: company.id, previous_name: company.name, new_name: parsed.data.name },
  })
  revalidatePath('/intervenants')
  revalidatePath(`/intervenants/entreprise/${company.id}`)
  return { ok: true }
}

export async function searchCompanyMergeTargetsAction(input: { companyId: string; query: string }): Promise<{ ok: true; hits: CompanySearchHit[] } | { ok: false; error: string }> {
  const g = await guard()
  if (!g.ok) return { ok: false, error: g.error }
  const company = await companyInGuardedOrg(input.companyId, g.orgIds)
  if (!company) return { ok: false, error: 'Entreprise introuvable dans votre organisation' }
  const q = (input.query ?? '').trim()
  if (q.length < 2) return { ok: true, hits: [] }
  const hits = await searchOrgCompanies(company.organizationId as string, q, company.id)
  return { ok: true, hits }
}

const aliasSchema = z.object({
  companyId: z.string().uuid(),
  canonicalCompanyId: z.string().uuid(),
})

export async function declareCompanyAliasAction(input: { companyId: string; canonicalCompanyId: string }): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = aliasSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Champs invalides' }
  const [company, canonical] = await Promise.all([
    companyInGuardedOrg(parsed.data.companyId, g.orgIds),
    companyInGuardedOrg(parsed.data.canonicalCompanyId, g.orgIds),
  ])
  if (!company) return { ok: false, error: 'Entreprise introuvable dans votre organisation' }
  if (!canonical) return { ok: false, error: 'Entreprise cible introuvable dans votre organisation' }
  if (company.organizationId !== canonical.organizationId) return { ok: false, error: 'Les deux entreprises doivent appartenir à la même organisation' }
  try {
    await setCompanyAlias(company.organizationId as string, company.id, canonical.id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Fusion impossible' }
  }
  await logAuditEvent({
    userId: g.userId,
    entityType: 'site',
    entityId: company.id,
    action: 'updated',
    metadata: {
      kind: 'company_declared_alias',
      company_id: company.id,
      company_name: company.name,
      canonical_company_id: canonical.id,
      canonical_company_name: canonical.name,
    },
  })
  revalidatePath('/intervenants')
  revalidatePath(`/intervenants/entreprise/${company.id}`)
  revalidatePath(`/intervenants/entreprise/${canonical.id}`)
  return { ok: true }
}
