// A3 — Confrontation AO ↔ expérience accumulée (Vincent 2026-06-22). DÉTERMINISTE,
// zéro IA. Le moat : on ne lit pas un document, on confronte ses exigences à ce que
// MemorIA a déjà vécu. Le pivot est le SUJET : un nom (« DOE ») revient à travers les
// chantiers ; on agrège son bilan (récurrence, retards, réserves, délai de clôture).

import { createAdminClient } from '@/lib/supabase/admin'

export interface ExperienceTerm {
  term: string             // nom de sujet rencontré (« DOE »)
  projectCount: number     // chantiers distincts où ce sujet est apparu
  openOrBlocked: number    // encore ouverts / bloqués aujourd'hui
  lateProjects: number     // chantiers avec au moins une action en retard sur ce sujet
  reserveCount: number     // réserves rattachées à ces sujets
  avgClosureDays: number | null  // délai moyen de clôture (sujets clos)
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

/** Pour les libellés d'un AO, le bilan historique des sujets de même nom dans l'org.
 *  Match = le nom de sujet (≥ 4 car) apparaît dans un libellé. Trié par récurrence. */
export async function getAoExperience(orgId: string | null, labels: string[]): Promise<ExperienceTerm[]> {
  if (!orgId || labels.length === 0) return []
  const sb = createAdminClient()
  const { data: subs } = await sb
    .from('subjects')
    .select('id, name, site_id, status, created_at, updated_at')
    .eq('organization_id', orgId)
    .limit(4000)
  const subjects = (subs ?? []) as Record<string, unknown>[]
  if (subjects.length === 0) return []

  const normLabels = labels.map(norm)

  // Regroupe les sujets par nom normalisé.
  interface Group { display: string; norm: string; ids: string[]; sites: Set<string>; closedDurations: number[]; openOrBlocked: number }
  const groups = new Map<string, Group>()
  for (const s of subjects) {
    const name = (s.name as string) ?? ''
    const n = norm(name)
    if (n.length < 4) continue // évite le bruit (mots trop courts/communs)
    let g = groups.get(n)
    if (!g) { g = { display: name.trim(), norm: n, ids: [], sites: new Set(), closedDurations: [], openOrBlocked: 0 }; groups.set(n, g) }
    g.ids.push(s.id as string)
    if (s.site_id) g.sites.add(s.site_id as string)
    const status = s.status as string
    if (status === 'closed') {
      const created = new Date(s.created_at as string).getTime()
      const closed = new Date(s.updated_at as string).getTime()
      const days = Math.round((closed - created) / 86_400_000)
      if (days >= 0) g.closedDurations.push(days)
    } else if (status === 'open' || status === 'dormant') {
      g.openOrBlocked += 1
    }
  }

  // Ne garde que les noms qui APPARAISSENT dans un libellé de l'AO.
  const matched = [...groups.values()].filter((g) => normLabels.some((l) => l.includes(g.norm)))
  if (matched.length === 0) return []

  // Enrichissement (retards + réserves) sur les sujets matchés uniquement (borné).
  const allIds = matched.flatMap((g) => g.ids)
  const today = new Date().toISOString().slice(0, 10)
  const [{ data: actions }, { data: reserves }] = await Promise.all([
    sb.from('site_actions').select('subject_id, due_date, status').in('subject_id', allIds),
    sb.from('site_reserve').select('subject_id').in('subject_id', allIds),
  ])
  const lateBySubject = new Set<string>()
  for (const a of (actions ?? []) as Record<string, unknown>[]) {
    const due = a.due_date as string | null
    const st = a.status as string
    if (due && due < today && (st === 'open' || st === 'planned')) lateBySubject.add(a.subject_id as string)
  }
  const reserveBySubject = new Map<string, number>()
  for (const r of (reserves ?? []) as Record<string, unknown>[]) {
    const k = r.subject_id as string
    reserveBySubject.set(k, (reserveBySubject.get(k) ?? 0) + 1)
  }

  const out: ExperienceTerm[] = matched.map((g) => {
    const lateProjects = g.ids.filter((id) => lateBySubject.has(id)).length
    const reserveCount = g.ids.reduce((n, id) => n + (reserveBySubject.get(id) ?? 0), 0)
    const avgClosureDays = g.closedDurations.length
      ? Math.round(g.closedDurations.reduce((a, b) => a + b, 0) / g.closedDurations.length)
      : null
    return { term: g.display, projectCount: g.sites.size, openOrBlocked: g.openOrBlocked, lateProjects, reserveCount, avgClosureDays }
  })
  // Tri : ceux qui ont une histoire (retards/réserves) d'abord, puis récurrence.
  return out.sort((a, b) => (b.lateProjects + b.reserveCount) - (a.lateProjects + a.reserveCount) || b.projectCount - a.projectCount)
}
