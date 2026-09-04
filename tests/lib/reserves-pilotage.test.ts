// V1-3 — CONTRAT read-model Réserves : occurrences → réserves durables (CBO), SANS lifecycle.
// Aucun état durable inventé ; aucune occurrence perdue (orphelin rattaché au CBO du même sujet).

import { describe, it, expect } from 'vitest'
import { assembleReservesPilotage, type ReserveCboInput, type ReserveRowInput } from '@/lib/knowledge/reserves-pilotage'

const cbo = (cboId: string, subjectId: string, label: string): ReserveCboInput => ({ cboId, label, canonicalSubjectId: subjectId })
const row = (id: string, subjectId: string, label: string, reportId: string | null, status = 'open'): ReserveRowInput => ({ id, label, status, reportId, canonicalSubjectId: subjectId })

describe('assembleReservesPilotage — occurrences → réserves durables', () => {
  it('N occurrences d\'un même problème → 1 réserve durable, occurrences conservées', () => {
    const p = assembleReservesPilotage(
      [cbo('r1', 's1', 'Porte CF grand passage')],
      new Map([['r1', ['o1', 'o2']]]),
      [row('o1', 's1', 'Porte CF (PV mars)', 'pv1'), row('o2', 's1', 'Porte CF (PV mai)', 'pv2')],
      new Map([['s1', 'Conformité des portes CF']]),
    )
    expect(p.kpi).toMatchObject({ subjectsWithReserves: 1, durableReserves: 1, occurrences: 2 })
    expect(p.subjects[0].reserves[0].occurrenceCount).toBe(2)
    expect(p.subjects[0].reserves[0].pvCount).toBe(2)
  })

  it('occurrence orphaline (sans membership CBO) → rattachée au CBO du même sujet, jamais perdue', () => {
    const p = assembleReservesPilotage(
      [cbo('r1', 's1', 'Non-conformités techniques')],
      new Map([['r1', ['o1', 'o2', 'o3']]]), // 3 membres
      [row('o1', 's1', 'a', 'pv1'), row('o2', 's1', 'b', 'pv2'), row('o3', 's1', 'c', 'pv3'), row('o4', 's1', 'd (orphelin)', 'pv4')],
      new Map([['s1', 'Non-conformités techniques à reprendre']]),
    )
    expect(p.kpi.occurrences).toBe(4)
    expect(p.subjects[0].reserves[0].occurrenceCount).toBe(4) // 3 membres + 1 orphelin
    expect(p.subjects[0].occurrenceCount).toBe(4)
  })

  it('durableReserves = nombre de CBO réserve (pas le nombre d\'occurrences)', () => {
    const p = assembleReservesPilotage(
      [cbo('r1', 's1', 'A'), cbo('r2', 's2', 'B')],
      new Map([['r1', ['o1', 'o2']], ['r2', ['o3']]]),
      [row('o1', 's1', 'a', 'pv1'), row('o2', 's1', 'a2', 'pv2'), row('o3', 's2', 'b', 'pv1')],
      new Map([['s1', 'Sujet A'], ['s2', 'Sujet B']]),
    )
    expect(p.kpi.durableReserves).toBe(2)
    expect(p.kpi.occurrences).toBe(3)
  })

  it('AUCUN état durable exposé (pas de computedCurrentState) — statut reste au niveau occurrence', () => {
    const p = assembleReservesPilotage([cbo('r1', 's1', 'A')], new Map([['r1', ['o1']]]), [row('o1', 's1', 'a', 'pv1', 'open')], new Map([['s1', 'S']]))
    expect(JSON.stringify(p)).not.toContain('computedCurrentState')
    // le statut brut n'apparaît PAS au niveau réserve durable
    expect(p.subjects[0].reserves[0]).not.toHaveProperty('status')
  })

  // ── INVARIANT WORKFLOW / NOUVEAUX IMPORTS ──────────────────────────────────
  // Le read-model consomme les sorties normales du workflow (CBO réserve + membership). Simuler
  // l'arrivée d'une occurrence supplémentaire, SANS toucher le pipeline — juste sa consommation.
  it('workflow — nouvelle occurrence rattachée au MÊME CBO → occurrences +1, problèmes durables INCHANGÉS', () => {
    const cbos = [cbo('r1', 's1', 'Porte CF grand passage')]
    const before = assembleReservesPilotage(cbos, new Map([['r1', ['o1']]]), [row('o1', 's1', 'a', 'pv1')], new Map([['s1', 'Portes CF']]))
    // le workflow rattache une nouvelle occurrence o2 au CBO r1 existant (même problème durable)
    const after = assembleReservesPilotage(cbos, new Map([['r1', ['o1', 'o2']]]), [row('o1', 's1', 'a', 'pv1'), row('o2', 's1', 'a (nouveau PV)', 'pv2')], new Map([['s1', 'Portes CF']]))
    expect(before.kpi.durableReserves).toBe(1)
    expect(after.kpi.durableReserves).toBe(1) // INCHANGÉ
    expect(after.kpi.occurrences).toBe(before.kpi.occurrences + 1)
    expect(after.subjects[0].reserves[0].occurrenceCount).toBe(2)
  })

  it('workflow — nouveau CBO produit par le workflow → problèmes durables +1', () => {
    const before = assembleReservesPilotage([cbo('r1', 's1', 'A')], new Map([['r1', ['o1']]]), [row('o1', 's1', 'a', 'pv1')], new Map([['s1', 'S1']]))
    // le workflow crée un nouveau CBO r2 (nouveau problème durable sur un autre sujet)
    const after = assembleReservesPilotage([cbo('r1', 's1', 'A'), cbo('r2', 's2', 'B')], new Map([['r1', ['o1']], ['r2', ['o2']]]), [row('o1', 's1', 'a', 'pv1'), row('o2', 's2', 'b', 'pv1')], new Map([['s1', 'S1'], ['s2', 'S2']]))
    expect(after.kpi.durableReserves).toBe(before.kpi.durableReserves + 1)
    expect(after.subjects.some((s) => s.canonicalSubjectId === 's2')).toBe(true)
  })

  it('tri : sujet avec le plus d\'occurrences d\'abord', () => {
    const p = assembleReservesPilotage(
      [cbo('r1', 's1', 'Peu'), cbo('r2', 's2', 'Beaucoup')],
      new Map([['r1', ['o1']], ['r2', ['o2', 'o3', 'o4']]]),
      [row('o1', 's1', 'a', 'pv1'), row('o2', 's2', 'b', 'pv1'), row('o3', 's2', 'c', 'pv2'), row('o4', 's2', 'd', 'pv3')],
      new Map([['s1', 'Sujet 1 occ'], ['s2', 'Sujet 3 occ']]),
    )
    expect(p.subjects[0].canonicalSubjectId).toBe('s2')
  })
})
