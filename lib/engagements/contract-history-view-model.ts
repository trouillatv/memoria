// DOC-CONTRACT-OS-1B3 (mandat Vincent 2026-09-29, sur 1B2-B1/B2/B3/B4 CODE
// CLOSED) — presenter PUR pour la vue historique contractuelle explicable.
//
// AUCUNE logique temporelle ici : aucun fold, aucune résolution, aucune
// priorité métier recalculée. Ce module se contente de FORMATER et de
// CLASSER ce que `resolveEngagementAtDate`/`resolveEngagementContractStateForUser`
// (B1/B3, FROZEN) ont déjà résolu — en particulier `provenanceTrail`, qui
// contient déjà l'intégralité de l'historique des effets (NEW/MODIFY/SUSPEND/
// CONFIRM), indépendamment de l'ordre d'entrée.
//
// Invariants non négociables (mandat 1B3) :
//   - Jamais `recordedInMemoriaAt` présenté comme une date de prise d'effet
//     contractuelle — toujours une ligne séparée, explicitement libellée.
//   - Jamais un tri par `recordedInMemoriaAt` — l'ordre visuel suit les dates
//     contractuelles (startsOn), jamais l'horodatage technique.
//   - CONFIRM reste provenance-only : jamais présenté comme un remplacement
//     de valeur ou un redémarrage de période.
//   - SUSPEND event_driven : jamais de reprise inventée.
//   - Un document source absent de `documentTitleById` (non visible pour ce
//     rôle) ne rend jamais son UUID — mention neutre uniquement, même
//     politique que B4.
//   - Indéterminé/conflit ne sont jamais convertis en certitude.

import type {
  EngagementContractStateDTO,
  MaterializedContractEffect,
  ProvenanceEntry,
} from './resolve-contract-state'
import type { ContractTemporality } from './contract-effect'
import { addDaysLocal, frDayMonthYearLocal } from '@/lib/time/local-date'

const RESTRICTED_DOCUMENT_LABEL = 'document à accès restreint'

export type ContractHistoryContribution =
  | 'used_in_resolution'
  | 'not_used_in_resolution'
  | 'orphaned'
  | 'confirm_provenance_only'

export type ContractHistoryEntryViewModel = {
  effectId: string
  effect: MaterializedContractEffect
  temporality: ContractTemporality
  scopeKey: string
  /** Phrase principale décrivant l'effet — cf. mandat sections 6-9. */
  headline: string
  /** Ligne de dates contractuelles (jamais recordedInMemoriaAt). */
  dateLine: string | null
  /** Valeur structurée — uniquement quand cet effet est la source ACTUELLE
   *  retenue par un scope du DTO (aucune valeur historique reconstruite pour
   *  un effet remplacé, faute de donnée disponible dans provenanceTrail). */
  valueLine: string | null
  sourceLine: string
  /** Toujours distincte de dateLine — audit MemorIA, jamais contractuelle. */
  recordedInMemoriaLine: string
  contribution: ContractHistoryContribution
  contributionNote: string | null
  /** Explication de l'indétermination ISSUE DU MOTEUR (scope.indeterminateReason),
   *  jamais une reformulation inventée. */
  engineIndeterminateReason: string | null
  inConflict: boolean
  conflictReason: string | null
}

export type EngagementContractHistoryViewModel = {
  isLegacy: boolean
  legacyMessage: string | null
  resolutionConflictMessage: string | null
  entries: ContractHistoryEntryViewModel[]
}

function sourceLabelOf(entry: ProvenanceEntry, documentTitleById?: Map<string, string>): string {
  return documentTitleById?.get(entry.sourceDocumentId) ?? RESTRICTED_DOCUMENT_LABEL
}

function formatStructuredValue(scopeKey: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const nested = record[scopeKey]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const { from, to } = nested as Record<string, unknown>
      if (typeof from === 'string' && typeof to === 'string') {
        return `${scopeKey} : ${from} → ${to}`
      }
    }
  }
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function buildNewHeadline(temporality: ContractTemporality, startsOn: string | null, endsOn: string | null): string {
  switch (temporality) {
    case 'permanent':
      return startsOn
        ? `Engagement en vigueur à partir du ${startsOn}.`
        : 'Engagement en vigueur, date de départ non déterminée.'
    case 'bounded':
      return startsOn && endsOn
        ? `Engagement en vigueur du ${startsOn} au ${endsOn}.`
        : 'Engagement borné, fenêtre non entièrement déterminée.'
    case 'one_off':
      return startsOn
        ? `Engagement applicable uniquement le ${startsOn}.`
        : 'Engagement ponctuel, date non déterminée.'
    case 'event_driven':
      return startsOn
        ? `Engagement en vigueur à partir du déclenchement enregistré le ${startsOn}.`
        : 'Engagement en vigueur, déclenchement non encore enregistré.'
  }
}

