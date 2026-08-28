import 'server-only'

// #230 Lot B — « Depuis le dernier PV » : l'ACTIVITÉ réelle du chantier entre les 2 derniers PV.
//
// Doctrine : ACTIVITÉ ≠ ÉTAT ≠ ATTENTION. Source = getPvDelta (occurrence-first, MÊME vérité que la
// Chronologie & #229). AUCUN nouveau calcul longitudinal. Population = business_subject (acteurs exclus,
// cohérent #228) — quelle que soit la famille d'occurrence. Densité = cap GLOBAL de lignes explicites
// (priorité réouvert > aggravé > nouveau > réapparu > résolu) ; maintenus/non-mentionnés = compteurs
// synthétiques qui ne consomment JAMAIS le cap. nouveau ≠ réapparu ≠ réouvert (3 films distincts).

import { createAdminClient } from '@/lib/supabase/admin'
import { canonicalRunsForSite, runEffectiveDate } from '@/lib/documents/pv-history'
import { getPvDelta } from '@/lib/documents/pv-comparison'
import { buildSiteSubjectCells } from '@/lib/documents/site-occurrence-timeline'

export type ActivityCategory = 'réouvert' | 'aggravé' | 'nouveau' | 'réapparu' | 'résolu' | 'autre'

/** Ordre de PRIORITÉ d'affichage — remplit le cap du plus fort au plus faible. */
export const ACTIVITY_PRIORITY: ActivityCategory[] = ['réouvert', 'aggravé', 'nouveau', 'réapparu', 'résolu', 'autre']

export const ACTIVITY_LINE_CAP = 8

export interface ActivityItem {
  canonicalSubjectId: string
  label: string
  /** Courte phrase de changement (trajectoire), ou null si l'entête de catégorie suffit. */
  trajectory: string | null
  href: string
}

export interface ActivityGroup {
  category: ActivityCategory
  total: number
  /** Items réellement affichés (bornés par le cap global). */
  displayed: ActivityItem[]
  /** total − displayed.length : « + N autres ». */
  hiddenCount: number
}

export interface SiteActivity {
  fromDate: string
  toDate: string
  /** Catégories de CHANGEMENT non vides, dans l'ordre de priorité. */
  groups: ActivityGroup[]
  /** Compteurs synthétiques (jamais listés, jamais dans le cap). */
  synthetic: { maintenus: number; nonMentionnes: number }
  /** Nombre total de vrais changements (hors maintenus/non-mentionnés). */
  totalChanges: number
  seeAllHref: string
}

/** Phrase de trajectoire courte par catégorie (déterministe, jamais inventer de causalité). */
export function activityLineText(category: ActivityCategory): string | null {
  switch (category) {
    case 'réouvert': return 'Résolu précédemment → à refaire'
    case 'réapparu': return 'Déjà connu, réapparu après absence'
    case 'aggravé':  return 'Aggravé au dernier PV'
    case 'résolu':   return 'Résolu / levé'
    // nouveau : l'entête « N nouveaux » suffit ; pas de sous-phrase inventée.
    default:         return null
  }
}

/**
 * Répartit un budget GLOBAL de lignes explicites entre les groupes, par ordre de priorité.
 * Chaque groupe garde son `total` exact ; seul le nombre d'items AFFICHÉS est borné. Pur/testable.
 */
export function distributeActivityLines(
  groups: Array<{ category: ActivityCategory; total: number; items: ActivityItem[] }>,
  cap = ACTIVITY_LINE_CAP,
): ActivityGroup[] {
  const ordered = [...groups].sort((a, b) => ACTIVITY_PRIORITY.indexOf(a.category) - ACTIVITY_PRIORITY.indexOf(b.category))
  let budget = Math.max(0, cap)
  return ordered.map((g) => {
    const show = Math.min(g.total, g.items.length, budget)
    budget -= show
    return { category: g.category, total: g.total, displayed: g.items.slice(0, show), hiddenCount: g.total - show }
  })
}

