// lib/db/dossiers.ts
// Le DOSSIER = l'opération métier (mig 172). Identité de mémoire entre le Site
// (lieu durable, mémoire permanente partagée) et le Sujet (point suivi).
//
// Un dossier naît à la prévisite (phase 'prospect') et va jusqu'au DOE sans
// changer d'identité. Un même lieu porte N dossiers dans le temps (AO 2026 perdu,
// réno 2028 gagnée…). La PHASE vit ici, plus sur le site (cf. mig 172).
//
// La capture existante reste site-keyed et fonctionne ; on STAMPE dossier_id au
// fil de l'eau via getOpenDossierIdForSite (un seul point de résolution).
// Cf. [[dossier-opportunite-colonne-vertebrale]].

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser, requireOrganizationMembership } from '@/lib/auth/memberships'
import { createSite, findOrCreateClientByName } from '@/lib/db/sites'
import type { DbDossier, DossierPhase } from '@/types/db'

const SELECT = 'id, organization_id, site_id, client_id, type, phase, label, opened_at, created_by, created_at, updated_at, deleted_at'

/** Les phases « vivantes » d'un dossier (ni perdu, ni archivé). */
const OPEN_PHASES: DossierPhase[] = ['prospect', 'en_ao', 'actif']

export async function getDossier(id: string): Promise<DbDossier | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('dossiers')
    .select(SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return null
  return data as DbDossier
}

export async function createDossier(input: {
  siteId: string
  clientId?: string | null
  type?: string
  phase?: DossierPhase
  label?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data: site } = await supabase.from('sites').select('organization_id').eq('id', input.siteId).maybeSingle()
  if (!site?.organization_id) throw new Error('Chantier introuvable ou sans organisation')
  const membership = await requireOrganizationMembership(site.organization_id)
  if (!membership.ok) throw new Error(membership.error)
  const orgId = site.organization_id
  const user = await getCurrentUserWithProfile().catch(() => null)
  const { data, error } = await supabase
    .from('dossiers')
    .insert({
      organization_id: orgId,
      site_id: input.siteId,
      client_id: input.clientId ?? null,
      type: input.type ?? 'operation',
      phase: input.phase ?? 'prospect',
      label: input.label ?? null,
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/**
 * Fait avancer un dossier dans son cycle de vie (prospect→en_ao→actif/perdu).
 * SOUDURE ARRIÈRE : « marché gagné » (phase 'actif') ne COPIE rien — c'est le même
 * dossier, le même lieu, la même mémoire de prévisite. On démasque alors le lieu de
 * la grille chantier (site.phase='actif', garde transitoire mig 171). Zéro rupture.
 */
export async function updateDossierPhase(dossierId: string, phase: DossierPhase): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('dossiers')
    .update({ phase, updated_at: new Date().toISOString() })
    .eq('id', dossierId)
    .is('deleted_at', null)
    .select('site_id')
    .maybeSingle()
  if (error) throw error
  const siteId = (data as { site_id: string } | null)?.site_id ?? null
  // Journalise la transition (mig 187) → jalon DATÉ pour la frise. Best-effort.
  await supabase.from('dossier_phase_events').insert({ dossier_id: dossierId, site_id: siteId, phase }).then(
    () => {},
    () => {},
  )
  // Marché gagné → le lieu devient un chantier visible (la mémoire suit, par construction).
  if (phase === 'actif' && siteId) {
    await supabase.from('sites').update({ phase: 'actif' }).eq('id', siteId)
  }
}

/**
 * Le dossier d'opération OUVERT d'un lieu (le plus récent non perdu/archivé), ou
 * null. Point de résolution unique pour stamper dossier_id sur les captures/infos
 * créées sur ce site. Un lieu sans dossier (chantier legacy) renvoie null → la
 * capture reste site-keyed, sans rupture.
 */
export async function getOpenDossierIdForSite(siteId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('dossiers')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .in('phase', OPEN_PHASES)
    .order('opened_at', { ascending: false })
    .limit(1)
  return (((data ?? [])[0] as { id: string } | undefined)?.id) ?? null
}

export interface OpportunityDossier {
  id: string
  label: string | null
  phase: DossierPhase
  type: string
  site_id: string
  site_name: string | null
  client_name: string | null
  opened_at: string
}

/** Les dossiers d'opportunité du tenant (prospect/en_ao), les plus récents d'abord. */
export async function listOpportunityDossiers(): Promise<OpportunityDossier[]> {
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return []
  const q = supabase
    .from('dossiers')
    .select('id, label, phase, type, site_id, opened_at, site:sites(name), client:clients(name)')
    .is('deleted_at', null)
    .in('phase', ['prospect', 'en_ao'])
    .order('opened_at', { ascending: false })
    .in('organization_id', orgIds)
  const { data, error } = await q
  if (error) throw error
  const pick = (v: { name: string } | { name: string }[] | null): string | null =>
    Array.isArray(v) ? (v[0]?.name ?? null) : (v?.name ?? null)
  return ((data ?? []) as Array<{
    id: string; label: string | null; phase: DossierPhase; type: string; site_id: string; opened_at: string
    site: { name: string } | { name: string }[] | null
    client: { name: string } | { name: string }[] | null
  }>).map((d) => ({
    id: d.id,
    label: d.label,
    phase: d.phase,
    type: d.type,
    site_id: d.site_id,
    site_name: pick(d.site),
    client_name: pick(d.client),
    opened_at: d.opened_at,
  }))
}

export interface DossierLite { id: string; label: string | null; site_name: string | null; phase: DossierPhase }

/** Toutes les opportunités du tenant (léger) — pour rattacher un AO depuis l'écran tender. */
export async function listDossiersLite(): Promise<DossierLite[]> {
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return []
  const q = supabase
    .from('dossiers')
    .select('id, label, phase, site:sites(name)')
    .is('deleted_at', null)
    .order('opened_at', { ascending: false })
    .in('organization_id', orgIds)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; label: string | null; phase: DossierPhase; site: { name: string } | { name: string }[] | null }>)
    .map((d) => ({
      id: d.id, label: d.label, phase: d.phase,
      site_name: Array.isArray(d.site) ? (d.site[0]?.name ?? null) : (d.site?.name ?? null),
    }))
}

/**
 * Crée une opportunité = un LIEU (site) + un DOSSIER en phase 'prospect'. Le site
 * porte phase='prospect' (garde transitoire mig 171 : le masque hors grille
 * chantier tant que rien n'est gagné). L'identité, elle, est le dossier.
 * Renvoie { dossierId, siteId }.
 */
export async function createProspectDossier(input: {
  name: string                  // libellé de l'AFFAIRE (dossier.label)
  clientName?: string | null    // donneur d'ordre — OPTIONNEL (terrain mobile)
  siteName?: string | null      // nom du LIEU — défaut = name (desktop)
  address?: string | null
}): Promise<{ dossierId: string; siteId: string }> {
  // Client optionnel : à défaut, on rattache un client provisoire nommé comme
  // l'affaire (le donneur d'ordre sera précisé au bureau). sites.client_id est NOT NULL.
  const clientLabel = input.clientName?.trim() || input.name.trim()
  const clientId = await findOrCreateClientByName(clientLabel)
  const siteId = await createSite({
    client_id: clientId,
    contract_id: null,
    name: (input.siteName?.trim() || input.name).trim(),
    address: input.address ?? null,
    phase: 'prospect',
  })
  const dossierId = await createDossier({
    siteId,
    clientId,
    type: 'ao',
    phase: 'prospect',
    label: input.name.trim(),
  })
  return { dossierId, siteId }
}
