'use server'

// Server actions pour la page Sites globale (/sites).
// Doctrine : delete protégé — un site avec des données liées (missions,
// interventions, notes mémoire des lieux) ne peut JAMAIS être supprimé,
// seulement archivé via le soft-delete normal du site lui-même n'est
// possible que pour les sites sans aucune trace historique.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById, getOrgId } from '@/lib/db/users'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import {
  updateSite,
  softDeleteSite,
  getSiteDependencies,
  createSite,
  listSitesForMatching,
  normalizeSiteName,
  buildCanonicalSiteKey,
  trigramSimilarity,
  type SiteForMatching,
} from '@/lib/db/sites'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

const updateSchema = z.object({
  site_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  access_code: z.string().max(200).optional(),
  alarm_code: z.string().max(200).optional(),
  contact_name: z.string().max(200).optional(),
  contact_phone: z.string().max(50).optional(),
  access_hours: z.string().max(200).optional(),
  access_instructions: z.string().max(1000).optional(),
})

export async function updateSiteGlobalAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = updateSchema.safeParse({
    site_id: formData.get('site_id'),
    name: formData.get('name'),
    address: formData.get('address') || undefined,
    notes: formData.get('notes') || undefined,
    access_code: formData.get('access_code') || undefined,
    alarm_code: formData.get('alarm_code') || undefined,
    contact_name: formData.get('contact_name') || undefined,
    contact_phone: formData.get('contact_phone') || undefined,
    access_hours: formData.get('access_hours') || undefined,
    access_instructions: formData.get('access_instructions') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  await updateSite(parsed.data.site_id, {
    name: parsed.data.name,
    address: parsed.data.address ?? null,
    notes: parsed.data.notes ?? null,
    access_code: parsed.data.access_code ?? null,
    alarm_code: parsed.data.alarm_code ?? null,
    contact_name: parsed.data.contact_name ?? null,
    contact_phone: parsed.data.contact_phone ?? null,
    access_hours: parsed.data.access_hours ?? null,
    access_instructions: parsed.data.access_instructions ?? null,
  })

  revalidatePath('/sites')
  return { ok: true as const }
}

/**
 * RATTACHER un chantier à un client, plus tard.
 *
 * Le pendant obligatoire du « sans client » : une prévisite devient une affaire,
 * un repérage devient un contrat. Sans ce geste, « sans client » serait une
 * impasse — et l'utilisateur inventerait un client fictif pour en sortir.
 *
 * Le client est choisi ou créé explicitement : jamais deviné.
 */
const attachClientSchema = z.object({
  site_id: z.string().uuid(),
  client_id: z.string().uuid().optional(),
  client_name_new: z.string().trim().min(1).max(200).optional(),
})

export async function attachClientToSiteAction(
  input: unknown,
): Promise<{ ok: true; clientName: string } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = attachClientSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  const { site_id, client_id, client_name_new } = parsed.data
  if (!client_id && !client_name_new) return { error: 'Choisissez un client ou créez-en un.' }

  const supabase = createAdminClient()
  const { data: siteRow } = await supabase.from('sites').select('organization_id').eq('id', site_id).maybeSingle()
  if (!siteRow) return { error: 'Chantier introuvable' }
  const membership = await requireOrganizationMembership(siteRow.organization_id)
  if (!membership.ok) return { error: membership.error }
  const orgId = siteRow.organization_id

  let resolvedId: string
  let resolvedName: string

  if (client_id) {
    let q = supabase.from('clients').select('id, name').eq('id', client_id).is('deleted_at', null)
    // Isolation : le service role contourne la RLS — le filtre org vit ici.
    if (orgId) q = q.eq('organization_id', orgId)
    const { data: cl } = await q.maybeSingle()
    if (!cl) return { error: 'Client introuvable' }
    resolvedId = cl.id
    resolvedName = cl.name
  } else {
    const trimmed = client_name_new!.trim()
    let qExisting = supabase
      .from('clients')
      .select('id, name')
      .ilike('name', trimmed)
      .is('deleted_at', null)
    if (orgId) qExisting = qExisting.eq('organization_id', orgId)
    const { data: existing } = await qExisting.maybeSingle()
    if (existing) {
      resolvedId = existing.id
      resolvedName = existing.name
    } else {
      const { data: created, error } = await supabase
        .from('clients')
        .insert({ name: trimmed, ...(orgId ? { organization_id: orgId } : {}) })
        .select('id, name')
        .single()
      if (error || !created) return { error: 'Impossible de créer le client' }
      resolvedId = created.id
      resolvedName = created.name
    }
  }

  let q = supabase.from('sites').update({ client_id: resolvedId }).eq('id', site_id)
  if (orgId) q = q.eq('organization_id', orgId)
  const { error: updErr } = await q
  if (updErr) return { error: 'Rattachement impossible' }

  revalidatePath('/sites')
  revalidatePath(`/sites/${site_id}`)
  return { ok: true, clientName: resolvedName }
}

