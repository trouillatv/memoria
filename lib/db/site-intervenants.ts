// CASTING DU CHANTIER (mig 137) — le mapping PAR SITE : rôle → entreprise → contact.
// Le RÔLE vit ICI (lien site↔entreprise), pas dans companies (une entreprise = ETV
// ici, sous-traitant ailleurs). C'est ce qui fait passer MemorIA des codes nus
// (« ETV ») aux vrais acteurs (« ETV · BatiSud · Jean Dupont »).
import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'

export interface SiteIntervenant {
  id: string
  siteId: string
  role: string
  /** NULL depuis la mig 320 : rôle seul et personne-sans-entreprise sont des
   *  états métier LÉGITIMES — le type dit la vérité du modèle, plus de
   *  filter(Boolean) silencieux pour masquer un null. */
  companyId: string | null
  companyName: string
  companyShort: string | null
  mainContactId: string | null
  contactName: string | null
  contactFunction: string | null
  contactPhone: string | null
  contactMobile: string | null
  contactEmail: string | null
  effectiveFrom: string | null
  sourceReportId: string | null
}

/** Casting ACTIF d'un site (liens non clôturés : effective_to is null), rôle →
 *  entreprise → contact. Stitché à la main (robuste vs embeddings ; volumes faibles). */
export async function listSiteIntervenants(siteId: string): Promise<SiteIntervenant[]> {
  const sb = createAdminClient()
  const { data: rows } = await sb
    .from('site_intervenants')
    .select('id, site_id, role, company_id, main_contact_id, created_at, effective_from, source_report_id')
    .eq('site_id', siteId)
    .is('effective_to', null) // casting COURANT (l'historique vit dans les lignes clôturées)
    .order('created_at', { ascending: true })
  const list = rows ?? []
  if (list.length === 0) return []

  // company_id est NULLABLE depuis la mig 320 (rôle seul, personne seule) : on
  // ne passe jamais null à un .in() — la ligne reste servie, sans entreprise.
  const companyIds = [...new Set(list.map((r) => r.company_id as string | null).filter((x): x is string => !!x))]
  const contactIds = list.map((r) => r.main_contact_id as string | null).filter((x): x is string => !!x)

  const { data: companies } = await sb.from('companies').select('id, name, short_name').in('id', companyIds)
  const companyById = new Map((companies ?? []).map((c) => [c.id as string, c]))
  const contactById = new Map<string, Record<string, unknown>>()
  if (contactIds.length > 0) {
    const { data: contacts } = await sb.from('company_contacts').select('id, full_name, function, phone, mobile, email').in('id', contactIds)
    for (const c of contacts ?? []) contactById.set(c.id as string, c)
  }

  return list.map((r) => {
    const c = r.company_id ? companyById.get(r.company_id as string) : undefined
    const ct = r.main_contact_id ? contactById.get(r.main_contact_id as string) : undefined
    return {
      id: r.id as string,
      siteId: r.site_id as string,
      role: r.role as string,
      companyId: (r.company_id as string | null) ?? null,
      companyName: (c?.name as string) ?? '',
      companyShort: (c?.short_name as string | null) ?? null,
      mainContactId: (r.main_contact_id as string | null) ?? null,
      contactName: (ct?.full_name as string | null) ?? null,
      contactFunction: (ct?.function as string | null) ?? null,
      contactPhone: (ct?.phone as string | null) ?? null,
      contactMobile: (ct?.mobile as string | null) ?? null,
      contactEmail: (ct?.email as string | null) ?? null,
      effectiveFrom: (r.effective_from as string | null) ?? null,
      sourceReportId: (r.source_report_id as string | null) ?? null,
    }
  })
}

/** Ouvre une PARTICIPATION (mig 320) et retourne son id.
 *
 *  Depuis P0-3A, l'intervenant est une participation contextualisée : les
 *  quatre états contact×company sont légaux, y compris le rôle SEUL
 *  (« l'électricien » — companyId null, mainContactId null). On n'invente
 *  jamais d'identité pour combler un NOT NULL disparu.
 *
 *  Résolution d'un lien actif « identique » (index partiel actif) :
 *   1. correspondance exacte (site, role, company, contact) → réutilisée ;
 *   2. sinon un lien actif (site, role, company) SANS contact peut être
 *      ENRICHI par le contact fourni (niveau 3 → niveau 4) — jamais l'inverse :
 *      rouvrir sans contact ne fait pas oublier Jean Dupont ;
 *   3. sinon création. Ne clôture PAS les autres liens du même rôle
 *      (co-traitance et successions possibles). */
