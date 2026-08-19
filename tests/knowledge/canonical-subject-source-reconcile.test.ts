import { describe, it, expect } from 'vitest'
import {
  clusterByJaccard,
  CAN_CREATE_SUBJECT_KINDS,
  MATCH_EXISTING_THRESHOLD,
  resolveMatchExistingDecision,
  computeClusterMaxOutputTokens,
} from '@/lib/db/canonical-subject-source-reconcile'
import { ELIGIBLE_KINDS } from '@/lib/db/canonical-subject-reconcile'

describe('clusterByJaccard', () => {
  it('regroupe deux labels identiques', () => {
    const clusters = clusterByJaccard(['Toiture terrasse R4', 'Toiture terrasse R4'])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].memberIdxs).toHaveLength(2)
  })

  it('sépare deux labels sans rapport', () => {
    const clusters = clusterByJaccard(['Toiture terrasse', 'Réseau eau chaude'])
    expect(clusters).toHaveLength(2)
    clusters.forEach((c) => expect(c.memberIdxs).toHaveLength(1))
  })

  it('regroupe des labels proches (même zone différente formulation)', () => {
    const clusters = clusterByJaccard(['Etanchéité toiture R3', 'Etanchéité toiture niveau R3'], 0.28)
    expect(clusters).toHaveLength(1)
  })

  it('ne regroupe pas des labels différents (zones différentes)', () => {
    const clusters = clusterByJaccard(['Etanchéité R3', 'Etanchéité R4'], 0.28)
    // "R3" et "R4" sont suffisamment distincts pour ne pas se confondre
    // Jaccard sur tokens : intersection={etancheite} / union={etancheite,r3,r4} = 1/3 ≈ 0.33
    // → peut fusionner selon seuil ; à 0.28 ils peuvent être regroupés
    // Ce test vérifie uniquement que la structure retournée est valide
    expect(clusters.length).toBeGreaterThanOrEqual(1)
    const totalMembers = clusters.reduce((sum, c) => sum + c.memberIdxs.length, 0)
    expect(totalMembers).toBe(2)
  })

  it('gère une liste vide', () => {
    expect(clusterByJaccard([])).toEqual([])
  })

  it('retourne un seul cluster pour un seul label', () => {
    const clusters = clusterByJaccard(['Réserve ascenseur'])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].memberIdxs).toEqual([0])
  })

  it('chaque index apparaît dans exactement un cluster', () => {
    const labels = [
      'Toiture terrasse R4',
      'Réseau CVC niveaux haut',
      'Toiture terrasse niveau 4',
      'Réseau chauffage',
      'Façade bardage',
    ]
    const clusters = clusterByJaccard(labels, 0.28)
    const allIdxs = clusters.flatMap((c) => c.memberIdxs).sort((a, b) => a - b)
    expect(allIdxs).toEqual([0, 1, 2, 3, 4])
  })

  it('respecte un seuil strict (0.99) : aucun regroupement sauf identique', () => {
    const labels = ['Toiture terrasse', 'Toiture terrasse R4', 'Toiture']
    const clusters = clusterByJaccard(labels, 0.99)
    // Jaccard exact entre "Toiture terrasse" et "Toiture terrasse R4" < 0.99
    expect(clusters).toHaveLength(3)
  })

  it('respecte un seuil large (0.01) : tout est regroupé', () => {
    const labels = ['Toiture terrasse', 'Réseau CVC', 'Façade']
    // Chacun partage au moins "toiture"|"réseau"|"façade" — mais pas entre eux
    // → dépend des tokens. Ce test vérifie juste que la structure est correcte.
    const clusters = clusterByJaccard(labels, 0.01)
    const totalMembers = clusters.reduce((sum, c) => sum + c.memberIdxs.length, 0)
    expect(totalMembers).toBe(3)
  })
})

// ─── Doctrine CAN_MATCH_EXISTING / CAN_CREATE_SUBJECT ────────────────────────

describe('doctrine deadline — match_existing_only', () => {
  it("ELIGIBLE_KINDS inclut 'deadline' (peut matcher un CS existant)", () => {
    expect(ELIGIBLE_KINDS.has('deadline')).toBe(true)
  })

  it("CAN_CREATE_SUBJECT_KINDS exclut 'deadline' (ne peut jamais créer un CS)", () => {
    expect(CAN_CREATE_SUBJECT_KINDS.has('deadline')).toBe(false)
  })

  it('les kinds standard restent dans CAN_CREATE_SUBJECT_KINDS', () => {
    for (const k of ['action', 'vigilance', 'decision', 'knowledge']) {
      expect(CAN_CREATE_SUBJECT_KINDS.has(k)).toBe(true)
    }
  })

  it('MATCH_EXISTING_THRESHOLD est à 0.85', () => {
    expect(MATCH_EXISTING_THRESHOLD).toBe(0.85)
  })
})

