import { describe, expect, it } from 'vitest'
import { assignedActionsByContact, type RawAssignedActionRow } from '@/lib/knowledge/assigned-actions'

// ── P2 · Slice 3A — attribution d'actions à une personne, par IDENTITÉ ───────
// Tests de COMPORTEMENT (fonction pure), pas de simples recherches de chaîne :
// ils protègent le chemin réel de construction de `assignedActions`.

const SITE = 'site-1'
const TODAY = '2026-07-19' // jour civil Nouméa

function row(p: Partial<RawAssignedActionRow>): RawAssignedActionRow {
  return {
    id: 'a', title: 'Action', assigned_contact_id: 'c-vincent',
    due_date: null, due_date_status: null, report_id: null, status: 'open',
    created_at: '2026-07-01T00:00:00.000Z', ...p,
  }
}

describe('assignedActionsByContact — la preuve est assigned_contact_id', () => {
  it('rattache une action à la personne assignée, et à elle seule', () => {
    const m = assignedActionsByContact(SITE, [
      row({ id: 'a1', assigned_contact_id: 'c-vincent' }),
      row({ id: 'a2', assigned_contact_id: 'c-claire' }),
    ], TODAY)
    expect(m.get('c-vincent')?.map((a) => a.id)).toEqual(['a1'])
    expect(m.get('c-claire')?.map((a) => a.id)).toEqual(['a2'])
  })

  it('n’attache JAMAIS par assigned_to : une action sans contact est ignorée', () => {
    // Ligne « historique » (assigned_to texte, assigned_contact_id null).
    const m = assignedActionsByContact(SITE, [row({ id: 'a1', assigned_contact_id: null })], TODAY)
    expect(m.size).toBe(0)
  })

  it('exclut les actions fermées ou annulées (ouverte = open + planned)', () => {
    const m = assignedActionsByContact(SITE, [
      row({ id: 'open', status: 'open' }),
      row({ id: 'planned', status: 'planned' }),
      row({ id: 'done', status: 'done' }),
      row({ id: 'cancelled', status: 'cancelled' }),
    ], TODAY)
    expect(m.get('c-vincent')?.map((a) => a.id).sort()).toEqual(['open', 'planned'])
  })

  it('en retard = échéance EXPLICITE passée uniquement', () => {
    const m = assignedActionsByContact(SITE, [
      row({ id: 'exp-past', due_date: '2026-07-17', due_date_status: 'explicit' }),
      row({ id: 'est-past', due_date: '2026-07-17', due_date_status: 'estimated' }),
      row({ id: 'exp-future', due_date: '2026-07-24', due_date_status: 'explicit' }),
      row({ id: 'no-date', due_date: null, due_date_status: null }),
    ], TODAY)
    const by = new Map(m.get('c-vincent')!.map((a) => [a.id, a]))
    expect(by.get('exp-past')!.isLate).toBe(true)
    expect(by.get('est-past')!.isLate).toBe(false)   // estimée : jamais un retard
    expect(by.get('exp-future')!.isLate).toBe(false)
    expect(by.get('no-date')!.isLate).toBe(false)
  })

  it('destination honnête : réunion source, sinon onglet Travail', () => {
    const m = assignedActionsByContact(SITE, [
      row({ id: 'from-report', report_id: 'r-9' }),
      row({ id: 'standalone', report_id: null }),
    ], TODAY)
    const by = new Map(m.get('c-vincent')!.map((a) => [a.id, a]))
    expect(by.get('from-report')).toMatchObject({ href: '/meetings/r-9', hrefSource: 'report' })
    expect(by.get('standalone')).toMatchObject({ href: '/sites/site-1?tab=travail', hrefSource: 'site_work' })
  })

  it('ordre déterministe : retard, puis explicite future, puis estimée, puis sans date', () => {
    const m = assignedActionsByContact(SITE, [
      row({ id: 'no-date' }),
      row({ id: 'est', due_date: '2026-07-30', due_date_status: 'estimated' }),
      row({ id: 'future', due_date: '2026-07-24', due_date_status: 'explicit' }),
      row({ id: 'late', due_date: '2026-07-10', due_date_status: 'explicit' }),
    ], TODAY)
    expect(m.get('c-vincent')?.map((a) => a.id)).toEqual(['late', 'future', 'est', 'no-date'])
  })

  it('deux échéances explicites futures : par date croissante', () => {
    const m = assignedActionsByContact(SITE, [
      row({ id: 'late-24', due_date: '2026-07-24', due_date_status: 'explicit' }),
      row({ id: 'late-22', due_date: '2026-07-22', due_date_status: 'explicit' }),
    ], TODAY)
    expect(m.get('c-vincent')?.map((a) => a.id)).toEqual(['late-22', 'late-24'])
  })

  it('aucune action → map vide (état vide honnête en amont)', () => {
    expect(assignedActionsByContact(SITE, [], TODAY).size).toBe(0)
  })
})
