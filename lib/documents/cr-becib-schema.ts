// CR de chantier BECIB — modèle de DONNÉES structuré (fond), séparé du gabarit
// (forme). Réf. canonique : docs/Becib/brief_CR_BECIB.md.
//
// Principes (validés Vincent) :
//  - statut = enum fermé · action = codes de rôle (joints par « / ») · action
//    possible AU NIVEAU DU BLOC (cellules ACTION fusionnées de l'original).
//  - administratifs structuré comme techniques (sous-blocs CONTRAT/SOUS-TRAITANCE…).
//  - emphase en ligne via **gras** (parsé au rendu).
//  - planning en champs typés (certains calculables).
//  - validation Zod + défauts SÛRS : champ manquant = vide, JAMAIS inventé.

import { z } from 'zod'

export const STATUTS = ['fait', 'OK', 'en cours', 'à faire', 'en attente', 'attente décision'] as const
export const ROLE_CODES = ['ETV', 'MOA', 'MOE', 'CLUB', 'FSH'] as const
export const INTERVENANT_GROUPES = ['MOA', 'MOE', 'ENTREPRISE', 'PARTENAIRES'] as const
export const PRESENCES = ['I', 'P', 'AE', 'AN', 'D'] as const

const statutSchema = z.enum(STATUTS).nullable().catch(null)
const actionSchema = z.array(z.enum(ROLE_CODES)).catch([])

// Un point examiné : texte rédigé (avec **gras** autorisé) + statut + responsables.
const pointSchema = z.object({
  texte: z.string().catch(''),
  statut: statutSchema,
  action: actionSchema, // override l'action du bloc si non vide
})

// Un BLOC = un sous-titre + ses points + une action de bloc (cellule fusionnée).
const blocSchema = z.object({
  sousTitre: z.string().catch(''),
  points: z.array(pointSchema).catch([]),
  action: actionSchema, // action commune au bloc (rendue dans la colonne ACTION)
})

const intervenantSchema = z.object({
  groupe: z.enum(INTERVENANT_GROUPES).catch('ENTREPRISE'),
  organisme: z.string().catch(''), // colonne dédiée (Mairie / BECIB / ETV …)
  representant: z.string().catch(''), // le nom de la personne, sans l'organisme
  tel: z.string().nullable().catch(null),
  mob: z.string().nullable().catch(null),
  email: z.string().nullable().catch(null),
  invite: z.boolean().catch(true), // colonne I (convié) — coché par défaut
  presence: z.enum(PRESENCES).catch('P'), // statut effectif (P / AE / AN), niveau organisme
  diffusion: z.boolean().catch(false), // coche AUSSI la colonne D (CR diffusé), par personne
})

const planningSchema = z.object({
  marche: z.object({
    osDemarrage: z.string().nullable().catch(null),
    delai: z.string().nullable().catch(null),
    finContractuelle: z.string().nullable().catch(null),
  }).catch({ osDemarrage: null, delai: null, finContractuelle: null }),
  intemperies: z.object({
    depuisDerniereReunion: z.string().nullable().catch(null),
    cumulOuvrable: z.string().nullable().catch(null),
    finAvecIntemperies: z.string().nullable().catch(null),
  }).catch({ depuisDerniereReunion: null, cumulOuvrable: null, finAvecIntemperies: null }),
  prolongations: z.string().nullable().catch(null),
  retard: z.object({
    previsionnel: z.string().nullable().catch(null),
    effectif: z.string().nullable().catch(null),
  }).catch({ previsionnel: null, effectif: null }),
}).catch({
  marche: { osDemarrage: null, delai: null, finContractuelle: null },
  intemperies: { depuisDerniereReunion: null, cumulOuvrable: null, finAvecIntemperies: null },
  prolongations: null,
  retard: { previsionnel: null, effectif: null },
})

export const crBecibSchema = z.object({
  meta: z.object({
    numeroCR: z.string().catch(''),
    dateIso: z.string().catch(''),
    semaine: z.string().nullable().catch(null),
    projetTitre: z.string().catch(''),
    moa: z.string().catch(''),
    moe: z.string().catch('BECIB'),
    chantier: z.string().catch(''),
    dns: z.string().nullable().catch(null),
    version: z.string().catch('1'),
    modification: z.string().catch('A'),
    // Logo du maître d'ouvrage (data URL base64), affiché centré en p.1.
    // Optionnel : sans asset fourni, le gabarit montre un emplacement discret.
    clientLogoDataUrl: z.string().nullable().catch(null),
  }),
  intervenants: z.array(intervenantSchema).catch([]),
  ordreDuJour: z.array(z.string()).catch([]),
  remarquesCrPrecedent: z.string().catch(''),
  pointsExamines: z.object({
    administratifs: z.array(blocSchema).catch([]),
    techniques: z.array(blocSchema).catch([]),
  }).catch({ administratifs: [], techniques: [] }),
  avancement: z.object({
    fait: z.array(z.string()).catch([]),
    previsions: z.array(z.string()).catch([]),
  }).catch({ fait: [], previsions: [] }),
  intemperiesAleas: z.array(z.string()).catch([]),
  planning: planningSchema,
  securite: z.array(z.string()).catch([]),
  photos: z.array(z.object({ url: z.string(), legende: z.string().catch('') })).catch([]),
  prochaineReunion: z.object({
    date: z.string().nullable().catch(null),
    heure: z.string().nullable().catch(null),
    lieu: z.string().nullable().catch(null),
  }).catch({ date: null, heure: null, lieu: null }),
  signature: z.string().catch('POUR BECIB,'),
})

export type CrBecib = z.infer<typeof crBecibSchema>
export type CrBecibPoint = z.infer<typeof pointSchema>
export type CrBecibBloc = z.infer<typeof blocSchema>
export type CrBecibIntervenant = z.infer<typeof intervenantSchema>
export type StatutPoint = (typeof STATUTS)[number]
export type RoleCode = (typeof ROLE_CODES)[number]

/** Clause des 48h — verbatim, jamais reformulée. */
export const NOTA_48H =
  "NOTA : En l'absence d'observations sous 48h, le présent CR est considéré comme accepté sans réserve. " +
  'De manière générale, il ne saurait être apporté de remarque par les intervenants qui ne sont pas ou partiellement présents à la réunion de chantier.'

/** Parse une string en runs { text, bold } : **gras** uniquement (léger, déterministe). */
export function parseEmphasis(text: string): { text: string; bold: boolean }[] {
  const runs: { text: string; bold: boolean }[] = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false })
    runs.push({ text: m[1], bold: true })
    last = re.lastIndex
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false })
  return runs.length > 0 ? runs : [{ text, bold: false }]
}

/** Libellé d'un statut pour le rendu (« = en cours »). */
export function statutLabel(s: StatutPoint | null): string {
  return s ? `= ${s}` : ''
}

/** Codes d'action joints (« ETV/MOA »). */
export function actionLabel(codes: RoleCode[]): string {
  return codes.join('/')
}
