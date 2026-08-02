import { describe, it, expect } from 'vitest'
import { jaccardSimilarity, normalizeLabel, mapDocumentStatus, stripCategoryFormatting, strongContainmentMatch, resolveMatches1to1, type ProposalStub } from './subject-reconciliation'

// Construit un ProposalStub minimal pour les tests
function stub(id: string, label: string, thread: string | null, cat: string | null = null, family = 'knowledge_fact'): ProposalStub {
  return { id, proposal_family: family, thematic_category: cat, label, subject_thread_id: thread }
}

// ── normalizeLabel ────────────────────────────────────────────────────────────

describe('normalizeLabel', () => {
  it('lowercases and strips accents', () => {
    expect(normalizeLabel('Réfection des Pentes')).toBe('refection pentes')
  })

  it('removes stopwords', () => {
    expect(normalizeLabel('Couche de forme')).toBe('couche forme')
  })

  it('removes punctuation', () => {
    expect(normalizeLabel('Rapport G3 — purge complémentaire')).toBe('rapport g3 purge complementaire')
  })

  it('filters single-character tokens', () => {
    expect(normalizeLabel('R4 / R5')).toBe('r4 r5')
  })
})

// ── jaccardSimilarity ─────────────────────────────────────────────────────────

describe('jaccardSimilarity', () => {
  it('returns 1 for identical labels', () => {
    expect(jaccardSimilarity('Rapport G3 purge', 'Rapport G3 purge')).toBe(1)
  })

  it('returns 0 for completely different labels', () => {
    const score = jaccardSimilarity('Rapport G3 transmis', 'Regard R4 non conforme')
    expect(score).toBe(0)
  })

  it('recognizes same subject with status change (attendu → transmis)', () => {
    // tokens: [rapport, g3, attendu] vs [rapport, g3, transmis]
    // intersection=2, union=4, jaccard=0.5 → above threshold 0.5
    const score = jaccardSimilarity('Rapport G3 attendu', 'Rapport G3 transmis')
    expect(score).toBeCloseTo(0.5)
    expect(score).toBeGreaterThanOrEqual(0.5)
  })

  it('recognizes same work item with completion status change', () => {
    // tokens: [couche, forme, cours] vs [couche, forme, terminee]
    // intersection=2, union=4, jaccard=0.5
    const score = jaccardSimilarity('Couche de forme en cours', 'Couche de forme terminée')
    expect(score).toBeCloseTo(0.5)
    expect(score).toBeGreaterThanOrEqual(0.5)
  })

  it('recognizes same subject with label reformulation', () => {
    // tokens: [refection, pentes, cote, nord] vs [pentes, cote, nord, reprofilees]
    // intersection=3, union=5, jaccard=0.6
    const score = jaccardSimilarity('Réfection des pentes côté nord', 'Pentes côté nord reprofilées')
    expect(score).toBeCloseTo(0.6)
    expect(score).toBeGreaterThanOrEqual(0.5)
  })

  it('does not match different essais from same PV', () => {
    // tokens: [essais, sol, non, conforme] vs [essais, compactage, conforme]
    // intersection=2 (essais, conforme), union=5, jaccard=0.4 < 0.5
    const score = jaccardSimilarity('Essais sol non conforme', 'Essais compactage conforme')
    expect(score).toBeLessThan(0.5)
  })

  it('does not match different types of couche', () => {
    // "couche forme" vs "couche gnt" — intersection=1, union=3, jaccard=0.33
    const score = jaccardSimilarity('Couche de forme', 'Couche de GNT')
    expect(score).toBeLessThan(0.5)
  })

  it('strips accents before comparing', () => {
    const score = jaccardSimilarity('terrassement réalisé', 'terrassement realise')
    expect(score).toBe(1)
  })

  it('handles empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(1)
    expect(jaccardSimilarity('rapport g3', '')).toBe(0)
    expect(jaccardSimilarity('', 'rapport g3')).toBe(0)
  })
})

// ── stripCategoryFormatting ───────────────────────────────────────────────────

describe('stripCategoryFormatting', () => {
  it('strips category prefix', () => {
    expect(stripCategoryFormatting('Assainissement : Busage entre la plateforme et le lagunage'))
      .toBe('Busage entre la plateforme et le lagunage')
  })

  it('strips status suffix', () => {
    expect(stripCategoryFormatting('Purge = Fait'))
      .toBe('Purge')
  })

  it('strips both prefix and suffix', () => {
    expect(stripCategoryFormatting('Terrassement plateforme : Purge = Fait'))
      .toBe('Purge')
  })

  it('leaves plain labels unchanged', () => {
    expect(stripCategoryFormatting('Purge')).toBe('Purge')
    expect(stripCategoryFormatting('Busage provisoire')).toBe('Busage provisoire')
  })

  it('handles multiple = signs (strips only last)', () => {
    expect(stripCategoryFormatting('Zone de prélèvement : Zone de prélèvement à retailler = FAIT'))
      .toBe('Zone de prélèvement à retailler')
  })
})