function buildModifyDateLine(temporality: ContractTemporality, startsOn: string | null, endsOn: string | null): string | null {
  switch (temporality) {
    case 'permanent':
      return startsOn ? `À partir du ${startsOn}.` : null
    case 'bounded':
      if (startsOn && endsOn) return `Du ${startsOn} au ${endsOn}.`
      return startsOn ? `À partir du ${startsOn}.` : null
    case 'one_off':
      return startsOn ? `Le ${startsOn}.` : null
    case 'event_driven':
      return startsOn
        ? `À partir du déclenchement enregistré le ${startsOn}.`
        : 'Déclenchement non encore enregistré.'
  }
}

// Le moteur (`suspendIndeterminateAt`, resolve-contract-state.ts) traite déjà
// tout jour strictement entre endsOn et resumeOn comme indéterminé dès que
// resumeOn n'est pas le lendemain civil d'endsOn. Ici, aucune résolution :
// seule une comparaison arithmétique de dates (addDaysLocal) pour rendre ce
// même trou VISIBLE dans le récit, plutôt que de le laisser implicite tant
// que personne ne consulte cette fenêtre précise.
function buildBoundedResumeGapPhrase(rawEndsOn: string | null, rawResumeOn: string | null): string | null {
  if (!rawEndsOn || !rawResumeOn) return null
  const dayAfterEnd = addDaysLocal(rawEndsOn, 1)
  if (dayAfterEnd === rawResumeOn) return null
  const gapStart = frDayMonthYearLocal(dayAfterEnd)
  const gapEnd = frDayMonthYearLocal(addDaysLocal(rawResumeOn, -1))
  return `Statut indéterminé du ${gapStart} au ${gapEnd} — aucune règle contractuelle ne couvre cet intervalle.`
}

function buildSuspendDateLine(
  temporality: ContractTemporality,
  startsOn: string | null,
  endsOn: string | null,
  resumeOn: string | null,
  rawEndsOn: string | null,
  rawResumeOn: string | null,
): string {
  switch (temporality) {
    case 'bounded': {
      if (startsOn && endsOn && resumeOn) {
        const gapPhrase = buildBoundedResumeGapPhrase(rawEndsOn, rawResumeOn)
        return `Suspension du ${startsOn} au ${endsOn}. Reprise le ${resumeOn}.${gapPhrase ? ` ${gapPhrase}` : ''}`
      }
      if (startsOn && endsOn) return `Suspension du ${startsOn} au ${endsOn}.`
      return startsOn ? `Suspension à partir du ${startsOn}.` : 'Suspension bornée, dates non déterminées.'
    }
    case 'one_off':
      return startsOn ? `Suspension le ${startsOn} uniquement.` : 'Suspension ponctuelle, date non déterminée.'
    case 'event_driven':
      return 'Suspension déclenchée par événement, reprise non déterminable à partir des données qualifiées.'
    case 'permanent':
      return startsOn ? `Suspension à partir du ${startsOn}, sans fin déterminée.` : 'Suspension sans fin déterminée.'
  }
}

function buildContributionNote(contribution: ContractHistoryContribution): string | null {
  switch (contribution) {
    case 'orphaned':
      return "Écarté du calcul — hors de la fenêtre d'existence fixée par l'Engagement."
    case 'not_used_in_resolution':
      return 'Non retenu dans l’état actuel (remplacé, futur, ou hors application à la date consultée).'
    case 'confirm_provenance_only':
      return 'Provenance uniquement — ne modifie jamais une valeur, une existence ni une période.'
    case 'used_in_resolution':
      return null
  }
}

