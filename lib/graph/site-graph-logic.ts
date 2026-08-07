import type { SiteGraph, GraphNode, GraphNodeType } from '@/lib/knowledge/site-graph'

// ── Constantes visuelles ───────────────────────────────────────────────────────

export const COLOR: Record<GraphNodeType, string> = {
  site: '#1C1B22', visite: '#0369A1', photo: '#D97706', memo: '#0F766E',
  action: '#059669', ech: '#C2410C', dec: '#4338CA', vigilance: '#BE123C',
  acteur: '#7C3AED', know: '#A16207',
}
export const COLOR_DARK: Record<GraphNodeType, string> = {
  site: '#F0EDF6', visite: '#38BDF8', photo: '#FBBF24', memo: '#2DD4BF',
  action: '#34D399', ech: '#FB923C', dec: '#818CF8', vigilance: '#FDA4AF',
  acteur: '#A78BFA', know: '#FACC15',
}
export const TYPE_LABEL: Record<GraphNodeType, string> = {
  site: 'Chantier', visite: 'Visite', photo: 'Photos', memo: 'Observation',
  action: 'Action', ech: 'Échéance', dec: 'Décision', vigilance: 'Vigilance',
  acteur: 'Intervenant', know: 'À savoir',
}
export const SIZE: Record<GraphNodeType, number> = {
  site: 26, visite: 19, photo: 15, memo: 14, action: 12, ech: 12, dec: 12,
  vigilance: 12, acteur: 15, know: 12,
}

// Les preuves n'apparaissent qu'à côté de l'objet exploré qui les contient.
export const PROOF = new Set<GraphNodeType>(['photo', 'memo'])

// La vue globale ne montre par défaut que la structure (décision 2026-07-18).
export const GLOBAL_DEFAULT = new Set<GraphNodeType>(['visite', 'action', 'dec', 'acteur'])

// ── Utilitaires date ───────────────────────────────────────────────────────────

const dayFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long',
})
export const frDay = (iso: string | null | undefined) =>
  iso ? dayFmt.format(new Date(iso)) : null

// ── Types internes ─────────────────────────────────────────────────────────────

export type Neigh = Record<string, Set<string>>
export type ById = Record<string, GraphNode>

// ── Visibilité ─────────────────────────────────────────────────────────────────

export interface VisibleParams {
  center: string
  depth: 1 | 2
  enqueteSet: Set<string> | null
  timeMax: string | null
  hiddenTypes: ReadonlySet<GraphNodeType>
  revealedTypes: ReadonlySet<GraphNodeType>
  neigh: Neigh
  nodeById: ById
}

export function computeVisible(p: VisibleParams): Set<string> {
  const { center, depth, enqueteSet, timeMax, hiddenTypes, revealedTypes, neigh, nodeById } = p
  let s: Set<string>
  if (enqueteSet) {
    s = new Set(enqueteSet)
  } else {
    s = new Set([center])
    for (const n of neigh[center] ?? []) s.add(n)
    if (depth === 2) for (const n of [...s]) for (const m of neigh[n] ?? []) s.add(m)
  }
  if (timeMax) {
    for (const id of [...s]) {
      const t = nodeById[id]?.t
      if (t && t.slice(0, 10) > timeMax) s.delete(id)
    }
  }
  if (!enqueteSet) {
    const near = neigh[center] ?? new Set()
    for (const id of [...s]) {
      const ty = nodeById[id]?.type
      if (!ty || ty === 'site' || id === center || revealedTypes.has(ty)) continue
      if (center === 'site') { if (!GLOBAL_DEFAULT.has(ty)) s.delete(id) }
      else if (PROOF.has(ty) && !near.has(id)) s.delete(id)
    }
  }
  if (hiddenTypes.size) {
    for (const id of [...s]) {
      const ty = nodeById[id]?.type
      if (ty && ty !== 'site' && id !== center && hiddenTypes.has(ty)) s.delete(id)
    }
  }
  return s
}

// ── Générateurs (données → texte, jamais écrits à la main) ───────────────────

export function linkedOf(id: string, types: GraphNodeType[], neigh: Neigh, byId: ById): GraphNode[] {
  return [...(neigh[id] ?? [])].map((m) => byId[m]).filter((m) => m && types.includes(m.type))
}

