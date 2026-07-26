// Résolution persistante des promesses (Cockpit, T3). Une promesse détectée
// possède enfin un cycle de vie : tenue / annulée / remplacée, tracée et auditée,
// après quoi le read model l'exclut (statut terminal) et le signal disparaît.
//
// Une promesse vit dans DEUX tables (cf. lib/db/promise-candidates.ts). Le
// `PromiseSubjectRef` porté par la Situation (T2) dit LAQUELLE. Ce moteur
// dispatche dessus, sans jamais faire confiance à l'organisation fournie par le
// client : il RECHARGE la ligne et vérifie que son `organization_id` appartient
// à l'utilisateur (garde fail-closed — le service-role bypasse la RLS).
//
// Idempotence : chaque transition est gardée par `.eq('status', <actif>)`. Un
// second clic, ou une décision concurrente, ne réécrit pas une résolution déjà
// posée — il retourne `already_terminal`, jamais une double écriture.

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import { createSiteAction } from '@/lib/db/site-actions'
import type { PromiseSubjectRef } from '@/lib/memory/signals/operational-contract'

export type PromiseOutcome = 'fulfilled' | 'cancelled' | 'replaced'

export type PromiseResolutionResult =
  | { status: 'resolved'; outcome: PromiseOutcome; siteId: string; replacementId?: string }
  /** Introuvable OU hors de l'organisation de l'utilisateur — indistinct (fail-closed). */
  | { status: 'not_found' }
  /** Déjà terminale (déjà résolue, ou concurrence) — aucune écriture. */
  | { status: 'already_terminal' }

type TableConfig = {
  active: string
  fulfilled: string
  cancelled: string
  replaced: string
  reviewerCol: 'resolved_by' | 'reviewed_by'
  reviewedAtCol: 'resolved_at' | 'reviewed_at'
  replacementCol: 'replaced_by' | 'superseded_by'
  /** Construit la ligne INSÉRÉE pour une promesse remplaçante, dans la même table. */
  buildReplacement: (old: LoadedPromise, replacement: NewPromiseInput, userId: string, now: string) => Record<string, unknown>
}

// Chaque table a son vocabulaire de statut et ses colonnes d'audit — mais le
// contrat commun (actif → terminal + auteur + date) est identique.
const TABLES: Record<PromiseSubjectRef['table'], TableConfig> = {
  captured_knowledge: {
    active: 'active', fulfilled: 'resolved', cancelled: 'dismissed', replaced: 'obsolete',
    reviewerCol: 'resolved_by', reviewedAtCol: 'resolved_at', replacementCol: 'replaced_by',
    buildReplacement: (old, replacement, userId) => ({
      organization_id: old.organization_id,
      site_id: old.site_id,
      kind: 'promise',
      status: 'active',
      // Une promesse saisie à la main pour remplacer la précédente.
      source_type: 'manual',
      title: replacement.title,
      body: replacement.body ?? null,
      created_by: userId,
    }),
  },
  site_knowledge_proposals: {
    active: 'proposed', fulfilled: 'fulfilled', cancelled: 'dismissed', replaced: 'superseded',
    reviewerCol: 'reviewed_by', reviewedAtCol: 'reviewed_at', replacementCol: 'superseded_by',
    buildReplacement: (old, replacement, userId, now) => ({
      organization_id: old.organization_id,
      site_id: old.site_id,
      kind: 'deadline',
      status: 'proposed',
      title: replacement.title,
      body: replacement.body ?? null,
      // Engagement explicite (le read model ne retient que ceux-là) sans échéance
      // devinée : la remplaçante est une promesse, pas une date fabriquée.
      payload: { commitment: true },
      // Clé de dédup STABLE et unique : jamais celle de l'ancienne (l'ancienne
      // reste, terminale). `now` est fourni par l'appelant (pas d'horloge cachée).
      dedupe_key: `replace-${old.id}-${now}`,
    }),
  },
}

type LoadedPromise = { id: string; organization_id: string; site_id: string; status: string }
export type NewPromiseInput = { title: string; body?: string | null }

// Recharge la ligne et applique la garde d'organisation. Renvoie null si la ligne
// n'existe pas ou n'appartient pas à l'utilisateur — les deux INDISTINCTS, pour
// ne pas révéler l'existence d'une ligne d'une autre organisation.
async function loadWithinOrg(
  supabase: ReturnType<typeof createAdminClient>,
  subject: PromiseSubjectRef,
  allowedOrgIds: string[],
): Promise<LoadedPromise | null> {
  const { data, error } = await supabase
    .from(subject.table)
    .select('id, organization_id, site_id, status')
    .eq('id', subject.id)
    .maybeSingle()
  if (error || !data) return null
  const row = data as LoadedPromise
  if (!row.organization_id || !allowedOrgIds.includes(row.organization_id)) return null
  return row
}

