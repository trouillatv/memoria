// Qualification humaine de l'effet contractuel d'une proposition Engagement
// issue d'un document ultérieur (avenant, ordre de service…) — DOC-CONTRACT-OS-1A.
//
// Deux axes orthogonaux (Vincent 2026-09-28), jamais mélangés :
//   EFFET        = ce que le document change (nouveau / modification / suspension…)
//   TEMPORALITÉ  = la forme temporelle de cet effet (permanent / borné / ponctuel…)
//
// Stocké uniquement dans document_extraction_proposal.source_payload.contract_effect
// (jsonb) — aucune table d'effets contractuels, aucune RPC d'application pour
// l'instant. Décider comment persister durablement un effet confirmé et calculer
// « quelle règle s'appliquait à telle date » est le périmètre de DOC-CONTRACT-OS-1B,
// explicitement hors périmètre ici.

export type ContractEffect = 'new' | 'modify' | 'suspend' | 'confirm' | 'conflict' | 'non_engagement'
export type ContractTemporality = 'permanent' | 'bounded' | 'one_off' | 'event_driven'

export const CONTRACT_EFFECT_ORDER: ContractEffect[] = [
  'new', 'modify', 'suspend', 'confirm', 'conflict', 'non_engagement',
]

export const CONTRACT_EFFECT_META: Record<
  ContractEffect,
  { label: string; description: string; badge: string }
> = {
  new: {
    label: 'Nouvel Engagement',
    description: 'Le document introduit une exigence qui n’existait pas.',
    badge: 'border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300',
  },
  modify: {
    label: 'Modification',
    description: 'Le document change une exigence existante (fréquence, périmètre…).',
    badge: 'border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-300',
  },
  suspend: {
    label: 'Suspension',
    description: 'Le document suspend temporairement ou définitivement une exigence existante.',
    badge: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  },
  confirm: {
    label: 'Confirmation',
    description: 'Le document rappelle une exigence déjà en vigueur, sans la modifier.',
    badge: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
  },
  conflict: {
    label: 'Conflit documentaire',
    description: 'Le document contredit une source déjà connue (CCTP, Engagement existant…) — à examiner avant toute décision.',
    badge: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300',
  },
  non_engagement: {
    label: 'Non-Engagement',
    description: 'Accusé de réception, formalité administrative — ne doit jamais devenir un Engagement.',
    badge: 'border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400',
  },
}

export const CONTRACT_TEMPORALITY_ORDER: ContractTemporality[] = [
  'permanent', 'bounded', 'one_off', 'event_driven',
]

export const CONTRACT_TEMPORALITY_META: Record<
  ContractTemporality,
  { label: string; description: string }
> = {
  permanent: { label: 'Permanent', description: 'Sans échéance connue, applicable jusqu’à nouvel effet.' },
  bounded: { label: 'Bornée', description: 'Période délimitée (début/fin), reprise éventuelle du régime antérieur.' },
  one_off: { label: 'Ponctuelle', description: 'Un seul événement daté, pas de récurrence.' },
  event_driven: { label: 'Déclenchée par événement', description: 'Applicable à l’occurrence d’un événement, pas à une date fixe.' },
}

export function effectLabel(effect: ContractEffect | null): string {
  return effect ? CONTRACT_EFFECT_META[effect].label : 'Non qualifié'
}

export function effectRequiresTarget(effect: ContractEffect): boolean {
  return effect === 'modify' || effect === 'suspend' || effect === 'confirm'
}

export function temporalityRequiresDates(temporality: ContractTemporality): boolean {
  return temporality === 'bounded'
}

// CONFLICT et NON_ENGAGEMENT bloquent toute matérialisation (Vincent 2026-09-28) :
// un conflit documentaire doit être résolu par un humain avant tout geste, et un
// non-Engagement (ex. accusé de réception) ne doit jamais produire d'Engagement.
export function effectBlocksMaterialization(effect: ContractEffect | null): boolean {
  return effect === 'conflict' || effect === 'non_engagement'
}

// Matrice effet → RPC de matérialisation autorisée (mandat de fermeture DOC-CONTRACT-OS-1A,
// Vincent 2026-09-28). `null` = proposition sans qualification (CCTP historique,
// comportement préservé). MODIFY/SUSPEND n'autorisent ni l'une ni l'autre tant que
// DOC-CONTRACT-OS-1B (persistance durable de l'effet) n'existe pas.
export function effectAllowsCreateNew(effect: ContractEffect | null): boolean {
  return effect === null || effect === 'new'
}

export function effectAllowsLinkExisting(effect: ContractEffect | null): boolean {
  return effect === null || effect === 'confirm'
}

// Trou de doctrine comblé (mandat de fermeture Vincent 2026-09-28) : `effect === null`
// signifiait à la fois « ancien CCTP jamais qualifié » (comportement legacy préservé)
// et « OS/Avenant nouvellement importé, qualification pas encore faite » (devrait
// bloquer). documents.document_type (migration 433, valeurs existantes — jamais un
// second champ inventé) distingue les deux : seuls ordre_service et avenant exigent
// une qualification explicite avant toute matérialisation individuelle ou groupée.
export const DOCUMENT_TYPES_REQUIRING_QUALIFICATION: readonly string[] = ['ordre_service', 'avenant']

export function documentRequiresContractEffectQualification(documentType: string | null | undefined): boolean {
  return !!documentType && DOCUMENT_TYPES_REQUIRING_QUALIFICATION.includes(documentType)
}

export function effectAllowsCreateNewForDocument(documentType: string | null | undefined, effect: ContractEffect | null): boolean {
  if (effect !== null) return effectAllowsCreateNew(effect)
  return !documentRequiresContractEffectQualification(documentType)
}

export function effectAllowsLinkExistingForDocument(documentType: string | null | undefined, effect: ContractEffect | null): boolean {
  if (effect !== null) return effectAllowsLinkExisting(effect)
  return !documentRequiresContractEffectQualification(documentType)
}

export type ContractEffectQualification = {
  effect: ContractEffect
  temporality: ContractTemporality
  targetEngagementId: string | null
  startsOn: string | null
  endsOn: string | null
  resumeOn: string | null
  scope: string | null
}
