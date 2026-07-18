import 'server-only'

// ── LA FICHE ACTION — read model d'UNE action, lecture canonique (Lot 4) ──────
// « La fiche Action devient capable de lire entièrement une action. » Une seule
// lecture, site-scopée + fail-closed org (le service-role bypasse la RLS). Le
// responsable est la PREUVE structurelle (assigned_contact_id) ; assigned_to
// n'est qu'une trace texte. La provenance (Slice 5) est STRUCTURELLE (colonnes
// FK), jamais inférée du titre/texte. Le read model est l'UNIQUE lieu de
// composition ; le composant ne fait qu'afficher.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso } from '@/lib/time/local-date'
import type { DbSiteAction, SiteActionStatus } from '@/types/db'
import {
  primaryProvenanceKind, PROVENANCE_TYPE_LABEL, PROVENANCE_LINK_LABEL,
  type ActionFicheSource, type ActionFicheContext, type ProvenanceType,
} from '@/lib/knowledge/action-provenance'

type Db = SupabaseClient

const STATUS_LABEL: Record<SiteActionStatus, string> = {
  open: 'Ouverte', planned: 'Planifiée', done: 'Terminée', cancelled: 'Annulée',
}
/** Libellé métier d'un statut d'action (pur, testable). */
export function actionStatusLabel(s: SiteActionStatus): string {
  return STATUS_LABEL[s] ?? s
}

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric',
})
const frDate = (iso: string | null | undefined): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

export type ActionFicheResponsible =
  | { kind: 'contact'; name: string; fonction: string | null }
  | { kind: 'text'; label: string }

export interface ActionFicheData {
  id: string
  siteId: string
  title: string
  body: string | null
  corpsEtat: string | null
  status: SiteActionStatus
  statusLabel: string
  responsible: ActionFicheResponsible | null
  dueDate: string | null
  dueDateStatus: 'explicit' | 'estimated' | null
  isLate: boolean
  /** Origine PRIMAIRE (structurelle). `available: false` = relation présente mais
   *  objet introuvable → « Origine indisponible ». */
  source: ActionFicheSource | null
  /** Contexte SECONDAIRE (la réunion/visite où l'action est née), quand la source
   *  primaire est une réserve/un sujet. */
  context: ActionFicheContext | null
  createdAt: string
  doneAt: string | null
}

// ── Chargements de provenance — TOUS scopés au chantier (garde IDOR) ─────────

type LoadedReport = { origin: string | null; date: string | null; title: string | null } | 'missing'

async function loadReport(db: Db, siteId: string, reportId: string): Promise<LoadedReport> {
  const { data } = await db.from('site_reports')
    .select('origin, title, started_at, created_at').eq('id', reportId).eq('site_id', siteId).maybeSingle()
  if (!data) return 'missing'
  const r = data as { origin: string | null; title: string | null; started_at: string | null; created_at: string }
  return { origin: r.origin, date: r.started_at ?? r.created_at, title: r.title }
}

/** Une source « report » (réunion ou visite) — libellés depuis les données réelles. */
function reportSource(r: Exclude<LoadedReport, 'missing'>, reportId: string): ActionFicheSource {
  const type: ProvenanceType = r.origin ? 'visite' : 'reunion'
  return {
    type,
    typeLabel: PROVENANCE_TYPE_LABEL[type],
    title: r.title?.trim() || (type === 'visite' ? 'Visite' : 'Compte rendu'),
    detail: frDate(r.date),
    href: `/meetings/${reportId}`,
    linkLabel: PROVENANCE_LINK_LABEL[type],
    available: true,
  }
}

/** « Origine indisponible » — une relation existait, l'objet a disparu. On ne le
 *  masque JAMAIS silencieusement. */
function unavailable(type: ProvenanceType): ActionFicheSource {
  return { type, typeLabel: PROVENANCE_TYPE_LABEL[type], title: 'Origine indisponible', detail: null, href: null, linkLabel: '', available: false }
}

