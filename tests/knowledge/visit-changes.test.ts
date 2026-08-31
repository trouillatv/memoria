import { describe, expect, it } from 'vitest'
import { groupVisitChanges } from '@/lib/db/visit-narrative'

// ── Helpers ───────────────────────────────────────────────────────────────────

function action(id: string, csId: string | null, label: string | null = csId) {
  return { id, title: `action-${id}`, status: null, priority: null, canonicalSubjectId: csId, subjectLabel: label }
}

function reserve(id: string, csId: string | null, label: string | null = csId) {
  return { id, label: `reserve-${id}`, canonicalSubjectId: csId, subjectLabel: label }
}

function decision(id: string, csId: string | null, label: string | null = csId) {
  return { id, title: `decision-${id}`, canonicalSubjectId: csId, subjectLabel: label }
}

function deadline(id: string, csId: string | null, label: string | null = csId) {
  return { id, title: `deadline-${id}`, dueDate: null, canonicalSubjectId: csId, subjectLabel: label }
}

function watchpoint(id: string, csId: string | null, label: string | null = csId) {
  return { id, title: `watchpoint-${id}`, canonicalSubjectId: csId, subjectLabel: label }
}

function fact(id: string, csId: string | null, label: string | null = csId) {
  return { id, title: `fact-${id}`, kind: 'durable', canonicalSubjectId: csId, subjectLabel: label }
}

function stakeholder(id: string, csId: string | null, label: string | null = csId) {
  return { id, role: 'entreprise', label: `stakeholder-${id}`, canonicalSubjectId: csId, subjectLabel: label }
}

const empty = { actions: [], deadlines: [], facts: [], watchpoints: [], decisions: [], reserves: [], stakeholders: [] }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('groupVisitChanges', () => {
  it('retourne [] sur entrée vide', () => {
    expect(groupVisitChanges(empty)).toEqual([])
  })

  it('plusieurs objets → même canonicalSubjectId → 1 seul groupe', () => {
    const result = groupVisitChanges({
      ...empty,
      actions: [action('a1', 'cs1', 'Façade'), action('a2', 'cs1', 'Façade')],
    })
    expect(result).toHaveLength(1)
    expect(result[0].canonicalSubjectId).toBe('cs1')
    expect(result[0].actions).toHaveLength(2)
    expect(result[0].sourceCount).toBe(2)
  })

  it('plusieurs types → même sujet → 1 seul groupe avec tous les types', () => {
    const result = groupVisitChanges({
      actions: [action('a1', 'cs1', 'Réseau')],
      deadlines: [deadline('d1', 'cs1', 'Réseau')],
      facts: [],
      watchpoints: [],
      decisions: [decision('dec1', 'cs1', 'Réseau')],
      reserves: [],
      stakeholders: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0].actions).toHaveLength(1)
    expect(result[0].deadlines).toHaveLength(1)
    expect(result[0].decisions).toHaveLength(1)
    expect(result[0].sourceCount).toBe(3)
  })

  it('deux sujets distincts → 2 groupes', () => {
    const result = groupVisitChanges({
      ...empty,
      actions: [action('a1', 'cs1', 'Sujet A'), action('a2', 'cs2', 'Sujet B')],
    })
    expect(result).toHaveLength(2)
    const ids = result.map(g => g.canonicalSubjectId)
    expect(ids).toContain('cs1')
    expect(ids).toContain('cs2')
  })

  it('objet sans sujet (création manuelle ou proposition superseded) → groupe unclassified', () => {
    // Un objet sans canonicalSubjectId — sa proposition était superseded (filtrée
    // en amont par buildVisitChanges) ou il a été créé manuellement.
    const result = groupVisitChanges({
      ...empty,
      actions: [action('a1', null, null)],
    })
    expect(result).toHaveLength(1)
    expect(result[0].canonicalSubjectId).toBeNull()
    expect(result[0].subjectLabel).toBeNull()
  })

  it('le groupe unclassified est trié en dernier', () => {
    const result = groupVisitChanges({
      ...empty,
      actions: [
        action('a1', null, null),          // unclassified
        action('a2', 'cs1', 'Béton'),      // classifié
        action('a3', 'cs2', 'Façade'),     // classifié
      ],
    })
    expect(result).toHaveLength(3)
    expect(result[result.length - 1].canonicalSubjectId).toBeNull()
  })

  it('les groupes classifiés sont triés par subjectLabel (fr)', () => {
    const result = groupVisitChanges({
      ...empty,
      actions: [
        action('a1', 'cs3', 'Toiture'),
        action('a2', 'cs1', 'Béton'),
        action('a3', 'cs2', 'Façade'),
      ],
    })
    const labels = result.map(g => g.subjectLabel)
    expect(labels).toEqual(['Béton', 'Façade', 'Toiture'])
  })

  it('visite sans objets → [] (pas de groupe vide)', () => {
    // Simule une visite sans aucun objet créé
    const result = groupVisitChanges(empty)
    expect(result).toHaveLength(0)
  })

  it('tous les types d\'objets sont regroupés correctement', () => {
    const result = groupVisitChanges({
      actions: [action('a1', 'cs1', 'S')],
      deadlines: [deadline('d1', 'cs1', 'S')],
      facts: [fact('f1', 'cs1', 'S')],
      watchpoints: [watchpoint('w1', 'cs1', 'S')],
      decisions: [decision('dec1', 'cs1', 'S')],
      reserves: [reserve('r1', 'cs1', 'S')],
      stakeholders: [stakeholder('s1', 'cs1', 'S')],
    })
    expect(result).toHaveLength(1)
    expect(result[0].sourceCount).toBe(7)
    expect(result[0].actions).toHaveLength(1)
    expect(result[0].deadlines).toHaveLength(1)
    expect(result[0].facts).toHaveLength(1)
    expect(result[0].watchpoints).toHaveLength(1)
    expect(result[0].decisions).toHaveLength(1)
    expect(result[0].reserves).toHaveLength(1)
    expect(result[0].stakeholders).toHaveLength(1)
  })

  it('un intervenant ouvert par la visite entre dans le groupe de son sujet', () => {
    const result = groupVisitChanges({
      ...empty,
      stakeholders: [stakeholder('s1', 'cs1', 'Sous-traitant électricité')],
    })
    expect(result).toHaveLength(1)
    expect(result[0].canonicalSubjectId).toBe('cs1')
    expect(result[0].stakeholders).toHaveLength(1)
    expect(result[0].stakeholders[0]).toEqual({ id: 's1', role: 'entreprise', label: 'stakeholder-s1' })
  })
})
