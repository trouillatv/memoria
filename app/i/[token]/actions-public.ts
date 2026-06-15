'use server'

import { z } from 'zod'
import { createHash } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  validateInterventionToken,
  listTokenItemIds,
  markItemsExecutedByToken,
} from '@/lib/db/intervention-tokens'
import { deriveChecklistItemStatus } from '@/lib/checklist-quantity'

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

/** Charge + valide un token pour une action externe.
 *  `allowedItemIds` = périmètre autorisé de la contribution. `null` = pas de
 *  périmètre (token sur l'intervention entière → tous les items autorisés). */
async function loadValidToken(
  token: string,
): Promise<
  | { ok: true; tok: LoadedToken; allowedItemIds: string[] | null }
  | { ok: false; error: string }
> {
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
  const perimeter = await listTokenItemIds(tok.id)
  return { ok: true, tok, allowedItemIds: perimeter.length > 0 ? perimeter : null }
}

/** Résout le périmètre effectif (IDs d'items que ce token peut toucher).
 *  Si pas de périmètre explicite → tous les items de l'intervention. */
async function resolveAllowedItemIds(
  interventionId: string,
  allowedItemIds: string[] | null,
): Promise<Set<string>> {
  if (allowedItemIds) return new Set(allowedItemIds)
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('intervention_checklist_items')
    .select('id')
    .eq('intervention_id', interventionId)
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
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

  // Garde-fou : une photo rattachée à un item DOIT être dans le périmètre.
  const rawItemId = formData.get('checklist_item_id')
  let checklistItemId: string | null = null
  if (typeof rawItemId === 'string' && rawItemId.length > 0) {
    if (!ItemIdSchema.safeParse(rawItemId).success) return { ok: false, error: 'Tâche invalide' }
    const allowed = await resolveAllowedItemIds(tok.intervention_id, loaded.allowedItemIds)
    if (!allowed.has(rawItemId)) return { ok: false, error: 'Cette tâche ne fait pas partie de votre périmètre' }
    checklistItemId = rawItemId
  }

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
      checklist_item_id: checklistItemId,
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
  // Items « à quantité » : itemId → quantité livrée saisie par l'externe.
  quantities?: Record<string, number>,
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

  const requestedItemIds = checkedItemIds.filter((id) => ItemIdSchema.safeParse(id).success)

  const loaded = await loadValidToken(tParsed.data)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  const { tok } = loaded

  // Idempotent : déjà validé → ok sans erreur
  if (tok.validated_at) return { ok: true }

  // GARDE-FOU : on ne retient QUE les items du périmètre de cette contribution.
  // Tout item hors périmètre est ignoré (le scope affiché n'est jamais décoratif).
  const allowed = await resolveAllowedItemIds(tok.intervention_id, loaded.allowedItemIds)

  // On charge expected_qty des items du périmètre pour distinguer binaire vs
  // quantité, et dériver le statut côté serveur (jamais un dropdown client).
  const supabaseRead = createAdminClient()
  const { data: scopeRows } = await supabaseRead
    .from('intervention_checklist_items')
    .select('id, expected_qty')
    .in('id', [...allowed])
  const expectedById = new Map<string, number | null>(
    ((scopeRows ?? []) as Array<{ id: string; expected_qty: number | null }>)
      .map((r) => [r.id, r.expected_qty]),
  )

  // Items à exécuter : binaires cochés + items à quantité « répondus » (une
  // quantité livrée saisie, 0 compris = « non livré »).
  const toExecute: Array<{ id: string; done: boolean; deliveredQty?: number | null; itemStatus?: string | null }> = []
  let hasPartialOrMissing = false

  for (const id of allowed) {
    const expected = expectedById.get(id) ?? null
    if (expected == null) {
      // Item binaire : exécuté s'il a été coché.
      if (requestedItemIds.includes(id)) toExecute.push({ id, done: true })
    } else {
      // Item à quantité : répondu si une valeur a été fournie (0 compris).
      const raw = quantities?.[id]
      if (raw === undefined || raw === null || !Number.isFinite(raw)) continue
      const delivered = Math.max(0, Math.min(1_000_000, Number(raw)))
      const status = deriveChecklistItemStatus(expected, delivered)
      if (status !== 'complet') hasPartialOrMissing = true
      toExecute.push({ id, done: status === 'complet', deliveredQty: delivered, itemStatus: status })
    }
  }

  // Checklist incomplète = relative AU PÉRIMÈTRE (« vos tâches »). Si incomplète
  // OU si un item à quantité est partiel/non livré → commentaire obligatoire.
  const scopeTotal = allowed.size
  const incomplete = scopeTotal > 0 && toExecute.length < scopeTotal
  if ((incomplete || hasPartialOrMissing) && !cParsed.data.trim()) {
    return {
      ok: false,
      error: hasPartialOrMissing
        ? 'Quantité partielle ou non livrée : un commentaire est obligatoire pour expliquer.'
        : 'Tâches incomplètes : un commentaire est obligatoire pour expliquer.',
    }
  }

  // Cocher + attribuer l'exécution à cette contribution externe (entreprise).
  await markItemsExecutedByToken(tok.id, toExecute)

  const supabase = createAdminClient()

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
