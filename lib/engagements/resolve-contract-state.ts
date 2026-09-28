// DOC-CONTRACT-OS-1B2-B1 (mandat Vincent 2026-09-29, sur audit 1B2-A FINAL
// CLOSED) — moteur pur de résolution temporelle contractuelle. Répond à
// « quelle règle contractuelle était applicable à telle date ? » à partir de
// engagement_contract_effects (migration 445/446/447) déjà matérialisés.
//
// Contraintes d'architecture (mandat, non négociables) :
//   - AUCUNE dépendance Supabase/DB — reçoit les lignes déjà chargées.
//   - AUCUNE dépendance à l'heure courante (jamais Date.now()/new Date()
//     sans argument) — queriedDate est toujours fourni par l'appelant.
//   - AUCUNE dépendance à l'ordre d'entrée du tableau `effects` — deux appels
//     avec les mêmes effets dans un ordre différent doivent rendre un
//     résultat strictement identique.
//   - Seuls NEW/MODIFY/SUSPEND/CONFIRM existent ici (CONFLICT/NON_ENGAGEMENT
//     ne matérialisent jamais de ligne, cf. contract-effect.ts).
//
// Doctrine gelée par l'audit DOC-CONTRACT-OS-1B2-A (3 tours de revue) :
//   1. NEW fixe l'existence de l'Engagement LUI-MÊME (jamais une portée),
//      selon sa temporalité — bounded fige une fenêtre [A,B] définitive,
//      jamais prolongeable par un MODIFY/CONFIRM ultérieur.
//   2. Un effet non-NEW dont startsOn tombe hors de cette fenêtre est une
//      anomalie de donnée permanente (« orphelin ») — exclu de tout calcul,
//      ne ressuscite jamais l'existence, signalé en provenance.
//   3. Engagement historique (legacy, sans NEW) : basis=engagement_base,
//      value=null tant qu'aucun MODIFY ne s'applique — jamais de valeur
//      structurée inventée depuis un texte libre (source_excerpt).
//   4. Repli MODIFY : permanent → écrasé par un bounded temporaire tant
//      qu'il est actif → à son expiration, retour à la DERNIÈRE valeur
//      permanente connue, jamais à la base textuelle d'origine.
//   5. Aucun repli sur une colonne technique/d'audit (applied_at, ordre
//      d'insertion, id, ordre SQL) pour départager deux effets contractuels
//      concurrents — seul CONFLICT est correct.
//   6. SUSPEND change l'applicabilité, jamais la valeur repliée. Une
//      SUSPEND scope_key='whole_engagement' domine toutes les portées plus
//      étroites pendant sa fenêtre, sans effacer leur valeur repliée.
//   7. SUSPEND event_driven : indéterminée pour toujours une fois active,
//      en l'absence d'un mécanisme de clôture démontré — aucun autre effet,
//      de quelque type ou portée que ce soit, n'est jamais lu comme une
//      reprise implicite.
//   8. CONFIRM est purement de la provenance — jamais de valeur, existence,
//      priorité de conflit ni reprise de suspension. applied_at (horodatage
//      technique) ne devient jamais un champ contractuel.
//   9. Plusieurs NEW pour un même Engagement → conflit explicite, jamais un
//      gagnant automatique (l'existence elle-même est alors indécidable).

import type { ContractEffect, ContractTemporality } from './contract-effect'

export type MaterializedContractEffect = Extract<ContractEffect, 'new' | 'modify' | 'suspend' | 'confirm'>

// Reflet camelCase de la ligne engagement_contract_effects (migration 445/446).
// startsOn/endsOn/resumeOn sont des dates ISO 'YYYY-MM-DD' (jamais un
// timestamp) ; appliedAt reste un timestamptz ISO complet — horodatage de
// manipulation, jamais un champ contractuel (doctrine 8).
export type EngagementContractEffectRow = {
  id: string
  engagementId: string
  effect: MaterializedContractEffect
  temporality: ContractTemporality
  scopeKey: string
  effectPayload: Record<string, unknown>
  startsOn: string | null
  endsOn: string | null
  resumeOn: string | null
  sourceDocumentId: string
  sourceProposalId: string
  appliedAt: string
}

export type ResolveEngagementAtDateInput = {
  engagementId: string
  effects: EngagementContractEffectRow[]
}

export type EngagementExistenceStatus = 'not_yet_existing' | 'exists' | 'expired' | 'undetermined'

