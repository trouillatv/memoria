// Test UNITAIRE — P1-4C2A-INTEGRATION. Réducteur PUR (aucune DB, aucun LLM).
// Couvre les 10 scénarios du prototype + témoins Fiches/BAES + anti-témoins Test SSI/RIA/Allée
// + import rétroactif + permutation d'ordre + qualification déterministe C1C.

import { describe, it, expect } from 'vitest'
import {
  reduceCboLifecycle, deriveCboNature, assembleCboEvents,
  deriveCanonicalSubjectCboState, activeObjectsTotalForState,
  type CboLifecycleEvent, type CboMemberProvenance, type CboCompletionProof, type CboNativeJournalEvent,
  type CboReducedState,
} from '@/lib/knowledge/cbo-lifecycle-reducer'
import { deriveCanonicalCurrentState, type PvState } from '@/lib/documents/subject-state'

const ev = (kind: CboLifecycleEvent['kind'], attestedAt: string, eventAt?: string): CboLifecycleEvent => ({ kind, attestedAt, eventAt })

describe('reduceCboLifecycle — 10 scénarios', () => {
  it('1. OPEN → doc completion → documentary_completed (Fiches)', () => {
    const r = reduceCboLifecycle([ev('doc_open', '2025-03-27'), ev('doc_completion', '2025-05-23')])
    expect(r.computedCurrentState).toBe('documentary_completed')
  })
  it('2. OPEN → completion → OPEN même CBO → reopened, completion conservé', () => {
    const r = reduceCboLifecycle([ev('doc_open', '2025-03-27'), ev('doc_completion', '2025-05-23'), ev('doc_open', '2026-01-10')])
    expect(r.computedCurrentState).toBe('documentary_reopened')
    expect(r.historicalTrajectory.some((t) => t.kind === 'doc_completion')).toBe(true) // conservé
  })
  it('3. completion → (OPEN autre CBO jamais reçu) → documentary_completed', () => {
    const r = reduceCboLifecycle([ev('doc_completion', '2025-08-27')])
    expect(r.computedCurrentState).toBe('documentary_completed')
  })
  it('4. continuous : conformités + OPEN → jamais DONE', () => {
    const r = reduceCboLifecycle([ev('doc_conformity', '2025-07-10'), ev('doc_conformity', '2025-08-27'), ev('doc_open', '2025-12-03')])
    expect(r.computedCurrentState).toBe('open')
    expect(r.computedCurrentState).not.toContain('completed')
  })
  it('5. unknown + accomplissement (conformité, évt explicite) → conforme_at, jamais DONE', () => {
    const r = reduceCboLifecycle([ev('doc_conformity', '2025-08-27', '2025-05-18')])
    expect(r.computedCurrentState).toBe('conforme_at')
    expect(r.historicalTrajectory[0].basis).toBe('explicit_event_date')
  })
  it('6. native COMPLETED puis doc OPEN → reste native_completed + divergence (option a)', () => {
    const r = reduceCboLifecycle([ev('doc_open', '2025-03-27'), ev('native_completed', '2025-06-01'), ev('doc_open', '2025-06-15')])
    expect(r.computedCurrentState).toBe('native_completed')
    expect(r.documentaryDivergences.length).toBeGreaterThan(0)
  })
  it('7. native REOPENED autoritatif', () => {
    const r = reduceCboLifecycle([ev('doc_completion', '2025-05-23'), ev('native_reopened', '2025-09-01')])
    expect(r.computedCurrentState).toBe('native_reopened')
  })
  it('8. cancelled → jamais completed (D2)', () => {
    const r = reduceCboLifecycle([ev('doc_open', '2025-03-27'), ev('native_cancelled', '2025-07-01')])
    expect(r.computedCurrentState).toBe('native_cancelled')
  })
  it('9. import rétroactif (completion insérée hors ordre) → recomposé par date métier', () => {
    const outOfOrder = reduceCboLifecycle([ev('doc_open', '2025-03-27'), ev('doc_open', '2026-01-10'), ev('doc_completion', '2025-05-23')])
    const inOrder = reduceCboLifecycle([ev('doc_open', '2025-03-27'), ev('doc_completion', '2025-05-23'), ev('doc_open', '2026-01-10')])
    expect(outOfOrder.computedCurrentState).toBe(inOrder.computedCurrentState)
    expect(outOfOrder.computedCurrentState).toBe('documentary_reopened')
  })
  it('10. égalité de date : completion + open même effective_at → CONFLICT', () => {
    const r = reduceCboLifecycle([ev('doc_completion', '2025-05-23'), ev('doc_open', '2025-05-23')])
    expect(r.computedCurrentState).toBe('conflict')
    expect(r.conflicts.length).toBeGreaterThan(0)
  })
})

