// Point 9+10B — Niveau 2 LMCA : un objet matérialisé depuis un PV importé ne fait
// PAS avancer lastMeaningfulChangeAt. Sa temporalité est déjà portée par
// l'occurrence documentaire (mécanisme A) ; son created_at = jour d'import ≠ date
// du PV. Direction (a) : exclure, ne pas remplacer par effective_date. La primitive
// est UNIQUE (fiche Sujet + Suivi) — ce test la verrouille.

import { describe, it, expect } from 'vitest'
import { applyTerrainLevel2, type TerrainObject } from '@/lib/db/canonical-subject-life'

const obj = (over: Partial<TerrainObject> & { createdAt: string; fromImport: boolean }): TerrainObject => ({
  entityType: 'site_action', entityId: 'x', title: 't', description: null, status: 'open', ...over,
})

const FIRST_SEEN = '2026-03-01'
const OCC_LMCA = '2026-03-12' // LMCA portée par les occurrences (mécanisme A)

describe('applyTerrainLevel2 — objets import exclus du Niveau 2', () => {
  it('un objet matérialisé-import (créé le jour d’import) NE fait PAS avancer LMCA', () => {
    const r = applyTerrainLevel2(
      [obj({ createdAt: '2026-08-02', fromImport: true })],
      FIRST_SEEN, OCC_LMCA, 2,
    )
    expect(r.lastMeaningfulChangeAt).toBe(OCC_LMCA)     // inchangé : reste la date métier
    expect(r.consecutiveMentionsWithoutChange).toBe(2)   // stagnation NON réinitialisée
  })

  it('un objet réellement opérationnel (non import) créé plus tard fait avancer LMCA', () => {
    const r = applyTerrainLevel2(
      [obj({ createdAt: '2026-08-02', fromImport: false })],
      FIRST_SEEN, OCC_LMCA, 2,
    )
    expect(r.lastMeaningfulChangeAt).toBe('2026-08-02')  // événement opérationnel réel
    expect(r.consecutiveMentionsWithoutChange).toBe(0)
  })

  it('mix : seul l’objet non-import compte ; l’objet import plus récent est ignoré', () => {
    const r = applyTerrainLevel2(
      [
        obj({ createdAt: '2026-09-01', fromImport: true }),  // import, plus récent → ignoré
        obj({ createdAt: '2026-05-10', fromImport: false }), // opérationnel réel → retenu
      ],
      FIRST_SEEN, OCC_LMCA, 1,
    )
    expect(r.lastMeaningfulChangeAt).toBe('2026-05-10')
    expect(r.consecutiveMentionsWithoutChange).toBe(0)
  })

  it('aucun objet éligible (tous import) → LMCA occurrence intacte', () => {
    const r = applyTerrainLevel2(
      [obj({ createdAt: '2026-08-02', fromImport: true }), obj({ createdAt: '2026-07-15', fromImport: true })],
      FIRST_SEEN, OCC_LMCA, 3,
    )
    expect(r.lastMeaningfulChangeAt).toBe(OCC_LMCA)
    expect(r.consecutiveMentionsWithoutChange).toBe(3)
  })

  it('objet non-import antérieur à la LMCA occurrence → n’avance pas (mention/insert ≠ changement)', () => {
    const r = applyTerrainLevel2(
      [obj({ createdAt: '2026-03-05', fromImport: false })], // > firstSeen mais < OCC_LMCA
      FIRST_SEEN, OCC_LMCA, 2,
    )
    expect(r.lastMeaningfulChangeAt).toBe(OCC_LMCA)
    expect(r.consecutiveMentionsWithoutChange).toBe(2)
  })
})
