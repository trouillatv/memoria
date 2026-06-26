// lib/db/site-chronicle.ts
// SOURCE CANONIQUE de l'histoire d'un chantier — une seule chronologie consolidée.
// Pas « une jolie timeline de plus » : la brique réutilisable par le Journal du
// chantier, l'Atelier mémoire, la Vue sujet, la préparation de dossier.
//
// Réutilise getSiteMemoryTimeline (interventions/photos/anomalies/notes/CR/actions/
// blocages, avec dédup) et AJOUTE décisions, réserves, documents, enrichissements.

import { getSiteMemoryTimeline, type SiteMemoryEvent } from '@/lib/db/site-memory'
import { createAdminClient } from '@/lib/supabase/admin'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { getSiteRecentEnrichments } from '@/lib/db/meeting-enrichments'

export type ChronicleCategory =
  | 'meeting' | 'intervention' | 'photo' | 'document' | 'action'
  | 'decision' | 'reserve' | 'ai' | 'enrichment' | 'anomaly' | 'note' | 'blocage'

export interface ChronicleEvent {
  id: string
  category: ChronicleCategory
  date: string
  title: string
  detail?: string | null
  href?: string
  subjectIds?: string[]
  /** Nom du sujet rattaché (pont vers l'histoire du sujet, affiché en contexte). */
  subjectLabel?: string | null
  source?: string
}

const MEM_CAT: Partial<Record<SiteMemoryEvent['type'], ChronicleCategory>> = {
  report: 'meeting', intervention: 'intervention', photo: 'photo', action: 'action',
  anomaly: 'anomaly', note: 'note', a_savoir: 'note', blocage: 'blocage',
  // 'access' (preuve d'accès) volontairement exclu du journal.
}

export async function getSiteChronicle(siteId: string, opts: { limit?: number } = {}): Promise<ChronicleEvent[]> {
  const sb = createAdminClient()
  const limit = opts.limit ?? 150

  const [memEvents, decRes, resRes, docs, enrichments] = await Promise.all([
    getSiteMemoryTimeline(siteId, { limit }).catch(() => [] as SiteMemoryEvent[]),
    sb.from('site_decisions').select('id, titre, description, date_decision, created_at, subject_id').eq('site_id', siteId).order('created_at', { ascending: false }).limit(limit),
    sb.from('site_reserve').select('id, label, location, status, created_at, subject_id').eq('site_id', siteId).order('created_at', { ascending: false }).limit(limit),
    listDocumentsForTarget('site', siteId).catch(() => []),
    getSiteRecentEnrichments(siteId, 20).catch(() => []),
  ])

  // Noms des sujets rattachés (décisions/réserves) — le Journal NOMME le sujet et
  // pointe vers son histoire. Pont vers le graphe métier, posé sans le construire.
  const decRows = (decRes.data ?? []) as Array<{ id: string; titre: string; description: string | null; date_decision: string | null; created_at: string; subject_id: string | null }>
  const resRows = (resRes.data ?? []) as Array<{ id: string; label: string; location: string | null; created_at: string; subject_id: string | null }>
  const subjectIds = new Set<string>()
  for (const d of decRows) if (d.subject_id) subjectIds.add(d.subject_id)
  for (const r of resRows) if (r.subject_id) subjectIds.add(r.subject_id)
  const subjectName = new Map<string, string>()
  if (subjectIds.size > 0) {
    const { data: subs } = await sb.from('subjects').select('id, name').in('id', [...subjectIds])
    for (const s of (subs ?? []) as Array<{ id: string; name: string }>) subjectName.set(s.id, s.name)
  }
  const subjectHref = (sid: string) => `/sites/${siteId}/subjects/${sid}`

  const events: ChronicleEvent[] = []

  for (const e of memEvents) {
    const cat = MEM_CAT[e.type]
    if (!cat) continue
    let href: string | undefined
    if (cat === 'meeting') href = `/meetings/${e.id}`
    else if (cat === 'intervention') href = `/interventions/${e.interventionId ?? e.id}`
    events.push({ id: `mem-${e.type}-${e.id}`, category: cat, date: e.occurredAt, title: e.title, detail: e.detail, href, source: 'memory' })
  }

  for (const d of decRows) {
    events.push({ id: `dec-${d.id}`, category: 'decision', date: d.date_decision ?? d.created_at, title: d.titre, detail: d.description, href: d.subject_id ? subjectHref(d.subject_id) : `/sites/${siteId}/subjects`, subjectIds: d.subject_id ? [d.subject_id] : undefined, subjectLabel: d.subject_id ? subjectName.get(d.subject_id) ?? null : null, source: 'site_decision' })
  }

  for (const r of resRows) {
    events.push({ id: `res-${r.id}`, category: 'reserve', date: r.created_at, title: r.label, detail: r.location, href: r.subject_id ? subjectHref(r.subject_id) : `/sites/${siteId}/reserves`, subjectIds: r.subject_id ? [r.subject_id] : undefined, subjectLabel: r.subject_id ? subjectName.get(r.subject_id) ?? null : null, source: 'site_reserve' })
  }

  for (const doc of docs) {
    events.push({ id: `doc-${doc.id}`, category: 'document', date: doc.created_at, title: doc.filename, href: `/documents/${doc.id}`, source: 'document' })
  }

  for (const en of enrichments) {
    events.push({ id: `enr-${en.date}-${en.what.slice(0, 16)}`, category: 'enrichment', date: en.date, title: en.what, detail: en.who, source: 'enrichment' })
  }

  return events
    .filter((e) => e.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1)) // plus récent d'abord
    .slice(0, limit)
}
