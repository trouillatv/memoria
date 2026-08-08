'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { normalizeCanonicalLabel } from '@/lib/db/canonical-subject-resolve'
import { resolveProposalCanonicalManually } from '@/lib/db/canonical-subject-reconcile'

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

// ── Alias learning ────────────────────────────────────────────────────────────

/**
 * Ajoute le label original de la proposition comme alias du canonical_subject cible.
 * Idempotent : aucun ajout si le label (normalisé) est déjà présent dans label ou aliases.
 * Stocke le label original (non normalisé) pour que la résolution puisse le comparer
 * via normalizeCanonicalLabel() au moment de la requête.
 */
async function learnAliasFromAcceptedSuggestion(
  admin: ReturnType<typeof createAdminClient>,
  canonicalSubjectId: string,
  proposalLabel: string,
): Promise<void> {
  const normalized = normalizeCanonicalLabel(proposalLabel)

  const { data: cs } = await admin
    .from('canonical_subject')
    .select('label, aliases')
    .eq('id', canonicalSubjectId)
    .maybeSingle()

  if (!cs) return
  const { label, aliases } = cs as { label: string; aliases: string[] }

  const alreadyPresent = [label, ...(aliases ?? [])].some(
    (l) => normalizeCanonicalLabel(l) === normalized
  )
  if (alreadyPresent) return

  await admin
    .from('canonical_subject')
    .update({ aliases: [...(aliases ?? []), proposalLabel] })
    .eq('id', canonicalSubjectId)
}

// ── Accept (RPC transactionnel) ────────────────────────────────────────────────

/**
 * Associe un thread à son canonical_subject suggéré.
 * Appelle le RPC PostgreSQL `accept_subject_suggestion` — atomique.
 * Stocke l'ancienne identité dans `previous_canonical_subject_id` pour l'undo.
 * En cas de succès, ajoute le proposal_label comme alias du canonical_subject cible.
 */
export async function acceptSuggestionAction(suggestionId: string): Promise<ActionResult> {
  const auth = await verifyUserAndRole()
  if (!auth.ok) return { ok: false, error: auth.error }

  const hasAccess = await verifySuggestionSiteAccess(suggestionId, auth.userId)
  if (!hasAccess) return { ok: false, error: 'Accès refusé' }

  const admin = createAdminClient()

  const { data: sugMeta } = await admin
    .from('canonical_subject_suggestion')
    .select('proposal_label, candidate_canonical_subject_id, source_proposal_id, resolution')
    .eq('id', suggestionId)
    .maybeSingle()

  if (!sugMeta) return { ok: false, error: 'Suggestion introuvable' }

  const sug = sugMeta as {
    proposal_label: string
    candidate_canonical_subject_id: string | null
    source_proposal_id: string | null
    resolution: string
  }

  if (sug.resolution !== 'pending') return { ok: false, error: 'Cette suggestion a déjà été traitée' }
  if (!sug.candidate_canonical_subject_id) return { ok: false, error: 'Aucun sujet candidat associé' }

  // ── Route visite terrain ──────────────────────────────────────────────────────
  if (sug.source_proposal_id) {
    return acceptVisitProposalSuggestion({
      admin,
      suggestionId,
      sourceProposalId: sug.source_proposal_id,
      candidateCanonicalSubjectId: sug.candidate_canonical_subject_id,
      proposalLabel: sug.proposal_label,
      resolvedBy: auth.userId,
    })
  }

  // ── Route PV/extraction — RPC transactionnel existant ─────────────────────────
  const { data, error } = await admin.rpc('accept_subject_suggestion', {
    p_suggestion_id: suggestionId,
    p_user_id: auth.userId,
  })

  if (error) {
    console.error('[suggestion-actions] acceptSuggestionAction RPC error', error)
    return { ok: false, error: 'Erreur serveur' }
  }

  const result = data as string
  if (result === 'ok') {
    await learnAliasFromAcceptedSuggestion(admin, sug.candidate_canonical_subject_id, sug.proposal_label)
      .catch((err) => console.error('[suggestion-actions] alias learning error', err))
    return { ok: true }
  }
  if (result === 'not_pending') return { ok: false, error: 'Cette suggestion a déjà été traitée' }
  if (result === 'invalid_candidate') return { ok: false, error: "Le sujet canonique proposé n'est plus disponible" }
  if (result === 'invalid_thread') return { ok: false, error: 'Thread introuvable pour ce site' }
  if (result === 'already_used') return { ok: false, error: 'Opération déjà en cours' }
  return { ok: false, error: `Erreur inattendue : ${result}` }
}

