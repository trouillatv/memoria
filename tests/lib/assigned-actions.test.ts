import { describe, expect, it } from 'vitest'
import {
  assignedActionsByContact, assignedActionCountLabel, describeAssignedActionDate,
  type RawAssignedActionRow, type AssignedAction,
} from '@/lib/knowledge/assigned-actions'

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

// ── Slice 3B — présentation (helpers purs, déterministes) ────────────────────
describe('assignedActionCountLabel — singulier / pluriel, jamais « ouvertes »', () => {
  it('1 action', () => expect(assignedActionCountLabel(1)).toBe('1 action avec cette personne'))
  it('N actions', () => expect(assignedActionCountLabel(3)).toBe('3 actions avec cette personne'))
})

describe('describeAssignedActionDate — quatre états distincts', () => {
  const p = (o: Partial<Pick<AssignedAction, 'dueDate' | 'dueDateStatus' | 'isLate'>>) =>
    describeAssignedActionDate({ dueDate: null, dueDateStatus: null, isLate: false, ...o }, TODAY)

  it('sans date → aucun texte de remplacement', () => {
    expect(p({})).toEqual({ kind: 'none', label: null })
  })

  it('échéance explicite aujourd’hui (jamais en retard, calcul strict < today)', () => {
    expect(p({ dueDate: '2026-07-19', dueDateStatus: 'explicit', isLate: false }))
      .toEqual({ kind: 'today', label: 'Échéance aujourd’hui' })
  })

  it('échéance explicite future — « le 24 juillet », sans année si année courante', () => {
    expect(p({ dueDate: '2026-07-24', dueDateStatus: 'explicit', isLate: false }))
      .toEqual({ kind: 'future', label: 'Échéance le 24 juillet' })
  })

  it('échéance explicite future d’une autre année → année ajoutée', () => {
    expect(p({ dueDate: '2027-01-05', dueDateStatus: 'explicit', isLate: false }))
      .toEqual({ kind: 'future', label: 'Échéance le 5 janvier 2027' })
  })

  it('retard d’un jour → « depuis 1 jour » (pas d’exception « hier »)', () => {
    expect(p({ dueDate: '2026-07-18', dueDateStatus: 'explicit', isLate: true }))
      .toEqual({ kind: 'late', label: 'Échéance dépassée depuis 1 jour' })
  })

  it('retard de plusieurs jours → « depuis N jours »', () => {
    expect(p({ dueDate: '2026-07-15', dueDateStatus: 'explicit', isLate: true }))
      .toEqual({ kind: 'late', label: 'Échéance dépassée depuis 4 jours' })
  })

  it('date estimée → « à confirmer », jamais « échéance », jamais un retard', () => {
    // Même passée, une estimée n'est jamais présentée comme un retard.
    const r = p({ dueDate: '2026-07-10', dueDateStatus: 'estimated', isLate: false })
    expect(r.kind).toBe('estimated')
    expect(r.label).toBe('Date envisagée le 10 juillet · à confirmer')
    expect(r.label).not.toContain('Échéance')
  })

  it('frontière de jour civil — déterministe, aucun décalage de fuseau', () => {
    expect(p({ dueDate: '2026-07-19', dueDateStatus: 'explicit', isLate: false }).kind).toBe('today')
    expect(p({ dueDate: '2026-07-20', dueDateStatus: 'explicit', isLate: false }).kind).toBe('future')
    expect(p({ dueDate: '2026-07-18', dueDateStatus: 'explicit', isLate: true }).kind).toBe('late')
  })
})