export type EngagementExistence = {
  status: EngagementExistenceStatus
  foundedBy: string | null
  existsFrom: string | null
  existsUntil: string | null
}

export type ScopeConflict = {
  scopeKey: string
  conflictingEffectIds: string[]
  reason: string
}

export type ScopeState = {
  scopeKey: string
  applicable: boolean
  dominatedByWholeEngagementSuspend: boolean
  basis: 'engagement_base' | 'new' | 'modify'
  value: unknown
  sourceEffectId: string | null
  valueConflict: ScopeConflict | null
  applicabilityConflict: ScopeConflict | null
  indeterminate: boolean
  indeterminateReason: string | null
}

export type ContractEffectAnomaly = {
  type: 'multiple_new_founders' | 'orphaned_effect'
  message: string
  effectIds: string[]
}

export type ResolutionIssue = {
  type: 'multiple_new_founders'
  conflictingEffectIds: string[]
}

export type ProvenanceEntry = {
  effectId: string
  effect: MaterializedContractEffect
  temporality: ContractTemporality
  scopeKey: string
  sourceDocumentId: string
  sourceProposalId: string
  recordedInMemoriaAt: string
  recordedAfterQueriedDate: boolean
  orphaned: boolean
  usedInResolution: boolean
}

export type EngagementContractStateDTO = {
  engagementId: string
  queriedDate: string
  resolvable: boolean
  resolutionIssue: ResolutionIssue | null
  existence: EngagementExistence
  scopes: ScopeState[]
  anomalies: ContractEffectAnomaly[]
  provenanceTrail: ProvenanceEntry[]
}

const WHOLE_ENGAGEMENT_SCOPE = 'whole_engagement'

// ─── Comparaison de dates ISO 'YYYY-MM-DD' — jamais new Date() sans argument,
// jamais Date.now(). Toute date manipulée ici est fournie par l'appelant ou
// extraite d'une ligne déjà chargée. ──────────────────────────────────────

function parseIsoDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function compareDates(a: string, b: string): number {
  return parseIsoDate(a) - parseIsoDate(b)
}

function isBefore(a: string, b: string): boolean {
  return compareDates(a, b) < 0
}

function isAfter(a: string, b: string): boolean {
  return compareDates(a, b) > 0
}

function isSameOrBefore(a: string, b: string): boolean {
  return compareDates(a, b) <= 0
}

function isSameOrAfter(a: string, b: string): boolean {
  return compareDates(a, b) >= 0
}

function sortIds(items: Array<{ id: string; startsOn: string | null }>): string[] {
  return [...items]
    .sort((a, b) => {
      const byDate = compareDates(a.startsOn ?? '0000-00-00', b.startsOn ?? '0000-00-00')
      if (byDate !== 0) return byDate
      return a.id.localeCompare(b.id)
    })
    .map((e) => e.id)
}

// provenanceTrail doit être indépendant de l'ordre d'entrée de `effects`
// (contrainte d'architecture du mandat) — tri canonique par id, jamais par
// position dans le tableau reçu.
function sortByIdAsc<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

// ─── Résolution générique « quel effet est actif à cette date, sur cette
// portée, et est-ce un conflit ? » — partagée par le repli MODIFY (valeur) et
// la résolution SUSPEND (applicabilité) : les deux ont exactement la même
// géométrie temporelle (bounded=[start,end] inclusif, one_off=jour unique,
// permanent/event_driven=actif pour toujours dès startsOn). Doctrine 5 :
// aucun repli sur applied_at/ordre/id pour départager — seul CONFLICT. ────

type TemporalRow = { id: string; startsOn: string | null; endsOn: string | null; temporality: ContractTemporality }

function isActiveAt(row: TemporalRow, date: string): boolean {
  if (row.startsOn === null) return false
  switch (row.temporality) {
    case 'bounded':
      return row.endsOn !== null && isSameOrAfter(date, row.startsOn) && isSameOrBefore(date, row.endsOn)
    case 'one_off':
      return date === row.startsOn
    case 'permanent':
    case 'event_driven':
      return isSameOrAfter(date, row.startsOn)
  }
}

type ActiveResolution<T> = { winner: T | null; conflict: { conflictingEffectIds: string[] } | null }

