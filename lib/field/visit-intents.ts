// Intentions de visite — un seul moteur de visite, spécialisé par l'INTENTION.
//
// « Pourquoi êtes-vous ici ? » Le moteur de capture (photos, vocaux, annotations,
// CR) est IDENTIQUE ; c'est l'intention qui changera les libellés, le CR, les
// questions de fin, la mémoire créée et les actions proposées. On n'ajoute donc
// plus un bouton par métier : une seule « Nouvelle visite », puis l'intention.
//
// `slug` correspond à site_reports.visit_motive (mig 186).

export type VisitIntent =
  | 'premiere'
  | 'avancement'
  | 'previsite_ao'
  | 'prereception'
  | 'reception'
  | 'levee_reserves'
  | 'sav'

export interface VisitIntentDef {
  slug: VisitIntent
  label: string
  hint: string
}

/** Ordre d'affichage dans la bottom sheet « Pourquoi êtes-vous ici ? ». */
export const VISIT_INTENTS: readonly VisitIntentDef[] = [
  { slug: 'premiere', label: 'Première visite', hint: 'Créer le point de départ du chantier' },
  { slug: 'avancement', label: 'Suivi de chantier', hint: 'Voir ce qui a changé depuis la dernière visite' },
  { slug: 'previsite_ao', label: 'Prévisite AO', hint: 'Évaluer risques, faisabilité, pièces manquantes' },
  { slug: 'prereception', label: 'Pré-réception', hint: 'Préparer la réception' },
  { slug: 'reception', label: 'Réception', hint: 'Constater / lever les réserves' },
  { slug: 'levee_reserves', label: 'Levée de réserves', hint: 'Vérifier ce qui est corrigé' },
  { slug: 'sav', label: 'SAV / Incident', hint: 'Documenter un problème ponctuel' },
] as const

const BY_SLUG = new Map<string, VisitIntentDef>(VISIT_INTENTS.map((i) => [i.slug, i]))

export function isVisitIntent(v: string | null | undefined): v is VisitIntent {
  return !!v && BY_SLUG.has(v)
}

/** Libellé court d'une intention pour une ligne de liste (« Suivi », « Prévisite AO »…). */
export function visitIntentLabel(slug: string | null | undefined): string | null {
  return slug ? BY_SLUG.get(slug)?.label ?? null : null
}
