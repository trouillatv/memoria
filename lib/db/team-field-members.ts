import 'server-only'

// ── PERSONNES TERRAIN DANS LES ÉQUIPES (mig 219) ─────────────────────────────
// « M. X, électricien » n'a pas de compte et n'en aura peut-être jamais : le
// socle de la personne terrain est company_contacts (entreprise OPTIONNELLE,
// organisation portée par le contact), et son appartenance vit dans
// team_field_members — PAS dans team_members, réservé aux utilisateurs
// connectés (briefings, passation, continuité supposent un compte, à raison).
//
// L'identité est PROGRESSIVE par conception : « M. X » → « Jean Dupont » →
// « Jean Dupont — ETV » se fait en modifiant la fiche, jamais en la recréant.
// Pas d'unicité sur le nom : deux « Électricien » peuvent être deux inconnus
// différents ; la fusion (Lot Intervenants) sera le mécanisme de dédoublonnage.
//
// La cohérence tenant (équipe = contact = ligne) et le refus des contacts
// archivés sont garantis par TRIGGER (mig 219) — y compris sous service-role.
// Les gardes ici donnent des messages clairs ; la base donne l'impossibilité.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { findOrCreateCompanyByName } from '@/lib/db/companies'

export interface FieldMember {
  /** L'id de l'APPARTENANCE (pour la quitter plus tard sans toucher la personne). */
  membershipId: string
  contactId: string
  fullName: string
  /** Le métier — company_contacts.function (« Électricien », « Conducteur grue »). */
  job: string | null
  companyName: string | null
  joinedAt: string
}

export type AddFieldPersonResult =
  | { ok: true; contactId: string }
  | { ok: false; error: string }

/**
 * Crée une personne terrain (SANS compte, entreprise optionnelle) et la
 * rattache à l'équipe — le geste unique du planificateur.
 *
 * Volontairement UNE transaction métier : créer la personne sans la rattacher
 * laisserait un contact orphelin que rien n'affiche encore.
 */
export async function createFieldPersonInTeam(input: {
  teamId: string
  fullName: string
  job?: string | null
  companyName?: string | null
  createdBy: string | null
}): Promise<AddFieldPersonResult> {
  const orgId = await getOrgId()
  // Fail-closed : le service-role bypasse la RLS — sans org, on refuse.
  if (!orgId) return { ok: false, error: 'Organisation introuvable' }

  const fullName = input.fullName.trim()
  if (!fullName) return { ok: false, error: 'Le nom est requis' }

  const db = createAdminClient()

  // L'entreprise, si donnée, passe par le geste canonique (dédup par nom
  // normalisé, scopé org) — jamais une insertion parallèle.
  let companyId: string | null = null
  const companyName = input.companyName?.trim()
  if (companyName) {
    companyId = await findOrCreateCompanyByName(orgId, companyName)
  }

  const { data: contact, error: contactErr } = await db
    .from('company_contacts')
    .insert({
      organization_id: orgId,
      company_id: companyId,
      full_name: fullName,
      function: input.job?.trim() || null,
    })
    .select('id')
    .single()
  if (contactErr || !contact) {
    return { ok: false, error: contactErr?.message ?? 'Création de la personne impossible' }
  }

  const { error: edgeErr } = await db.from('team_field_members').insert({
    organization_id: orgId,
    team_id: input.teamId,
    contact_id: contact.id,
    created_by: input.createdBy,
  })
  if (edgeErr) {
    // Le contact vient d'être créé pour CE rattachement : s'il échoue (équipe
    // d'un autre tenant, refus du trigger), on ne laisse pas d'orphelin.
    await db.from('company_contacts').delete().eq('id', contact.id)
    const msg = edgeErr.message ?? ''
    if (msg.includes('tenant')) return { ok: false, error: 'Cette équipe n’appartient pas à votre organisation' }
    if (msg.includes('duplicate') || msg.includes('uq_team_field_members_active')) {
      return { ok: false, error: 'Cette personne est déjà dans l’équipe' }
    }
    return { ok: false, error: 'Rattachement à l’équipe impossible' }
  }

  return { ok: true, contactId: contact.id }
}

/** Compte les personnes terrain ACTIVES par équipe. Descriptif (doctrine V2 :
 *  jamais un KPI). Fail-closed : sans org, une Map vide. */
export async function countFieldMembersByTeam(orgIds: string[]): Promise<Map<string, number>> {
  if (orgIds.length === 0) return new Map()
  const db = createAdminClient()
  const { data, error } = await db
    .from('team_field_members')
    .select('team_id')
    .is('left_at', null)
    .in('organization_id', orgIds)
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ team_id: string }>) {
    counts.set(row.team_id, (counts.get(row.team_id) ?? 0) + 1)
  }
  return counts
}

/** La composition TERRAIN d'une équipe — les personnes sans compte, avec leur
 *  métier et leur entreprise éventuelle. Les membres connectés ont leur propre
 *  lecture (listMembersOfTeam) : deux listes, deux natures, jamais fusionnées
 *  en silence. */
export async function listFieldMembersOfTeam(teamId: string): Promise<FieldMember[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('team_field_members')
    .select('id, contact_id, joined_at, company_contacts(full_name, function, company_id, deleted_at)')
    .eq('team_id', teamId)
    .is('left_at', null)
    .order('joined_at', { ascending: true })
  if (error) throw error

  type Contact = { full_name: string; function: string | null; company_id: string | null; deleted_at: string | null }
  type Row = {
    id: string
    contact_id: string
    joined_at: string
    // Le typegen Supabase ne connaît pas la cardinalité de la FK : il peut
    // annoncer un tableau. On normalise (même patron que sites/client ailleurs).
    company_contacts: Contact | Contact[] | null
  }
  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => ({ ...r, contact: Array.isArray(r.company_contacts) ? r.company_contacts[0] ?? null : r.company_contacts }))
    .filter((r): r is typeof r & { contact: Contact } => !!r.contact && !r.contact.deleted_at)

  // Résolution des noms d'entreprise en un seul appel.
  const companyIds = [...new Set(rows.map((r) => r.contact.company_id).filter((id): id is string => !!id))]
  const nameOf = new Map<string, string>()
  if (companyIds.length > 0) {
    const { data: cos } = await db.from('companies').select('id, name').in('id', companyIds)
    for (const c of (cos ?? []) as Array<{ id: string; name: string }>) nameOf.set(c.id, c.name)
  }

  return rows.map((r) => ({
    membershipId: r.id,
    contactId: r.contact_id,
    fullName: r.contact.full_name,
    job: r.contact.function,
    companyName: r.contact.company_id ? nameOf.get(r.contact.company_id) ?? null : null,
    joinedAt: r.joined_at,
  }))
}
