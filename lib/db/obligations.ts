// Obligations chantier (migration 146) — l'objet métier PRESCRIPTIF.
//
// Une obligation doit exister dès le démarrage ; c'est son ABSENCE/négligence qui est
// le signal. Santé DÉRIVÉE (ok | négligée), déterministe, zéro IA — comme les insights
// du sujet. La bibliothèque (obligation_template) EST la connaissance métier : pas de
// parsing CCTP. L'IA propose la liste standard, l'humain valide (non_applicable = écarter).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type { MemorySignal } from '@/lib/db/site-memory-signals'

export type ObligationStatus = 'a_produire' | 'en_cours' | 'satisfaite' | 'non_applicable'
export type VerificationKind = 'document' | 'photo_journal' | 'control_event'

export interface ObligationTemplate {
  id: string
  code: string
  label: string
  defaultResponsibleRole: string
  trigger: 'kickoff' | 'phase' | 'manual'
  phaseKey: string | null
  closure: 'on_artifact' | 'at_reception' | 'recurring_until_reception'
  verificationKind: VerificationKind
  verificationParam: Record<string, unknown>
  themes: string[]
  isSystem: boolean
}

export interface SiteObligation {
  id: string
  siteId: string
  templateId: string | null
  label: string
  responsibleRole: string
  status: ObligationStatus
  verificationKind: VerificationKind
  subjectId: string | null
  createdAt: string
  satisfiedAt: string | null
  // — Santé DÉRIVÉE —
  neglected: boolean
  healthReason: string | null
}

function todayIso(): string { return new Date().toISOString().slice(0, 10) }
function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86400000)
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

function mapTemplate(r: Record<string, unknown>): ObligationTemplate {
  return {
    id: r.id as string, code: r.code as string, label: r.label as string,
    defaultResponsibleRole: r.default_responsible_role as string,
    trigger: r.trigger as ObligationTemplate['trigger'],
    phaseKey: (r.phase_key as string | null) ?? null,
    closure: r.closure as ObligationTemplate['closure'],
    verificationKind: r.verification_kind as VerificationKind,
    verificationParam: (r.verification_param as Record<string, unknown>) ?? {},
    themes: (r.themes as string[]) ?? [],
    isSystem: r.organization_id == null,
  }
}

/** Catalogue applicable à une org : modèles SYSTÈME (livrés) + ajouts de l'org. */
export async function listObligationTemplates(): Promise<ObligationTemplate[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId().catch(() => null)
  let q = supabase.from('obligation_template').select('*').eq('is_active', true)
  q = orgId ? q.or(`organization_id.is.null,organization_id.eq.${orgId}`) : q.is('organization_id', null)
  const { data } = await q.order('sort_order', { ascending: true })
  return ((data ?? []) as Record<string, unknown>[]).map(mapTemplate)
}

// ---------------------------------------------------------------------------
// Instanciation (injection au démarrage — l'humain a validé la sélection)
// ---------------------------------------------------------------------------

