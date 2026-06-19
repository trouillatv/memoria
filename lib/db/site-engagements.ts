// Sprint 4.5 — Tableau des engagements (coordination, PAS évaluation).
//
// NB : distinct de lib/db/engagements.ts (engagements d'AO). Ici = responsabilités
// d'actions de chantier. Groupe les actions d'un site par responsable (clé
// normalisée), avec compteurs neutres. 100% déterministe (site_actions), zéro
// LLM. Répond à « quelles responsabilités restent à suivre avant la prochaine
// réunion ? » — jamais « qui travaille bien/mal ». Pas de score, %, ni classement.
// `assigned_to` reste la source brute, jamais réécrit (vue en lecture).

import { listSiteActionsBySite } from '@/lib/db/site-actions'
import { responsibleKey, canonicalLabel } from '@/lib/engagements/responsible-key'

export interface EngagementGroup {
  /** Clé normalisée (couture vers le futur modèle entité). */
  key: string
  /** Libellé affiché (orthographe réelle la plus fréquente). */
  label: string
  total: number
  ouvertes: number
  enRetard: number
}

export interface SiteEngagements {
  /** Groupes avec un responsable, triés ALPHABÉTIQUEMENT (anti-palmarès). */
  responsables: EngagementGroup[]
  /** Actions ouvertes sans responsable — appel à coordination, mis en avant. */
  sansResponsable: number
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Engagements à suivre pour un site. `ouvertes` = open/planned ;
 * `enRetard` = ouverte avec due_date < aujourd'hui (mêmes définitions que le
 * suivi de réunion). Les actions annulées sont ignorées.
 */
export async function getSiteEngagements(siteId: string): Promise<SiteEngagements> {
  const actions = (await listSiteActionsBySite(siteId)).filter((a) => a.status !== 'cancelled')
  const today = todayIso()

  const isOpen = (s: string) => s === 'open' || s === 'planned'

  // Bucket sans responsable : actions OUVERTES sans assigned_to (à coordonner).
  const sansResponsable = actions.filter(
    (a) => isOpen(a.status) && !(a.assigned_to ?? '').trim(),
  ).length

  // Regroupement par clé normalisée.
  const groups = new Map<string, { variants: string[]; total: number; ouvertes: number; enRetard: number }>()
  for (const a of actions) {
    const raw = (a.assigned_to ?? '').trim()
    if (!raw) continue // compté dans sansResponsable
    const k = responsibleKey(raw)
    let g = groups.get(k)
    if (!g) { g = { variants: [], total: 0, ouvertes: 0, enRetard: 0 }; groups.set(k, g) }
    g.variants.push(raw)
    g.total += 1
    if (isOpen(a.status)) {
      g.ouvertes += 1
      if (a.due_date != null && a.due_date < today) g.enRetard += 1
    }
  }

  const responsables: EngagementGroup[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: canonicalLabel(g.variants),
      total: g.total,
      ouvertes: g.ouvertes,
      enRetard: g.enRetard,
    }))
    // Tri ALPHABÉTIQUE volontaire (jamais par volume → pas de classement).
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))

  return { responsables, sansResponsable }
}
