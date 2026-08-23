// PRODUCT-CANONICAL-BRIDGE — la carte d'action ouvre la mémoire du sujet.
//
// Invariant produit : une action reste un objet opérationnel distinct. Le lien
// canonique EXPOSE la mémoire, il ne regroupe rien et ne masque rien.
// Invariant technique : aucun lien n'est inventé — seulement la FK déjà en base.

import { describe, it, expect } from 'vitest'
import {
  groupActionsByThread,
  resolveGroupCanonicalSubject,
  type ActionSummaryRow,
} from '@/lib/knowledge/repository'

function makeRow(overrides: Partial<ActionSummaryRow> & { id: string }): ActionSummaryRow {
  return {
    title: 'Action',
    status: 'open',
    due_date: null,
    due_date_status: null,
    created_at: '2026-08-01T10:00:00Z',
    done_at: null,
    assigned_to: null,
    report_id: null,
    corps_etat: null,
    subject_thread_id: null,
    canonical_subject_id: null,
    ...overrides,
  }
}

describe('resolveGroupCanonicalSubject', () => {
  it('un seul sujet distinct → ce sujet', () => {
    const rows = [
      makeRow({ id: 'a', canonical_subject_id: 'cs-1' }),
      makeRow({ id: 'b', canonical_subject_id: 'cs-1' }),
    ]
    expect(resolveGroupCanonicalSubject(rows)).toBe('cs-1')
  })

  it('une seule ligne porte la FK, les autres non → ce sujet (le lien ne se perd pas)', () => {
    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b', canonical_subject_id: 'cs-1' })]
    expect(resolveGroupCanonicalSubject(rows)).toBe('cs-1')
  })

  it('aucune FK → aucun lien', () => {
    expect(resolveGroupCanonicalSubject([makeRow({ id: 'a' }), makeRow({ id: 'b' })])).toBeNull()
  })

  it('sujets divergents → aucun lien, jamais un choix arbitraire', () => {
    const rows = [
      makeRow({ id: 'a', canonical_subject_id: 'cs-1' }),
      makeRow({ id: 'b', canonical_subject_id: 'cs-2' }),
    ]
    expect(resolveGroupCanonicalSubject(rows)).toBeNull()
  })
})

describe('groupActionsByThread — pont canonique', () => {
  it('PETRO : subject_thread_id NULL partout → 1 carte par action, chacune gardant SON sujet', () => {
    // Corpus réel : 17/17 actions sans thread. Le pont doit fonctionner malgré ça.
    const rows = [
      makeRow({ id: 'cadenas', title: 'Finaliser la sécurisation du site (cadenas)', canonical_subject_id: 'cs-cadenas' }),
      makeRow({ id: 'eau', title: "Nettoyer l'autre côté du mur où l'eau s'écoule", canonical_subject_id: 'cs-eau' }),
      makeRow({ id: 'combi', title: 'Trouver des combinaisons plus imperméables' }),
    ]
    const groups = groupActionsByThread(rows)

    expect(groups).toHaveLength(3) // aucune fusion : une action reste une action
    const byId = new Map(groups.map((g) => [g.representative.id, g]))
    expect(byId.get('cadenas')!.canonicalSubjectId).toBe('cs-cadenas')
    expect(byId.get('eau')!.canonicalSubjectId).toBe('cs-eau')
    expect(byId.get('combi')!.canonicalSubjectId).toBeNull() // pas de FK → pas de lien
  })

  it('deux actions du même sujet canonique restent DEUX cartes', () => {
    const rows = [
      makeRow({ id: 'a', canonical_subject_id: 'cs-1' }),
      makeRow({ id: 'b', canonical_subject_id: 'cs-1' }),
    ]
    const groups = groupActionsByThread(rows)
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.canonicalSubjectId === 'cs-1')).toBe(true)
  })

  it('groupe par thread : la FK portée par un seul membre reste exposée', () => {
    const rows = [
      makeRow({ id: 'old', subject_thread_id: 'th-1', created_at: '2026-08-01T08:00:00Z', canonical_subject_id: 'cs-1' }),
      makeRow({ id: 'new', subject_thread_id: 'th-1', created_at: '2026-08-03T12:00:00Z' }),
    ]
    const groups = groupActionsByThread(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].representative.id).toBe('new') // représentant inchangé
    expect(groups[0].canonicalSubjectId).toBe('cs-1')
  })
})
