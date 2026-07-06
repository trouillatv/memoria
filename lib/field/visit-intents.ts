// Intentions de visite — un seul moteur de visite, spécialisé par l'INTENTION.
//
// « Pourquoi êtes-vous ici ? » Le moteur de capture (photos, vocaux, annotations,
// CR) est IDENTIQUE ; c'est l'intention qui changera les libellés, le CR, les
// questions de fin, la mémoire créée et les actions proposées. On n'ajoute donc
// plus un bouton par métier : une seule « Nouvelle visite », puis l'intention.
//
// `slug` correspond à site_reports.visit_motive (mig 186).

// TROIS intentions seulement — les seules qui changent VRAIMENT le comportement
// (introduction, conclusion, compte-rendu). Le moteur de capture est identique.
//   - Suivi        → faire évoluer la mémoire.
//   - Première     → créer la mémoire de référence.
//   - Prévisite AO → décider grâce à la mémoire.
export type VisitIntent =
  | 'avancement'
  | 'premiere'
  | 'previsite_ao'

/** Accent (jeton de couleur, pas une classe) : création=vert · évolution=bleu ·
 *  analyse=violet. La couleur est portée par l'icône/pastille, jamais le texte. */
export type VisitIntentAccent = 'emerald' | 'sky' | 'violet'

export interface VisitIntentDef {
  slug: VisitIntent
  label: string
  hint: string
  /** Un mot qui résume l'objectif : Création / Évolution / Analyse. */
  role: string
  accent: VisitIntentAccent
}

/** Ordre d'affichage dans la bottom sheet « Pourquoi êtes-vous ici ? ». */
export const VISIT_INTENTS: readonly VisitIntentDef[] = [
  { slug: 'avancement', label: 'Suivi de chantier', hint: 'Pour une visite normale sur un chantier existant', role: 'Évolution', accent: 'sky' },
  { slug: 'premiere', label: 'Première visite', hint: 'Pour créer la mémoire de départ d’un chantier', role: 'Création', accent: 'emerald' },
  { slug: 'previsite_ao', label: 'Prévisite AO', hint: 'Pour évaluer un chantier avant réponse à appel d’offres', role: 'Analyse', accent: 'violet' },
] as const

const BY_SLUG = new Map<string, VisitIntentDef>(VISIT_INTENTS.map((i) => [i.slug, i]))

export function isVisitIntent(v: string | null | undefined): v is VisitIntent {
  return !!v && BY_SLUG.has(v)
}

/** Libellé court d'une intention pour une ligne de liste (« Suivi », « Prévisite AO »…). */
export function visitIntentLabel(slug: string | null | undefined): string | null {
  return slug ? BY_SLUG.get(slug)?.label ?? null : null
}