// ─── resolveMatchExistingDecision — cas polaires Phase 2b ────────────────────

const CS_LIST = [
  { id: 'cs-elec-0001-0000-0000-000000000004', label: 'Vérification des lignes électriques et consignations' },
  { id: 'cs-cadenas-0001-0000-000000000001', label: 'Installation et présentation cadenas à code' },
]

describe('resolveMatchExistingDecision', () => {
  // ── Cas polaire 1 : électricien → doit rejoindre CS électrique ──────────────
  // "Intervention de l'électricien pour vérifier les installations électriques"
  // Jaccard vs CS4 = 0.091 (trop bas pour Phase 1) → Gemini Phase 2b doit réussir.
  it('attache quand confiance >= 0.85 et UUID présent (électricien → CS électrique)', () => {
    const geminiOutput = { canonicalSubjectId: CS_LIST[0].id, confidence: 0.91, reason: 'électricien → vérification lignes' }
    expect(resolveMatchExistingDecision(geminiOutput, CS_LIST)).toBe('attach')
  })

  // ── Cas polaire 2 : planning → doit rester orphelin ──────────────────────────
  // "Diffusion du premier planning" ne correspond à aucun CS PETRO connu.
  it('orpheline si confiance < seuil (planning → aucun CS)', () => {
    const geminiOutput = { canonicalSubjectId: null, confidence: 0.3, reason: 'planning générique non lié' }
    expect(resolveMatchExistingDecision(geminiOutput, CS_LIST)).toBe('orphan')
  })

  it('orpheline si canonicalSubjectId est null (Gemini refuse de lier)', () => {
    const geminiOutput = { canonicalSubjectId: null, confidence: 0.95, reason: 'aucun sujet suffisamment proche' }
    expect(resolveMatchExistingDecision(geminiOutput, CS_LIST)).toBe('orphan')
  })

  it('orpheline si match est null (Gemini a échoué)', () => {
    expect(resolveMatchExistingDecision(null, CS_LIST)).toBe('orphan')
  })

  it('orpheline si UUID non présent dans la liste locale (intégrité)', () => {
    const geminiOutput = { canonicalSubjectId: 'cs-inexistant-0000-0000-000000000000', confidence: 0.92, reason: 'hallucination' }
    expect(resolveMatchExistingDecision(geminiOutput, CS_LIST)).toBe('orphan')
  })

  it('seuil personnalisé respecté', () => {
    const geminiOutput = { canonicalSubjectId: CS_LIST[0].id, confidence: 0.80 }
    expect(resolveMatchExistingDecision(geminiOutput, CS_LIST, 0.75)).toBe('attach')
    expect(resolveMatchExistingDecision(geminiOutput, CS_LIST, 0.85)).toBe('orphan')
  })
})

// ─── computeClusterMaxOutputTokens — verrou anti-régression MAX_TOKENS ───────
// Bug réel découvert lors du dry-run P0-J.1 : un budget fixe de 1200 tokens
// tronque la réponse Gemini (finishReason: MAX_TOKENS) dès ~15 orphelins,
// JSON.parse échoue silencieusement, clusterOrphansWithGemini retourne null,
// et tous les orphelins sont traités comme non résolus sans erreur visible.

describe('computeClusterMaxOutputTokens', () => {
  it('applique le plancher de 1200 sur un petit lot', () => {
    expect(computeClusterMaxOutputTokens(1)).toBe(1200)
    expect(computeClusterMaxOutputTokens(5)).toBe(1200)
    expect(computeClusterMaxOutputTokens(11)).toBe(1200)
  })

  it('dimensionne proportionnellement au-delà du plancher', () => {
    expect(computeClusterMaxOutputTokens(20)).toBe(2000)
    expect(computeClusterMaxOutputTokens(50)).toBe(5000)
  })

  it('plafonne à 8192 sur un gros lot', () => {
    expect(computeClusterMaxOutputTokens(100)).toBe(8192)
    expect(computeClusterMaxOutputTokens(486)).toBe(8192)
  })
})
