// Points STRUCTURÉS ajoutés en séance (mig 134) : anomalie / prévision saisies par
// Émeline quand le terrain ne les a pas remontées. Objets TYPÉS (≠ texte libre des
// report_human_points). Mémorisés au report ; ajout éditorial → vraie suppression.
import { createAdminClient } from '@/lib/supabase/admin'
import type { PointExamine, PointExamineStatut } from './points-examines'
import type { PrevisionItem } from './site-previsions'

export type AddedPointKind = 'anomalie' | 'prevision'
const ANOMALIE_STATUTS: PointExamineStatut[] = ['bloqué', 'en cours', 'à faire', 'en attente']

export interface ReportAddedPoint {
  id: string
  kind: AddedPointKind
  label: string
  statut: string | null
  dueDate: string | null
  assignedTo: string | null
}

function ddmmyyyy(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

export async function listReportAddedPoints(reportId: string): Promise<ReportAddedPoint[]> {
  const { data } = await createAdminClient()
    .from('report_added_points')
    .select('id, kind, label, statut, due_date, assigned_to, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  return (data ?? []).map((p) => ({
    id: p.id as string,
    kind: p.kind as AddedPointKind,
    label: (p.label as string) ?? '',
    statut: (p.statut as string | null) ?? null,
    dueDate: (p.due_date as string | null) ?? null,
    assignedTo: (p.assigned_to as string | null) ?? null,
  }))
}

/** Anomalies ajoutées → points examinés typés (blocage), source stable `added:<id>`. */
export async function listAddedAnomaliesAsPoints(reportId: string): Promise<PointExamine[]> {
  const rows = await listReportAddedPoints(reportId)
  return rows
    .filter((r) => r.kind === 'anomalie')
    .map((r) => ({
      type: 'blocage',
      sousTitre: 'ANOMALIES SIGNALÉES EN SÉANCE',
      texte: `Anomalie signalée : ${r.label}`,
      action: null,
      statut: (ANOMALIE_STATUTS as string[]).includes(r.statut ?? '') ? (r.statut as PointExamineStatut) : 'bloqué',
      source: `added:${r.id}`,
      confiance: 'sûr',
    }))
}

/** Prévisions ajoutées → items de prévision structurés, source stable `added:<id>`. */
export async function listAddedPrevisions(reportId: string): Promise<PrevisionItem[]> {
  const rows = await listReportAddedPoints(reportId)
  return rows
    .filter((r) => r.kind === 'prevision')
    .map((r) => {
      const det = [r.assignedTo, r.dueDate ? `éch. ${ddmmyyyy(r.dueDate)}` : null].filter(Boolean).join(', ')
      return {
        kind: 'intervention' as const,
        texte: det ? `${r.label} (${det})` : r.label,
        confiance: 'sûr' as const,
        source: `added:${r.id}`,
      }
    })
}

export async function addReportAddedPoint(input: {
  reportId: string
  kind: AddedPointKind
  label: string
  statut?: string | null
  dueDate?: string | null
  assignedTo?: string | null
  createdBy?: string | null
}): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('report_added_points')
    .insert({
      report_id: input.reportId,
      kind: input.kind,
      label: input.label.trim(),
      statut: input.kind === 'anomalie' ? (input.statut?.trim() || 'bloqué') : null,
      due_date: input.kind === 'prevision' ? (input.dueDate || null) : null,
      assigned_to: input.kind === 'prevision' ? (input.assignedTo?.trim() || null) : null,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

/** Suppression scopée au report. Renvoie true si une ligne a été retirée. */
export async function deleteReportAddedPoint(reportId: string, id: string): Promise<boolean> {
  const { error, count } = await createAdminClient()
    .from('report_added_points')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('report_id', reportId)
  if (error) throw new Error(error.message)
  return (count ?? 0) > 0
}
