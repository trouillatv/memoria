'use server'

// Actions publiques pour /i/[token] — pas d'auth utilisateur requis.
// Le token lui-même est la permission.
//
// Pattern identique à /h/[token]/actions-public.ts :
//   1. Valider le token (existence + état + permissions)
//   2. Écrire via admin client
//   3. Revalider le path pour mise à jour immédiate

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateInterventionToken } from '@/lib/db/intervention-tokens'

const TokenSchema = z.string().min(8).max(200)
const NameSchema = z.string().trim().min(1, 'Nom requis').max(100)
const CommentSchema = z.string().trim().max(500)

export async function validateInterventionViaToken(
  token: string,
  validatedByName: string,
  comment: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tParsed = TokenSchema.safeParse(token)
  if (!tParsed.success) return { ok: false, error: 'Token invalide' }

  const nParsed = NameSchema.safeParse(validatedByName)
  if (!nParsed.success) return { ok: false, error: nParsed.error.issues[0]?.message ?? 'Nom invalide' }

  const cParsed = CommentSchema.safeParse(comment)
  if (!cParsed.success) return { ok: false, error: 'Commentaire trop long' }

  const supabase = createAdminClient()

  const { data: tok } = await supabase
    .from('intervention_tokens')
    .select('id, revoked_at, expires_at, permissions, validated_at')
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

  await validateInterventionToken({
    tokenId: tok.id,
    validatedByName: nParsed.data,
    validationComment: cParsed.data || null,
  })

  revalidatePath(`/i/${tParsed.data}`)
  return { ok: true }
}