function resolveActiveWinner<T extends TemporalRow>(rows: T[], queriedDate: string): ActiveResolution<T> {
  const active = rows.filter((r) => isActiveAt(r, queriedDate))
  if (active.length === 0) return { winner: null, conflict: null }

  const byStartsOn = new Map<string, T[]>()
  for (const r of active) {
    const key = r.startsOn as string
    const group = byStartsOn.get(key)
    if (group) group.push(r)
    else byStartsOn.set(key, [r])
  }
  for (const group of byStartsOn.values()) {
    if (group.length > 1) return { winner: null, conflict: { conflictingEffectIds: sortIds(active) } }
  }

  const bounded = active.filter((r) => r.temporality === 'bounded')
  const oneOff = active.filter((r) => r.temporality === 'one_off')
  const permanent = active.filter((r) => r.temporality === 'permanent' || r.temporality === 'event_driven')

  // Deux fenêtres temporaires (bounded/one_off) simultanément actives sur la
  // même portée n'ont pas de priorité contractuelle démontrable entre elles.
  if (bounded.length > 1 || oneOff.length > 1 || (bounded.length === 1 && oneOff.length === 1)) {
    return { winner: null, conflict: { conflictingEffectIds: sortIds(active) } }
  }

  // Une fenêtre temporaire active prime sur la base permanente (c'est
  // précisément son rôle : override) ; entre plusieurs permanents/event_driven
  // déjà démarrés, le plus récent (startsOn) est le repli normal — ce n'est
  // pas un conflit, c'est l'historique qui s'accumule.
  const winner =
    bounded[0] ??
    oneOff[0] ??
    [...permanent].sort((a, b) => compareDates(b.startsOn as string, a.startsOn as string))[0] ??
    null
  return { winner, conflict: null }
}

// ─── SUSPEND — statut d'indétermination (doctrine 7 event_driven, doctrine
// commentaire migration 446 pour le trou bounded resume_on > ends_on+1).
// N'affecte jamais le calcul du gagnant (isActiveAt reste la seule géométrie
// de vérité) — seulement un drapeau d'incertitude superposé. ──────────────

function suspendIndeterminateAt(row: EngagementContractEffectRow, date: string): boolean {
  if (row.startsOn === null) return false
  if (row.temporality === 'event_driven') {
    return isSameOrAfter(date, row.startsOn)
  }
  if (row.temporality === 'bounded' && row.endsOn !== null && row.resumeOn !== null) {
    return isAfter(date, row.endsOn) && isBefore(date, row.resumeOn)
  }
  return false
}

// ─── Provenance ────────────────────────────────────────────────────────────

function toProvenanceEntry(
  row: EngagementContractEffectRow,
  queriedDate: string,
  orphaned: boolean,
  usedInResolution: boolean,
): ProvenanceEntry {
  return {
    effectId: row.id,
    effect: row.effect,
    temporality: row.temporality,
    scopeKey: row.scopeKey,
    sourceDocumentId: row.sourceDocumentId,
    sourceProposalId: row.sourceProposalId,
    recordedInMemoriaAt: row.appliedAt,
    recordedAfterQueriedDate: isAfter(row.appliedAt.slice(0, 10), queriedDate),
    orphaned,
    usedInResolution,
  }
}

// ─── Point d'entrée ─────────────────────────────────────────────────────────