export function enUnePhrase(n: GraphNode, graph: SiteGraph, neigh: Neigh, byId: ById): string {
  const d = frDay(n.t)
  const memos = linkedOf(n.id, ['memo'], neigh, byId)
  const src = memos.length > 0 ? ' depuis un mémo de visite' : ''
  if (n.type === 'site') {
    const c = (t: GraphNodeType) => graph.nodes.filter((x) => x.type === t).length
    const conf = graph.nodes.filter((x) => x.sub?.includes('à confirmer')).reduce((s, x) => s + (x.count ?? 1), 0)
    return `${c('visite')} visite${c('visite') > 1 ? 's' : ''}, ${c('action')} action${c('action') > 1 ? 's' : ''}, ${c('ech')} échéance${c('ech') > 1 ? 's' : ''}, ${c('dec')} décision${c('dec') > 1 ? 's' : ''}${conf > 0 ? ` — ${conf} élément${conf > 1 ? 's' : ''} encore à confirmer` : ''}.`
  }
  if (n.type === 'visite') {
    const suites = [...(neigh[n.id] ?? [])].length - 1
    return `Visite${d ? ` du ${d}` : ''}. ${suites} élément${suites > 1 ? 's' : ''} de la mémoire en descend${suites > 1 ? 'ent' : ''}.`
  }
  if (n.type === 'memo') {
    const suites = linkedOf(n.id, ['action', 'ech', 'dec', 'vigilance', 'acteur', 'know'], neigh, byId)
    return `Dicté pendant la visite${d ? ` du ${d}` : ''}. ${suites.length} fait${suites.length > 1 ? 's' : ''} en ${suites.length > 1 ? 'sont issus' : 'est issu'}.`
  }
  if (n.type === 'photo') return `${n.count ?? 0} photo${(n.count ?? 0) > 1 ? 's' : ''} prise${(n.count ?? 0) > 1 ? 's' : ''} pendant la visite${d ? ` du ${d}` : ''}.`
  if (n.type === 'action') return `Créée${d ? ` le ${d}` : ''}${src}. ${n.sub ?? ''}.`
  if (n.type === 'ech') return `Extraite${src} et confirmée${d ? ` le ${d}` : ''}. ${n.sub ?? ''}.`
  if (n.type === 'dec') {
    const acts = linkedOf(n.id, ['action'], neigh, byId)
    return `Actée${d ? ` le ${d}` : ''}${src}, confirmée par un humain.${acts.length === 0 ? ' Aucune action n’en découle pour l’instant.' : ''}`
  }
  if (n.type === 'acteur') {
    const a = linkedOf(n.id, ['action'], neigh, byId).length
    const e = linkedOf(n.id, ['ech'], neigh, byId).length
    return `Cité${d ? ` le ${d}` : ''} dans un mémo de visite — jamais encore confirmé comme intervenant.${a > 0 ? ` ${a} action${a > 1 ? 's' : ''} le concerne${a > 1 ? 'nt' : ''}.` : ''}${e > 0 ? ` ${e} échéance${e > 1 ? 's' : ''} liée${e > 1 ? 's' : ''}.` : ''}`
  }
  if (n.type === 'know') return `${n.count ?? 0} information${(n.count ?? 0) > 1 ? 's' : ''} extraite${(n.count ?? 0) > 1 ? 's' : ''} des mémos, en attente d’un choix humain.`
  return n.sub ?? ''
}

export function recit(n: GraphNode, graph: SiteGraph, neigh: Neigh, byId: ById): string[] {
  const d = frDay(n.t)
  if (n.type === 'acteur') {
    const acts = linkedOf(n.id, ['action'], neigh, byId)
    const echs = linkedOf(n.id, ['ech'], neigh, byId)
    const ps = [`${n.label} apparaît${d ? ` le ${d}` : ''}, cité dans un mémo vocal de visite.`]
    const bits: string[] = []
    if (acts.length) bits.push(`${acts.length} action${acts.length > 1 ? 's' : ''} ouverte${acts.length > 1 ? 's' : ''} le concerne${acts.length > 1 ? 'nt' : ''} (${acts.slice(0, 2).map((a) => `« ${a.label} »`).join(', ')})`)
    if (echs.length) bits.push(`${echs.length} échéance${echs.length > 1 ? 's' : ''} l’attend${echs.length > 1 ? 'ent' : ''}`)
    if (bits.length) ps.push(bits.join(' et ') + ', mais il n’a jamais été confirmé comme intervenant.')
    else ps.push('Il n’a jamais été confirmé comme intervenant.')
    return ps
  }
  if (n.type === 'memo') {
    const suites = linkedOf(n.id, ['action', 'ech', 'dec', 'vigilance', 'acteur', 'know'], neigh, byId)
    return [
      `Mémo dicté sur place${d ? ` le ${d}` : ''}.`,
      suites.length > 0
        ? `${suites.length} fait${suites.length > 1 ? 's' : ''} en ${suites.length > 1 ? 'sont sortis' : 'est sorti'} : ${suites.slice(0, 3).map((s) => s.label.toLowerCase()).join(', ')}${suites.length > 3 ? '…' : ''}.`
        : 'Aucun fait n’en a encore été extrait.',
      'La voix d’origine reste attachée à chaque fait — c’est elle qui fait foi.',
    ]
  }
  if (n.type === 'visite') {
    const kids = [...(neigh[n.id] ?? [])].map((m) => byId[m]).filter(Boolean)
    const photos = kids.find((k) => k.type === 'photo')?.count ?? 0
    const memos = kids.filter((k) => k.type === 'memo').length
    return [
      `Visite${d ? ` du ${d}` : ''} — ${photos} photo${photos > 1 ? 's' : ''}, ${memos} mémo${memos > 1 ? 's' : ''}.`,
      `${kids.length} élément${kids.length > 1 ? 's' : ''} de la mémoire en descend${kids.length > 1 ? 'ent' : ''}.`,
    ]
  }
  return [
    enUnePhrase(n, graph, neigh, byId),
    'Chaque élément de cette carte peut expliquer d’où il vient — cliquez, la fiche remonte la chaîne.',
  ]
}

