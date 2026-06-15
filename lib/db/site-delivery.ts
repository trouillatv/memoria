// Bons de livraison de chantier (Tier 1 BTP).
//
// Un chantier reçoit des livraisons (béton/BPE, matériaux). Chaque livraison
// est enregistrée avec une photo du bon de livraison (BL), datée et OPPOSABLE :
// preuve décennale / contentieux.
//
// Doctrine : descriptif, niveau SITE, calme, jamais une mesure d'humain.
// Sécurité : admin client + scoping `organization_id` (comme les autres helpers).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

// Bucket existant réutilisé pour les photos de BL (cf. migration site-reports /
// intervention-photos). Le binaire ne transite jamais par Postgres.
const DELIVERY_PHOTO_BUCKET = 'intervention-photos'
const SIGNED_URL_TTL = 3600 // 1 h

export interface SiteDelivery {
  id: string
  deliveredOn: string // yyyy-mm-dd
  supplier: string | null
  reference: string | null
  zone: string | null
  material: string | null
  quantity: string | null
  photoPath: string | null
  note: string | null
  createdAt: string
}

/** Vrai si l'erreur Postgres signale une table absente (migration non appliquée). */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return code === '42P01' || msg.includes('does not exist') || msg.includes('site_delivery')
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function getSiteDeliveries(siteId: string): Promise<SiteDelivery[]> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('site_delivery')
    .select('id, delivered_on, supplier, reference, zone, material, quantity, photo_path, note, created_at')
    .eq('site_id', siteId)
    .order('delivered_on', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    // Dégradation gracieuse si la migration 109 n'est pas encore appliquée.
    if (isMissingTable(error as { code?: string; message?: string })) return []
    throw error
  }

  return (data ?? []).map((r) => ({
    id: r.id as string,
    deliveredOn: r.delivered_on as string,
    supplier: (r.supplier as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    zone: (r.zone as string | null) ?? null,
    material: (r.material as string | null) ?? null,
    quantity: (r.quantity as string | null) ?? null,
    photoPath: (r.photo_path as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  }))
}

/** URL signée pour afficher la photo d'un BL. null si pas de photo ou erreur. */
export async function getSignedDeliveryPhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null
  const sb = createAdminClient()
  const { data, error } = await sb.storage
    .from(DELIVERY_PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export interface CreateSiteDeliveryInput {
  siteId: string
  deliveredOn: string
  supplier: string | null
  reference: string | null
  zone: string | null
  material: string | null
  quantity: string | null
  note: string | null
  userId: string | null
}

/** Crée une livraison et retourne son id. */
export async function createSiteDelivery(input: CreateSiteDeliveryInput): Promise<string> {
  const sb = createAdminClient()
  const orgId = await getOrgId()
  const { data, error } = await sb
    .from('site_delivery')
    .insert({
      site_id: input.siteId,
      organization_id: orgId,
      delivered_on: input.deliveredOn,
      supplier: input.supplier,
      reference: input.reference,
      zone: input.zone,
      material: input.material,
      quantity: input.quantity,
      note: input.note,
      created_by: input.userId,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

/** Attache le chemin de la photo du BL à une livraison existante. */
export async function setSiteDeliveryPhoto(id: string, photoPath: string): Promise<void> {
  const sb = createAdminClient()
  const { error } = await sb
    .from('site_delivery')
    .update({ photo_path: photoPath, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Helper pur (testable, sans DB)
// ---------------------------------------------------------------------------

/**
 * Résumé sur une ligne : « Fournisseur · n°ref · zone ».
 * Les parties vides sont ignorées. Renvoie chaîne vide si tout est vide.
 */
export function formatDeliverySummary(d: {
  supplier?: string | null
  reference?: string | null
  zone?: string | null
}): string {
  const parts: string[] = []
  const supplier = d.supplier?.trim()
  const reference = d.reference?.trim()
  const zone = d.zone?.trim()
  if (supplier) parts.push(supplier)
  if (reference) parts.push(`n°${reference}`)
  if (zone) parts.push(zone)
  return parts.join(' · ')
}