export function resolveEngagementAtDate(
  input: ResolveEngagementAtDateInput,
  queriedDate: string,
): EngagementContractStateDTO {
  const { engagementId, effects } = input
  const newEffects = effects.filter((e) => e.effect === 'new')

  // Doctrine 9 — plusieurs fondateurs NEW : l'existence est indécidable,
  // jamais de gagnant automatique. Aucune portée n'est calculée.
  if (newEffects.length > 1) {
    const conflictingEffectIds = sortIds(newEffects)
    return {
      engagementId,
      queriedDate,
      resolvable: false,
      resolutionIssue: { type: 'multiple_new_founders', conflictingEffectIds },
      existence: { status: 'undetermined', foundedBy: null, existsFrom: null, existsUntil: null },
      scopes: [],
      anomalies: [
        {
          type: 'multiple_new_founders',
          message: 'Plusieurs effets NEW existent pour cet Engagement — existence indécidable.',
          effectIds: conflictingEffectIds,
        },
      ],
      provenanceTrail: sortByIdAsc(effects).map((e) => toProvenanceEntry(e, queriedDate, false, false)),
    }
  }

  const founder = newEffects[0] ?? null

  // ── Existence (doctrine 1) ────────────────────────────────────────────
  let existence: EngagementExistence
  let envelopeStart: string | null = null
  let envelopeEnd: string | null = null // null = ouvert (permanent/event_driven)
  let envelopeValid = true

  if (founder === null) {
    // Legacy — l'existence n'est pas gouvernée par le modèle d'effets.
    existence = { status: 'exists', foundedBy: null, existsFrom: null, existsUntil: null }
  } else if (founder.startsOn === null) {
    envelopeValid = false
    existence = { status: 'undetermined', foundedBy: founder.id, existsFrom: null, existsUntil: null }
  } else {
    envelopeStart = founder.startsOn
    switch (founder.temporality) {
      case 'permanent':
      case 'event_driven':
        envelopeEnd = null
        existence = {
          status: isSameOrAfter(queriedDate, envelopeStart) ? 'exists' : 'not_yet_existing',
          foundedBy: founder.id,
          existsFrom: envelopeStart,
          existsUntil: null,
        }
        break
      case 'one_off':
        envelopeEnd = envelopeStart
        existence = {
          status:
            queriedDate === envelopeStart
              ? 'exists'
              : isBefore(queriedDate, envelopeStart)
                ? 'not_yet_existing'
                : 'expired',
          foundedBy: founder.id,
          existsFrom: envelopeStart,
          existsUntil: envelopeEnd,
        }
        break
      case 'bounded':
        if (founder.endsOn === null) {
          envelopeValid = false
          existence = { status: 'undetermined', foundedBy: founder.id, existsFrom: envelopeStart, existsUntil: null }
        } else {
          envelopeEnd = founder.endsOn
          existence = {
            status: isBefore(queriedDate, envelopeStart)
              ? 'not_yet_existing'
              : isSameOrAfter(queriedDate, envelopeStart) && isSameOrBefore(queriedDate, envelopeEnd)
                ? 'exists'
                : 'expired',
            foundedBy: founder.id,
            existsFrom: envelopeStart,
            existsUntil: envelopeEnd,
          }
        }
        break
    }
  }

  // ── Orphelins (doctrine 2) — tout effet non-NEW dont startsOn tombe hors
  // de l'enveloppe du fondateur, exclu de tout calcul. Sans fondateur valide,
  // la notion d'orphelin ne s'applique pas (legacy : pas d'enveloppe à violer).
  const anomalies: ContractEffectAnomaly[] = []
  const orphanedIds = new Set<string>()
  if (founder !== null && envelopeValid && envelopeStart !== null) {
    for (const e of effects) {
      if (e.id === founder.id) continue
      if (e.startsOn === null) continue
      const before = isBefore(e.startsOn, envelopeStart)
      const after = envelopeEnd !== null && isAfter(e.startsOn, envelopeEnd)
      if (before || after) orphanedIds.add(e.id)
    }
    if (orphanedIds.size > 0) {
      anomalies.push({
        type: 'orphaned_effect',
        message: "Effet(s) daté(s) hors de la fenêtre d'existence fixée par NEW — exclus du calcul, l'existence n'est jamais ressuscitée.",
        effectIds: sortIds(effects.filter((e) => orphanedIds.has(e.id))),
      })
    }
  }

  const usableEffects = effects.filter((e) => e.id !== founder?.id && !orphanedIds.has(e.id))
  const modifyEffects = usableEffects.filter((e) => e.effect === 'modify')
  const suspendEffects = usableEffects.filter((e) => e.effect === 'suspend')

  const scopeKeys = new Set<string>([WHOLE_ENGAGEMENT_SCOPE])
  for (const e of modifyEffects) scopeKeys.add(e.scopeKey)

  const usedIds = new Set<string>()
  if (founder) usedIds.add(founder.id)

  let scopes: ScopeState[] = []
  const canComputeScopes = existence.status === 'exists' || existence.status === 'undetermined'

  if (canComputeScopes) {
    const wholeSuspendEffects = suspendEffects.filter((e) => e.scopeKey === WHOLE_ENGAGEMENT_SCOPE)
    const wholeResolution = resolveActiveWinner(wholeSuspendEffects, queriedDate)
    const wholeIndeterminate = wholeSuspendEffects.some((e) => suspendIndeterminateAt(e, queriedDate))
    if (wholeResolution.winner) usedIds.add(wholeResolution.winner.id)

    scopes = [...scopeKeys].sort().map((scopeKey) => {
      const baseline: { basis: 'engagement_base' | 'new'; sourceEffectId: string | null } = founder
        ? { basis: 'new', sourceEffectId: founder.id }
        : { basis: 'engagement_base', sourceEffectId: null }

      const scopeModifyEffects = modifyEffects.filter((e) => e.scopeKey === scopeKey)
      const modifyResolution = resolveActiveWinner(scopeModifyEffects, queriedDate)

      let basis: ScopeState['basis'] = baseline.basis
      let value: unknown = null
      let sourceEffectId: string | null = baseline.sourceEffectId
      let valueConflict: ScopeConflict | null = null

      if (modifyResolution.conflict) {
        valueConflict = {
          scopeKey,
          conflictingEffectIds: modifyResolution.conflict.conflictingEffectIds,
          reason: 'Plusieurs effets MODIFY applicables simultanément sur cette portée — aucune valeur ne peut être retenue.',
        }
      } else if (modifyResolution.winner) {
        basis = 'modify'
        value = modifyResolution.winner.effectPayload
        sourceEffectId = modifyResolution.winner.id
        usedIds.add(modifyResolution.winner.id)
      }

      let applicable = true
      let dominatedByWholeEngagementSuspend = false
      let applicabilityConflict: ScopeConflict | null = null
      let indeterminate = false
      let indeterminateReason: string | null = null

      if (wholeResolution.conflict) {
        applicabilityConflict = {
          scopeKey: WHOLE_ENGAGEMENT_SCOPE,
          conflictingEffectIds: wholeResolution.conflict.conflictingEffectIds,
          reason: 'Plusieurs effets SUSPEND (whole_engagement) applicables simultanément — applicabilité indécidable.',
        }
        applicable = false
        indeterminate = true
        indeterminateReason = 'Conflit de suspension au niveau whole_engagement.'
        if (scopeKey !== WHOLE_ENGAGEMENT_SCOPE) dominatedByWholeEngagementSuspend = true
      } else if (wholeResolution.winner) {
        applicable = false
        if (scopeKey !== WHOLE_ENGAGEMENT_SCOPE) dominatedByWholeEngagementSuspend = true
      } else if (scopeKey !== WHOLE_ENGAGEMENT_SCOPE) {
        // whole_engagement ne domine pas — évaluer les SUSPEND propres à cette portée.
        const scopeSuspendEffects = suspendEffects.filter((e) => e.scopeKey === scopeKey)
        const scopeResolution = resolveActiveWinner(scopeSuspendEffects, queriedDate)
        const scopeIndeterminate = scopeSuspendEffects.some((e) => suspendIndeterminateAt(e, queriedDate))
        if (scopeResolution.conflict) {
          applicabilityConflict = {
            scopeKey,
            conflictingEffectIds: scopeResolution.conflict.conflictingEffectIds,
            reason: 'Plusieurs effets SUSPEND applicables simultanément sur cette portée — applicabilité indécidable.',
          }
          applicable = false
          indeterminate = true
          indeterminateReason = 'Conflit de suspension sur cette portée.'
        } else if (scopeResolution.winner) {
          applicable = false
          usedIds.add(scopeResolution.winner.id)
        }
        if (scopeIndeterminate) {
          indeterminate = true
          indeterminateReason =
            indeterminateReason ??
            "Statut de reprise non confirmé (fenêtre de reprise explicite non atteinte) ou suspension déclenchée par événement sans mécanisme de clôture démontré."
        }
      }

      if (wholeIndeterminate) {
        indeterminate = true
        indeterminateReason =
          indeterminateReason ??
          "Statut de reprise whole_engagement non confirmé (fenêtre de reprise explicite non atteinte) ou suspension déclenchée par événement sans mécanisme de clôture démontré."
      }

      return {
        scopeKey,
        applicable,
        dominatedByWholeEngagementSuspend,
        basis,
        value,
        sourceEffectId,
        valueConflict,
        applicabilityConflict,
        indeterminate,
        indeterminateReason,
      }
    })
  }

  const provenanceTrail = sortByIdAsc(effects).map((e) =>
    toProvenanceEntry(e, queriedDate, orphanedIds.has(e.id), usedIds.has(e.id)),
  )

  return {
    engagementId,
    queriedDate,
    resolvable: true,
    resolutionIssue: null,
    existence,
    scopes,
    anomalies,
    provenanceTrail,
  }
}
