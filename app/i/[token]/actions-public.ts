'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateInterventionToken } from '@/lib/db/intervention-tokens'

const TokenSchema = z.string().min(8).max(200)
const NameSchema = z.string().trim().min(1, 'Nom requis').max(100)
const CommentSchema = z.string().trim().max(500)
const ItemIdSchema = z.string().uuid()

export async function validateInterventionViaToken(
  token: string,
  validatedByName: string,
  comment: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return checkItemsAndValidateViaToken(token, [], validatedByName, comment)
}

/**
 * Action principale : coche les items sélectionnés + valide le token.
 * checkedItemIds = IDs des checklist_items que l'acteur externe confirme.
 * Les items déjà cochés (done=true) ne sont pas modifiés.
 */
export async function checkItemsAndValidateViaToken(
  token: string,
  checkedItemIds: string[],
  validatedByName: string,
  comment: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tParsed = TokenSchema.safeParse(token)
  if (!tParsed.success) return { ok: false, error: 'Token invalide' }

  const nParsed = NameSchema.safeParse(validatedByName)
  if (!nParsed.success) return { ok: false, error: nParsed.error.issues[0]?.message ?? 'Nom invalide' }

  const cParsed = CommentSchema.safeParse(comment)
  if (!cParsed.success) return { ok: false, error: 'Commentaire trop long' }

  // Valider les UUIDs des items (ignore les invalides silencieusement)
  const validItemIds = checkedItemIds.filter((id) => ItemIdSchema.safeParse(id).success)

  const supabase = createAdminClient()

  const { data: tok } = await supabase
    .from('intervention_tokens')
    .select('id, intervention_id, revoked_at, expires_at, permissions, validated_at')
    .eq('token', tParsed.data)
    .maybeSingle()

  if (!tok) return { ok: false, error: 'Lien invalide' }
  if (tok.revoked_at) return { ok: false, error: 'Ce lien a été révoqué' }
  if (tok.expires_at && new Date(tok.expires_at) < new Date()) {
    return { ok: false, error: 'Ce lien a expiré' }
  }
  if (!(tok.permissions as string[]).includes('validate')) {
    return { ok: false, error: 'Action non autorisée sur ce lien' }
  }

  // Idempotent : déjà validé → ok sans erreur
  if (tok.validated_at) return { ok: true }

  // Cocher les items confirmés par l'acteur externe (uniquement ceux de cette intervention)
  if (validItemIds.length > 0) {
    await supabase
      .from('intervention_checklist_items')
      .update({ done: true })
      .eq('intervention_id', tok.intervention_id)
      .in('id', validItemIds)
  }

  await validateInterventionToken({
    tokenId: tok.id,
    validatedByName: nParsed.data,
    validationComment: cParsed.data || null,
  })

  revalidatePath(`/i/${tParsed.data}`)
  return { ok: true }
}