// ── strongContainmentMatch — vrais positifs PV006→PV007 ──────────────────────
//
// Cascade dans findBestThread : exact → containment → Jaccard.
// Ces tests couvrent les paires capturées par exact (early exit) ou containment.
// Paires 7, 9, 10 (Débourbeur, Retaillage, Essais bétons) : non couvertes par containment,
// rattrapées par Jaccard sur labels strippés dans findBestThread — non testées ici.
// Paire 13 (Moyens humains/matériels) : non matchable sans stemming — miss accepté.

describe('strongContainmentMatch — vrais positifs', () => {
  it('Purge ↔ Terrassement plateforme : Purge = Fait (exact après strip)', () => {
    // Les deux se strippent en "Purge" → exact match → true
    expect(strongContainmentMatch(
      'Purge',
      'Terrassement plateforme : Purge = Fait',
    )).toBe(true)
  })

  it('Purge complémentaire ↔ Terrassement plateforme : Purge complémentaire a été fait', () => {
    // sig = ["complementaire"] (purge est générique), length 13 ≥ 7 → true
    expect(strongContainmentMatch(
      'Purge complémentaire',
      'Terrassement plateforme : Purge complémentaire a été fait',
    )).toBe(true)
  })

  it('Récolement ↔ Récolement fait = VISA réalisé, Reprise FAIT en attente plan récolement', () => {
    // sig = ["recolement"], length 9 ≥ 7 → true
    expect(strongContainmentMatch(
      'Récolement',
      'Récolement fait = VISA réalisé, Reprise FAIT en attente plan récolement',
    )).toBe(true)
  })

  it('Débroussaillage ↔ Débroussaillage : 100% réalisé', () => {
    // raw containment : "debroussaillage" ⊂ {"debroussaillage", "100", "realise"}
    // sig = ["debroussaillage"], length 14 ≥ 7 → true
    expect(strongContainmentMatch(
      'Débroussaillage',
      'Débroussaillage : 100% réalisé',
    )).toBe(true)
  })

  it('Busage entre plateforme et lagunage ↔ Assainissement : Busage entre la plateforme... (exact après strip)', () => {
    // strip B → "Busage entre la plateforme et le lagunage" → norm = "busage entre plateforme lagunage"
    // strip A → norm = "busage entre plateforme lagunage" → exact
    expect(strongContainmentMatch(
      'Busage entre plateforme et lagunage',
      'Assainissement : Busage entre la plateforme et le lagunage = Remblai réalisé',
    )).toBe(true)
  })

  it('Busages sous plateforme et fonds de regard ↔ Assainissement : Mise en place des busages...', () => {
    // sig ≥ 2 : [busages, fonds, regard] → true
    expect(strongContainmentMatch(
      'Busages sous plateforme et fonds de regard',
      'Assainissement : Mise en place des busages sous la plateforme et réalisation des fonds de regard',
    )).toBe(true)
  })

  it('Busage provisoire ↔ GDE : Busage Provisoire mis en place', () => {
    // sig = [busage, provisoire] → length 2 ≥ 2 → true
    expect(strongContainmentMatch(
      'Busage provisoire',
      'GDE : Busage Provisoire mis en place',
    )).toBe(true)
  })

  it('Validation raccordement lagunage ↔ Raccordement sur le lagunage fera l\'objet d\'une validation du MOA/MOE', () => {
    // sig = [lagunage, validation] (raccordement est générique) → ≥ 2 → true
    expect(strongContainmentMatch(
      'Validation raccordement lagunage',
      'Raccordement sur le lagunage fera l\'objet d\'une validation du MOA/MOE',
    )).toBe(true)
  })

  it('Visite mairie secteur sous plateforme ↔ Assainissement : Visite de la mairie pour le secteur sous plateforme...', () => {
    // sig = [mairie, secteur] (visite et plateforme sont génériques) → ≥ 2 → true
    expect(strongContainmentMatch(
      'Visite mairie secteur sous plateforme',
      'Assainissement : Visite de la mairie pour le secteur sous plateforme fait le 02/04/2026',
    )).toBe(true)
  })
})

// ── strongContainmentMatch — paires rattrapées par Jaccard (non containment) ─

