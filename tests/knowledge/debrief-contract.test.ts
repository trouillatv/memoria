import { describe, expect, it } from 'vitest'
import {
  classifyActionForDebrief,
  classifyDeadlineForDebrief,
  classifyReserveForDebrief,
  classifyPlanningItemForDebrief,
  classifyInformationalSignalForDebrief,
  markSeen,
  debriefBlockForDisposition,
} from '@/lib/knowledge/debrief-contract'

const TODAY = '2026-08-31'
const RECENT = '2026-08-28' // 3 jours avant TODAY, dans la fenêtre de rétention
const OLD = '2026-08-01' // 30 jours avant TODAY, hors fenêtre

// Matrice de recette D1 — bloc cible × action utilisateur autorisée × condition de
// sortie, pour chaque couple (type d'objet, statut) que Vincent a listé. Chaque
// ligne prouve le contrat, elle ne le documente pas séparément.
describe('Matrice de recette D1 — object × statut → bloc Débrief', () => {
  it('Action open → à traiter ; action autorisée = clôturer/planifier sur l’écran Actions ; sort quand status change', () => {
    const item = classifyActionForDebrief({ status: 'open', doneAt: null }, TODAY)
    expect(item).toEqual({ kind: 'action', disposition: 'to_handle' })
    expect(debriefBlockForDisposition(item.disposition)).toBe('to_handle')
  })

  it('Action planned → à surveiller ; aucune action ici ; sort quand l’intervention est réalisée (status=done)', () => {
    const item = classifyActionForDebrief({ status: 'planned', doneAt: null }, TODAY)
    expect(item).toEqual({ kind: 'action', disposition: 'to_watch' })
    expect(debriefBlockForDisposition(item.disposition)).toBe('to_watch')
  })

  it('Action done récente (done_at fiable, fn_complete_action) → traité récemment ; sort après 7 jours', () => {
    const item = classifyActionForDebrief({ status: 'done', doneAt: RECENT }, TODAY)
    expect(item).toEqual({ kind: 'action', disposition: 'recently_handled' })
    expect(debriefBlockForDisposition(item.disposition)).toBe('recently_handled')
  })

  it('Action done ancienne → not_relevant (sort du Débrief, reste visible sur la fiche Action)', () => {
    const item = classifyActionForDebrief({ status: 'done', doneAt: OLD }, TODAY)
    expect(item.disposition).toBe('not_relevant')
    expect(debriefBlockForDisposition(item.disposition)).toBeNull()
  })

  it('Action cancelled → cancelSiteAction ne pose aucun timestamp : handled_without_reliable_date, jamais une date fabriquée, jamais affichée dans traité récemment', () => {
    const item = classifyActionForDebrief({ status: 'cancelled', doneAt: null }, TODAY)
    expect(item.disposition).toBe('handled_without_reliable_date')
    expect(debriefBlockForDisposition(item.disposition)).toBeNull()
  })

  it('Deadline to_plan → à traiter ; action autorisée = planifier une date ; sort quand due_date est renseignée (status=planned)', () => {
    const item = classifyDeadlineForDebrief({ status: 'to_plan', resolvedAt: null }, TODAY)
    expect(item).toEqual({ kind: 'deadline', disposition: 'to_handle' })
    expect(debriefBlockForDisposition(item.disposition)).toBe('to_handle')
  })

  it('Deadline planned → à surveiller ; aucune action ici ; sort au passage en statut terminal', () => {
    const item = classifyDeadlineForDebrief({ status: 'planned', resolvedAt: null }, TODAY)
    expect(item).toEqual({ kind: 'deadline', disposition: 'to_watch' })
    expect(debriefBlockForDisposition(item.disposition)).toBe('to_watch')
  })

  it('Deadline terminale (done/cancelled/superseded) → site_deadlines n’a AUCUN timestamp de clôture aujourd’hui : toujours handled_without_reliable_date, jamais recently_handled', () => {
    const statuses: Array<'done' | 'cancelled' | 'superseded'> = ['done', 'cancelled', 'superseded']
    for (const status of statuses) {
      const item = classifyDeadlineForDebrief({ status, resolvedAt: null }, TODAY)
      expect(item.disposition).toBe('handled_without_reliable_date')
      expect(debriefBlockForDisposition(item.disposition)).toBeNull()
    }
  })

  it('Deadline terminale avec resolvedAt fourni (migration future D2) → daterait correctement traité récemment — prouve que le classifieur est prêt sans changer de code', () => {
    const item = classifyDeadlineForDebrief({ status: 'done', resolvedAt: RECENT }, TODAY)
    expect(item.disposition).toBe('recently_handled')
  })

  it('Réserve open → à traiter ; action autorisée = lever la réserve ; sort quand status=lifted', () => {
    const item = classifyReserveForDebrief({ status: 'open', liftedAt: null }, TODAY)
    expect(item).toEqual({ kind: 'reserve', disposition: 'to_handle' })
    expect(debriefBlockForDisposition(item.disposition)).toBe('to_handle')
  })

  it('Réserve lifted récente (lifted_at fiable, atomique) → traité récemment ; sort après 7 jours', () => {
    const item = classifyReserveForDebrief({ status: 'lifted', liftedAt: RECENT }, TODAY)
    expect(item).toEqual({ kind: 'reserve', disposition: 'recently_handled' })
    expect(debriefBlockForDisposition(item.disposition)).toBe('recently_handled')
  })

  it('Planning planned → not_relevant en permanence ; aucune action, jamais actionnable dans le Débrief', () => {
    const item = classifyPlanningItemForDebrief()
    expect(item).toEqual({ kind: 'planning', disposition: 'not_relevant' })
    expect(debriefBlockForDisposition(item.disposition)).toBeNull()
  })

  it('Signal informationnel unseen (sans objet métier lié) → à surveiller ; action autorisée = Vu ; sort quand ack=seen', () => {
    const item = classifyInformationalSignalForDebrief({ hasOpenLinkedObject: false, ack: 'unseen' })
    expect(item).toEqual({ kind: 'informational_signal', disposition: 'to_watch', ack: 'unseen' })
    expect(debriefBlockForDisposition(item.disposition)).toBe('to_watch')
  })

  it('Signal informationnel seen → traité récemment ; aucune action supplémentaire', () => {
    const item = classifyInformationalSignalForDebrief({ hasOpenLinkedObject: false, ack: 'seen' })
    expect(item).toEqual({ kind: 'informational_signal', disposition: 'recently_handled', ack: 'seen' })
    expect(debriefBlockForDisposition(item.disposition)).toBe('recently_handled')
  })

  it('Signal informationnel avec objet métier déjà lié → not_relevant : l’objet représente l’attention, jamais les deux cartes', () => {
    const item = classifyInformationalSignalForDebrief({ hasOpenLinkedObject: true, ack: 'unseen' })
    expect(item.disposition).toBe('not_relevant')
  })
})

