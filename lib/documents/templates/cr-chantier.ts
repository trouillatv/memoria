// Sprint 1 — Templates de CR / PV de chantier (en code, pas en fs : bundlé &
// déployable ; lire docs/ au runtime sur Vercel n'est pas fiable).
//
// Un template décrit : sa MISE EN PAGE (layout, dépendante de la compagnie),
// son system_prompt, et ses SECTIONS typées par `source`. La `source` impose le
// Choix A (Vincent) : participants/actions/risques viennent des DONNÉES déjà
// curées de la réunion ; seules les sections `generative` sont rédigées par l'IA
// depuis le transcript. Aucune ré-extraction d'actions.
//
// Résolution : template spécifique compagnie → template par défaut (structure
// inspirée BECIB, identifiants/layout NEUTRES). L'identité BECIB (logo, codif.
// « Numéro DNS », emails, mise en page deux colonnes) ne fuite jamais ; elle
// sera portée par un template/layout BECIB dédié quand on aura leurs assets.

/** D'où vient le contenu d'une section. */
export type SectionSource = 'generative' | 'participants' | 'actions' | 'risks' | 'meta'

export interface TemplateSectionSpec {
  key: string
  title: string
  /** generative = rédigée par l'IA ; fixed = texte imposé (clauses). */
  kind: 'generative' | 'fixed'
  /** Origine du contenu (impose le Choix A : data vs IA). */
  source: SectionSource
  /** Consigne de rédaction (sections generative) ou texte imposé (fixed). */
  guidance?: string
}

/** Layout PDF — dépendant de la compagnie (cf. mémoire templates-compagnie-moat). */
export type TemplateLayout = 'neutral' | 'becib'

export interface ReportTemplateSpec {
  key: string
  label: string
  /** document_type côté /documents quand le PV est validé. */
  docType: string
  layout: TemplateLayout
  systemPrompt: string
  sections: TemplateSectionSpec[]
}

// ---------------------------------------------------------------------------
// Template par défaut — CR chantier (structure inspirée BECIB, NEUTRE).
// Sert toute compagnie sans template propre (ex. Contrabat).
// ---------------------------------------------------------------------------

const NEUTRAL_SYSTEM_PROMPT = [
  'Tu rédiges un compte-rendu de réunion de chantier pour une maîtrise d\'œuvre.',
  'Style : factuel, neutre, au constat. Aucune interprétation, aucun jugement, aucune flatterie.',
  'Conventions :',
  '- Marquer l\'état des points : « = fait », « = en cours », « = à faire », « = à confirmer ».',
  '- Une phrase = un fait. Concis. Pas de remplissage.',
  '- Ne JAMAIS inventer une présence, une date, une décision ou un état non étayé par le transcript/les notes.',
  '- Si une information est évoquée mais incertaine, l\'écrire suivie de « (à confirmer) ».',
  'Tu rédiges UNIQUEMENT les sections narratives demandées. Les participants, actions et',
  'réserves sont fournis séparément (ne pas les réécrire ni en inventer).',
].join('\n')

export const CR_CHANTIER_VRD_V1: ReportTemplateSpec = {
  key: 'cr_chantier_vrd.v1',
  label: 'Compte-rendu de réunion de chantier',
  docType: 'pv_chantier',
  layout: 'neutral',
  systemPrompt: NEUTRAL_SYSTEM_PROMPT,
  sections: [
    {
      key: 'infos_generales',
      title: 'Informations générales',
      kind: 'generative',
      source: 'generative',
      guidance: 'Objet de la réunion, chantier concerné, date si mentionnée. 1 à 3 lignes. Ne pas inventer de numéro de marché.',
    },
    { key: 'participants', title: 'Participants', kind: 'generative', source: 'participants' },
    {
      key: 'avancement',
      title: 'Avancement depuis la dernière réunion',
      kind: 'generative',
      source: 'generative',
      guidance: 'Synthèse factuelle de l\'avancement et des constats. Puces courtes, état par point (= fait / en cours / à faire).',
    },
    {
      key: 'points_techniques',
      title: 'Points techniques',
      kind: 'generative',
      source: 'generative',
      guidance: 'Regrouper les points par thème / corps d\'état (terrassement, assainissement, etc. selon le contenu). Puces courtes, factuelles, état par point.',
    },
    {
      key: 'decisions',
      // « proposées », pas « prises » : tant que l'humain n'a pas validé le PV,
      // ce sont des propositions. Évite qu'une IA transforme une hypothèse en
      // décision actée (« on pourrait déplacer le regard » → « Décision : … »).
      title: 'Décisions proposées',
      kind: 'generative',
      source: 'generative',
      guidance: 'Ne lister QUE les décisions clairement et explicitement tranchées pendant la réunion. Toute formulation conditionnelle, hypothétique ou non tranchée (« on pourrait », « éventuellement », « à voir ») ne doit PAS devenir une décision : l\'écrire suffixée « (à confirmer) » ou l\'omettre. Ne JAMAIS inventer ni durcir une décision.',
    },
    // Choix A (Vincent) : les actions viennent des actions DÉJÀ curées de la
    // réunion (site_actions), jamais d'une extraction parallèle par l'IA.
    { key: 'actions', title: 'Actions à faire', kind: 'generative', source: 'actions' },
    { key: 'reserves', title: 'Réserves / points bloquants', kind: 'generative', source: 'risks' },
    {
      key: 'documents_attendus',
      title: 'Documents attendus',
      kind: 'generative',
      source: 'generative',
      guidance: 'Lister les documents/livrables explicitement attendus (PAQ, fiches techniques, DOE, PV…). Si aucun n\'est évoqué, écrire « Aucun document spécifique mentionné. ».',
    },
    {
      key: 'prochaine_reunion',
      title: 'Prochaine réunion',
      kind: 'generative',
      source: 'generative',
      guidance: 'Date/heure de la prochaine réunion si mentionnée, sinon « À planifier. ». Ne pas inventer de date.',
    },
  ],
}

const TEMPLATES: Record<string, ReportTemplateSpec> = {
  [CR_CHANTIER_VRD_V1.key]: CR_CHANTIER_VRD_V1,
}

/**
 * Résout le template à utiliser. MVP : toujours le CR par défaut.
 * `companySlug` est prévu pour brancher un template propre à la compagnie
 * (ex. BECIB avec son layout) sans changer les appelants.
 */
export function resolveReportTemplate(opts?: { companySlug?: string | null }): ReportTemplateSpec {
  // TODO(engine) : si un template compagnie existe pour opts.companySlug, le renvoyer
  // (ex. layout BECIB). MVP : toujours le CR neutre par défaut.
  void opts?.companySlug
  return CR_CHANTIER_VRD_V1
}

export function getReportTemplate(key: string): ReportTemplateSpec | null {
  return TEMPLATES[key] ?? null
}
