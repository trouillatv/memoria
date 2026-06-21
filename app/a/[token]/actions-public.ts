'use server'

// Server actions publiques pour /a/[token] — déclaration d'une entreprise sur
// SON lot d'actions (mig 148). Mêmes garde-fous que /i/[token] :
//   - scope strict (le serveur refuse toute action hors du lot) ;
//   - photo = preuve, rattachée au lot/action, jamais à un salarié nommé ;
//   - signature obligatoire ; déclaration ≠ clôture (statut interne intouché).

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { submitDistributionDeclaration } from '@/lib/db/action-distribution'

const TokenSchema = z.string().min(8).max(200)
const NameSchema = z.string().trim().min(1, 'Nom requis').max(100)
const CommentSchema = z.string().trim().max(500)
const ActionIdSchema = z.string().uuid()

const PHOTO_BUCKET = 'intervention-photos'
const MAX_PHOTO_BYTES = 10 * 1024 * 1024

interface LoadedDist {
  id: string
  site_id: string
  recipient_label: string
  revoked_at: string | null
  expires_at: string | null
  submitted_at: string | null
}

/** Charge + valide un lot par son token, renvoie le périmètre autorisé. */
async function loadValidDistribution(
  token: string,
): Promise<
  | { ok: true; dist: LoadedDist; allowedActionIds: Set<string>; proofRequired: Set<string> }
  | { ok: false; error: string }
> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('action_distributions')
    .select('id, site_id, recipient_label, revoked_at, expires_at, submitted_at')
    .eq('token', token)
    .maybeSingle()
  const dist = data as LoadedDist | null
  if (!dist) return { ok: false, error: 'Lien invalide' }
  if (dist.revoked_at) return { ok: false, error: 'Ce lien a été révoqué' }
  if (dist.expires_at && new Date(dist.expires_at) < new Date()) return { ok: false, error: 'Ce lien a expiré' }

  const { data: items } = await supabase
    .from('action_distribution_items')
    .select('action_id, requires_proof_photo')
    .eq('distribution_id', dist.id)
  const rows = (items ?? []) as Array<{ action_id: string; requires_proof_photo: boolean }>
  const allowed = new Set(rows.map((r) => r.action_id))
  const proofRequired = new Set(rows.filter((r) => r.requires_proof_photo).map((r) => r.action_id))
  return { ok: true, dist, allowedActionIds: allowed, proofRequired }
}

/**
 * Upload d'une photo de preuve par l'entreprise, rattachée à une action du lot.
 * Gardé par la validité du token ET l'appartenance de l'action au périmètre.
 * Retourne le storage_path (référencé ensuite dans la déclaration).
 */
export async function uploadActionPhotoViaToken(
  formData: FormData,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const tParsed = TokenSchema.safeParse(formData.get('token'))
  if (!tParsed.success) return { ok: false, error: 'Token invalide' }

  const rawActionId = formData.get('action_id')
  if (typeof rawActionId !== 'string' || !ActionIdSchema.safeParse(rawActionId).success) {
    return { ok: false, error: 'Action invalide' }
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Photo manquante' }
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'Photo trop lourde (max 10 Mo)' }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'Format non supporté' }

  const loaded = await loadValidDistribution(tParsed.data)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  if (!loaded.allowedActionIds.has(rawActionId)) {
    return { ok: false, error: 'Cette action ne fait pas partie de votre liste' }
  }

  const supabase = createAdminClient()
  const rawExt = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
  const safeExt = /^[a-z0-9]+$/.test(rawExt) ? rawExt : 'jpg'
  const storagePath = `action-distribution/${loaded.dist.id}/${rawActionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })
  if (upErr) return { ok: false, error: 'Échec de l\'envoi de la photo' }

  return { ok: true, path: storagePath }
}

interface DeclarationInput {
  actionId: string
  status: 'done' | 'blocked'
  comment?: string | null
  photoPath?: string | null
}

/**
 * Soumission finale : déclarations par action (fait/bloqué + commentaire +
 * photo) + identité + signature. Règles métier :
 *   - signature OBLIGATOIRE (preuve) ;
 *   - une action « bloquée » exige un commentaire (pourquoi) ;
 *   - idempotent : un lot déjà soumis renvoie ok sans réécrire.
 */
export async function submitDeclarationViaToken(
  token: string,
  submittedByName: string,
  signatureDataUrl: string,
  declarations: DeclarationInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tParsed = TokenSchema.safeParse(token)
  if (!tParsed.success) return { ok: false, error: 'Token invalide' }

  const nParsed = NameSchema.safeParse(submittedByName)
  if (!nParsed.success) return { ok: false, error: nParsed.error.issues[0]?.message ?? 'Nom invalide' }

  if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.startsWith('data:image/') || signatureDataUrl.length > 2_000_000) {
    return { ok: false, error: 'Signature requise' }
  }

  const loaded = await loadValidDistribution(tParsed.data)
  if (!loaded.ok) return { ok: false, error: loaded.error }

  // Idempotent : déjà soumis → ok.
  if (loaded.dist.submitted_at) return { ok: true }

  // Garde-fou périmètre + validation par déclaration.
  const clean: DeclarationInput[] = []
  for (const dec of declarations) {
    if (!ActionIdSchema.safeParse(dec.actionId).success) continue
    if (!loaded.allowedActionIds.has(dec.actionId)) continue // hors lot = ignoré
    if (dec.status !== 'done' && dec.status !== 'blocked') continue
    const comment = (dec.comment ?? '').trim()
    if (!CommentSchema.safeParse(comment).success) return { ok: false, error: 'Commentaire trop long' }
    if (dec.status === 'blocked' && !comment) {
      return { ok: false, error: 'Une action bloquée doit être expliquée (commentaire obligatoire).' }
    }
    const photoPath = typeof dec.photoPath === 'string' && dec.photoPath.length > 0 ? dec.photoPath : null
    // Demande de preuve : « fait » sur une action à preuve requise EXIGE une photo.
    if (dec.status === 'done' && loaded.proofRequired.has(dec.actionId) && !photoPath) {
      return { ok: false, error: 'Une photo est requise pour clôturer cette action.' }
    }
    clean.push({
      actionId: dec.actionId,
      status: dec.status,
      comment: comment || null,
      photoPath,
    })
  }

  if (clean.length === 0) return { ok: false, error: 'Aucune action renseignée.' }

  try {
    await submitDistributionDeclaration({
      distributionId: loaded.dist.id,
      recipientLabel: loaded.dist.recipient_label,
      submittedByName: nParsed.data,
      signatureDataUrl,
      declarations: clean,
    })
  } catch {
    return { ok: false, error: 'Enregistrement échoué. Réessayez.' }
  }

  revalidatePath(`/a/${tParsed.data}`)
  return { ok: true }
}
