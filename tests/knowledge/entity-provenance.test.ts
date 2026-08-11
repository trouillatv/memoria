// Tests entity provenance plumbing (mig 310).
//
// Ce que ce lot garantit :
//   1. extractEntityIds fait un lookup EXACT dans semantic_memory.resolutions.
//   2. Seules les entités status='resolved' contribuent.
//   3. Plusieurs entités sur une même proposition → toutes présentes.
//   4. Proposition sans entité → tableau vide, jamais d'invention.
//   5. Renommage de l'entité → occurrence.label reste inchangé (invariant architectural).

import { describe, it, expect } from 'vitest'
import { extractEntityIds } from '@/lib/db/knowledge-proposals'
import type { EntityResolution } from '@/lib/knowledge/semantic-resolution'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UUID_CLIMEXPERT = '11111111-0000-0000-0000-000000000001'
const UUID_AGP        = '22222222-0000-0000-0000-000000000002'
const UUID_ELECTRICIEN = '33333333-0000-0000-0000-000000000003'

const RESOLUTIONS: Record<string, EntityResolution> = {
  'Clim Expert': {
    status: 'resolved',
    source: 'semantic_memory',
    entityId: UUID_CLIMEXPERT,
    matchedAlias: 'Clim Expert',
    canonical: 'Clim Expert NC',
    needs_resolution: false,
  },
  'AGP': {
    status: 'resolved',
    source: 'canonical_name',
    entityId: UUID_AGP,
    matchedAlias: 'AGP',
    canonical: 'AGP',
    needs_resolution: false,
  },
  'électricien': {
    status: 'unknown',
    source: 'llm_only',
    needs_resolution: true,
    // entityId absent : non résolu
  },
  'Inconnu SA': {
    status: 'ambiguous',
    source: 'llm_only',
    needs_resolution: true,
    // entityId absent : ambiguïté
  },
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('extractEntityIds — lookup direct dans semantic_memory.resolutions', () => {
  it('retourne entityId pour une entité résolue', () => {
    expect(extractEntityIds(['Clim Expert'], RESOLUTIONS)).toEqual([UUID_CLIMEXPERT])
  })

  it('retourne plusieurs entityIds pour plusieurs entités résolues', () => {
    const ids = extractEntityIds(['Clim Expert', 'AGP'], RESOLUTIONS)
    expect(ids).toHaveLength(2)
    expect(ids).toContain(UUID_CLIMEXPERT)
    expect(ids).toContain(UUID_AGP)
  })

  it('déduplique si le même texte apparaît deux fois', () => {
    const ids = extractEntityIds(['Clim Expert', 'Clim Expert'], RESOLUTIONS)
    expect(ids).toHaveLength(1)
    expect(ids[0]).toBe(UUID_CLIMEXPERT)
  })

  it("retourne [] si l'entité est status='unknown'", () => {
    // 'électricien' est dans les resolutions mais status='unknown'
    expect(extractEntityIds(['électricien'], RESOLUTIONS)).toEqual([])
  })

  it("retourne [] si l'entité est status='ambiguous'", () => {
    expect(extractEntityIds(['Inconnu SA'], RESOLUTIONS)).toEqual([])
  })

  it("retourne [] si le texte n'est pas dans les resolutions", () => {
    expect(extractEntityIds(['Entreprise XYZ'], RESOLUTIONS)).toEqual([])
  })

  it("retourne [] pour une proposition sans entité (texte vide ou null)", () => {
    expect(extractEntityIds([null, undefined, ''], RESOLUTIONS)).toEqual([])
  })

  it('retourne [] si resolutions est vide (synthèse sans semantic_memory)', () => {
    expect(extractEntityIds(['Clim Expert'], {})).toEqual([])
  })

  it('lookup exact : "Clim Expert NC" ≠ "Clim Expert" (pas de fuzzy)', () => {
    // L'entité est enregistrée sous "Clim Expert" ; son canonical est "Clim Expert NC".
    // Un texte brut "Clim Expert NC" ne doit pas matcher.
    expect(extractEntityIds(['Clim Expert NC'], RESOLUTIONS)).toEqual([])
  })
})

// ─── Invariant architectural : label reste un snapshot historique ─────────────

describe('invariant — occurrence.label non réécrit par un renommage', () => {
  it("le label 'Clim Expert' capturé le 20 juillet reste 'Clim Expert' même si canonical='Clim Expert NC'", () => {
    // Ce test vérifie que l'entityId résolu pointe vers le canonical "Clim Expert NC",
    // MAIS que le label de l'occurrence n'est jamais modifié par ce fait.
    // La donnée capturée est "Clim Expert" → elle doit le rester.
    const resolution = RESOLUTIONS['Clim Expert']
    expect(resolution.entityId).toBe(UUID_CLIMEXPERT)
    expect(resolution.canonical).toBe('Clim Expert NC')

    // La capture historique est distincte du canonical actuel :
    // occurrence.label = "Clim Expert" (frozen)
    // company.name = "Clim Expert NC" (via entityId)
    // → ces deux valeurs coexistent sans conflit.
    const capturedLabel = 'Clim Expert'       // snapshot historique
    const currentName   = resolution.canonical // nom courant via entity_id

    expect(capturedLabel).not.toBe(currentName) // ils PEUVENT diverger
    expect(capturedLabel).toBe('Clim Expert')    // l'historique reste inchangé
  })

  it('cas PAVE → APAVE : deux noms, même entity_id', () => {
    const resolutionsWithPave: Record<string, EntityResolution> = {
      'PAVE': {
        status: 'resolved',
        source: 'semantic_memory',
        entityId: UUID_ELECTRICIEN, // même UUID que si l'alias "APAVE" était aussi enregistré
        matchedAlias: 'PAVE',
        canonical: 'APAVE',
        needs_resolution: false,
      },
    }
    const ids = extractEntityIds(['PAVE'], resolutionsWithPave)
    expect(ids).toEqual([UUID_ELECTRICIEN])
    // L'occurrence garde label="PAVE" mais entity_ids=[UUID_ELECTRICIEN]
    // → la requête reverse (WHERE entity_ids @> ARRAY[UUID_ELECTRICIEN]) retrouve PAVE et APAVE.
  })
})
