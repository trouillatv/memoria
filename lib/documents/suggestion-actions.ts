'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'

type ActionResult = { ok: boolean; error?: string }

// ── Accès ─────────────────────────────────────────────────────────────────────

async function verifyUserAndRole(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié' }

  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { ok: false, error: 'Permissions insuffisantes' }

  return { ok: true, userId: user.id }
}

async function verifySuggestionSiteAccess(suggestionId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient()

  const { data: sug } = await admin
    .from('canonical_subject_suggestion')
    .select('site_id')
    .eq('id', suggestionId)
    .maybeSingle()

  if (!sug) return false

  const role = await getUserRoleById(userId)
  if (role === 'admin') return true

  // Vérifie que le site appartient à une organisation dont l'utilisateur est membre
  const { data: site } = await admin
    .from('sites')
    .select('organization_id')
    .eq('id', sug.site_id)
    .maybeSingle()

  if (!site) return false

  const orgIds = await getOrgIdsOfUser()
  return orgIds.includes((site as { organization_id: string }).organization_id)
}

// ── Accept (RPC transactionnel) ────────────────────────────────────────────────

/**
 * Associe un thread à son canonical_subject suggéré.
 * Appelle le RPC PostgreSQL `accept_subject_suggestion` — atomique.
 * Stocke l'ancienne identité dans `previous_canonical_subject_id` pour l'undo.
 */
export async function acceptSuggestionAction(suggestionId: string): Promise<ActionResult> {
  const auth = await verifyUserAndRole()
  if (!auth.ok) return { ok: false, error: auth.error }

  const hasAccess = await verifySuggestionSiteAccess(suggestionId, auth.userId)
  if (!hasAccess) return { ok: false, error: 'Accès refusé' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('accept_subject_suggestion', {
    p_suggestion_id: suggestionId,
    p_user_id: auth.userId,
  })

  if (error) {
    console.error('[suggestion-actions] acceptSuggestionAction RPC error', error)
    return { ok: false, error: 'Erreur serveur' }
  }

  const result = data as string
  if (result === 'ok') return { ok: true }
  if (result === 'not_pending') return { ok: false, error: 'Cette suggestion a déjà été traitée' }
  if (result === 'invalid_candidate') return { ok: false, error: 'Le sujet canonique proposé n\'est plus disponible' }
  if (result === 'invalid_thread') return { ok: false, error: 'Thread introuvable pour ce site' }
  if (result === 'already_used') return { ok: false, error: 'Opération déjà en cours' }
  return { ok: false, error: `Erreur inattendue : ${result}` }
}

// ── Reject (simple UPDATE) ────────────────────────────────────────────────────

/**
 * Refuse la suggestion — conserve l'identité actuelle du thread.
 * Le refus porte sur la paire (thread, candidat) : le thread reste éligible
 * à d'autres rapprochements vers un candidat différent.
 */
export async function rejectSuggestionAction(suggestionId: string): Promise<ActionResult> {
  const auth = await verifyUserAndRole()
  if (!auth.ok) return { ok: false, error: auth.error }

  const hasAccess = await verifySuggestionSiteAccess(suggestionId, auth.userId)
  if (!hasAccess) return { ok: false, error: 'Accès refusé' }

  const admin = createAdminClient()

  // Vérifie que la suggestion est pending avant de modifier
  const { data: sug } = await admin
    .from('canonical_subject_suggestion')
    .select('resolution')
    .eq('id', suggestionId)
    .maybeSingle()

  if (!sug) return { ok: false, error: 'Suggestion introuvable' }
  if ((sug as { resolution: string }).resolution !== 'pending') {
    return { ok: false, error: 'Cette suggestion a déjà été traitée' }
  }

  const { error } = await admin
    .from('canonical_subject_suggestion')
    .update({
      resolution: 'rejected',
      resolved_at: new Date().toISOString(),
      resolved_by: auth.userId,
    })
    .eq('id', suggestionId)

  if (error) {
    console.error('[suggestion-actions] rejectSuggestionAction error', error)
    return { ok: false, error: 'Erreur serveur' }
  }

  return { ok: true }
}

// ── Undo ──────────────────────────────────────────────────────────────────────

/**
 * Annule une décision (accepted ou rejected) et remet la suggestion en pending.
 *
 * Pour un undo d'Accept : appelle le RPC `undo_accept_subject_suggestion` (atomique).
 * Pour un undo de Reject : simple UPDATE sur canonical_subject_suggestion.
 */
export async function undoSuggestionAction(suggestionId: string): Promise<ActionResult> {
  const auth = await verifyUserAndRole()
  if (!auth.ok) return { ok: false, error: auth.error }

  const hasAccess = await verifySuggestionSiteAccess(suggestionId, auth.userId)
  if (!hasAccess) return { ok: false, error: 'Accès refusé' }

  const admin = createAdminClient()

  const { data: sug } = await admin
    .from('canonical_subject_suggestion')
    .select('resolution')
    .eq('id', suggestionId)
    .maybeSingle()

  if (!sug) return { ok: false, error: 'Suggestion introuvable' }

  const resolution = (sug as { resolution: string }).resolution

  if (resolution === 'accepted') {
    // Undo Accept — RPC transactionnel avec garde d'obsolescence
    const { data, error } = await admin.rpc('undo_accept_subject_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: auth.userId,
    })

    if (error) {
      console.error('[suggestion-actions] undoSuggestionAction RPC error', error)
      return { ok: false, error: 'Erreur serveur' }
    }

    const result = data as string
    if (result === 'ok') return { ok: true }
    if (result === 'stale_undo') {
      return { ok: false, error: 'Ce thread a déjà été réassigné par une décision plus récente — annulation refusée' }
    }
    if (result === 'not_accepted') return { ok: false, error: 'Cette suggestion n\'est pas dans l\'état accepté' }
    return { ok: false, error: `Erreur inattendue : ${result}` }
  }

  if (resolution === 'rejected') {
    // Undo Reject — simple UPDATE
    const { error } = await admin
      .from('canonical_subject_suggestion')
      .update({
        resolution: 'pending',
        resolved_at: null,
        resolved_by: null,
      })
      .eq('id', suggestionId)

    if (error) {
      console.error('[suggestion-actions] undoSuggestionAction reject error', error)
      return { ok: false, error: 'Erreur serveur' }
    }

    return { ok: true }
  }

  return { ok: false, error: 'Aucune décision à annuler (suggestion déjà pending)' }
}