describe('strongContainmentMatch — non matchées (rattrapées par Jaccard dans le pipeline)', () => {
  it('Débourbeur déshuileur mis en place ↔ Assainissement : Mise en place du Débourbeur déshuileur... (mis ≠ mise)', () => {
    // "mis" absent de longSet qui a "mise" → containment fail → Jaccard = 0.6 avec stripping
    expect(strongContainmentMatch(
      'Débourbeur déshuileur mis en place',
      'Assainissement : Mise en place du Débourbeur déshuileur = FT transmise non conforme',
    )).toBe(false)
  })

  it('Retaillage zone de prélèvement ↔ Zone de prélèvement : Zone de prélèvement à retailler... (retaillage ≠ retailler)', () => {
    // "retaillage" absent de longSet qui a "retailler" → containment fail → Jaccard = 0.5 avec stripping
    expect(strongContainmentMatch(
      'Retaillage zone de prélèvement',
      'Zone de prélèvement : Zone de prélèvement à retailler = FAIT',
    )).toBe(false)
  })
})

// ── strongContainmentMatch — faux positifs à rejeter ─────────────────────────

describe('strongContainmentMatch — faux positifs à rejeter', () => {
  it('Purge ne doit pas matcher Purge complémentaire', () => {
    // "purge" seul : sig=[], length 5 < 7 → false
    expect(strongContainmentMatch('Purge', 'Purge complémentaire')).toBe(false)
  })

  it('Purge complémentaire ne doit pas matcher Purge (sens inverse)', () => {
    expect(strongContainmentMatch('Purge complémentaire', 'Purge')).toBe(false)
  })

  it('token générique seul ne matche pas', () => {
    expect(strongContainmentMatch('Plan', 'Plan de terrassement général')).toBe(false)
    expect(strongContainmentMatch('Essais', 'Essais de compactage couche de forme')).toBe(false)
    expect(strongContainmentMatch('Travaux', 'Travaux de terrassement plateforme nord')).toBe(false)
    expect(strongContainmentMatch('Accès', 'Accès plateforme nord réalisé')).toBe(false)
  })

  it('Essais sol non conforme vs Essais compactage conforme — tokens différents', () => {
    // "sol" absent de [essais, compactage, conforme] → pas de containment
    expect(strongContainmentMatch('Essais sol non conforme', 'Essais compactage conforme')).toBe(false)
  })

  it('Couche de forme ne doit pas matcher Couche de GNT', () => {
    // "forme" absent de [couche, gnt] → pas de containment
    expect(strongContainmentMatch('Couche de forme', 'Couche de GNT')).toBe(false)
  })

  it('labels sans token commun ne matchent pas', () => {
    expect(strongContainmentMatch('Rapport G3', 'Regard R4 non conforme')).toBe(false)
  })
})

// ── resolveMatches1to1 — contrainte 1:1 ──────────────────────────────────────

describe('resolveMatches1to1 — assignation sans collision', () => {
  it('assigne le thread précédent quand un seul match existe', () => {
    const priors = [stub('p1', 'Purge', 'thread-purge')]
    const news = [stub('n1', 'Terrassement plateforme : Purge = Fait', null)]
    const map = resolveMatches1to1(news, priors, () => 'new-uuid')
    expect(map.get('n1')).toBe('thread-purge')
  })

  it('crée un nouveau thread si aucun match', () => {
    const priors = [stub('p1', 'Rapport G3', 'thread-rapport')]
    const news = [stub('n1', 'Pose de fondation béton armé', null)]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    expect(map.get('n1')).toBe('uuid-1')
  })

  it('deux nouvelles props matchant deux threads différents — pas de collision', () => {
    const priors = [
      stub('p1', 'Purge', 'thread-purge'),
      stub('p2', 'Débroussaillage', 'thread-deb'),
    ]
    const news = [
      stub('n1', 'Terrassement plateforme : Purge = Fait', null),
      stub('n2', 'Débroussaillage : 100% réalisé', null),
    ]
    const map = resolveMatches1to1(news, priors, () => 'new-uuid')
    expect(map.get('n1')).toBe('thread-purge')
    expect(map.get('n2')).toBe('thread-deb')
  })
})