const deleteSchema = z.object({ site_id: z.string().uuid() })

/**
 * Supprime un site uniquement s'il n'a AUCUNE donnée liée (mission,
 * intervention, note). Sinon retourne un message explicatif qui guide
 * l'utilisateur vers l'archivage (= laisser le site, il bascule en
 * "Inactif" automatiquement après 6 mois sans intervention).
 */
// ---------------------------------------------------------------------------
// Création de site depuis la page globale /sites
// ---------------------------------------------------------------------------

const createSiteGlobalSchema = z.object({
  name: z.string().min(1, 'Nom requis').max(200),
  client_id: z.string().uuid().optional(),
  client_name_new: z.string().min(1).max(200).optional(),
  /** « Continuer sans client » — une DÉCISION, pas un champ laissé vide. */
  no_client: z.enum(['true', 'false']).default('false'),
  contract_id: z.string().uuid().optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  force: z.enum(['true', 'false']).default('false'),
  access_code: z.string().max(200).optional(),
  alarm_code: z.string().max(200).optional(),
  contact_name: z.string().max(200).optional(),
  contact_phone: z.string().max(50).optional(),
  access_hours: z.string().max(200).optional(),
  access_instructions: z.string().max(1000).optional(),
})

export interface SimilarSiteResult {
  id: string
  name: string
  client_display_name: string | null
  score: number
}

export type CreateSiteGlobalResult =
  | { ok: true; siteId: string }
  | { similar: SimilarSiteResult[] }
  | { error: string }

/**
 * Crée un site depuis la page globale /sites.
 * - Trouve ou crée le client (par id existant ou nom saisi).
 * - Calcule normalized_name et canonical_site_key.
 * - Si des sites similaires existent et force !== 'true', retourne { similar }.
 * - L'humain confirme et renvoie avec force='true'.
 */