const TRANSITION_TO_CATEGORY: Record<string, ActivityCategory | 'maintenu' | 'non_mentionné' | 'nouveau_raw'> = {
  réouvert: 'réouvert', aggravé: 'aggravé', nouveau: 'nouveau_raw', // nouveau_raw = à raffiner (nouveau vs réapparu)
  levé: 'résolu', réalisé: 'résolu',
  maintenu: 'maintenu', non_mentionné: 'non_mentionné',
  progressé: 'autre', changé: 'autre', annulé: 'autre',
}

export async function buildActivitySinceLastPv(siteId: string): Promise<SiteActivity | null> {
  const runs = await canonicalRunsForSite(siteId)
  if (runs.length < 2) return null
  const from = runs[runs.length - 2]
  const to = runs[runs.length - 1]

  const [delta, view] = await Promise.all([
    getPvDelta(from.id, to.id).catch(() => null),
    buildSiteSubjectCells(siteId).catch(() => null),
  ])
  if (!delta) return null

  const toIdx = view ? view.runs.findIndex((r) => r.id === to.id) : -1
  const cellsByCs = new Map((view?.rows ?? []).map((r) => [r.canonicalSubjectId, r.cells]))

  // Population : exclure les acteurs (durableKind=actor). business_subject/NULL = métier (#228).
  // + label CANONIQUE (canonical_subject.label) pour cohérence Fiche = Chronologie = Attention = Activité
  // (getPvDelta expose le label de l'occurrence, qui peut différer du nom canonique du sujet).
  const csIds = [...new Set(delta.items.map((i) => i.subjectThreadId))]
  const actorCs = new Set<string>()
  const labelByCs = new Map<string, string>()
  const admin = createAdminClient()
  for (let i = 0; i < csIds.length; i += 300) {
    const { data } = await admin.from('canonical_subject').select('id, kind, label').in('id', csIds.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ id: string; kind: string | null; label: string | null }>) {
      if (r.kind === 'actor') actorCs.add(r.id)
      if (r.label) labelByCs.set(r.id, r.label)
    }
  }

  const buckets = new Map<ActivityCategory, ActivityItem[]>()
  let maintenus = 0
  let nonMentionnes = 0
  const href = (cs: string) => `/sites/${siteId}/historique/sujets/${cs}`

  for (const it of delta.items) {
    if (actorCs.has(it.subjectThreadId)) continue // acteurs exclus de l'activité
    const mapped = TRANSITION_TO_CATEGORY[it.transition] ?? 'autre'
    if (mapped === 'maintenu') { maintenus++; continue }
    if (mapped === 'non_mentionné') { nonMentionnes++; continue }

    let category: ActivityCategory
    if (mapped === 'nouveau_raw') {
      // Raffinement nouveau vs réapparu depuis l'axe de PRÉSENCE (sans inventer de sémantique) :
      // un « nouveau » (absent au PV précédent) ayant une présence réelle à un PV ANTÉRIEUR = réapparu.
      const cells = cellsByCs.get(it.subjectThreadId) ?? []
      const firstReal = cells.findIndex((c) => c && !c.isGap)
      category = firstReal >= 0 && toIdx >= 0 && firstReal < toIdx ? 'réapparu' : 'nouveau'
    } else {
      category = mapped
    }

    const list = buckets.get(category) ?? []
    list.push({ canonicalSubjectId: it.subjectThreadId, label: labelByCs.get(it.subjectThreadId) ?? it.label, trajectory: activityLineText(category), href: href(it.subjectThreadId) })
    buckets.set(category, list)
  }

  const rawGroups = [...buckets.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([category, items]) => ({ category, total: items.length, items }))
  const groups = distributeActivityLines(rawGroups).filter((g) => g.total > 0)
  const totalChanges = rawGroups.reduce((a, g) => a + g.total, 0)

  return {
    fromDate: runEffectiveDate(from),
    toDate: runEffectiveDate(to),
    groups,
    synthetic: { maintenus, nonMentionnes },
    totalChanges,
    // Destination « Voir tous les changements » — Chronologie (vue synthèse) : voir note #230 Phase 1.
    seeAllHref: `/sites/${siteId}/historique?view=synthese`,
  }
}
