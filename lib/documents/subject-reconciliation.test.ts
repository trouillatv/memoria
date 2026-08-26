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

// ── stripCategoryFormatting — P1-C1.2 : garde vocabulaire de statut nu ───────
//
// Audit read-only P1-C1.2 (486 propositions Guillaume) : 25 continuités réelles
// cassées quand le texte après " : " ne contient qu'un statut générique
// (Fait/OK/VISA/...) — le préfixe ou suffixe retiré contenait alors le sujet
// réel. Voir STATUS_ONLY_VOCAB, constituée exclusivement des cas observés.

describe('stripCategoryFormatting — P1-C1.2 : garde vocabulaire de statut nu', () => {
  it('"Terrassement plateforme - Purge : Fait" ne se réduit plus à "Fait" (sentinelle Vincent)', () => {
    expect(stripCategoryFormatting('Terrassement plateforme - Purge : Fait'))
      .toBe('Terrassement plateforme - Purge : Fait')
  })

  it('"Plan de gestion des eaux pluviales : FAIT" conserve le label complet (statut nu)', () => {
    expect(stripCategoryFormatting('Plan de gestion des eaux pluviales : FAIT'))
      .toBe('Plan de gestion des eaux pluviales : FAIT')
  })

  it('"Plan des installations de chantier : FAIT" conserve le label complet (statut nu)', () => {
    expect(stripCategoryFormatting('Plan des installations de chantier : FAIT'))
      .toBe('Plan des installations de chantier : FAIT')
  })

  it('le strip reste normal quand le noyau retenu est un vrai sujet, pas un statut (non-régression)', () => {
    expect(stripCategoryFormatting('Terrassement plateforme : Purge = Fait')).toBe('Purge')
    expect(stripCategoryFormatting('Accès Plateforme : Reprise accès Est')).toBe('Reprise accès Est')
  })
})