describe('resolveMatches1to1 — résolution de collisions 1:1', () => {
  it('collision "Couche de forme" : deux PV07 sur le même thread PV06 — premier gagne', () => {
    // PV06 : une seule entrée "Couche de forme accès plateforme"
    const priors = [stub('p1', 'Couche de forme accès plateforme', 'thread-cf')]
    // PV07 : deux entrées, les deux matchent "thread-cf" par containment
    const news = [
      stub('n1', 'Accès Plateforme : Couche de forme = Fait', null),
      stub('n2', 'Terrassement plateforme : Couche de forme = Fait', null),
    ]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    // Exactement un seul hérite du thread existant
    const hasThread = [map.get('n1'), map.get('n2')].filter(v => v === 'thread-cf')
    expect(hasThread).toHaveLength(1)
    // L'autre reçoit un nouveau UUID
    const hasNew = [map.get('n1'), map.get('n2')].filter(v => v !== 'thread-cf')
    expect(hasNew).toHaveLength(1)
    expect(hasNew[0]).toMatch(/^uuid-/)
  })

  it('collision "Intempéries" : deux périodes PV07 sur le même thread PV06', () => {
    const priors = [stub('p1', 'Jours d\'intempéries', 'thread-intemp')]
    const news = [
      stub('n1', 'Intempéries : 3 jours du 24/03 au 26/03', null),
      stub('n2', 'Intempéries : 14,5 jours du 16/02 au 27/02 et du 02/03', null),
    ]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    const shared = [map.get('n1'), map.get('n2')].filter(v => v === 'thread-intemp')
    expect(shared).toHaveLength(1)
    const fresh = [map.get('n1'), map.get('n2')].filter(v => v !== 'thread-intemp')
    expect(fresh).toHaveLength(1)
    expect(fresh[0]).toMatch(/^uuid-/)
  })

  it('collision "Plan de gestion des eaux" : deux variantes PV07 sur le même thread PV06', () => {
    const priors = [stub('p1', 'Plan de gestion des eaux transmis', 'thread-pgde')]
    const news = [
      stub('n1', 'Plan de gestion des eaux transmis par l\'entreprise', null),
      stub('n2', 'Plan de gestion des eaux pluviales : FAIT', null),
    ]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    const shared = [map.get('n1'), map.get('n2')].filter(v => v === 'thread-pgde')
    expect(shared).toHaveLength(1)
  })

  it('le meilleur score gagne en cas de collision', () => {
    // n1 matche par containment (0.85), n2 par Jaccard (0.5) — n1 doit gagner
    const priors = [stub('p1', 'Busage provisoire', 'thread-busage')]
    const news = [
      stub('n2', 'Busage', null),         // Jaccard : "busage" seul, score ~0.5 si "busage" n'est pas générique
      stub('n1', 'GDE : Busage Provisoire mis en place', null),  // containment : score 0.85
    ]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    // n1 (containment, score 0.85) doit récupérer le thread, n2 (Jaccard plus faible) → nouveau UUID
    expect(map.get('n1')).toBe('thread-busage')
    expect(map.get('n2')).toMatch(/^uuid-/)
  })
})

// ── mapDocumentStatus ─────────────────────────────────────────────────────────

describe('mapDocumentStatus', () => {
  it('maps "réalisé" → done', () => {
    expect(mapDocumentStatus('réalisé', 'knowledge_fact')).toBe('done')
    expect(mapDocumentStatus('Travaux terminés', 'knowledge_fact')).toBe('done')
    expect(mapDocumentStatus('réserve levée', 'reservation')).toBe('done')
  })

  it('maps "en cours" → in_progress', () => {
    expect(mapDocumentStatus('en cours', 'knowledge_fact')).toBe('in_progress')
    expect(mapDocumentStatus('partiellement réalisé', 'knowledge_fact')).toBe('in_progress')
  })

  it('maps "prévu" → planned', () => {
    expect(mapDocumentStatus('prévu', 'knowledge_fact')).toBe('planned')
    expect(mapDocumentStatus('non démarré', 'knowledge_fact')).toBe('planned')
  })

  it('maps "non conforme" → non_compliant', () => {
    expect(mapDocumentStatus('non conforme', 'knowledge_fact')).toBe('non_compliant')
    expect(mapDocumentStatus('refusé', 'knowledge_fact')).toBe('non_compliant')
  })

  it('maps "en attente de validation" → awaiting_validation', () => {
    expect(mapDocumentStatus('en attente de validation', 'knowledge_fact')).toBe('awaiting_validation')
    expect(mapDocumentStatus('attendu', 'knowledge_fact')).toBe('awaiting_validation')
    expect(mapDocumentStatus('VISA en cours', 'knowledge_fact')).toBe('awaiting_validation')
  })

  it('maps "annulé" → cancelled', () => {
    expect(mapDocumentStatus('annulé', 'knowledge_fact')).toBe('cancelled')
  })

  it('maps unknown values → informational', () => {
    expect(mapDocumentStatus('autre statut', 'knowledge_fact')).toBe('informational')
  })

  it('returns null for person/company families', () => {
    expect(mapDocumentStatus('présent', 'person')).toBeNull()
    expect(mapDocumentStatus('présente', 'company')).toBeNull()
  })

  it('returns null for null/empty input', () => {
    expect(mapDocumentStatus(null, 'knowledge_fact')).toBeNull()
    expect(mapDocumentStatus('', 'knowledge_fact')).toBeNull()
    expect(mapDocumentStatus(undefined, 'knowledge_fact')).toBeNull()
  })
})