/**
 * Accepte une suggestion issue d'une proposition terrain (source_proposal_id non null).
 * - Crée/met à jour l'occurrence canonical (confirmed).
 * - Marque la proposition comme résolue.
 * - Marque la suggestion comme acceptée.
 * - Apprend l'alias.
 */
async function acceptVisitProposalSuggestion(params: {
  admin: ReturnType<typeof createAdminClient>
  suggestionId: string
  sourceProposalId: string
  candidateCanonicalSubjectId: string
  proposalLabel: string
  resolvedBy: string
}): Promise<ActionResult> {
  const { admin, suggestionId, sourceProposalId, candidateCanonicalSubjectId, proposalLabel, resolvedBy } = params

  const { data: prop } = await admin
    .from('site_knowledge_proposals')
    .select('id, title, body, site_id, report_id, created_at')
    .eq('id', sourceProposalId)
    .maybeSingle()

  if (!prop) return { ok: false, error: 'Proposition terrain introuvable' }

  const { title, body, site_id, report_id, created_at } = prop as {
    title: string; body: string | null; site_id: string; report_id: string; created_at: string
  }

  // Récupère la date de visite depuis le rapport pour effective_date
  const { data: report } = await admin
    .from('site_reports')
    .select('started_at, created_at')
    .eq('id', report_id)
    .maybeSingle()
  const rr = report as { started_at: string | null; created_at: string } | null
  const visitDate = rr?.started_at ?? rr?.created_at ?? created_at

  await resolveProposalCanonicalManually({
    proposalId: sourceProposalId,
    siteId: site_id,
    canonicalSubjectId: candidateCanonicalSubjectId,
    reportId: report_id,
    proposalTitle: title,
    proposalBody: body ?? null,
    visitDate,
    resolvedBy,
  })

  const { error: updErr } = await admin
    .from('canonical_subject_suggestion')
    .update({
      resolution: 'accepted',
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq('id', suggestionId)

  if (updErr) {
    console.error('[suggestion-actions] acceptVisitProposalSuggestion update error', updErr)
    return { ok: false, error: 'Erreur serveur' }
  }

  await learnAliasFromAcceptedSuggestion(admin, candidateCanonicalSubjectId, proposalLabel)
    .catch((err) => console.error('[suggestion-actions] alias learning error', err))

  return { ok: true }
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
    .select('resolution, source_proposal_id')
    .eq('id', suggestionId)
    .maybeSingle()

  if (!sug) return { ok: false, error: 'Suggestion introuvable' }

  const { resolution, source_proposal_id } = sug as { resolution: string; source_proposal_id: string | null }

  if (resolution === 'accepted') {
    // ── Undo Accept visite terrain ──────────────────────────────────────────────
    if (source_proposal_id) {
      // Rétrograder l'occurrence confirmed → observed
      await admin
        .from('canonical_subject_occurrence')
        .update({ validation_status: 'observed' })
        .eq('source_proposal_id', source_proposal_id)
        .eq('validation_status', 'confirmed')

      // Remettre la proposition en needs_resolution
      await admin
        .from('site_knowledge_proposals')
        .update({ canonical_subject_id: null, canonical_resolution_status: 'needs_resolution' })
        .eq('id', source_proposal_id)

      const { error: undoErr } = await admin
        .from('canonical_subject_suggestion')
        .update({ resolution: 'pending', resolved_at: null, resolved_by: null })
        .eq('id', suggestionId)

      if (undoErr) {
        console.error('[suggestion-actions] undoVisitProposalSuggestion error', undoErr)
        return { ok: false, error: 'Erreur serveur' }
      }

      return { ok: true }
    }

    // ── Undo Accept PV — RPC transactionnel avec garde d'obsolescence ───────────
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
    if (result === 'not_accepted') return { ok: false, error: "Cette suggestion n'est pas dans l'état accepté" }
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
