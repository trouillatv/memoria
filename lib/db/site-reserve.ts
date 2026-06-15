// Réserves / levée de réserves — Tier 1 BTP (2026-06-15).
//
// À la réception (OPR), la MOE dresse les RÉSERVES (défauts à corriger).
// L'entreprise les LÈVE une à une avec preuve (photo avant/après) et date.
// Une réserve est SITE-scoped, émise par la MOE.
//
// Doctrine : descriptif, niveau SITE, calme. VOCABULAIRE : status 'lifted' =
// "Levée" — jamais "résolu" (juridiquement dangereux) ; on dit "levée" /
// "clôturée". Sécurité : admin client + scoping `organization_id`.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

export type ReserveStatus = 'open' | 'lifted'

export interface SiteReserve {
  id: string
  siteId: string
  label: string
  location: string | null
  issuedBy: string | null
  issuedOn: string | null // yyyy-mm-dd
  status: ReserveStatus
  photoBeforePath: string | null
  photoAfterPath: string | null
  liftedAt: string | null // ISO
  liftNote: string | null
  createdAt: string // ISO
}

// ---------------------------------------------------------------------------
// Helpers PURS (testables) — pas de DB.
// ---------------------------------------------------------------------------

// VOCABULAIRE JURIDIQUE : 'lifted' s'affiche "Levée", jamais "résolu".
export const RESERVE_STATUS_META: Record<ReserveStatus, { label: string }> = {
  open:   { label: 'Ouverte' },
  lifted: { label: 'Levée' },
}

export function statusLabel(status: ReserveStatus): string {
  return RESERVE_STATUS_META[status]?.label ?? status
}

export interface ReserveSummary {
  open: number
  lifted: number
}

export function summarizeReserves(reserves: SiteReserve[]): ReserveSummary {
  const summary: ReserveSummary = { open: 0, lifted: 0 }
  for (const r of reserves) {
    if (r.status === 'lifted') summary.lifted += 1
    else summary.open += 1
  }
  return summary
}

// ---------------------------------------------------------------------------
// Mapping ligne DB → type métier
// ---------------------------------------------------------------------------

type ReserveRow = {
  id: string
  site_id: string
  label: string
  location: string | null
  issued_by: string | null
  issued_on: string | null
  status: string
  photo_before_path: string | null
  photo_after_path: string | null
  lifted_at: string | null
  lift_note: string | null
  created_at: string
}

function mapRow(r: ReserveRow): SiteReserve {
  return {
    id: r.id,
    siteId: r.site_id,
    label: r.label,
    location: r.location ?? null,
    issuedBy: r.issued_by ?? null,
    issuedOn: r.issued_on ?? null,
    status: r.status === 'lifted' ? 'lifted' : 'open',
    photoBeforePath: r.photo_before_path ?? null,
    photoAfterPath: r.photo_after_path ?? null,
    liftedAt: r.lifted_at ?? null,
    liftNote: r.lift_note ?? null,
    createdAt: r.created_at,
  }
}

/** Dégradation gracieuse si la table n'existe pas encore (migration 110). */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return code === '42P01' || msg.includes('does not exist') || msg.includes('site_reserve')
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function getSiteReserves(siteId: string): Promise<SiteReserve[]> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('site_reserve')
    .select(
      'id, site_id, label, location, issued_by, issued_on, status, photo_before_path, photo_after_path, lifted_at, lift_note, created_at',
    )
    .eq('site_id', siteId)
    // Ouvertes d'abord, puis par date d'émission la plus récente.
    .order('status', { ascending: true })
    .order('issued_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return (data ?? []).map((r) => mapRow(r as ReserveRow))
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export async function createSiteReserve(input: {
  siteId: string
  label: string
  location: string | null
  issuedBy: string | null
  issuedOn: string | null
  userId: string | null
}): Promise<{ id: string }> {
  const sb = createAdminClient()
  const orgId = await getOrgId()
  const { data, error } = await sb
    .from('site_reserve')
    .insert({
      site_id: input.siteId,
      organization_id: orgId,
      label: input.label,
      location: input.location,
      issued_by: input.issuedBy,
      issued_on: input.issuedOn,
      status: 'open',
      created_by: input.userId,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  return { id: data.id as string }
}

/** Levée d'une réserve : status='lifted' + lifted_at=now. Jamais "résolu". */
export async function liftReserve(input: {
  id: string
  liftNote: string | null
  photoAfterPath: string | null
  userId: string | null
}): Promise<void> {
  const sb = createAdminClient()
  const patch: Record<string, unknown> = {
    status: 'lifted',
    lifted_at: new Date().toISOString(),
    lift_note: input.liftNote,
    updated_at: new Date().toISOString(),
  }
  // On n'écrase pas une photo "après" existante si aucune nouvelle n'est fournie.
  if (input.photoAfterPath) patch.photo_after_path = input.photoAfterPath

  const { error } = await sb
    .from('site_reserve')
    .update(patch)
    .eq('id', input.id)
  if (error) throw error
}

/** Attache la photo de constat (avant) après son upload storage. */
export async function setReserveBeforePhoto(id: string, path: string): Promise<void> {
  const sb = createAdminClient()
  const { error } = await sb
    .from('site_reserve')
    .update({ photo_before_path: path, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