describe('Verrou « Vu » — réservé aux signaux informationnels', () => {
  it('markSeen fait passer un signal informationnel de unseen à seen', () => {
    const before = classifyInformationalSignalForDebrief({ hasOpenLinkedObject: false, ack: 'unseen' })
    const after = markSeen(before)
    expect(after.ack).toBe('seen')
    expect(after.disposition).toBe('recently_handled')
  })

  it('markSeen refuse à la COMPILATION un item Action/Deadline/Reserve/Planning — pas une convention UI, une impossibilité de type', () => {
    const action = classifyActionForDebrief({ status: 'open', doneAt: null }, TODAY)
    const deadline = classifyDeadlineForDebrief({ status: 'to_plan', resolvedAt: null }, TODAY)
    const reserve = classifyReserveForDebrief({ status: 'open', liftedAt: null }, TODAY)
    const planning = classifyPlanningItemForDebrief()

    // @ts-expect-error — DebriefActionItem n'est pas assignable à DebriefInformationalSignalItem (kind incompatible, pas de `ack`)
    markSeen(action)
    // @ts-expect-error — idem pour DebriefDeadlineItem
    markSeen(deadline)
    // @ts-expect-error — idem pour DebriefReserveItem
    markSeen(reserve)
    // @ts-expect-error — idem pour DebriefPlanningItem
    markSeen(planning)
  })
})