describe('reduceCboLifecycle — permutation d\'ordre (invariance)', () => {
  it('même résultat quel que soit l\'ordre d\'entrée', () => {
    const base: CboLifecycleEvent[] = [ev('doc_open', '2025-03-27'), ev('doc_completion', '2025-05-23'), ev('native_reopened', '2025-09-01', '2025-09-01')]
    const a = reduceCboLifecycle(base)
    const b = reduceCboLifecycle([...base].reverse())
    const c = reduceCboLifecycle([base[1], base[2], base[0]])
    expect(a.computedCurrentState).toBe(b.computedCurrentState)
    expect(a.computedCurrentState).toBe(c.computedCurrentState)
    expect(a.computedCurrentState).toBe('native_reopened')
  })
})

describe('deriveCboNature — déterministe, positif, unknown par défaut', () => {
  it('Fiches → one_shot + terminal_candidate', () => {
    expect(deriveCboNature('Rédiger les fiches de poste pour les postes SSIAP 1 et SSIAP 2', 1)).toEqual({ nature: 'one_shot', stateChar: 'terminal_candidate' })
  })
  it('BAES cave → one_shot + terminal_candidate', () => {
    expect(deriveCboNature("Supprimer le BAES de l'intérieur de la cave au-dessus de la porte d'entrée", 1)).toEqual({ nature: 'one_shot', stateChar: 'terminal_candidate' })
  })
  it('SSIAP 2 → one_shot + regression (stateChar unknown, non prouvé)', () => {
    expect(deriveCboNature('Mettre en place un SSIAP 2', 1)).toEqual({ nature: 'one_shot', stateChar: 'unknown' })
  })
  it('Allée → continuous + point_in_time_only', () => {
    expect(deriveCboNature('Maintenir les circulations horizontales utilisées comme dégagement exemptes de stockage', 1)).toEqual({ nature: 'continuous', stateChar: 'point_in_time_only' })
  })
  it('Test SSI / RIA (répétable, 1 événement) → unknown (récurrence non tranchable)', () => {
    expect(deriveCboNature('Organiser un test SSI pour vérifier le compartimentage', 1).nature).toBe('unknown')
    expect(deriveCboNature('Vérifier la dotation des RIA', 1).nature).toBe('unknown')
  })
  it('récurrence PROUVÉE (≥2 événements distincts) → recurring', () => {
    expect(deriveCboNature('Vérifier la dotation des RIA', 3).nature).toBe('recurring')
  })
  it('Déchets → unknown (récurrence non importée)', () => {
    expect(deriveCboNature("Évacuer les déchets pour limiter l'apport en combustible", 1).nature).toBe('unknown')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// P1-4C2A-DOC-OPEN — assemblage PUR (members → doc_open, B HIGH → doc_completion, C1C, provenance).
// ─────────────────────────────────────────────────────────────────────────────

const mem = (memberId: string, docId: string | null, date: string | null): CboMemberProvenance => ({ memberId, docId, date })
const comp = (proposalId: string, docId: string | null, date: string | null): CboCompletionProof => ({ proposalId, docId, date })
const state = (label: string, members: CboMemberProvenance[], completions: CboCompletionProof[], natives: CboNativeJournalEvent[] = []) => {
  const asm = assembleCboEvents(label, members, completions, natives)
  return { asm, reduced: reduceCboLifecycle(asm.events) }
}

const FICHES = 'Rédiger les fiches de poste pour les postes SSIAP 1 et SSIAP 2'
const BAES = "Supprimer le BAES de l'intérieur de la cave au-dessus de la porte d'entrée"
const ECLAIRAGE = "Mettre en place l'éclairage de sécurité sur la porte d'accès aux réserves d'eau sprinkler"
const RIA = 'Vérifier la dotation des RIA'
const TESTSSI = 'Organiser un test SSI pour vérifier le compartimentage'
const ALLEE = 'Maintenir les circulations horizontales utilisées comme dégagement exemptes de stockage'

describe('assembleCboEvents — doc_open depuis les membres CBO', () => {
  it('Fiches : OPEN(membre) → completion(autre doc) → documentary_completed', () => {
    const { asm, reduced } = state(FICHES, [mem('m1', 'docA', '2025-03-27')], [comp('p1', 'docB', '2025-05-23')])
    expect(reduced.computedCurrentState).toBe('documentary_completed')
    expect(asm.docOpenCount).toBe(1)
    expect(asm.membersSharedWithCompletionDoc).toBe(0)
  })

  it('BAES : OPEN×3 (docs distincts) → completion → documentary_completed', () => {
    const { asm, reduced } = state(BAES,
      [mem('m1', 'docA', '2025-03-27'), mem('m2', 'docB', '2025-05-23'), mem('m3', 'docC', '2025-07-10')],
      [comp('p1', 'docD', '2025-08-27')])
    expect(reduced.computedCurrentState).toBe('documentary_completed')
    expect(asm.docOpenCount).toBe(3)
  })

  it('Éclairage : membre issu du document de complétion EXCLU du doc_open, aucun faux CONFLICT même-date', () => {
    const { asm, reduced } = state(ECLAIRAGE,
      // le membre docC (2025-07-10) provient du MÊME document que la complétion p1@2025-07-10
      [mem('m1', 'docA', '2025-03-27'), mem('m2', 'docB', '2025-05-23'), mem('m3', 'docC', '2025-07-10')],
      [comp('p1', 'docC', '2025-07-10'), comp('p2', 'docD', '2025-08-27')])
    expect(asm.membersSharedWithCompletionDoc).toBe(1) // m3 exclu
    expect(asm.docOpenCount).toBe(2)
    expect(reduced.conflicts).toHaveLength(0)
    expect(reduced.computedCurrentState).toBe('documentary_completed')
  })

  it('CONTRÔLE : sans la règle de provenance, un open même-date que la completion → CONFLICT', () => {
    // preuve que l'exclusion est ce qui protège : ici le membre partage la date SANS être filtré
    const r = reduceCboLifecycle([
      { kind: 'doc_open', attestedAt: '2025-07-10', eventAt: '2025-07-10' },
      { kind: 'doc_completion', attestedAt: '2025-07-10', eventAt: '2025-07-10' },
    ])
    expect(r.computedCurrentState).toBe('conflict')
  })

  it('OPEN → completion → OPEN postérieur (même CBO) → documentary_reopened, completion conservé', () => {
    const { reduced } = state(FICHES,
      [mem('m1', 'docA', '2025-03-27'), mem('m2', 'docC', '2026-01-10')], // docC postérieur à la completion
      [comp('p1', 'docB', '2025-05-23')])
    expect(reduced.computedCurrentState).toBe('documentary_reopened')
    expect(reduced.historicalTrajectory.some((t) => t.kind === 'doc_completion')).toBe(true)
  })

  it('import rétroactif / permutation d\'ordre des membres → résultat identique', () => {
    const members = [mem('m1', 'docA', '2025-03-27'), mem('m2', 'docC', '2026-01-10')]
    const completions = [comp('p1', 'docB', '2025-05-23')]
    const a = state(FICHES, members, completions).reduced.computedCurrentState
    const b = state(FICHES, [...members].reverse(), completions).reduced.computedCurrentState
    expect(a).toBe(b)
    expect(a).toBe('documentary_reopened')
  })

  it('membership DANGLING (date/docId null) → aucun doc_open inventé', () => {
    const { asm, reduced } = state(FICHES, [mem('mDangling', null, null)], [])
    expect(asm.docOpenCount).toBe(0)
    expect(reduced.computedCurrentState).toBe('unknown') // aucune preuve exploitable
  })

  it('un membre dangling n\'empêche pas les membres datables du même CBO', () => {
    const { asm, reduced } = state(FICHES,
      [mem('mDangling', null, null), mem('m1', 'docA', '2025-03-27')],
      [comp('p1', 'docB', '2025-05-23')])
    expect(asm.docOpenCount).toBe(1)
    expect(reduced.computedCurrentState).toBe('documentary_completed')
  })

  it('natif REOPENED postérieur reste autoritatif au-dessus du documentaire', () => {
    const { reduced } = state(FICHES,
      [mem('m1', 'docA', '2025-03-27')],
      [comp('p1', 'docB', '2025-05-23')],
      [{ kind: 'reopened', occurredAt: '2025-09-01' }])
    expect(reduced.computedCurrentState).toBe('native_reopened')
  })

  it('natif `created` EXCLU de la réduction (horloge d\'import, pas une date métier)', () => {
    // created à une date technique postérieure ne doit PAS créer de réouverture
    const { reduced } = state(FICHES,
      [mem('m1', 'docA', '2025-03-27')],
      [comp('p1', 'docB', '2025-05-23')],
      [{ kind: 'created', occurredAt: '2026-09-03' }])
    expect(reduced.computedCurrentState).toBe('documentary_completed')
  })
})

describe('assembleCboEvents — anti-témoins (nature C1C) restent non-DONE', () => {
  for (const [name, label] of [['RIA', RIA], ['Test SSI', TESTSSI], ['Allée', ALLEE]] as const) {
    it(`${name} : B HIGH présent mais nature non one_shot/terminal → open, complétion supprimée`, () => {
      const { asm, reduced } = state(label,
        [mem('m1', 'docA', '2025-03-27'), mem('m2', 'docB', '2025-07-10')],
        [comp('p1', 'docC', '2025-08-27')])
      expect(reduced.computedCurrentState).toBe('open')
      expect(asm.suppressedByNature).toBe(1)
      expect(reduced.historicalTrajectory.some((t) => t.kind === 'doc_completion')).toBe(false)
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// P1-4C2D — agrégat SUJET←CBO + composition dans deriveCanonicalCurrentState.
// ─────────────────────────────────────────────────────────────────────────────

const rs = (s: CboReducedState['computedCurrentState']): CboReducedState =>
  ({ computedCurrentState: s, historicalTrajectory: [], stateBasis: [], conflicts: s === 'conflict' ? ['x'] : [], documentaryDivergences: [] })
const occ = (effectiveDate: string, pvState: PvState) => ({ effectiveDate, pvState })
// projection SUJET candidate = deriveCanonicalCurrentState(occurrences, activeObjectsTotalForState(...))
const subjectDisplay = (occs: { effectiveDate: string; pvState: PvState }[], scbo: ReturnType<typeof deriveCanonicalSubjectCboState> | undefined, rawActionOpen: boolean, nonActionOpen: boolean) =>
  deriveCanonicalCurrentState({ occurrences: occs, activeObjectsTotal: activeObjectsTotalForState(scbo, rawActionOpen, nonActionOpen) }).displayState

describe('deriveCanonicalSubjectCboState — classification', () => {
  it('mix actif/completed/unknown/conflict → compteurs + blocksResolution', () => {
    const s = deriveCanonicalSubjectCboState([rs('open'), rs('documentary_completed'), rs('unknown'), rs('conflict'), rs('native_reopened')])
    expect(s).toMatchObject({ activeCboTotal: 2, completedCboTotal: 1, unknownCboTotal: 1, conflictCboTotal: 1, totalCboTotal: 5, blocksResolution: true })
  })
  it('tous completed → blocksResolution false', () => {
    expect(deriveCanonicalSubjectCboState([rs('documentary_completed'), rs('native_completed')]).blocksResolution).toBe(false)
  })
  it('unknown seul → neutre (blocksResolution false)', () => {
    expect(deriveCanonicalSubjectCboState([rs('unknown')]).blocksResolution).toBe(false)
  })
})

describe('activeObjectsTotalForState — composition action(CBO)+non-action(brut)', () => {
  it('aucun CBO action → retombe sur la vérité brute des actions', () => {
    expect(activeObjectsTotalForState(undefined, true, false)).toBe(1)
    expect(activeObjectsTotalForState(undefined, false, false)).toBe(0)
    expect(activeObjectsTotalForState(deriveCanonicalSubjectCboState([]), true, false)).toBe(1) // total 0 → brut
  })
  it('CBO action completed → action non active, ignore le brut open', () => {
    const scbo = deriveCanonicalSubjectCboState([rs('documentary_completed')])
    expect(activeObjectsTotalForState(scbo, true, false)).toBe(0) // le site_action brut open est ignoré
  })
  it('CBO action actif → 1', () => {
    expect(activeObjectsTotalForState(deriveCanonicalSubjectCboState([rs('open')]), false, false)).toBe(1)
  })
  it('conflict → bloque (1) même sans brut', () => {
    expect(activeObjectsTotalForState(deriveCanonicalSubjectCboState([rs('conflict')]), false, false)).toBe(1)
  })
  it('non-action actif seul → 1 (réserve/échéance/décision conservées)', () => {
    expect(activeObjectsTotalForState(deriveCanonicalSubjectCboState([rs('documentary_completed')]), false, true)).toBe(1)
  })
})

describe('composition SUJET — état courant (deriveCanonicalCurrentState)', () => {
  it('TÉMOIN Calfeutrement : occurrence resolved + CBO completed + action brute open → resolved (avant: reopened)', () => {
    const occs = [occ('2025-01-29', 'open'), occ('2025-07-10', 'resolved')]
    const scbo = deriveCanonicalSubjectCboState([rs('documentary_completed')])
    // AVANT C2D : activeObjectsTotal venait du brut (action open) → reopened
    expect(deriveCanonicalCurrentState({ occurrences: occs, activeObjectsTotal: 1 }).displayState).toBe('reopened')
    // APRÈS C2D : le CBO completed retire la fausse activité → resolved (occurrence disait déjà resolved)
    expect(subjectDisplay(occs, scbo, /*rawActionOpen*/ true, /*nonActionOpen*/ false)).toBe('resolved')
  })

  it('CBO completed + occurrence OPEN significative → reste open (complétion ne fabrique jamais resolved)', () => {
    const occs = [occ('2025-03-27', 'open')]
    const scbo = deriveCanonicalSubjectCboState([rs('documentary_completed')])
    expect(subjectDisplay(occs, scbo, true, false)).toBe('open')
  })

  it('tous CBO action completed MAIS réserve active → reste ouvert (non résolu)', () => {
    const occs = [occ('2025-03-27', 'open'), occ('2025-07-10', 'resolved')]
    const scbo = deriveCanonicalSubjectCboState([rs('documentary_completed')])
    expect(subjectDisplay(occs, scbo, false, /*nonActionOpen=réserve*/ true)).not.toBe('resolved')
  })

  it('occurrence resolved + CBO unknown → resolved (unknown neutre, occurrence décide)', () => {
    const occs = [occ('2025-07-10', 'resolved')]
    const scbo = deriveCanonicalSubjectCboState([rs('unknown')])
    expect(subjectDisplay(occs, scbo, false, false)).toBe('resolved')
  })

  it('CBO completed + unknown SANS preuve occurrence resolved → jamais resolved (unknown)', () => {
    const scbo = deriveCanonicalSubjectCboState([rs('documentary_completed'), rs('unknown')])
    expect(subjectDisplay([], scbo, false, false)).toBe('unknown')
  })

  it('dangling (aucun CBO sujet) sans action brute open → aucune activité inventée (unknown)', () => {
    expect(subjectDisplay([], undefined, false, false)).toBe('unknown')
  })

  it('conflict CBO + occurrence resolved → bloque la résolution silencieuse (non resolved)', () => {
    const occs = [occ('2025-07-10', 'resolved')]
    const scbo = deriveCanonicalSubjectCboState([rs('conflict')])
    expect(subjectDisplay(occs, scbo, false, false)).not.toBe('resolved')
  })
})
