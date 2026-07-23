// Upload et lecture sécurisée des logos d'entité (organisation, client…).
//
// Bucket privé entity-logos. Les chemins incluent toujours l'organization_id
// en première composante pour qu'une politique Storage par org soit possible.
//
// Formats acceptés : PNG / JPEG / WebP (pas SVG — risque injection).
// Vérification du MIME déclaré + magic bytes → refus des fichiers renommés.
// Taille max 2 Mo. Upload via admin client (service_role) ; lecture via URL signée.

import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'entity-logos'
const MAX_BYTES = 2 * 1024 * 1024

// 7 jours — stable pour le rendu sidebar/PDF, rechargé à la prochaine génération.
export const LOGO_SIGNED_URL_TTL = 7 * 24 * 3600

const ALLOWED_MIME: Record<string, string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

function checkMagicBytes(buf: Buffer, mime: string): boolean {
  if (mime === 'image/png')
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (mime === 'image/jpeg')
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  if (mime === 'image/webp')
    return (
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    )
  return false
}

/**
 * Upload un logo d'organisation. Valide le MIME + magic bytes + taille.
 * Supprime les anciens fichiers (toutes extensions) avant d'uploader.
 * Retourne le chemin stocké en base (pas une URL).
 */
export async function uploadOrgLogo(
  orgId: string,
  data: Buffer,
  mime: string,
): Promise<string> {
  const ext = ALLOWED_MIME[mime]
  if (!ext) throw new Error('Format non autorisé (PNG, JPEG ou WebP uniquement)')
  if (data.length > MAX_BYTES) throw new Error('Fichier trop volumineux (max 2 Mo)')
  if (!checkMagicBytes(data, mime)) throw new Error('Le contenu du fichier ne correspond pas au type déclaré')

  const path = `organizations/${orgId}/logo.${ext}`
  const supabase = createAdminClient()

  // Supprimer toutes les variantes d'extension pour un remplacement propre.
  await supabase.storage.from(BUCKET).remove(
    Object.values(ALLOWED_MIME).map((e) => `organizations/${orgId}/logo.${e}`)
  )

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, data, { contentType: mime, upsert: true })
  if (error) throw new Error(`Upload échoué : ${error.message}`)
  return path
}

/** Supprime un fichier logo du bucket. Silencieux si absent. */
export async function deleteLogoFile(path: string): Promise<void> {
  await createAdminClient().storage.from(BUCKET).remove([path])
}

/**
 * Génère des URLs signées (TTL 7 j) pour plusieurs chemins en un seul appel.
 * Retourne un Record<path, signedUrl>. Les chemins sans URL sont absents du résultat.
 */
export async function getSignedLogoUrls(
  paths: string[],
): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrls(paths, LOGO_SIGNED_URL_TTL)
  const result: Record<string, string> = {}
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) result[item.path] = item.signedUrl
  }
  return result
}
