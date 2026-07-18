import 'server-only'

// ── LA FICHE ACTION — read model d'UNE action, lecture canonique (Lot 4 · 3) ──
// « La fiche Action devient capable de lire entièrement une action. » Une seule
// lecture, site-scopée + fail-closed org (le service-role bypasse la RLS). Le
// responsable est la PREUVE structurelle (assigned_contact_id) ; assigned_to
// n'est qu'une trace texte historique. Réutilise les objets/tables existants,
// aucune nouvelle source de vérité.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso } from '@/lib/time/local-date'
import type { DbSiteAction, SiteActionStatus } from '@/types/db'

const STATUS_LABEL: Record<SiteActionStatus, string> = {
  open: 'Ouverte', planned: 'Planifiée', done: 'Terminée', cancelled: 'Annulée',
}
/** Libellé métier d'un statut d'action (pur, testable). */
export function actionStatusLabel(s: SiteActionStatus): string {
  return STATUS_LABEL[s] ?? s
}

export type ActionFicheResponsible =
  | { kind: 'contact'; name: string; fonction: string | null }
  | { kind: 'text'; label: string }

/** La source PRIMAIRE d'une action (lien minimal en Slice 3 ; la provenance
 *  détaillée Visite/Réunion/Réserve/Observation viendra en Slice 5). */
export interface ActionFicheSource {
  kind: 'report' | 'reserve' | 'sujet'
  label: string
  href: string
}

export interface ActionFicheData {
  id: string
  siteId: string
  title: string
  body: string | null
  corpsEtat: string | null
  status: SiteActionStatus
  statusLabel: string
  /** Responsable identifié (personne) ou trace texte historique, ou aucun. */
  responsible: ActionFicheResponsible | null
  dueDate: string | null
  dueDateStatus: 'explicit' | 'estimated' | null
  /** Retard = échéance EXPLICITE passée, action non terminée (jour civil Nouméa). */
  isLate: boolean
  source: ActionFicheSource | null
  createdAt: string
  doneAt: string | null
}

/** UNE action, entièrement lue. `null` si hors org, ou si l'action n'appartient
 *  pas à ce chantier (fail-closed, garde IDOR). */
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

  // Source primaire (lien minimal). L'ordre reflète l'origine la plus spécifique.
  let source: ActionFicheSource | null = null
  if (a.report_id) source = { kind: 'report', label: 'Voir l’origine', href: `/meetings/${a.report_id}` }
  else if (a.reserve_id) source = { kind: 'reserve', label: 'Réserve liée', href: `/sites/${siteId}/reserves` }
  else if (a.subject_id) source = { kind: 'sujet', label: 'Sujet lié', href: `/sites/${siteId}/subjects/${a.subject_id}` }

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
    createdAt: a.created_at,
    doneAt: a.done_at,
  }
}