export async function createSiteGlobalAction(
  formData: FormData,
): Promise<CreateSiteGlobalResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const raw = {
    name: formData.get('name'),
    client_id: formData.get('client_id') || undefined,
    client_name_new: formData.get('client_name_new') || undefined,
    no_client: formData.get('no_client') ?? 'false',
    contract_id: formData.get('contract_id') || undefined,
    address: formData.get('address') || undefined,
    notes: formData.get('notes') || undefined,
    force: formData.get('force') ?? 'false',
    access_code: formData.get('access_code') || undefined,
    alarm_code: formData.get('alarm_code') || undefined,
    contact_name: formData.get('contact_name') || undefined,
    contact_phone: formData.get('contact_phone') || undefined,
    access_hours: formData.get('access_hours') || undefined,
    access_instructions: formData.get('access_instructions') || undefined,
  }

  const parsed = createSiteGlobalSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Données invalides' }

  const { name, client_id, client_name_new, no_client, contract_id, force, ...rest } = parsed.data

  // Le « sans client » est un CHOIX, jamais un champ vide : un formulaire qu'on
  // valide sans y penser ne distingue plus l'oubli de la décision.
  if (!client_id && !client_name_new && no_client !== 'true') {
    return {
      error:
        'Choisissez un client, créez-en un, ou indiquez explicitement « Continuer sans client ».',
    }
  }

  const supabase = createAdminClient()
  const orgId = await getOrgId()
  let resolvedClientId: string | null = null
  let resolvedClientName: string | null = null

  if (client_id) {
    const { data: cl } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', client_id)
      .maybeSingle()
    if (!cl) return { error: 'Client introuvable' }
    resolvedClientId = cl.id
    resolvedClientName = cl.name
  } else if (client_name_new) {
    // Création ou lookup du client par nom (scoped to org). Un client ne naît
    // JAMAIS d'une déduction : ce nom a été saisi et confirmé par un humain.
    const trimmedClientName = client_name_new.trim()
    let qExisting = supabase
      .from('clients')
      .select('id, name')
      .ilike('name', trimmedClientName)
      .is('deleted_at', null)
    if (orgId) qExisting = qExisting.eq('organization_id', orgId)
    const { data: existing } = await qExisting.maybeSingle()
    if (existing) {
      resolvedClientId = existing.id
      resolvedClientName = existing.name
    } else {
      const { data: created, error: createErr } = await supabase
        .from('clients')
        .insert({ name: trimmedClientName, ...(orgId ? { organization_id: orgId } : {}) })
        .select('id, name')
        .single()
      if (createErr || !created) return { error: 'Impossible de créer le client' }
      resolvedClientId = created.id
      resolvedClientName = created.name
    }
  }

  const normalizedName = normalizeSiteName(name)
  const canonicalKey = buildCanonicalSiteKey(resolvedClientName ?? '', name)

  // Anti-doublon : vérification par similarité trigram si force !== 'true'
  if (force !== 'true') {
    const allSites = await listSitesForMatching()
    const similar: SimilarSiteResult[] = allSites
      .map((s: SiteForMatching) => ({
        id: s.id,
        name: s.name,
        client_display_name: s.client_display_name,
        score: trigramSimilarity(s.normalized_name, normalizedName),
      }))
      .filter((s) => s.score >= 0.75)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    if (similar.length > 0) return { similar }
  }

  const siteId = await createSite({
    client_id: resolvedClientId,
    contract_id: contract_id ?? null,
    name,
    canonical_site_key: canonicalKey,
    address: rest.address ?? null,
    notes: rest.notes ?? null,
    access_code: rest.access_code ?? null,
    alarm_code: rest.alarm_code ?? null,
    contact_name: rest.contact_name ?? null,
    contact_phone: rest.contact_phone ?? null,
    access_hours: rest.access_hours ?? null,
    access_instructions: rest.access_instructions ?? null,
  })

  revalidatePath('/sites')
  // Doctrine (audit/09) : un client peut être créé inline ici (« + Nouveau
  // client ») — la liste /clients doit le montrer sans refresh manuel.
  revalidatePath('/clients')
  return { ok: true, siteId }
}

export async function deleteSiteAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = deleteSchema.safeParse({ site_id: formData.get('site_id') })
  if (!parsed.success) return { error: 'Identifiant invalide' }

  const deps = await getSiteDependencies(parsed.data.site_id)
  const blockers: string[] = []
  if (deps.missionsCount > 0) {
    blockers.push(`${deps.missionsCount} mission${deps.missionsCount > 1 ? 's' : ''}`)
  }
  if (deps.interventionsCount > 0) {
    blockers.push(
      `${deps.interventionsCount} intervention${deps.interventionsCount > 1 ? 's' : ''}`,
    )
  }
  if (deps.siteNotesCount > 0) {
    blockers.push(
      `${deps.siteNotesCount} note${deps.siteNotesCount > 1 ? 's' : ''} de mémoire des lieux`,
    )
  }
  if (blockers.length > 0) {
    return {
      error:
        `Suppression impossible : ce site est lié à ${blockers.join(', ')}. ` +
        `L'historique doit être conservé. Le site basculera automatiquement en « Inactif » ` +
        `6 mois après sa dernière intervention.`,
    }
  }

  await softDeleteSite(parsed.data.site_id)
  revalidatePath('/sites')
  return { ok: true as const }
}