export function ifGone(n: GraphNode, neigh: Neigh, byId: ById): string[] {
  const a = linkedOf(n.id, ['action'], neigh, byId).length
  const e = linkedOf(n.id, ['ech'], neigh, byId).length
  const out: string[] = []
  if (a) out.push(`${a} action${a > 1 ? 's' : ''} restera${a > 1 ? 'ient' : 'it'} sans destinataire`)
  if (e) out.push(`${e} échéance${e > 1 ? 's' : ''} serai${e > 1 ? 'ent' : 't'} bloquée${e > 1 ? 's' : ''}`)
  out.push('sa trace resterait : le mémo d’origine fait foi')
  return out
}

export function computeGaps(graph: SiteGraph, neigh: Neigh): Array<{ id: string; txt: string }> {
  const g: Array<{ id: string; txt: string }> = []
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  for (const n of graph.nodes.filter((x) => x.type === 'acteur' && x.sub?.includes('à confirmer'))) {
    g.push({ id: n.id, txt: `${n.label} est cité mais n’a jamais été confirmé comme intervenant.` })
  }
  const know = graph.nodes.find((x) => x.type === 'know')
  if (know?.count) g.push({ id: know.id, txt: `${know.count} information${know.count > 1 ? 's' : ''} « à savoir » attend${know.count > 1 ? 'ent' : ''} une décision humaine.` })
  const toPlan = graph.nodes.filter((x) => x.type === 'ech' && x.sub?.startsWith('À planifier'))
  if (toPlan.length) g.push({ id: toPlan[0].id, txt: `${toPlan.length} échéance${toPlan.length > 1 ? 's' : ''} confirmée${toPlan.length > 1 ? 's' : ''} sans date.` })
  for (const d of graph.nodes.filter((x) => x.type === 'dec')) {
    const acts = [...(neigh[d.id] ?? [])].filter((m) => byId[m]?.type === 'action')
    if (acts.length === 0) g.push({ id: d.id, txt: `La décision « ${d.label} » n’a déclenché aucune action.` })
  }
  return g
}

export function dependencySet(root: string, neigh: Neigh, byId: ById): Set<string> {
  const EXPAND = new Set<GraphNodeType>(['action', 'ech', 'dec', 'know', 'vigilance'])
  const out = new Set([root])
  const q = [root]
  while (q.length) {
    const cur = q.shift()!
    for (const nx of neigh[cur] ?? []) {
      if (nx === 'site' || out.has(nx)) continue
      out.add(nx)
      if (EXPAND.has(byId[nx]?.type)) q.push(nx)
    }
  }
  return out
}

export function chainToSource(id: string, neigh: Neigh): string[] | null {
  if (id === 'site') return null
  const prev: Record<string, string | null> = { [id]: null }
  const q = [id]
  while (q.length) {
    const cur = q.shift()!
    if (cur === 'site') break
    for (const nx of neigh[cur] ?? []) if (!(nx in prev)) { prev[nx] = cur; q.push(nx) }
  }
  if (!('site' in prev)) return null
  const path: string[] = []
  let cur: string | null = 'site'
  while (cur !== null) { path.push(cur); cur = prev[cur] }
  return path
}
