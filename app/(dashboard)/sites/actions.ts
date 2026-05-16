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
import { getUserRoleById } from '@/lib/db/users'
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

  const { name, client_id, client_name_new, contract_id, force, ...rest } = parsed.data

  // Résolution du client : existant ou création inline
  if (!client_id && !client_name_new) {
    return { error: 'Un client est requis — sélectionnez-en un ou créez-en un nouveau.' }
  }

  const supabase = createAdminClient()
  let resolvedClientId: string
  let resolvedClientName: string

  if (client_id) {
    const { data: cl } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', client_id)
      .maybeSingle()
    if (!cl) return { error: 'Client introuvable' }
    resolvedClientId = cl.id
    resolvedClientName = cl.name
  } else {
    // Création ou lookup du client par nom
    const trimmedClientName = client_name_new!.trim()
    const { data: existing } = await supabase
      .from('clients')
      .select('id, name')
      .ilike('name', trimmedClientName)
      .is('deleted_at', null)
      .maybeSingle()
    if (existing) {
      resolvedClientId = existing.id
      resolvedClientName = existing.name
    } else {
      const { data: created, error: createErr } = await supabase
        .from('clients')
        .insert({ name: trimmedClientName })
        .select('id, name')
        .single()
      if (createErr || !created) return { error: 'Impossible de créer le client' }
      resolvedClientId = created.id
      resolvedClientName = created.name
    }
  }

  const normalizedName = normalizeSiteName(name)
  const canonicalKey = buildCanonicalSiteKey(resolvedClientName, name)

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
