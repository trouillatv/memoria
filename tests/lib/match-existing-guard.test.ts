import { describe, it, expect } from 'vitest'
import {
  SYSTEM_PROMPT_MATCH_EXISTING,
  resolveMatchExistingDecision,
  MATCH_EXISTING_THRESHOLD,
} from '@/lib/db/canonical-subject-source-reconcile'

// P2-B — garde-fou « même objet ≠ même domaine » dans matchExistingSubject (Phase 1.5).
// Ces tests protègent la présence du garde-fou dans le prompt (non-régression de contenu) et
// vérifient que la porte de décision (seuil 0.85, existant-ou-null) reste inchangée. Le
// comportement sémantique réel du LLM est prouvé par le dry-run (_p2b-dryrun.ts).

describe('SYSTEM_PROMPT_MATCH_EXISTING — garde-fou objet vs domaine', () => {
  it('exige le MÊME OBJET et refuse la simple proximité de domaine', () => {
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/M[ÊE]ME OBJET/i)
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/proximit[ée] de DOMAINE.*ne suffit/i)
  })

  it('porte les contre-exemples cross-object (document/registre/rapport/réserve ≠ contrôle/équipement)', () => {
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/Registre.*≠.*Contr[ôo]le des installations/i)
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/SSI/)
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/porte coupe-feu/i)
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/VGP/)
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/registre hotte|registre.*hotte|Signature du registre/i)
  })

  it('préserve les matches même-objet nouvel-état (anti-fragmentation)', () => {
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/extincteurs.*↔.*extincteurs/i)
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/Nettoyage conduits.*↔.*Nettoyage des conduits/i)
  })

  it('n’est PAS une table d’exclusion déterministe (« Contrôle du registre » reste légitime)', () => {
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/PAS une table d'exclusion/i)
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/Contr[ôo]le du registre/i)
  })

  it('sortie prudente : existant ou null, ne force jamais le plus proche', () => {
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/ou null/i)
    expect(SYSTEM_PROMPT_MATCH_EXISTING).toMatch(/ne force jamais le candidat le plus proche/i)
  })
})

describe('resolveMatchExistingDecision — porte inchangée (seuil 0.85)', () => {
  const pool = [{ id: 'cs-1' }, { id: 'cs-2' }]
  it('seuil = 0.85', () => expect(MATCH_EXISTING_THRESHOLD).toBe(0.85))
  it('confiance ≥ seuil + UUID présent → attach', () => {
    expect(resolveMatchExistingDecision({ canonicalSubjectId: 'cs-1', confidence: 0.9 }, pool)).toBe('attach')
  })
  it('confiance < seuil → orphan', () => {
    expect(resolveMatchExistingDecision({ canonicalSubjectId: 'cs-1', confidence: 0.8 }, pool)).toBe('orphan')
  })
  it('null / UUID absent → orphan', () => {
    expect(resolveMatchExistingDecision(null, pool)).toBe('orphan')
    expect(resolveMatchExistingDecision({ canonicalSubjectId: 'cs-x', confidence: 0.99 }, pool)).toBe('orphan')
  })
})