export async function instantiateObligations(siteId: string, templateIds: string[], userId: string | null): Promise<number> {
  if (templateIds.length === 0) return 0
  const supabase = createAdminClient()
  const orgId = await getOrgId().catch(() => null)
  const { data: tpls } = await supabase.from('obligation_template').select('*').in('id', templateIds)
  const rows = ((tpls ?? []) as Record<string, unknown>[]).map((t) => ({
    site_id: siteId,
    organization_id: orgId,
    template_id: t.id,
    label: t.label,
    responsible_role: t.default_responsible_role,
    status: 'a_produire',
    trigger: t.trigger,
    phase_key: t.phase_key,
    closure: t.closure,
    verification_kind: t.verification_kind,
    verification_param: t.verification_param,
    created_by: userId,
  }))
  if (rows.length === 0) return 0
  // Idempotent : l'unique (site_id, template_id) évite les doublons à la ré-injection.
  const { data, error } = await supabase
    .from('site_obligation')
    .upsert(rows, { onConflict: 'site_id,template_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  return (data ?? []).length
}

export async function setObligationStatus(id: string, status: ObligationStatus, note?: string | null): Promise<void> {
  const supabase = createAdminClient()
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === 'satisfaite') { patch.satisfied_at = new Date().toISOString(); if (note) patch.satisfied_note = note }
  const { error } = await supabase.from('site_obligation').update(patch).eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Santé dérivée (déterministe)
// ---------------------------------------------------------------------------

interface HealthCtx { today: string; lastSitePhotoIso: string | null }
interface ObRow {
  status: string; verification_kind: string; verification_param: Record<string, unknown> | null; created_at: string
}
/** Calcul PUR de la négligence d'une obligation (zéro IA). */
function computeHealth(ob: ObRow, ctx: HealthCtx): { neglected: boolean; reason: string | null } {
  if (ob.status === 'satisfaite' || ob.status === 'non_applicable') return { neglected: false, reason: null }
  const param = ob.verification_param ?? {}
  const ageDays = daysBetween(ob.created_at.slice(0, 10), ctx.today)
  if (ob.verification_kind === 'photo_journal') {
    const staleness = (param.staleness_days as number) ?? 21
    if (!ctx.lastSitePhotoIso) {
      return ageDays >= staleness ? { neglected: true, reason: `Aucune photo de chantier (depuis ${ageDays} j)` } : { neglected: false, reason: null }
    }
    const sincePhoto = daysBetween(ctx.lastSitePhotoIso.slice(0, 10), ctx.today)
    return sincePhoto >= staleness ? { neglected: true, reason: `Journal vide depuis ${sincePhoto} j` } : { neglected: false, reason: null }
  }
  // document & control_event : minuterie de négligence depuis la création.
  const neglect = (param.neglect_days as number) ?? 30
  return ageDays >= neglect && ob.status === 'a_produire'
    ? { neglected: true, reason: `À produire depuis ${ageDays} j` }
    : { neglected: false, reason: null }
}

/** Dernière photo connue d'un site (report_photos via les CR du site). */
async function lastSitePhoto(siteId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: reps } = await supabase.from('site_reports').select('id').eq('site_id', siteId)
  const ids = (reps ?? []).map((r) => r.id as string)
  if (ids.length === 0) return null
  const { data } = await supabase.from('report_photos').select('created_at').in('report_id', ids).order('created_at', { ascending: false }).limit(1)
  return (data?.[0]?.created_at as string | undefined) ?? null
}

/** Obligations d'un site, avec santé dérivée + libellé de statut. */
export async function getSiteObligations(siteId: string): Promise<SiteObligation[]> {
  const supabase = createAdminClient()
  const [{ data }, lastPhoto] = await Promise.all([
    supabase.from('site_obligation').select('*').eq('site_id', siteId).order('created_at', { ascending: true }),
    lastSitePhoto(siteId),
  ])
  const ctx: HealthCtx = { today: todayIso(), lastSitePhotoIso: lastPhoto }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const h = computeHealth(r as unknown as ObRow, ctx)
    return {
      id: r.id as string, siteId: r.site_id as string, templateId: (r.template_id as string | null) ?? null,
      label: r.label as string, responsibleRole: r.responsible_role as string,
      status: r.status as ObligationStatus, verificationKind: r.verification_kind as VerificationKind,
      subjectId: (r.subject_id as string | null) ?? null, createdAt: r.created_at as string,
      satisfiedAt: (r.satisfied_at as string | null) ?? null,
      neglected: h.neglected, healthReason: h.reason,
    }
  })
}

// ---------------------------------------------------------------------------
// Détecteur briefing — la VITRINE (« Obligations à surveiller »)
// ---------------------------------------------------------------------------

/** Obligations négligées d'un site → signal « Préparer la réunion ». Déterministe. */
export async function detectNeglectedObligations(siteId: string): Promise<MemorySignal | null> {
  const obligations = await getSiteObligations(siteId)
  const neglected = obligations.filter((o) => o.neglected)
  if (neglected.length === 0) return null
  return {
    kind: 'obligation_neglected',
    title: `${neglected.length} obligation${neglected.length > 1 ? 's' : ''} à surveiller`,
    items: neglected.map((o) => ({
      id: o.id,
      label: o.label,
      meta: o.responsibleRole,
      context: o.healthReason ? [o.healthReason] : [],
    })),
    source: 'Obligations chantier (site_obligation) restées à produire / négligées (bibliothèque, déterministe).',
  }
}