function buildEntry(
  entry: ProvenanceEntry,
  state: EngagementContractStateDTO,
  documentTitleById?: Map<string, string>,
): ContractHistoryEntryViewModel {
  const sourceLabel = sourceLabelOf(entry, documentTitleById)
  const sourceLine = `Source : ${sourceLabel}`
  const recordedInMemoriaLine =
    `Enregistré dans MemorIA le ${frDayMonthYearLocal(entry.recordedInMemoriaAt)}` +
    (entry.recordedAfterQueriedDate ? ' (après la date consultée)' : '')

  const startsOnFmt = entry.startsOn ? frDayMonthYearLocal(entry.startsOn) : null
  const endsOnFmt = entry.endsOn ? frDayMonthYearLocal(entry.endsOn) : null
  const resumeOnFmt = entry.resumeOn ? frDayMonthYearLocal(entry.resumeOn) : null

  let headline: string
  let dateLine: string | null = null
  let valueLine: string | null = null

  if (entry.effect === 'new') {
    headline = buildNewHeadline(entry.temporality, startsOnFmt, endsOnFmt)
  } else if (entry.effect === 'modify') {
    headline = `Modification — ${entry.scopeKey}`
    dateLine = buildModifyDateLine(entry.temporality, startsOnFmt, endsOnFmt)
    const matchingScope = state.scopes.find((s) => s.scopeKey === entry.scopeKey)
    valueLine =
      matchingScope && matchingScope.basis === 'modify' && matchingScope.sourceEffectId === entry.effectId
        ? formatStructuredValue(entry.scopeKey, matchingScope.value)
        : null
  } else if (entry.effect === 'suspend') {
    headline = `Suspension — ${entry.scopeKey}`
    dateLine = buildSuspendDateLine(entry.temporality, startsOnFmt, endsOnFmt, resumeOnFmt, entry.endsOn, entry.resumeOn)
  } else {
    // confirm — provenance-only (doctrine 8), jamais une valeur/existence.
    headline = sourceLabel !== RESTRICTED_DOCUMENT_LABEL ? `Confirmé par ${sourceLabel}` : 'Confirmation documentaire enregistrée'
    dateLine = startsOnFmt ? `Confirme l'état applicable au ${startsOnFmt}.` : null
  }

  const contribution: ContractHistoryContribution = entry.orphaned
    ? 'orphaned'
    : entry.effect === 'confirm'
      ? 'confirm_provenance_only'
      : entry.usedInResolution
        ? 'used_in_resolution'
        : 'not_used_in_resolution'

  const matchingScope = state.scopes.find((s) => s.scopeKey === entry.scopeKey)
  const engineIndeterminateReason =
    entry.effect === 'suspend' && matchingScope?.applicability === 'indeterminate'
      ? matchingScope.indeterminateReason
      : null

  const inResolutionConflict = state.resolutionIssue?.conflictingEffectIds.includes(entry.effectId) ?? false
  const inValueConflict = matchingScope?.valueConflict?.conflictingEffectIds.includes(entry.effectId) ?? false
  const inApplicabilityConflict = matchingScope?.applicabilityConflict?.conflictingEffectIds.includes(entry.effectId) ?? false
  const inConflict = inResolutionConflict || inValueConflict || inApplicabilityConflict
  const conflictReason = !inConflict
    ? null
    : inResolutionConflict
      ? 'Plusieurs effets fondateurs (NEW) concurrents sur cet Engagement — existence indécidable, revue humaine requise.'
      : inValueConflict
        ? matchingScope!.valueConflict!.reason
        : matchingScope!.applicabilityConflict!.reason

  return {
    effectId: entry.effectId,
    effect: entry.effect,
    temporality: entry.temporality,
    scopeKey: entry.scopeKey,
    headline,
    dateLine,
    valueLine,
    sourceLine,
    recordedInMemoriaLine,
    contribution,
    contributionNote: buildContributionNote(contribution),
    engineIndeterminateReason,
    inConflict,
    conflictReason,
  }
}

/**
 * Construit la vue historique explicable d'un Engagement à partir du DTO déjà
 * résolu par B1/B3. Ordre visuel = dates contractuelles (startsOn), jamais
 * `recordedInMemoriaAt` ; à date contractuelle égale ou absente, ordre
 * technique stable (id ascendant, déjà l'ordre de `provenanceTrail`).
 */
export function buildEngagementContractHistoryViewModel(
  state: EngagementContractStateDTO,
  documentTitleById?: Map<string, string>,
): EngagementContractHistoryViewModel {
  if (state.provenanceTrail.length === 0) {
    return {
      isLegacy: true,
      legacyMessage:
        'Engagement historique. MemorIA dispose de la règle source mais pas d’un historique contractuel structuré pour cette période.',
      resolutionConflictMessage: null,
      entries: [],
    }
  }

  const resolutionConflictMessage = state.resolutionIssue
    ? 'Conflit non résolu : plusieurs effets fondateurs (NEW) concurrents sur cet Engagement — existence indécidable, revue humaine requise.'
    : null

  const sortedTrail = [...state.provenanceTrail].sort((a, b) => {
    if (a.startsOn === b.startsOn) return 0
    if (a.startsOn === null) return 1
    if (b.startsOn === null) return -1
    return a.startsOn < b.startsOn ? -1 : 1
  })

  return {
    isLegacy: false,
    legacyMessage: null,
    resolutionConflictMessage,
    entries: sortedTrail.map((entry) => buildEntry(entry, state, documentTitleById)),
  }
}
