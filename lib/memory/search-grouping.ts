// De la LISTE à la RÉPONSE.
//
// Une recherche qui rend 40 lignes en vrac oblige Guillaume à faire le travail
// lui-même. Or il ne demande pas « des lignes », il demande :
//
//   « Montre-moi tout ce qu'on sait sur Discount Poindimié. »  → par CHANTIER
//   « On avait déjà vu cette fuite il y a deux ans ? »          → par FIL
//   « Quelles observations concernent les chambres froides ? »  → par SUJET
//
// D'où la mise en forme : les FILS d'abord (un sujet qui porte le mot cherché
// est la meilleure réponse possible — il contient déjà toute l'histoire), puis
// les faits, groupés par chantier, du plus pertinent au moins pertinent.
//
// Pur : aucune base, aucun réseau. Testable à sec.

import type { MemoryHit, MemoryHitType } from '@/lib/db/memory-search'

/** Comment on NOMME chaque chose, en français de chantier. */
export const HIT_LABEL_FR: Record<MemoryHitType, string> = {
  observation: 'Observation',
  anomaly: 'Anomalie',
  site_note: 'À savoir',
  intervention: 'Intervention',
  photo: 'Photo',
  site_action: 'Action',
  site_decision: 'Décision',
  meeting_decision: 'Décision de réunion',
  site_reserve: 'Réserve',
  report_document: 'Compte-rendu',
  knowledge: 'Connaissance',
  blocage: 'Blocage',
  obligation: 'Obligation',
  subject: 'Sujet',
}

export interface SiteGroup {
  siteId: string
  siteName: string
  hits: MemoryHit[]
  /** Le meilleur score du chantier — c'est lui qui ordonne les chantiers. */
  bestRank: number
}

export interface GroupedSearch {
  /** Les FILS trouvés. Un sujet qui porte le mot cherché contient déjà l'histoire. */
  threads: MemoryHit[]
  /** Les faits, par chantier, chantier le plus pertinent en premier. */
  sites: SiteGroup[]
  /** Combien de faits en tout (les fils ne sont pas des faits). */
  factCount: number
  /** Ce qu'on a trouvé, par nature — « 3 observations, 2 actions… ». */
  countsByType: Array<{ type: MemoryHitType; count: number }>
}

/**
 * Met en forme les résultats bruts.
 *
 * `siteNameOf` vient de l'appelant : la RPC ne rend que des `site_id` (elle ne
 * doit pas savoir comment on affiche les choses).
 */
export function groupSearchHits(
  hits: MemoryHit[],
  siteNameOf: (siteId: string) => string | undefined,
): GroupedSearch {
  const threads: MemoryHit[] = []
  const bySite = new Map<string, SiteGroup>()
  const counts = new Map<MemoryHitType, number>()

  for (const hit of hits) {
    counts.set(hit.type, (counts.get(hit.type) ?? 0) + 1)

    if (hit.type === 'subject') {
      threads.push(hit)
      continue
    }
    if (!hit.siteId) continue

    const group = bySite.get(hit.siteId)
    if (group) {
      group.hits.push(hit)
      group.bestRank = Math.max(group.bestRank, hit.rank)
    } else {
      bySite.set(hit.siteId, {
        siteId: hit.siteId,
        siteName: siteNameOf(hit.siteId) ?? 'Chantier',
        hits: [hit],
        bestRank: hit.rank,
      })
    }
  }

  // Les fils : le plus pertinent d'abord.
  threads.sort((a, b) => b.rank - a.rank)

  // Les chantiers : celui qui a le meilleur résultat d'abord. À égalité, le
  // plus récent (une mémoire fraîche prime sur une mémoire ancienne).
  const sites = [...bySite.values()].sort((a, b) => {
    if (b.bestRank !== a.bestRank) return b.bestRank - a.bestRank
    return (b.hits[0]?.occurredAt ?? '').localeCompare(a.hits[0]?.occurredAt ?? '')
  })

  // Dans un chantier : le plus pertinent, puis le plus récent.
  for (const g of sites) {
    g.hits.sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank
      return b.occurredAt.localeCompare(a.occurredAt)
    })
  }

  const countsByType = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  return {
    threads,
    sites,
    factCount: sites.reduce((n, g) => n + g.hits.length, 0),
    countsByType,
  }
}

/**
 * « il y a deux ans » — la mémoire ne s'arrête pas à l'année en cours.
 *
 * La recherche interroge par défaut TOUT ce qui est connu : la question « on
 * avait déjà vu ça ? » porte précisément sur l'ancien. Une fenêtre d'un an y
 * répondrait « non » à tort — le pire mensonge possible pour une mémoire.
 */
export const ALL_MEMORY_DAYS = 3650