export async function openSiteIntervenant(input: {
  siteId: string
  role: string
  /** null = entreprise inconnue (niveaux 1-2 de connaissance). */
  companyId: string | null
  mainContactId?: string | null
  effectiveFrom?: string | null
  sourceReportId?: string | null
}): Promise<string> {
  const sb = createAdminClient()
  const role = input.role.trim().toUpperCase()
  const contactId = input.mainContactId ?? null

  let actifs = sb
    .from('site_intervenants')
    .select('id, main_contact_id')
    .eq('site_id', input.siteId)
    .eq('role', role)
    .is('effective_to', null)
  actifs = input.companyId ? actifs.eq('company_id', input.companyId) : actifs.is('company_id', null)
  const { data: rows } = await actifs
  const candidates = (rows ?? []) as Array<{ id: string; main_contact_id: string | null }>

  const exact = candidates.find((c) => (c.main_contact_id ?? null) === contactId)
  if (exact) {
    invalidateSiteProjection(input.siteId)
    return exact.id
  }
  // Enrichissement : un lien actif sans contact absorbe le contact fourni.
  const enrichable = contactId ? candidates.find((c) => c.main_contact_id === null) : undefined
  if (enrichable) {
    const { error } = await sb.from('site_intervenants').update({ main_contact_id: contactId }).eq('id', enrichable.id)
    if (error) throw new Error(error.message)
    invalidateSiteProjection(input.siteId)
    return enrichable.id
  }

  const row: Record<string, unknown> = {
    site_id: input.siteId, role, company_id: input.companyId, main_contact_id: contactId,
    source_report_id: input.sourceReportId ?? null,
  }
  if (input.effectiveFrom) row.effective_from = input.effectiveFrom
  const { data: ins, error } = await sb.from('site_intervenants').insert(row).select('id').single()
  if (error) throw new Error(error.message)
  // Arbitrage 2026-08-15 (option B) : un acteur est une identité/intervenant,
  // pas un canonical_subject. La vie du sujet de l'acteur est reconstruite
  // à partir de site_intervenants → entreprise/contact → actions/décisions.
  // ensureActorCanonicalSubject() est retiré de ce chemin.
  invalidateSiteProjection(input.siteId)
  return ins.id as string
}

/** REMPLACE une participation par une nouvelle dans le MÊME rôle (Jean → Paul).
 *  Clôture l'ancienne (effective_to), ouvre la nouvelle, et CHAÎNE les deux
 *  (replaced_by_intervenant_id, mig 320). « La participation de Jean a été
 *  remplacée » — Jean, lui, n'est jamais obsolète : son passage reste vrai. */
export async function replaceSiteIntervenant(input: {
  siteId: string
  /** La participation à clore. */
  currentId: string
  /** La relève — même rôle, identité éventuellement différente. */
  next: { companyId: string | null; mainContactId?: string | null }
  effectiveDate: string
  sourceReportId?: string | null
}): Promise<string> {
  const sb = createAdminClient()
  const { data: current } = await sb
    .from('site_intervenants')
    .select('id, role')
    .eq('id', input.currentId)
    .eq('site_id', input.siteId)
    .is('effective_to', null)
    .maybeSingle()
  if (!current) throw new Error('Participation active introuvable')

  const nextId = await openSiteIntervenant({
    siteId: input.siteId,
    role: (current as { role: string }).role,
    companyId: input.next.companyId,
    mainContactId: input.next.mainContactId ?? null,
    effectiveFrom: input.effectiveDate,
    sourceReportId: input.sourceReportId ?? null,
  })
  const { error } = await sb
    .from('site_intervenants')
    .update({
      effective_to: input.effectiveDate,
      replaced_by_intervenant_id: nextId,
      replaced_at: new Date().toISOString(),
    })
    .eq('id', input.currentId)
    .is('effective_to', null)
  if (error) throw new Error(error.message)
  invalidateSiteProjection(input.siteId)
  return nextId
}

/** CLÔTURE un lien (effective_to = date) au lieu de le supprimer → l'historique du
 *  casting est préservé (« qui était ETV au CR05 »). */
export async function closeSiteIntervenant(siteId: string, id: string, effectiveTo: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('site_intervenants')
    .update({ effective_to: effectiveTo })
    .eq('id', id)
    .eq('site_id', siteId)
    .is('effective_to', null)
  if (error) throw new Error(error.message)
}

export interface SiteContactOption {
  id: string
  fullName: string
  function: string | null
  phone: string | null
  mobile: string | null
  email: string | null
  companyName: string
}

/** Tous les contacts des entreprises ACTIVES du casting d'un site — pour relier un
 *  participant ou un décisionnaire à une vraie personne (« Jean Dupont — BatiSud »). */
