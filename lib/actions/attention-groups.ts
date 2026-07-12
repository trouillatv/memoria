// « À reprendre » — le regroupement PAR CHANTIER des éléments qui réclament
// (règle 2026-07-12 : jamais une action hors contexte). PUR, testable en CI.
//
// Garanties (revue 2026-07-12) :
// - le COMPTE d'un chantier est VRAI : tous les items reçus comptent, la borne
//   ne porte que sur le RENDU (2 items visibles, 3 chantiers max) ;
// - les report_id sont collectés par groupe pour résoudre l'ORIGINE réelle —
//   jamais une correspondance indirecte par site (une action du 8 juillet ne
//   doit pas être présentée comme issue de la réunion du 3).

export type AttentionSeverity = 'red' | 'orange' | 'yellow' | 'indigo'

const SEV_RANK: Record<AttentionSeverity, number> = { red: 0, orange: 1, yellow: 2, indigo: 3 }

export interface GroupableItem {
  key: string
  severity: AttentionSeverity
  title: string
  /** La RAISON pure (« pas d'avancée depuis 7 j ») — jamais le chantier. */
  subtitle: string | null
  href: string
  urgent?: boolean
  group: string
  groupHref?: string | null
  /** Le rapport (réunion/visite) qui a créé l'élément, quand il existe. */
  reportId?: string | null
}

export interface BuiltGroup<T extends GroupableItem = GroupableItem> {
  label: string
  href: string | null
  /** Sévérité du pire item — teinte la raison. */
  worstSeverity: AttentionSeverity
  /** Raison de la carte = note du pire item (les items arrivent triés). */
  reason: string | null
  /** Les rapports sources DISTINCTS de tous les items du groupe. */
  reportIds: string[]
  /** Compte VRAI (tous les items du groupe, pas seulement les visibles). */
  totalCount: number
  /** Visibles (maxItems). */
  items: T[]
  moreCount: number
}

// ── Provenance exacte (revue 2026-07-12) ─────────────────────────────────────
// Un site_report est une RÉUNION ou une VISITE (`origin IS NOT NULL`, mig 162).
// Une action née en visite ne doit JAMAIS être présentée comme issue d'une
// réunion — la carte existe précisément pour dire le vrai pourquoi.

export type SourceKind = 'reunion' | 'visite'
export interface SourceRef {
  id: string
  kind: SourceKind
  /** « 8 juillet » — déjà formatée (fuseau Nouméa) par l'appelant. */
  dateLabel: string
}

/** Libellé + lien d'origine d'un groupe, depuis ses sources RÉELLES. PUR.
 *  0 source (action ajoutée directement) → null, jamais une origine inventée.
 *  1 source → « Issue de la réunion/visite du … », cliquable vers SA route.
 *  N sources d'un même type → « Issues de N réunions/visites », sans lien.
 *  Types mélangés → « Issues de N sources », sans lien. */
export function originOfSources(sources: SourceRef[]): { label: string; href: string | null } | null {
  if (sources.length === 0) return null
  if (sources.length === 1) {
    const s = sources[0]
    return s.kind === 'visite'
      ? { label: `Issue de la visite du ${s.dateLabel}`, href: `/m/visite/${s.id}/recap` }
      : { label: `Issue de la réunion du ${s.dateLabel}`, href: `/m/reunion/${s.id}` }
  }
  const kinds = new Set(sources.map((s) => s.kind))
  if (kinds.size === 1) {
    return { label: `Issues de ${sources.length} ${kinds.has('visite') ? 'visites' : 'réunions'}`, href: null }
  }
  return { label: `Issues de ${sources.length} sources`, href: null }
}

export function buildAttentionGroups<T extends GroupableItem>(
  items: T[],
  opts?: { maxSites?: number; maxItems?: number },
): BuiltGroup<T>[] {
  const maxSites = opts?.maxSites ?? 3
  const maxItems = opts?.maxItems ?? 2

  // Trié par urgence : le 1er item d'un groupe est son pire.
  const sorted = [...items].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])

  const byGroup = new Map<string, BuiltGroup<T> & { _reports: Set<string> }>()
  const ordered: Array<BuiltGroup<T> & { _reports: Set<string> }> = []
  for (const it of sorted) {
    let g = byGroup.get(it.group)
    if (!g) {
      g = {
        label: it.group,
        href: it.groupHref ?? null,
        worstSeverity: it.severity,
        reason: it.subtitle ?? null,
        reportIds: [],
        totalCount: 0,
        items: [],
        moreCount: 0,
        _reports: new Set<string>(),
      }
      byGroup.set(it.group, g)
      ordered.push(g)
    }
    if (!g.href && it.groupHref) g.href = it.groupHref
    g.totalCount++
    if (it.reportId) g._reports.add(it.reportId)
    if (g.items.length < maxItems) g.items.push(it)
  }

  const sites = ordered.filter((g) => g.href).slice(0, maxSites)
  const familles = ordered.filter((g) => !g.href)
  return [...sites, ...familles].map((g) => {
    const { _reports, ...rest } = g
    return { ...rest, reportIds: [..._reports], moreCount: g.totalCount - g.items.length }
  })
}