async function terminalize(
  subject: PromiseSubjectRef,
  allowedOrgIds: string[],
  userId: string,
  outcome: 'fulfilled' | 'cancelled',
  reason: string | null,
): Promise<PromiseResolutionResult> {
  const cfg = TABLES[subject.table]
  const supabase = createAdminClient()
  const row = await loadWithinOrg(supabase, subject, allowedOrgIds)
  if (!row) return { status: 'not_found' }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    status: outcome === 'fulfilled' ? cfg.fulfilled : cfg.cancelled,
    [cfg.reviewerCol]: userId,
    [cfg.reviewedAtCol]: now,
    updated_at: now,
  }
  // Le motif n'existe que pour une annulation.
  if (outcome === 'cancelled') patch.dismiss_reason = reason ?? null

  const { data, error } = await supabase
    .from(subject.table)
    .update(patch)
    .eq('id', subject.id)
    .eq('status', cfg.active) // idempotence : on ne rejoue pas une décision déjà prise
    .select('site_id')
  if (error) throw error
  const updated = (data as Array<{ site_id: string }> | null) ?? []
  if (updated.length === 0) return { status: 'already_terminal' }

  invalidateSiteProjection(row.site_id)
  return { status: 'resolved', outcome, siteId: row.site_id }
}

/** Promesse TENUE — statut terminal « réalisée », aucun objet métier créé. */
export function fulfillPromise(params: { subject: PromiseSubjectRef; userId: string; allowedOrgIds: string[] }) {
  return terminalize(params.subject, params.allowedOrgIds, params.userId, 'fulfilled', null)
}

/** Promesse ANNULÉE — « plus attendue », avec motif. */
export function cancelPromise(params: { subject: PromiseSubjectRef; userId: string; allowedOrgIds: string[]; reason?: string | null }) {
  return terminalize(params.subject, params.allowedOrgIds, params.userId, 'cancelled', params.reason ?? null)
}

/**
 * Promesse REMPLACÉE : crée la remplaçante DANS LA MÊME TABLE (self-FK valide),
 * relie l'ancienne à la nouvelle, puis rend l'ancienne terminale — dans cet
 * ordre, avec COMPENSATION si la terminalisation échoue (concurrence) : la
 * remplaçante fraîchement insérée est supprimée, l'ancienne reste active. On ne
 * laisse jamais deux promesses actives ni un lien orphelin.
 */
export async function replacePromise(params: {
  subject: PromiseSubjectRef
  userId: string
  allowedOrgIds: string[]
  replacement: NewPromiseInput
}): Promise<PromiseResolutionResult> {
  const { subject, userId, allowedOrgIds, replacement } = params
  const cfg = TABLES[subject.table]
  const supabase = createAdminClient()
  const row = await loadWithinOrg(supabase, subject, allowedOrgIds)
  if (!row) return { status: 'not_found' }
  if (!replacement.title.trim()) return { status: 'not_found' }

  const now = new Date().toISOString()
  // 1) Insérer la remplaçante.
  const { data: inserted, error: insErr } = await supabase
    .from(subject.table)
    .insert(cfg.buildReplacement(row, { title: replacement.title.trim(), body: replacement.body ?? null }, userId, now))
    .select('id')
    .single()
  if (insErr || !inserted) throw insErr ?? new Error('insertion de la promesse remplaçante impossible')
  const newId = (inserted as { id: string }).id

  // 2) Terminaliser l'ancienne + poser le lien, gardé par le statut actif.
  const { data: updated, error: updErr } = await supabase
    .from(subject.table)
    .update({
      status: cfg.replaced,
      [cfg.replacementCol]: newId,
      [cfg.reviewerCol]: userId,
      [cfg.reviewedAtCol]: now,
      updated_at: now,
    })
    .eq('id', subject.id)
    .eq('status', cfg.active)
    .select('site_id')
  if (updErr) {
    // Compensation best-effort : ne pas laisser la remplaçante orpheline.
    await supabase.from(subject.table).delete().eq('id', newId)
    throw updErr
  }
  const rows = (updated as Array<{ site_id: string }> | null) ?? []
  if (rows.length === 0) {
    // L'ancienne était déjà terminale (concurrence) : on annule la remplaçante.
    await supabase.from(subject.table).delete().eq('id', newId)
    return { status: 'already_terminal' }
  }

  invalidateSiteProjection(row.site_id)
  return { status: 'resolved', outcome: 'replaced', siteId: row.site_id, replacementId: newId }
}

/**
 * Créer une ACTION DE SUIVI — geste DISTINCT de la résolution : la promesse
 * reste dans son état (souvent active). Ne ferme jamais le signal ; c'est une
 * commodité, pas une issue de la promesse.
 */
export async function createPromiseFollowUp(params: {
  subject: PromiseSubjectRef
  userId: string
  allowedOrgIds: string[]
  title: string
  body?: string | null
}): Promise<{ status: 'created'; actionId: string; siteId: string } | { status: 'not_found' }> {
  const supabase = createAdminClient()
  const row = await loadWithinOrg(supabase, params.subject, params.allowedOrgIds)
  if (!row || !params.title.trim()) return { status: 'not_found' }

  const actionId = await createSiteAction({
    site_id: row.site_id,
    title: params.title.trim(),
    body: params.body ?? null,
    created_by: params.userId,
    created_from: 'promise_follow_up',
  })
  invalidateSiteProjection(row.site_id)
  return { status: 'created', actionId, siteId: row.site_id }
}