export async function listSiteContacts(siteId: string): Promise<SiteContactOption[]> {
  const sb = createAdminClient()
  const intervenants = await listSiteIntervenants(siteId)
  const companyIds = [...new Set(intervenants.map((i) => i.companyId).filter(Boolean))]
  if (companyIds.length === 0) return []
  const { data: companies } = await sb.from('companies').select('id, name, short_name').in('id', companyIds)
  const nameById = new Map((companies ?? []).map((c) => [c.id as string, (c.short_name as string | null) || (c.name as string)]))
  const { data: contacts } = await sb
    .from('company_contacts')
    .select('id, company_id, full_name, function, phone, mobile, email')
    .in('company_id', companyIds)
    .is('deleted_at', null)
    .order('full_name', { ascending: true })
  return (contacts ?? []).map((c) => ({
    id: c.id as string,
    fullName: (c.full_name as string) ?? '',
    function: (c.function as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    mobile: (c.mobile as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    companyName: nameById.get(c.company_id as string) ?? '',
  }))
}

export interface SiteCandidateCompany { id: string; name: string }

export interface SiteCompanyLogo { id: string; name: string; logoUrl: string | null }

/**
 * Entreprises du chantier (casting ACTIF), avec leur logo — pour l'en-tête du CR
 * PDF. Mêmes règles de propreté que les candidates responsables : hors placeholder
 * « À identifier » et hors archivées. Nom court privilégié ; logo = `logo_url`
 * (URL publique, directement lisible par le renderer PDF), null si absent.
 */
export async function listSiteConcernedCompanies(siteId: string): Promise<SiteCompanyLogo[]> {
  const intervenants = await listSiteIntervenants(siteId)
  const ids = [...new Set(intervenants.map((i) => i.companyId).filter(Boolean))]
  if (ids.length === 0) return []
  const sb = createAdminClient()
  const { data } = await sb
    .from('companies')
    .select('id, name, short_name, logo_url, is_placeholder, deleted_at')
    .in('id', ids)
  return ((data ?? []) as Array<{ id: string; name: string; short_name: string | null; logo_url: string | null; is_placeholder: boolean; deleted_at: string | null }>)
    .filter((c) => !c.is_placeholder && !c.deleted_at)
    .map((c) => ({ id: c.id, name: c.short_name?.trim() || c.name, logoUrl: c.logo_url?.trim() || null }))
    // Les entreprises AVEC logo d'abord (valeur visuelle recherchée), puis par nom.
    .sort((a, b) => (a.logoUrl ? 0 : 1) - (b.logoUrl ? 0 : 1) || a.name.localeCompare(b.name, 'fr'))
}

/**
 * Entreprises pouvant être RESPONSABLES d'une action de ce chantier (Lot 2B.1) :
 * le casting ACTIF (site_intervenants, effective_to null), hors placeholder
 * « À identifier » et hors archivées. Une entreprise devient candidate parce
 * qu'elle intervient réellement — jamais parce qu'un de ses contacts est ailleurs.
 */
export async function listSiteCandidateCompanies(siteId: string): Promise<SiteCandidateCompany[]> {
  const intervenants = await listSiteIntervenants(siteId)
  const ids = [...new Set(intervenants.map((i) => i.companyId).filter(Boolean))]
  if (ids.length === 0) return []
  const sb = createAdminClient()
  const { data } = await sb
    .from('companies')
    .select('id, name, short_name, is_placeholder, deleted_at')
    .in('id', ids)
  return ((data ?? []) as Array<{ id: string; name: string; short_name: string | null; is_placeholder: boolean; deleted_at: string | null }>)
    .filter((c) => !c.is_placeholder && !c.deleted_at)
    .map((c) => ({ id: c.id, name: c.short_name || c.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

export interface RoleActor { company: string; contact: string | null }

/** Résolution rôle → acteur pour un site : « ETV » → { company:'BatiSud', contact:'Jean Dupont' }.
 *  Clé = rôle en MAJUSCULES. En cas de co-traitance (N entreprises/rôle), garde la 1ʳᵉ
 *  et concatène les noms. Sert l'affichage « ETV · BatiSud » dans la colonne ACTION. */
export async function getRoleActorMap(siteId: string): Promise<Map<string, RoleActor>> {
  const list = await listSiteIntervenants(siteId)
  const map = new Map<string, RoleActor>()
  for (const i of list) {
    // D1 (P0-3D) : une participation à rôle seul n'affiche jamais du vide —
    // « non identifié » est un état de connaissance, pas une anomalie.
    const label = i.companyShort || i.companyName || i.contactName || 'non identifié'
    const existing = map.get(i.role)
    if (existing) existing.company = `${existing.company}, ${label}`
    else map.set(i.role, { company: label, contact: i.contactName })
  }
  return map
}
