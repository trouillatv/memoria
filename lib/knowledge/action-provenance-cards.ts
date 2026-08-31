import 'server-only'

// ── PROVENANCE COMPACTE POUR LES CARTES (/m/actions) ─────────────────────────
// Une ligne secondaire par action : « Issue du PV du 25 août 2026 », etc. —
// UNIQUEMENT depuis les relations STRUCTURELLES de site_actions (mêmes colonnes
// FK que la fiche : reserve_id > report_id > source_capture_id > subject_id),
// jamais depuis le titre/canonical_subject/une proximité de date. Résolution en
// BATCH (aucun N+1) : on collecte les ids par type puis une requête par table.
// Une action sans provenance démontrable N'A PAS de ligne (clé absente du map).

import { createAdminClient } from '@/lib/supabase/admin'
import type { SiteActionRow } from '@/lib/db/site-actions'
import {
  primaryProvenanceKind, reportProvenanceType, mobileSourceHref, cardProvenanceLine,
} from '@/lib/knowledge/action-provenance'

export interface CardProvenance {
  label: string
  /** Route `/m` réelle, ou null (libellé sans lien — jamais un renvoi desktop). */
  href: string | null
}

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric',
})
const frDate = (iso: string | null | undefined): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

type ReportRow = { id: string; origin: string | null; started_at: string | null; created_at: string }
type ReserveRow = { id: string; issued_on: string | null; created_at: string }
type SubjectRow = { id: string; name: string }

/**
 * Résout la ligne de provenance de chaque action, en batch. Retourne un map
 * `actionId -> CardProvenance` NE CONTENANT QUE les actions à provenance
 * démontrable (source résolue, ou « Créée manuellement »). Les actions à origine
 * inconnue sont absentes du map (aucune ligne sur leur carte).
 */
export async function resolveActionProvenanceLines(
  rows: Pick<SiteActionRow, 'id' | 'site_id' | 'report_id' | 'reserve_id' | 'source_capture_id' | 'subject_id' | 'created_from'>[],
): Promise<Record<string, CardProvenance>> {
  if (rows.length === 0) return {}
  const db = createAdminClient()

  // 1) Résoudre les captures → leur report (une visite terrain).
  const captureIds = [...new Set(rows.map((r) => r.source_capture_id).filter((v): v is string => !!v))]
  const captureToReport = new Map<string, string>()
  if (captureIds.length > 0) {
    const { data } = await db.from('visit_capture').select('id, report_id').in('id', captureIds)
    for (const c of (data ?? []) as Array<{ id: string; report_id: string | null }>) {
      if (c.report_id) captureToReport.set(c.id, c.report_id)
    }
  }

  // 2) Collecter les ids par table (report_id direct + report via capture).
  const reportIds = new Set<string>()
  const reserveIds = new Set<string>()
  const subjectIds = new Set<string>()
  for (const r of rows) {
    const kind = primaryProvenanceKind({
      reserveId: r.reserve_id, reportId: r.report_id,
      sourceCaptureId: r.source_capture_id, subjectId: r.subject_id,
    })
    if (kind === 'reserve' && r.reserve_id) reserveIds.add(r.reserve_id)
    else if (kind === 'report' && r.report_id) reportIds.add(r.report_id)
    else if (kind === 'capture' && r.source_capture_id) {
      const rep = captureToReport.get(r.source_capture_id)
      if (rep) reportIds.add(rep)
    } else if (kind === 'subject' && r.subject_id) subjectIds.add(r.subject_id)
  }

  // 3) Une requête par table.
  const reports = new Map<string, ReportRow>()
  if (reportIds.size > 0) {
    const { data } = await db.from('site_reports').select('id, origin, started_at, created_at').in('id', [...reportIds])
    for (const r of (data ?? []) as ReportRow[]) reports.set(r.id, r)
  }
  const reserves = new Map<string, ReserveRow>()
  if (reserveIds.size > 0) {
    const { data } = await db.from('site_reserve').select('id, issued_on, created_at').in('id', [...reserveIds])
    for (const r of (data ?? []) as ReserveRow[]) reserves.set(r.id, r)
  }
  const subjects = new Map<string, SubjectRow>()
  if (subjectIds.size > 0) {
    const { data } = await db.from('subjects').select('id, name').in('id', [...subjectIds])
    for (const s of (data ?? []) as SubjectRow[]) subjects.set(s.id, s)
  }

  // 4) Composer la ligne par action.
  const out: Record<string, CardProvenance> = {}
  for (const r of rows) {
    const kind = primaryProvenanceKind({
      reserveId: r.reserve_id, reportId: r.report_id,
      sourceCaptureId: r.source_capture_id, subjectId: r.subject_id,
    })

    if (kind === 'reserve' && r.reserve_id) {
      const res = reserves.get(r.reserve_id)
      if (!res) continue // objet disparu : pas de ligne sur la carte (la fiche dira « indisponible »)
      out[r.id] = {
        label: cardProvenanceLine({ kind: 'source', type: 'reserve', dateLabel: frDate(res.issued_on ?? res.created_at) }),
        href: mobileSourceHref('reserve', { siteId: r.site_id, reportId: null }),
      }
    } else if (kind === 'report' || kind === 'capture') {
      const reportId = kind === 'report' ? r.report_id : (r.source_capture_id ? captureToReport.get(r.source_capture_id) ?? null : null)
      const rep = reportId ? reports.get(reportId) : null
      if (!rep) continue
      const type = reportProvenanceType(rep.origin)
      out[r.id] = {
        label: cardProvenanceLine({ kind: 'source', type, dateLabel: frDate(rep.started_at ?? rep.created_at) }),
        href: mobileSourceHref(type, { siteId: r.site_id, reportId }),
      }
    } else if (kind === 'subject' && r.subject_id) {
      const s = subjects.get(r.subject_id)
      if (!s) continue
      out[r.id] = {
        label: cardProvenanceLine({ kind: 'source', type: 'sujet', dateLabel: null, name: s.name }),
        href: mobileSourceHref('sujet', { siteId: r.site_id, reportId: null }),
      }
    } else if (kind === null && r.created_from != null) {
      // Aucune source documentaire mais une porte MemorIA connue → création directe.
      out[r.id] = { label: cardProvenanceLine({ kind: 'manual' }), href: null }
    }
    // kind === null && created_from == null → origine inconnue : aucune ligne.
  }
  return out
}
