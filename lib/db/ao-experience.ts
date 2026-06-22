// A3 v2 — Confrontation AO ↔ expérience accumulée, par SUJET CANONIQUE (Vincent
// 2026-06-22). DÉTERMINISTE, zéro IA. Le moat n'est pas le texte mais le sujet
// canonique : « DOE », « Dossier des Ouvrages Exécutés », « documents de recollement »
// = UN seul sujet. La canonicalisation s'appuie sur le GLOSSAIRE (terme + alias,
// mig 150) ; à défaut de glossaire, on retombe sur le nom du sujet (v1).

import { createAdminClient } from '@/lib/supabase/admin'

export interface ExperienceTerm {
  term: string             // libellé canonique (« DOE »)
  occurrences: number      // nb total de sujets rencontrés (toutes occurrences)
  projectCount: number     // chantiers distincts
  openOrBlocked: number    // encore ouverts / en sommeil
  lateProjects: number     // sujets avec au moins une action en retard
  lateRatioPct: number     // % d'occurrences en retard
  reserveCount: number     // réserves rattachées
  reserveLabels: string[]  // libellés de réserves distincts (top 4)
  avgClosureDays: number | null
  difficult: boolean       // historiquement difficile (retards/réserves marqués)
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
// Match par FRONTIÈRE DE MOT (les deux normalisés) : « DOE » matche « le DOE final »
// mais « paq » ne matche pas « paquet ». Sûr pour les acronymes courts.
function wordMatch(haystackNorm: string, formNorm: string): boolean {
  if (formNorm.length < 3) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(formNorm)}([^a-z0-9]|$)`).test(haystackNorm)
}

interface CanonGroup {
  key: string
  display: string
  surfaceForms: string[]   // formes normalisées (terme + alias + noms de sujets) pour le matching
  ids: string[]
  sites: Set<string>
  closedDurations: number[]
  openOrBlocked: number
}

/** Charge les sujets de l'org regroupés par SUJET CANONIQUE (via glossaire). */
async function loadCanonGroups(orgId: string): Promise<CanonGroup[]> {
  const sb = createAdminClient()
  const [{ data: subs }, { data: gloss }] = await Promise.all([
    sb.from('subjects').select('id, name, site_id, status, created_at, updated_at').eq('organization_id', orgId).limit(4000),
    sb.from('glossary_terms').select('term, aliases').eq('organization_id', orgId).limit(1000),
  ])
  const subjects = (subs ?? []) as Record<string, unknown>[]
  if (subjects.length === 0) return []

  // Dictionnaire canonique : forme normalisée → { key, display }. La forme la plus
  // longue gagne (évite qu'un alias court écrase un terme précis).
  const canonByForm: Array<{ form: string; key: string; display: string }> = []
  for (const g of (gloss ?? []) as Record<string, unknown>[]) {
    const term = (g.term as string ?? '').trim()
    if (!term) continue
    const key = norm(term)
    const forms = [term, ...((g.aliases as string[] | null) ?? [])]
    for (const f of forms) {
      const nf = norm(f)
      if (nf.length >= 3) canonByForm.push({ form: nf, key, display: term })
    }
  }
  canonByForm.sort((a, b) => b.form.length - a.form.length)

  function canonOf(name: string): { key: string; display: string } | null {
    const n = norm(name)
    for (const c of canonByForm) {
      if (wordMatch(n, c.form)) return { key: c.key, display: c.display }
    }
    return null
  }

  const groups = new Map<string, CanonGroup>()
  for (const s of subjects) {
    const name = (s.name as string) ?? ''
    const n = norm(name)
    if (n.length < 4) continue
    const canon = canonOf(name) ?? { key: n, display: name.trim() } // fallback v1
    let grp = groups.get(canon.key)
    if (!grp) { grp = { key: canon.key, display: canon.display, surfaceForms: [], ids: [], sites: new Set(), closedDurations: [], openOrBlocked: 0 }; groups.set(canon.key, grp) }
    grp.ids.push(s.id as string)
    if (!grp.surfaceForms.includes(n)) grp.surfaceForms.push(n)
    if (s.site_id) grp.sites.add(s.site_id as string)
    const status = s.status as string
    if (status === 'closed') {
      const days = Math.round((new Date(s.updated_at as string).getTime() - new Date(s.created_at as string).getTime()) / 86_400_000)
      if (days >= 0) grp.closedDurations.push(days)
    } else if (status === 'open' || status === 'dormant') {
      grp.openOrBlocked += 1
    }
  }
  // Ajoute les formes canoniques (terme + alias) aux surfaceForms pour le matching libellé.
  for (const grp of groups.values()) {
    for (const c of canonByForm) if (c.key === grp.key && !grp.surfaceForms.includes(c.form)) grp.surfaceForms.push(c.form)
  }
  return [...groups.values()]
}

/** Enrichit des groupes (retards + réserves + clôture) → ExperienceTerm. Borné. */
async function enrichGroups(groups: CanonGroup[]): Promise<ExperienceTerm[]> {
  if (groups.length === 0) return []
  const sb = createAdminClient()
  const allIds = groups.flatMap((g) => g.ids)
  const today = new Date().toISOString().slice(0, 10)
  const [{ data: actions }, { data: reserves }] = await Promise.all([
    sb.from('site_actions').select('subject_id, due_date, status').in('subject_id', allIds),
    sb.from('site_reserve').select('subject_id, label').in('subject_id', allIds),
  ])
  const lateBySubject = new Set<string>()
  for (const a of (actions ?? []) as Record<string, unknown>[]) {
    const due = a.due_date as string | null
    const st = a.status as string
    if (due && due < today && (st === 'open' || st === 'planned')) lateBySubject.add(a.subject_id as string)
  }
  const reservesBySubject = new Map<string, string[]>()
  for (const r of (reserves ?? []) as Record<string, unknown>[]) {
    const k = r.subject_id as string
    const arr = reservesBySubject.get(k) ?? []
    arr.push((r.label as string) ?? '')
    reservesBySubject.set(k, arr)
  }

  return groups.map((g) => {
    const lateProjects = g.ids.filter((id) => lateBySubject.has(id)).length
    const allReserves = g.ids.flatMap((id) => reservesBySubject.get(id) ?? [])
    const reserveLabels = [...new Set(allReserves.map((l) => l.trim()).filter(Boolean))].slice(0, 4)
    const occurrences = g.ids.length
    const lateRatioPct = occurrences ? Math.round((lateProjects / occurrences) * 100) : 0
    const avgClosureDays = g.closedDurations.length
      ? Math.round(g.closedDurations.reduce((a, b) => a + b, 0) / g.closedDurations.length) : null
    return {
      term: g.display,
      occurrences,
      projectCount: g.sites.size,
      openOrBlocked: g.openOrBlocked,
      lateProjects,
      lateRatioPct,
      reserveCount: allReserves.length,
      reserveLabels,
      avgClosureDays,
      difficult: lateRatioPct >= 40 || allReserves.length >= 3,
    }
  })
}

/** Pour les libellés d'un AO : le bilan historique des sujets canoniques référencés. */
export async function getAoExperience(orgId: string | null, labels: string[]): Promise<ExperienceTerm[]> {
  if (!orgId || labels.length === 0) return []
  const groups = await loadCanonGroups(orgId)
  const normLabels = labels.map(norm)
  const matched = groups.filter((g) => g.surfaceForms.some((f) => normLabels.some((l) => wordMatch(l, f))))
  const enriched = await enrichGroups(matched)
  return enriched.sort((a, b) => (b.lateProjects + b.reserveCount) - (a.lateProjects + a.reserveCount) || b.occurrences - a.occurrences)
}

/** Niveau 3 — pour UN sujet, son bilan à l'échelle de l'org (toutes occurrences du
 *  sujet canonique). Renvoie null si le sujet est seul (rien à raconter de collectif). */
export async function getSubjectOrgHistory(orgId: string | null, subjectName: string): Promise<ExperienceTerm | null> {
  if (!orgId) return null
  const groups = await loadCanonGroups(orgId)
  const n = norm(subjectName)
  const grp = groups.find((g) => g.surfaceForms.some((f) => f === n || wordMatch(n, f)))
  if (!grp || grp.ids.length < 2) return null // seul = pas d'histoire collective
  const [term] = await enrichGroups([grp])
  return term ?? null
}
