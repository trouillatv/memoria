'use server'

import { z } from 'zod'
import { createHash } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateInterventionToken } from '@/lib/db/intervention-tokens'

const TokenSchema = z.string().min(8).max(200)
const NameSchema = z.string().trim().min(1, 'Nom requis').max(100)
const CommentSchema = z.string().trim().max(500)
const ItemIdSchema = z.string().uuid()

const PHOTO_BUCKET = 'intervention-photos'
const MAX_PHOTO_BYTES = 10 * 1024 * 1024

interface LoadedToken {
  id: string
  intervention_id: string
  revoked_at: string | null
  expires_at: string | null
  permissions: string[]
  validated_at: string | null
}

/** Charge + valide un token pour une action externe. */
async function loadValidToken(
  token: string,
): Promise<{ ok: true; tok: LoadedToken } | { ok: false; error: string }> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('intervention_tokens')
    .select('id, intervention_id, revoked_at, expires_at, permissions, validated_at')
    .eq('token', token)
    .maybeSingle()
  const tok = data as LoadedToken | null
  if (!tok) return { ok: false, error: 'Lien invalide' }
  if (tok.revoked_at) return { ok: false, error: 'Ce lien a été révoqué' }
  if (tok.expires_at && new Date(tok.expires_at) < new Date()) return { ok: false, error: 'Ce lien a expiré' }
  if (!(tok.permissions ?? []).includes('validate')) return { ok: false, error: 'Action non autorisée sur ce lien' }
  return { ok: true, tok }
}

/**
 * Upload d'une photo par un intervenant externe (preuve depuis le téléphone).
 * Gardé par la validité du token. La photo est rattachée à l'intervention ET
 * au token (external_token_id) — taken_by reste NULL (pas de compte).
 */
export async function uploadExternalPhotoViaToken(
  formData: FormData,
): Promise<{ ok: true; photoId: string } | { ok: false; error: string }> {
  const tParsed = TokenSchema.safeParse(formData.get('token'))
  if (!tParsed.success) return { ok: false, error: 'Token invalide' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Photo manquante' }
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'Photo trop lourde (max 10 Mo)' }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'Format non supporté' }

  const loaded = await loadValidToken(tParsed.data)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  const { tok } = loaded

  const supabase = createAdminClient()
  const rawExt = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
  const safeExt = /^[a-z0-9]+$/.test(rawExt) ? rawExt : 'jpg'
  const storagePath = `${tok.intervention_id}/proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })
  if (upErr) return { ok: false, error: 'Échec de l\'envoi de la photo' }

  const { data: inserted, error: insertErr } = await supabase
    .from('intervention_photos')
    .insert({
      intervention_id: tok.intervention_id,
      checklist_item_id: null,
      storage_path: storagePath,
      kind: 'proof',
      caption: null,
      taken_by: null,
      sha256,
      mime_type: file.type,
      size_bytes: buffer.length,
      hash_origin: 'unknown',
      external_token_id: tok.id,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]).catch(() => {})
    return { ok: false, error: 'Enregistrement de la photo échoué' }
  }

  return { ok: true, photoId: (inserted as { id: string }).id }
}

export async function validateInterventionViaToken(
  token: string,
  validatedByName: string,
  comment: string,
  signatureDataUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return checkItemsAndValidateViaToken(token, [], validatedByName, comment, signatureDataUrl)
}

/**
 * Action principale : coche les items + signature + valide le token.
 * Règles métier :
 *  - signature OBLIGATOIRE à la validation ;
 *  - si la checklist est incomplète → commentaire OBLIGATOIRE ;
 *  - validation externe ≠ clôture de l'intervention (statut opérationnel inchangé).
 */
export async function checkItemsAndValidateViaToken(
  token: string,
  checkedItemIds: string[],
  validatedByName: string,
  comment: string,
  signatureDataUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tParsed = TokenSchema.safeParse(token)
  if (!tParsed.success) return { ok: false, error: 'Token invalide' }

  const nParsed = NameSchema.safeParse(validatedByName)
  if (!nParsed.success) return { ok: false, error: nParsed.error.issues[0]?.message ?? 'Nom invalide' }

  const cParsed = CommentSchema.safeParse(comment)
  if (!cParsed.success) return { ok: false, error: 'Commentaire trop long' }

  // Signature obligatoire (preuve).
  if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.startsWith('data:image/') || signatureDataUrl.length > 2_000_000) {
    return { ok: false, error: 'Signature requise' }
  }

  const validItemIds = checkedItemIds.filter((id) => ItemIdSchema.safeParse(id).success)

  const supabase = createAdminClient()
  const loaded = await loadValidToken(tParsed.data)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  const { tok } = loaded

  // Idempotent : déjà validé → ok sans erreur
  if (tok.validated_at) return { ok: true }

  // Checklist incomplète → commentaire obligatoire
  const { data: allItems } = await supabase
    .from('intervention_checklist_items')
    .select('id')
    .eq('intervention_id', tok.intervention_id)
  const total = (allItems ?? []).length
  const incomplete = total > 0 && validItemIds.length < total
  if (incomplete && !cParsed.data.trim()) {
    return { ok: false, error: 'Checklist incomplète : un commentaire est obligatoire pour expliquer.' }
  }

  // Cocher les items confirmés par l'acteur externe
  if (validItemIds.length > 0) {
    await supabase
      .from('intervention_checklist_items')
      .update({ done: true })
      .eq('intervention_id', tok.intervention_id)
      .in('id', validItemIds)
  }

  // Signature sur le token (preuve, jamais clôture).
  await supabase
    .from('intervention_tokens')
    .update({ signature_data_url: signatureDataUrl, signed_at: new Date().toISOString() })
    .eq('id', tok.id)

  await validateInterventionToken({
    tokenId: tok.id,
    validatedByName: nParsed.data,
    validationComment: cParsed.data || null,
  })

  revalidatePath(`/i/${tParsed.data}`)
  return { ok: true }
}
