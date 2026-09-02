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
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { resolveSubjectAndAttachCanonicalBusinessObject } from '@/lib/db/canonical-business-object-attach'
import {
  reportProvenanceType, mobileSourceHref, desktopSourceHref, cardProvenanceLine,
  PROVENANCE_LINK_LABEL, type ProvenanceType,
} from '@/lib/knowledge/action-provenance'

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
  /** Lien vers le site_report source (PV historique). Null pour les réserves manuelles. */
  reportId: string | null
}

// ---------------------------------------------------------------------------
// Helpers PURS (testables) — pas de DB.
// ---------------------------------------------------------------------------

// VOCABULAIRE JURIDIQUE : 'lifted' s'affiche "Levée", jamais "résolu".
export const RESERVE_STATUS_META: Record<ReserveStatus, { label: string }> = {
  open:   { label: 'Ouvert' },
  lifted: { label: 'Levé' },
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
  report_id: string | null
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
    reportId: r.report_id ?? null,
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
      'id, site_id, label, location, issued_by, issued_on, status, photo_before_path, photo_after_path, lifted_at, lift_note, created_at, report_id',
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
// Provenance d'une réserve — objet → source (point 7A). STRUCTUREL uniquement :
// on lit `report_id` (déjà porté par la réserve), on résout l'origine du report
// et on compose la route canonique. Aucune inférence : une réserve sans
// `report_id`, ou dont le report a disparu, n'a PAS de lien (jamais fabriqué).
// ---------------------------------------------------------------------------

export interface ReserveSourceLink {
  type: ProvenanceType
  /** « Issue du PV du 22 juillet » — déterministe (type + date). */
  line: string
  /** « Voir le document » / « Voir la visite » / « Voir le compte rendu ». */
  linkLabel: string
  mobileHref: string | null
  desktopHref: string | null
}

const SOURCE_DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long' })
function sourceDateLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : SOURCE_DATE_FMT.format(d)
}

/** Résout la source (batch) des réserves qui portent un `report_id`. Clé = reserve id. */
export async function resolveReserveSourceLinks(
  reserves: Array<{ id: string; reportId: string | null }>,
  siteId: string,
): Promise<Map<string, ReserveSourceLink>> {
  const out = new Map<string, ReserveSourceLink>()
  const withReport = reserves.filter((r) => r.reportId)
  if (withReport.length === 0) return out

  const reportIds = [...new Set(withReport.map((r) => r.reportId as string))]
  const sb = createAdminClient()
  const { data } = await sb
    .from('site_reports')
    .select('id, origin, started_at, created_at')
    .in('id', reportIds)
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const byId = new Map(
    ((data ?? []) as Array<{ id: string; origin: string | null; started_at: string | null; created_at: string }>)
      .map((r) => [r.id, r]),
  )

  for (const r of withReport) {
    const rep = byId.get(r.reportId as string)
    if (!rep) continue // source introuvable → aucun lien inventé
    const type = reportProvenanceType(rep.origin)
    out.set(r.id, {
      type,
      line: cardProvenanceLine({ kind: 'source', type, dateLabel: sourceDateLabel(rep.started_at ?? rep.created_at) }),
      linkLabel: PROVENANCE_LINK_LABEL[type],
      mobileHref: mobileSourceHref(type, { siteId, reportId: r.reportId ?? null }),
      desktopHref: desktopSourceHref(type, { siteId, reportId: r.reportId ?? null }),
    })
  }
  return out
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
  /** Capture d'origine (mig 183) — traçabilité de la réserve née d'une visite. */
  sourceCaptureId?: string | null
  /** Point 7B-1b — rapport source (visite/réunion/PV) quand il est DÉJÀ connu par
   *  l'appelant (débrief mobile, promotion watchlist). Omis/`null` pour une réserve
   *  réellement manuelle (réception MOE) ou copilote sans source : on n'invente
   *  jamais un report par date/libellé. Alimente `site_reserve.report_id`,
   *  symétrique de `site_actions.report_id` (provenance objet→source, 7A). */
  reportId?: string | null
  /**
   * Fourni par un appelant qui a DÉJÀ vérifié le droit d'écriture (ex.
   * copilot-write-action.ts via requireSiteWriteAccess) — saute la vérification
   * interne requireOrganizationMembership(), qui résout la session HTTP
   * courante et ne fonctionne pas hors contexte HTTP (ex. harnais de recette).
   * Omis : comportement inchangé pour les appelants existants (desktop/terrain).
   */
  organizationId?: string | null
  /** Idempotence Copilote (mig 333) — cf. copilot_proposal_id sur site_watchpoints/site_deadlines. */
  copilotProposalId?: string | null
}): Promise<{ id: string }> {
  const sb = createAdminClient()
  let organizationId = input.organizationId ?? null
  if (!organizationId) {
    const { data: siteRow } = await sb.from('sites').select('organization_id').eq('id', input.siteId).maybeSingle()
    if (!siteRow) throw new Error('Chantier introuvable')
    const membership = await requireOrganizationMembership((siteRow as { organization_id: string }).organization_id)
    if (!membership.ok) throw new Error(membership.error)
    organizationId = (siteRow as { organization_id: string }).organization_id
  }
  const { data, error } = await sb
    .from('site_reserve')
    .insert({
      site_id: input.siteId,
      organization_id: organizationId,
      label: input.label,
      location: input.location,
      issued_by: input.issuedBy,
      issued_on: input.issuedOn,
      status: 'open',
      created_by: input.userId,
      source_capture_id: input.sourceCaptureId ?? null,
      report_id: input.reportId ?? null,
      copilot_proposal_id: input.copilotProposalId ?? null,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  const reserveId = data.id as string
  // P1-C2B.2 (mig 347) : rattachement sujet canonique + canonical_business_object,
  // best-effort/non bloquant — même resolver que site_actions/site_deadlines (mig 346).
  void resolveSubjectAndAttachCanonicalBusinessObject({
    siteId: input.siteId,
    entityType: 'site_reserve',
    entityId: reserveId,
    label: input.label,
    date: input.issuedOn ?? null,
  })
  return { id: reserveId }
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