describe('resolveMatches1to1 — P1-C1.2 : effets du correctif sur le rejeu Guillaume', () => {
  it('continuité correcte : deux occurrences du même statut nu se rattachent (label complet identique)', () => {
    const priors = [stub('p1', 'Plan de gestion des eaux pluviales : FAIT', 'thread-pgep')]
    const news = [stub('n1', 'Plan de gestion des eaux pluviales : FAIT', null)]
    const map = resolveMatches1to1(news, priors, () => 'new-uuid')
    expect(map.get('n1')).toBe('thread-pgep')
  })

  it('ne fusionne plus deux plans distincts réduits au même "FAIT" (faux rapprochement cassé par le correctif)', () => {
    const priors = [stub('p1', 'Plan de gestion des eaux pluviales : FAIT', 'thread-pgep')]
    const news = [stub('n1', 'Plan des installations de chantier : FAIT', null)]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    expect(map.get('n1')).not.toBe('thread-pgep')
    expect(map.get('n1')).toMatch(/^uuid-/)
  })

  it('cas réel où le strip reste nécessaire (STRIP_NECESSARY) : le correctif ne le casse pas', () => {
    const priors = [stub('p1', 'Reprise accès Est', 'thread-reprise')]
    const news = [stub('n1', 'Accès Plateforme : Reprise accès Est', null)]
    const map = resolveMatches1to1(news, priors, () => 'new-uuid')
    expect(map.get('n1')).toBe('thread-reprise')
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

// ── strongContainmentMatch — P1-C1.1 : garde QUALIFIERS universel ───────────
//
// Avant P1-C1.1, la garde QUALIFIERS n'était consultée que dans la branche
// sigShort.length === 1. Dès que deux labels partageaient un préfixe/contexte
// de ≥ 2 tokens significatifs, containment retournait true sans jamais vérifier
// qu'un qualificatif discriminant (complémentaire, partiel, etc.) n'était
// présent que du côté long. Cas réel confirmé par audit (_p1b_out2.txt, thread
// 26c7e2d0 "Purge") : "Terrassement plateforme : Purge complémentaire" matchait
// déjà "Terrassement plateforme : Purge" avec sameTheme=true — bug actif avant
// P1-C1, pas seulement exposé par lui.

describe('strongContainmentMatch — P1-C1.1 : qualificatif discriminant avec préfixe commun', () => {
  it('Purge ⊄ Purge complémentaire avec préfixe commun de plusieurs tokens (cas réel PV003)', () => {
    // sig court = [terrassement, plateforme, purge] → 3 ≥ 2 aurait matché avant le correctif
    // longOnly = [complementaire] ∈ QUALIFIERS → rejeté
    expect(strongContainmentMatch(
      'Terrassement plateforme : Purge',
      'Terrassement plateforme : Purge complémentaire',
    )).toBe(false)
  })

  it('sens inverse : Purge complémentaire ⊅ Purge (même préfixe)', () => {
    expect(strongContainmentMatch(
      'Terrassement plateforme : Purge complémentaire',
      'Terrassement plateforme : Purge',
    )).toBe(false)
  })

  it('qualificatif présent symétriquement des deux côtés → matching toujours autorisé (cas réel PV006)', () => {
    // "complémentaire" présent des deux côtés → pas d'asymétrie → containment conservé
    expect(strongContainmentMatch(
      'Rapport G3 pour purge complémentaire',
      'Transmission photos et rapport G3 purge complémentaire',
    )).toBe(true)
  })

  it('texte identique → matching inchangé', () => {
    expect(strongContainmentMatch(
      'Avis G3 sur les essais de la plateforme support de dalle',
      'Avis G3 sur les essais de la plateforme support de dalle',
    )).toBe(true)
  })

  it('autre qualificatif (partiel) avec préfixe commun → rejeté', () => {
    expect(strongContainmentMatch(
      'Terrassement plateforme : Purge',
      'Terrassement plateforme : Purge partiel réalisé',
    )).toBe(false)
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

// ── P1-C1 — thematic_category n'est plus une condition bloquante d'identité ──
//
// Matrice construite à partir des cas réels du replay P1-B sur le chantier Guillaume
// (OCEF Compostage). proposal_family reste la frontière forte (inchangé) ;
// thematic_category redevient un signal secondaire de tie-break, jamais un verrou.
// Chaque cas positif documente le jaccard/containment réel et confirme qu'avant
// P1-C1 le thème bloquait la continuité malgré une similarité suffisante.

describe('resolveMatches1to1 — continuités récupérées par P1-C1 (5 familles, cas réels)', () => {
  it('FT matériaux/équipements : "Transmettre les FT..." (theme=-) → (theme=test_control), exact après strip', () => {
    const priors = [stub('p1', 'Transmettre les fiches techniques des matériaux et équipements', 'thread-ft', null, 'action')]
    const news = [stub('n1', 'Transmettre les fiches techniques des matériaux et équipements', null, 'test_control', 'action')]
    const map = resolveMatches1to1(news, priors, () => 'new-uuid')
    // jaccard=1.00 containment=true — bloqué avant P1-C1 par sameTheme=false, récupéré ici
    expect(map.get('n1')).toBe('thread-ft')
  })

  it('Purge G3 : "Rapport G3 pour purge complémentaire" (theme=-) ↔ "Transmission des photos et rapport G3..." (theme=test_control)', () => {
    const priors = [stub('p1', 'Transmission des photos et rapport G3 pour purge complémentaire', 'thread-g3', 'test_control', 'action')]
    const news = [stub('n1', 'Rapport G3 pour purge complémentaire', null, null, 'action')]
    const map = resolveMatches1to1(news, priors, () => 'new-uuid')
    // jaccard=0.67 containment=true — bloqué avant P1-C1 par sameTheme=false, récupéré ici
    expect(map.get('n1')).toBe('thread-g3')
  })

  it('Busage/lagunage : "Raccordement...validation" (theme=administrative) ↔ "...validation du MOA/MOE" (theme=forecast)', () => {
    const priors = [stub('p1', 'Raccordement sur le lagunage fera l’objet d’une validation du MOA/MOE', 'thread-busage', 'forecast', 'knowledge_fact')]
    const news = [stub('n1', 'Raccordement sur le lagunage fera l\'objet d\'une validation', null, 'administrative', 'knowledge_fact')]
    const map = resolveMatches1to1(news, priors, () => 'new-uuid')
    // jaccard=0.71 containment=true — bloqué avant P1-C1 par sameTheme=false, récupéré ici
    expect(map.get('n1')).toBe('thread-busage')
  })

  it('Regard R4 : "Prévision: Problème regard R4 - manque Chute" (theme=forecast) ↔ "...Reprise...Faite" (theme=progress)', () => {
    const priors = [stub('p1', 'Prévision: Problème regard R4 - manque Chute', 'thread-r4', 'forecast', 'knowledge_fact')]
    const news = [stub('n1', 'Assainissement : Reprise problème chute dans le regard R4 Faite', null, 'progress', 'knowledge_fact')]
    const map = resolveMatches1to1(news, priors, () => 'new-uuid')
    // jaccard=0.50 (seuil exact) containment=false — bloqué avant P1-C1 par sameTheme=false, récupéré ici
    expect(map.get('n1')).toBe('thread-r4')
  })

  it('Enrobage : "Épaisseurs d\'enrobage...non conformes" (theme=-) ↔ "...non conforme" (theme=test_control)', () => {
    const priors = [stub('p1', 'Épaisseurs d\'enrobage sur les conduites d\'assainissement non conformes', 'thread-enrobage', null, 'reservation')]
    const news = [stub('n1', 'Épaisseurs d’enrobage sur les conduites d’assainissement non conforme', null, 'test_control', 'reservation')]
    const map = resolveMatches1to1(news, priors, () => 'new-uuid')
    // jaccard=0.71 containment=false — bloqué avant P1-C1 par sameTheme=false, récupéré ici
    expect(map.get('n1')).toBe('thread-enrobage')
  })
})

describe('resolveMatches1to1 — contre-exemples : deux objets proches restent distincts (P1-C1)', () => {
  it('"FT matériaux génériques" ne matche pas "FT débourbeur déshuileur" (même thème déjà — dissimilarité lexicale, pas le thème, les sépare)', () => {
    const priors = [stub('p1', 'Transmettre les fiches techniques des matériaux et équipements', 'thread-ft-generique', null, 'action')]
    const news = [stub('n1', 'Transmettre FT débourbeur déshuileur', null, null, 'action')]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    // jaccard=0.13 containment=false, sameTheme=true déjà — jamais protégé par le thème, safe par construction
    expect(map.get('n1')).not.toBe('thread-ft-generique')
    expect(map.get('n1')).toMatch(/^uuid-/)
  })

  it('"Busage provisoire GDE" ne matche pas "Busage entre plateforme et lagunage : zone non conforme" (familles différentes — frontière forte intacte)', () => {
    const priors = [stub('p1', 'Busage Provisoire GDE', 'thread-busage-gde', 'progress', 'knowledge_fact')]
    const news = [stub('n1', 'Busage entre la plateforme et le lagunage : Zone de largeur non conforme', null, 'test_control', 'reservation')]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    // proposal_family knowledge_fact ≠ reservation — bloqué par la frontière forte, jamais atteint par P1-C1
    expect(map.get('n1')).not.toBe('thread-busage-gde')
    expect(map.get('n1')).toMatch(/^uuid-/)
  })

  it('"Purge" (thread existant) vs "Purge complémentaire" — le vrai match exact du run gagne la collision, "complémentaire" reçoit un nouveau thread', () => {
    // Réplique la situation réelle PV003 Guillaume : le run contient à la fois une proposition
    // "= Fait" (exact après strip → score 1.0) et "Purge complémentaire" (containment/Jaccard plus faible)
    // qui compétitionnent pour le même thread prior. resolveMatches1to1 alloue au meilleur score.
    const priors = [stub('p1', 'Terrassement plateforme : Purge', 'thread-purge', 'progress', 'knowledge_fact')]
    const news = [
      stub('n-complementaire', 'Terrassement plateforme : Purge complémentaire', null, 'progress', 'knowledge_fact'),
      stub('n-exact', 'Terrassement plateforme : Purge = Fait', null, 'progress', 'knowledge_fact'),
    ]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    expect(map.get('n-exact')).toBe('thread-purge')
    expect(map.get('n-complementaire')).not.toBe('thread-purge')
    expect(map.get('n-complementaire')).toMatch(/^uuid-/)
  })

  it('Regard R4 : jaccard=0.43 sous le seuil reste sans match malgré sameFamily=true sameTheme=false (pas de sur-fusion au voisinage du seuil)', () => {
    const priors = [stub('p1', 'Prévision: Problème regard R4 - manque Chute', 'thread-r4-forecast', 'forecast', 'knowledge_fact')]
    const news = [stub('n1', 'Regard R4 chute manquante', null, 'test_control', 'knowledge_fact')]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    expect(map.get('n1')).not.toBe('thread-r4-forecast')
    expect(map.get('n1')).toMatch(/^uuid-/)
  })
})

// ── P1-C1.1 — régression : plus besoin d'une collision favorable pour séparer ─
//
// Avant le correctif, "Purge complémentaire" matchait déjà "Purge" même avec
// sameTheme=true et sans aucun concurrent dans le run (cas réel f66b84aa/26c7e2d0,
// PV003 Guillaume/OCEF) — la séparation observée en base ne tenait qu'à une
// collision favorable dans resolveMatches1to1 côté PV compétiteur. Ce test
// vérifie que la séparation est maintenant garantie par l'identité elle-même.

describe('resolveMatches1to1 — P1-C1.1 : Purge/Purge complémentaire séparés sans collision (cas réel non protégé par le thème)', () => {
  it('Purge complémentaire ne matche plus Purge même seul dans le run, même thème (f66b84aa/26c7e2d0)', () => {
    const priors = [stub('p1', 'Terrassement plateforme : Purge', 'thread-purge', 'progress', 'knowledge_fact')]
    const news = [stub('n1', 'Terrassement plateforme : Purge complémentaire', null, 'progress', 'knowledge_fact')]
    let uuidN = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++uuidN}`)
    expect(map.get('n1')).not.toBe('thread-purge')
    expect(map.get('n1')).toMatch(/^uuid-/)
  })
})

// ── M1 — réconciliation intra-run des orphelines (audit fragmentation FT OCEF) ─
//
// Défaut prouvé (audit 2026-08-27) : deux formulations jumelles d'un même objet
// métier, présentes dans le MÊME run, ne se voyaient jamais entre elles à
// l'Étage A (resolveMatches1to1 ne comparait chaque nouvelle proposition qu'aux
// runs antérieurs) → deux threads distincts → deux canonical_subject. M1 regroupe
// les orphelines du même run par composantes connexes, avec un prédicat STRICT
// (exact-après-strip OU containment fort, jamais Jaccard seul) pour ne pas
// sur-fusionner deux équipements distincts (dégrilleur ≠ débitmètre).

describe('resolveMatches1to1 — M1 : réconciliation intra-run des orphelines', () => {
  it('CASE 1 OCEF : deux formulations jumelles de la FT débourbeur déshuileur dans le même run → même thread', () => {
    const news = [
      stub('n1', 'FT Débourbeur déshuileur à retransmettre', null, null, 'action'),
      stub('n2', 'Retransmettre la FT débourbeur déshuileur', null, null, 'action'),
    ]
    let n = 0
    const map = resolveMatches1to1(news, [], () => `uuid-${++n}`)
    expect(map.get('n1')).toBe(map.get('n2'))
    expect(map.get('n1')).toBe('uuid-1') // une seule composante → un seul UUID alloué
  })

  it('anti-sur-fusion PROUVÉE (dry-run OCEF, run 6b684311) : "Busage… : largeur non conforme" ≠ "Zone déshuileur : largeur non conforme"', () => {
    // Deux non-conformités distinctes (busage vs déshuileur) partageant "largeur
    // non conforme". Le containment brut les sépare car "déshuileur" est absent
    // de l'autre label ; un pré-strip du préfixe les aurait sur-fusionnées.
    const news = [
      stub('n1', 'Busage entre la plateforme et le lagunage : Zone de largeur non conforme', null, 'test_control', 'reservation'),
      stub('n2', 'Zone déshuileur : largeur non conforme', null, 'test_control', 'reservation'),
    ]
    let n = 0
    const map = resolveMatches1to1(news, [], () => `uuid-${++n}`)
    expect(map.get('n1')).not.toBe(map.get('n2'))
  })

  it('anti-sur-fusion : dégrilleur ≠ débitmètre dans le même run → deux threads distincts', () => {
    const news = [
      stub('n1', 'Fournir le plan de détail du dégrilleur', null, null, 'action'),
      stub('n2', 'Fournir le plan de détail du débitmètre', null, null, 'action'),
    ]
    let n = 0
    const map = resolveMatches1to1(news, [], () => `uuid-${++n}`)
    expect(map.get('n1')).not.toBe(map.get('n2'))
  })

  it('anti-sur-fusion : familles différentes ne fusionnent jamais, même labels quasi-identiques', () => {
    const news = [
      stub('n1', 'FT Débourbeur déshuileur à retransmettre', null, null, 'action'),
      stub('n2', 'FT Débourbeur déshuileur à retransmettre', null, null, 'reservation'),
    ]
    let n = 0
    const map = resolveMatches1to1(news, [], () => `uuid-${++n}`)
    expect(map.get('n1')).not.toBe(map.get('n2'))
  })

  it('indépendance à l’ordre : le même lot rejoué dans plusieurs ordres produit une identité identique', () => {
    const a = stub('a', 'FT Débourbeur déshuileur à retransmettre', null, null, 'action')
    const b = stub('b', 'Retransmettre la FT débourbeur déshuileur', null, null, 'action')
    const c = stub('c', 'Fournir le plan de détail du débitmètre', null, null, 'action')
    const run = (news: ProposalStub[]) => {
      let n = 0
      return resolveMatches1to1(news, [], () => `uuid-${++n}`)
    }
    const m1 = run([a, b, c])
    const m2 = run([c, b, a])
    const m3 = run([b, a, c])
    for (const id of ['a', 'b', 'c']) {
      expect(m2.get(id)).toBe(m1.get(id))
      expect(m3.get(id)).toBe(m1.get(id))
    }
    // Partition attendue : a~b (jumeaux FT débourbeur), c distinct (débitmètre)
    expect(m1.get('a')).toBe(m1.get('b'))
    expect(m1.get('c')).not.toBe(m1.get('a'))
  })

  it('proposition isolée : comportement inchangé (un thread neuf)', () => {
    const map = resolveMatches1to1(
      [stub('n1', 'Pose de fondation béton armé', null, null, 'action')],
      [],
      () => 'uuid-1',
    )
    expect(map.get('n1')).toBe('uuid-1')
  })

  it('rattachement historique préservé : une orpheline jumelle ne détourne pas une proposition qui matche un thread antérieur', () => {
    const priors = [stub('p1', 'Transmettre les fiches techniques des matériaux et équipements', 'thread-ft', null, 'action')]
    const news = [
      stub('n1', 'Transmettre les fiches techniques des matériaux et équipements', null, null, 'action'), // matche le prior
      stub('n2', 'FT Débourbeur déshuileur à retransmettre', null, null, 'action'),                        // orpheline distincte
    ]
    let n = 0
    const map = resolveMatches1to1(news, priors, () => `uuid-${++n}`)
    expect(map.get('n1')).toBe('thread-ft')
    expect(map.get('n2')).not.toBe('thread-ft')
    expect(map.get('n2')).toMatch(/^uuid-/)
  })

  it('trois orphelines dont deux jumelles : composantes correctes (2 threads pour 3 propositions)', () => {
    const news = [
      stub('n1', 'FT Débourbeur déshuileur à retransmettre', null, null, 'action'),
      stub('n2', 'Retransmettre la FT débourbeur déshuileur', null, null, 'action'),
      stub('n3', 'Fournir le plan de détail du débitmètre', null, null, 'action'),
    ]
    let n = 0
    const map = resolveMatches1to1(news, [], () => `uuid-${++n}`)
    expect(map.get('n1')).toBe(map.get('n2'))
    expect(map.get('n3')).not.toBe(map.get('n1'))
    expect(new Set([map.get('n1'), map.get('n2'), map.get('n3')]).size).toBe(2)
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

  // ── P1-3C.2 — garde-fou "tâche non soldée" ──────────────────────────────────

  it('maps "à faire" → open (garde-fou : jamais informational/resolved)', () => {
    expect(mapDocumentStatus('à faire', 'action')).toBe('open')
    expect(mapDocumentStatus('à faire', 'knowledge_fact')).toBe('open')
  })

  it('maps "à réaliser" → open (garde-fou : "réalis" ne doit pas court-circuiter vers done)', () => {
    expect(mapDocumentStatus('à réaliser', 'action')).toBe('open')
  })

  it('maps "à transmettre" → open', () => {
    expect(mapDocumentStatus('à transmettre', 'action')).toBe('open')
  })

  // ── P1-3C.2 — sentinel pièges obligatoires ───────────────────────────────────

  it('piège #1 — "réalisé non conforme" → non_compliant (jamais done/resolved)', () => {
    expect(mapDocumentStatus('réalisé non conforme', 'action')).toBe('non_compliant')
    expect(mapDocumentStatus('essais réalisés non conformes', 'action')).toBe('non_compliant')
  })

  it('piège #2 — "en attente" → awaiting_validation (jamais resolved)', () => {
    expect(mapDocumentStatus('en attente de confirmation', 'action')).toBe('awaiting_validation')
  })

  it('piège #3 — "prévu" → planned (état futur, pas résolution)', () => {
    expect(mapDocumentStatus('prévu semaine 13', 'action')).toBe('planned')
  })

  it('piège #4 — "VISA FAIT" → awaiting_validation (visa = portée documentaire)', () => {
    expect(mapDocumentStatus('VISA FAIT', 'action')).toBe('awaiting_validation')
  })

  it('piège #5 — "Reprise FAIT en attente plan récolement" → awaiting_validation (terminal partiel)', () => {
    // "en attente" est testé avant "réalis/termin", et avant le nouveau garde-fou
    expect(mapDocumentStatus('Reprise FAIT en attente plan récolement', 'action')).toBe('awaiting_validation')
  })

  it('positif — "réalisé" sans réserve → done (résolution réelle)', () => {
    expect(mapDocumentStatus('réalisé', 'action')).toBe('done')
    expect(mapDocumentStatus('terminé sans réserve', 'action')).toBe('done')
  })
})
