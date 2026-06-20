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
export type SectionSource = 'generative' | 'participants' | 'actions' | 'risks' | 'meta' | 'followup'

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
  /** Libellé MOE pour le bandeau (ex. « BECIB »). Affiché en layout becib. */
  companyLabel?: string
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
    // Suivi de la réunion précédente (Sprint 3) — données site_actions, zéro LLM.
    // En tête : PV de pilotage, pas PV statique.
    { key: 'suivi_precedent', title: 'Suivi de la réunion précédente', kind: 'fixed', source: 'followup' },
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

// ---------------------------------------------------------------------------
// Template BECIB — CR de réunion de chantier (maîtrise d'œuvre).
// Dérivé de leurs CR réels (docs/Becib : LA CRAVACHE GDE - PV 01→04) +
// _STYLE_Becib.md. Trame numérotée, style administratif, responsable par point,
// clause des 48h. Layout 'becib' (bandeau MOA / BECIB / chantier).
// ---------------------------------------------------------------------------

const BECIB_SYSTEM_PROMPT = [
  "Tu rédiges un COMPTE-RENDU DE RÉUNION DE CHANTIER au format BECIB (maîtrise d'œuvre, Nouvelle-Calédonie).",
  'Style administratif, factuel, sobre, orienté traçabilité et responsabilité. On CONSTATE, on ne juge jamais.',
  'Conventions BECIB à respecter :',
  "- État de chaque point en fin de ligne, précédé de « = » : « = fait », « = OK », « = en cours », « = à faire », « = à confirmer », « = ATTENTE DECISION ».",
  '- Chaque point a un RESPONSABLE explicite (code court entre parenthèses) : MOA (maîtrise d\'ouvrage), MOE/BECIB (maîtrise d\'œuvre), le sigle de l\'entreprise titulaire, ou l\'exploitant. Combinaisons possibles (ex. « ETV/MOA »).',
  '- Regrouper les points techniques par corps d\'état / domaine (Travaux préliminaires, Terrassements, Assainissement, VRD, Divers… selon le contenu).',
  '- Tournures maison autorisées : « De manière générale, … », « Pour mémoire, … », « Au besoin, … », « Noter que … », « Attention, … ».',
  '- Une phrase = un fait. Concis.',
  "RÈGLES D'OR : aucune interprétation, aucun jugement de valeur, aucune flatterie. Ne JAMAIS inventer une présence, une date, une décision ou un état non étayé par le transcript/les notes. Incertain → suffixer « (à confirmer) ».",
  'Tu rédiges UNIQUEMENT les sections narratives demandées (les participants, actions et réserves sont fournis à part).',
].join('\n')

const NOTA_48H =
  "NOTA : En l'absence d'observations sous 48h, le présent CR est considéré comme accepté sans réserve. " +
  'De manière générale, il ne saurait être apporté de remarque par les intervenants qui ne sont pas ou partiellement présents à la réunion de chantier.'