export async function getSiteActionFiche(siteId: string, actionId: string): Promise<ActionFicheData | null> {
  const orgId = await getOrgId()
  if (!orgId) return null
  const db = createAdminClient()
  const { data: site } = await db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle()
  if (!site || (site as { organization_id: string | null }).organization_id !== orgId) return null

  const { data } = await db.from('site_actions').select('*').eq('id', actionId).eq('site_id', siteId).maybeSingle()
  if (!data) return null
  const a = data as DbSiteAction

  // Responsable : la personne (preuve) d'abord, sinon la trace texte.
  let responsible: ActionFicheResponsible | null = null
  if (a.assigned_contact_id) {
    const { data: c } = await db.from('company_contacts')
      .select('full_name, function').eq('id', a.assigned_contact_id).maybeSingle()
    if (c) responsible = { kind: 'contact', name: (c.full_name as string) ?? '', fonction: (c.function as string | null) ?? null }
  }
  if (!responsible && a.assigned_to) responsible = { kind: 'text', label: a.assigned_to }

  const due = a.due_date ? a.due_date.slice(0, 10) : null
  const isLate = a.due_date_status === 'explicit' && due !== null && due < todayLocalIso()
    && a.status !== 'done' && a.status !== 'cancelled'

  // ── Provenance STRUCTURELLE (Slice 5) : source primaire déterministe ──
  const kind = primaryProvenanceKind({
    reserveId: a.reserve_id, reportId: a.report_id,
    sourceCaptureId: a.source_capture_id, subjectId: a.subject_id,
  })
  let source: ActionFicheSource | null = null
  if (kind === 'reserve' && a.reserve_id) {
    const { data: r } = await db.from('site_reserve')
      .select('label, issued_on, created_at').eq('id', a.reserve_id).eq('site_id', siteId).maybeSingle()
    source = !r
      ? unavailable('reserve')
      : {
          type: 'reserve', typeLabel: PROVENANCE_TYPE_LABEL.reserve,
          title: (r as { label: string }).label,
          detail: frDate((r as { issued_on: string | null; created_at: string }).issued_on ?? (r as { created_at: string }).created_at)
            ? `Constatée le ${frDate((r as { issued_on: string | null; created_at: string }).issued_on ?? (r as { created_at: string }).created_at)}` : null,
          href: `/sites/${siteId}/reserves`, linkLabel: PROVENANCE_LINK_LABEL.reserve, available: true,
        }
  } else if (kind === 'report' && a.report_id) {
    const r = await loadReport(db, siteId, a.report_id)
    source = r === 'missing' ? unavailable('reunion') : reportSource(r, a.report_id)
  } else if (kind === 'capture' && a.source_capture_id) {
    const { data: cap } = await db.from('visit_capture')
      .select('report_id').eq('id', a.source_capture_id).eq('site_id', siteId).maybeSingle()
    const capReportId = (cap as { report_id: string | null } | null)?.report_id ?? null
    if (!capReportId) source = unavailable('visite')
    else {
      const r = await loadReport(db, siteId, capReportId)
      source = r === 'missing' ? unavailable('visite') : reportSource(r, capReportId)
    }
  } else if (kind === 'subject' && a.subject_id) {
    const { data: s } = await db.from('subjects')
      .select('name').eq('id', a.subject_id).eq('site_id', siteId).maybeSingle()
    source = !s
      ? unavailable('sujet')
      : {
          type: 'sujet', typeLabel: PROVENANCE_TYPE_LABEL.sujet, title: (s as { name: string }).name,
          detail: null, href: `/sites/${siteId}/subjects/${a.subject_id}`, linkLabel: PROVENANCE_LINK_LABEL.sujet, available: true,
        }
  }

  // ── Contexte secondaire : la réunion/visite d'origine, quand la source primaire
  //    est une réserve ou un sujet. Vient de la colonne report_id de l'action. ──
  let context: ActionFicheContext | null = null
  if ((kind === 'reserve' || kind === 'subject') && a.report_id) {
    const r = await loadReport(db, siteId, a.report_id)
    if (r !== 'missing') {
      const t = r.origin ? 'Visite' : 'Réunion'
      const d = frDate(r.date)
      context = { label: `${r.title?.trim() || t}${d ? ` · ${d}` : ''}`, href: `/meetings/${a.report_id}` }
    }
  }

  return {
    id: a.id,
    siteId,
    title: a.title,
    body: a.body,
    corpsEtat: a.corps_etat,
    status: a.status,
    statusLabel: actionStatusLabel(a.status),
    responsible,
    dueDate: due,
    dueDateStatus: a.due_date_status,
    isLate,
    source,
    context,
    createdAt: a.created_at,
    doneAt: a.done_at,
  }
}
