// V5.1 Slice 4 — Templates déterministes pour capsules WhatsApp.
//
// Doctrine Vincent 2026-05-14 : AUCUNE génération libre par IA. Templates
// stricts paramétrés. Le texte sortie est prédictible. Si une nouvelle
// formulation est désirée, on ajoute un nouveau case ici (revue de code).
//
// Wording :
//   - Descriptif uniquement (règle V5.1 "décrire, jamais juger / dramatiser").
//   - Pas d'emoji.
//   - 2-3 lignes max.
//   - Lien terminal type signature.
//   - Numéros : "23 passages" est descriptif factuel, pas un KPI saillant
//     (on cite la quantité sans la valoriser).

export type CapsuleKind = 'monthly_capsule' | 'incident_capsule'

export interface MonthlyCapsuleData {
  /** Libellé du mois en français, ex. "Mai 2026" ou "Mai". */
  monthLabel: string
  /** Nombre de passages dans le mois. */
  passageCount: number
  /** Date courte de la dernière anomalie du mois, ex. "8 mars". null si aucune. */
  lastAnomalyShort: string | null
  /** Statut de la dernière anomalie. 'resolved' = "(résolue)", autre = "". */
  lastAnomalyStatus: 'open' | 'resolved' | null
}

export interface IncidentCapsuleData {
  /** Nom du site. */
  siteName: string
  /** Description courte de l'anomalie (ex. "plomberie bloc B"). */
  anomalyShort: string
  /** Date courte de résolution, ex. "12 mai". */
  resolvedShort: string
}

/**
 * Génère le texte d'une capsule mensuelle.
 *
 * Exemples :
 *   - "Mai. 23 passages. Dernière anomalie : 8 mars (résolue)."
 *   - "Mai. 23 passages." (si lastAnomalyShort est null)
 *   - "Mai. 23 passages. Dernière anomalie : 8 mars." (si statut non résolu)
 */
export function renderMonthlyCapsule(d: MonthlyCapsuleData): string {
  const base = `${d.monthLabel}. ${d.passageCount} passages.`
  if (!d.lastAnomalyShort) return base
  if (d.lastAnomalyStatus === 'resolved') {
    return `${base} Dernière anomalie : ${d.lastAnomalyShort} (résolue).`
  }
  return `${base} Dernière anomalie : ${d.lastAnomalyShort}.`
}

/**
 * Génère le texte d'une capsule incident résolu.
 *
 * Exemple :
 *   "CHT Magenta. Anomalie plomberie bloc B résolue le 12 mai."
 */
export function renderIncidentCapsule(d: IncidentCapsuleData): string {
  return `${d.siteName}. Anomalie ${d.anomalyShort} résolue le ${d.resolvedShort}.`
}

/**
 * Helper pour formater une date au format court "8 mars" en fr-FR.
 */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
  })
}

/**
 * Helper pour formater le mois en libellé sobre. Ex. "Mai" pour "2026-05".
 * Pour V5.1 on garde court (pas d'année) — l'année est implicite côté client.
 */
export function formatMonthLabel(yyyymm: string): string {
  const [year, month] = yyyymm.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  const monthName = date.toLocaleDateString('fr-FR', { month: 'long' })
  return monthName.charAt(0).toUpperCase() + monthName.slice(1)
}