export const CR_CHANTIER_BECIB_V1: ReportTemplateSpec = {
  key: 'cr_chantier_becib.v1',
  label: 'Compte-rendu de réunion de chantier (BECIB)',
  docType: 'pv_chantier',
  layout: 'becib',
  // companyLabel volontairement absent : le bandeau porte le NOM RÉEL de l'org
  // appelante (BatiSud, ContraBat…), jamais « BECIB ». BECIB = trame de
  // référence, son identité ne se partage pas.
  systemPrompt: BECIB_SYSTEM_PROMPT,
  sections: [
    { key: 'suivi_precedent', title: 'Suivi de la réunion précédente', kind: 'fixed', source: 'followup' },
    { key: 'intervenants', title: '1. Intervenants', kind: 'generative', source: 'participants' },
    {
      key: 'ordre_du_jour',
      title: '2. Ordre du jour',
      kind: 'generative',
      source: 'generative',
      guidance: "Points à l'ordre du jour, en puces courtes. Si non explicite, déduire sobrement du contenu (ex. « Suivi des travaux. »).",
    },
    {
      key: 'remarques_cr_precedent',
      title: '3. Remarques sur le CR précédent',
      kind: 'generative',
      source: 'generative',
      guidance: 'Remarques/corrections sur le CR précédent si mentionnées, sinon « RAS. ». Ne pas inventer.',
    },
    // Clause des 48h — verbatim, rendue telle quelle (jamais reformulée).
    { key: 'nota_48h', title: 'NOTA', kind: 'fixed', source: 'meta', guidance: NOTA_48H },
    {
      key: 'points_examines',
      title: '4. Points examinés',
      kind: 'generative',
      source: 'generative',
      guidance: 'Cœur du CR. Regrouper par corps d\'état / domaine. Chaque point : fait constaté + état en fin (« = fait / en cours / à faire ») + responsable entre parenthèses (MOA / MOE / sigle entreprise / exploitant). Tournures BECIB. Ne rien inventer.',
    },
    {
      key: 'decisions',
      title: 'Décisions proposées',
      kind: 'generative',
      source: 'generative',
      guidance: 'Décisions explicitement tranchées en réunion uniquement. Formulation conditionnelle → « (à confirmer) » ou omise. Ne jamais inventer ni durcir.',
    },
    { key: 'actions', title: 'Actions à faire', kind: 'generative', source: 'actions' },
    { key: 'reserves', title: 'Réserves / points bloquants', kind: 'generative', source: 'risks' },
    {
      key: 'prochaine_reunion',
      title: 'Prochaine réunion',
      kind: 'generative',
      source: 'generative',
      guidance: 'Date/heure si mentionnée, sinon « À planifier. ». Ne pas inventer de date.',
    },
  ],
}

const TEMPLATES: Record<string, ReportTemplateSpec> = {
  [CR_CHANTIER_VRD_V1.key]: CR_CHANTIER_VRD_V1,
  [CR_CHANTIER_BECIB_V1.key]: CR_CHANTIER_BECIB_V1,
}

/**
 * Trame de CR de chantier (dérivée BECIB) = défaut pour TOUS : c'est la bonne
 * structure de CR BTP (numérotée, responsable par point, clause 48h). L'IDENTITÉ
 * (nom du bandeau) reste celle de l'org appelante — cf. companyLabelForOrg.
 * Un template plus spécifique pourra être renvoyé selon companySlug plus tard.
 */
export function resolveReportTemplate(opts?: { companySlug?: string | null }): ReportTemplateSpec {
  void opts?.companySlug // réservé pour une future résolution par compagnie
  return CR_CHANTIER_BECIB_V1
}

export function getReportTemplate(key: string): ReportTemplateSpec | null {
  return TEMPLATES[key] ?? null
}

// IDENTITÉ BECIB = réservée à l'entreprise BECIB (directive Vincent 2026-06-20).
// L'identité (nom + logo) NE SE PARTAGE PAS : chaque org porte la sienne. Seule
// une org dont le slug est « becib » affiche le label/logo BECIB ; toute autre
// (BatiSud, ContraBat…) porte son PROPRE nom, sans logo BECIB. La trame (structure
// numérotée, codification, responsable par point) reste partagée — c'est la mise
// en page ; l'IDENTITÉ, non.
const BECIB_BRANDED_ORG_SLUGS = new Set(['becib'])

/** Libellé MOE du bandeau : « BECIB » uniquement pour l'org BECIB, sinon le nom réel. */
export function companyLabelForOrg(org: { slug?: string | null; name?: string | null } | null): string | null {
  if (!org) return null
  if (org.slug && BECIB_BRANDED_ORG_SLUGS.has(org.slug.toLowerCase())) return 'BECIB'
  return org.name ?? null
}

/** Ligne de codification façon BECIB : « AAAABECnnn/CRnnn · Version 1 · date ».
 *  nnn dérivé (stable) du site ; seq = numéro de réunion. Déterministe, sans IA. */
export function becibReference(opts: { dateIso: string; meetingSeq: number; siteId: string }): string {
  const d = new Date(opts.dateIso)
  const year = Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear()
  let h = 7
  for (const c of opts.siteId) h = (h * 31 + c.charCodeAt(0)) | 0
  const siteNum = (Math.abs(h) % 900) + 100 // 100..999, stable par site
  const seq = String(Math.max(1, opts.meetingSeq)).padStart(3, '0')
  const dateFr = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR')
  return `${year}BEC${siteNum}/CR${seq} · Version 1 · ${dateFr}`
}
