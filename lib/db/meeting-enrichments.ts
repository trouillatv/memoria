// lib/db/meeting-enrichments.ts
// Historique des ENRICHISSEMENTS d'une réunion : tout ce qui a été ajouté à la
// mémoire après coup (PJ, participants, documents). « La mémoire vivante » se
// raconte — date · qui · quoi — pas un simple badge. Lecture seule.

import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteReport } from '@/lib/db/site-reports'
import { listDocumentsForTarget } from '@/lib/db/documents'

export interface MeetingEnrichment {
  date: string
  who: string | null
  what: string
}

export async function getMeetingEnrichments(reportId: string): Promise<MeetingEnrichment[]> {
  const sb = createAdminClient()
  const report = await getSiteReport(reportId)
  if (!report) return []

  const [attRes, docs] = await Promise.all([
    sb.from('site_report_attachments')
      .select('filename, kind, created_at, added_by')
      .eq('report_id', reportId).eq('uploaded_after_meeting', true),
    listDocumentsForTarget('site_report', reportId).catch(() => []),
  ])

  type Raw = { date: string; byId: string | null; what: string }
  const raws: Raw[] = []

  for (const a of (attRes.data ?? []) as Array<{ filename: string | null; kind: string; created_at: string; added_by: string | null }>) {
    raws.push({ date: a.created_at, byId: a.added_by, what: `${a.kind === 'photo' ? 'Photo' : 'Pièce'} ajoutée${a.filename ? ` : ${a.filename}` : ''}` })
  }
  for (const p of report.participants ?? []) {
    if (p.addedAfterMeeting && p.addedAt) raws.push({ date: p.addedAt, byId: p.addedBy ?? null, what: `Participant ajouté : ${p.name}` })
  }
  for (const d of docs) {
    raws.push({ date: d.created_at, byId: (d as { created_by?: string | null }).created_by ?? null, what: `Document ajouté : ${d.filename}` })
  }

  // Résolution des auteurs.
  const ids = [...new Set(raws.map((r) => r.byId).filter((x): x is string => !!x))]
  const nameById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: users } = await sb.from('users').select('id, full_name, email').in('id', ids)
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
      nameById.set(u.id, ((u.full_name ?? '').trim() || (u.email.split('@')[0] ?? '')))
    }
  }

  return raws
    .filter((r) => r.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({ date: r.date, who: r.byId ? (nameById.get(r.byId) ?? null) : null, what: r.what }))
}
