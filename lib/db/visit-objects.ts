// ── PROJECTION MOBILE des « objets issus d'une visite » (point 6) ────────────
// PAS un second read-model : une simple PROJECTION PURE de `buildVisitChanges`
// (l'unique vérité desktop/mobile, lib/db/visit-narrative.ts). Le desktop
// (VisitDesk) et le mobile (VisitObjectsPanel) projettent EXACTEMENT la même
// population métier — seul le rendu diffère. Aucune requête ici : on aplatit les
// groupes canonical en listes par type, en attachant à chaque objet le sujet
// canonique de son groupe pour router décision/intervenant/vigilance/connaissance
// vers l'historique du sujet quand il existe.

import type { VisitChangeGroup } from '@/lib/db/visit-narrative'

export interface VisitObjectItem {
  id: string
  label: string
  /** Badge d'état ou null. */
  statusLabel: string | null
  /** Route /m réelle, ou null quand aucune destination précise n'existe
   *  (l'objet est alors affiché sans lien — jamais « Ouvrir » vers rien). */
  href: string | null
  /** true = fiche précise de l'objet ; false = espace/sujet. */
  precise: boolean
  /** Libellé honnête du lien (« Voir la fiche » / « Voir les réserves » / « Voir
   *  le sujet »…), ou null si pas de lien. */
  ctaLabel: string | null
}

export interface VisitObjects {
  actions: VisitObjectItem[]
  reserves: VisitObjectItem[]
  deadlines: VisitObjectItem[]
  decisions: VisitObjectItem[]
  stakeholders: VisitObjectItem[]
  watchpoints: VisitObjectItem[]
  knowledge: VisitObjectItem[]
  isEmpty: boolean
}

const ACTION_STATUS: Record<string, string> = { open: 'Ouverte', planned: 'Planifiée', done: 'Terminée', cancelled: 'Annulée' }
const KNOWLEDGE_KIND: Record<string, string> = { current_information: 'Information actuelle', durable_knowledge: 'Connaissance durable', observed_pattern: 'Habitude observée' }

/**
 * Projette les groupes canonical de `buildVisitChanges` en listes mobiles par
 * type. Doctrine navigation (Vincent 2026-09-01) :
 *   • action → fiche précise ;
 *   • réserve → espace Réserves ; échéance → Planning ;
 *   • décision / intervenant / vigilance → sujet mobile SI canonical_subject_id
 *     (destination la plus précise disponible), sinon libellé sans lien ;
 *   • connaissance → sujet si canonical, sinon Patrimoine.
 */
export function projectVisitObjects(groups: VisitChangeGroup[], siteId: string): VisitObjects {
  const subjectHref = (csId: string | null): string | null => (csId ? `/m/site/${siteId}/sujets/${csId}` : null)

  const actions: VisitObjectItem[] = []
  const reserves: VisitObjectItem[] = []
  const deadlines: VisitObjectItem[] = []
  const decisions: VisitObjectItem[] = []
  const stakeholders: VisitObjectItem[] = []
  const watchpoints: VisitObjectItem[] = []
  const knowledge: VisitObjectItem[] = []

  for (const g of groups) {
    const cs = g.canonicalSubjectId
    for (const a of g.actions) {
      actions.push({ id: a.id, label: a.title, statusLabel: a.status ? (ACTION_STATUS[a.status] ?? null) : null, href: `/m/site/${siteId}/action/${a.id}`, precise: true, ctaLabel: 'Voir la fiche' })
    }
    for (const r of g.reserves) {
      reserves.push({ id: r.id, label: r.label, statusLabel: null, href: `/m/site/${siteId}/reserves`, precise: false, ctaLabel: 'Voir les réserves' })
    }
    for (const d of g.deadlines) {
      deadlines.push({ id: d.id, label: d.title, statusLabel: null, href: `/m/planning`, precise: false, ctaLabel: 'Voir le planning' })
    }
    for (const d of g.decisions) {
      const href = subjectHref(cs)
      decisions.push({ id: d.id, label: d.title, statusLabel: null, href, precise: false, ctaLabel: href ? 'Voir le sujet' : null })
    }
    for (const s of g.stakeholders) {
      const href = subjectHref(cs)
      const label = s.label && s.label !== 'non identifié' ? `${s.role} — ${s.label}` : s.role
      stakeholders.push({ id: s.id, label, statusLabel: null, href, precise: false, ctaLabel: href ? 'Voir le sujet' : null })
    }
    for (const w of g.watchpoints) {
      const href = subjectHref(cs)
      watchpoints.push({ id: w.id, label: w.title, statusLabel: null, href, precise: false, ctaLabel: href ? 'Voir le sujet' : null })
    }
    for (const k of g.knowledge) {
      const href = subjectHref(cs) ?? `/m/site/${siteId}/patrimoine`
      knowledge.push({ id: k.id, label: k.title, statusLabel: KNOWLEDGE_KIND[k.kind] ?? null, href, precise: false, ctaLabel: cs ? 'Voir le sujet' : 'Voir le patrimoine' })
    }
  }

  const isEmpty = actions.length === 0 && reserves.length === 0 && deadlines.length === 0
    && decisions.length === 0 && stakeholders.length === 0 && watchpoints.length === 0 && knowledge.length === 0
  return { actions, reserves, deadlines, decisions, stakeholders, watchpoints, knowledge, isEmpty }
}
