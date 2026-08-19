// Tests du routeur d'intention V2 — couverture complète avec cas de collision.
// Matrice issue de la spec Intent Router V2 (2026-08-05).
//
// Principe : un faux positif d'écriture est plus grave qu'une commande non reconnue.
// Les tests READ sont donc les plus critiques.

import { describe, it, expect } from 'vitest'
import { detectIntent, readRemainsPlausible } from '@/lib/visits/copilot-intent-router'

const intent = (q: string) => detectIntent(q).intent
const confidence = (q: string) => detectIntent(q).confidence
const signals = (q: string) => detectIntent(q).signals

// ── READ ──────────────────────────────────────────────────────────────────────
// Ces tests sont les plus importants : aucune de ces phrases ne doit déclencher
// une intention d'écriture.

describe('READ — questions explicites', () => {
  const cases = [
    'Où en est R4 ?',
    "Qu'en est-il de G3 ?",
    'Comment va le chantier ?',
    'Infos sur R4',
    "État de G3",
    "Qui s'occupe de R4 ?",
    'Résumé du chantier',
    "Qu'est-ce qui a changé depuis la dernière visite ?",
    'Quelle est la situation de R4 ?',
    'Explique-moi pourquoi R4 revient',
    'Dis-moi où en est G3',
    'Parle-moi de R4',
    'Montre-moi les actions ouvertes',
  ]
  for (const q of cases) {
    it(`"${q.slice(0, 60)}" → READ`, () => {
      expect(intent(q)).toBe('READ')
    })
  }
})

describe('READ — prochaine visite comme sujet de question (pas commande)', () => {
  it('"Parle-moi de la prochaine visite" → READ strong', () => {
    expect(intent('Parle-moi de la prochaine visite')).toBe('READ')
    expect(confidence('Parle-moi de la prochaine visite')).toBe('strong')
  })
  it('"Quand est ma prochaine visite ?" → READ', () => {
    expect(intent('Quand est ma prochaine visite ?')).toBe('READ')
  })
  it('"Qu\'est-ce qu\'on prévoit pour la prochaine visite ?" → READ', () => {
    expect(intent("Qu'est-ce qu'on prévoit pour la prochaine visite ?")).toBe('READ')
  })
})

// ── Préparation de visite (P1-A.1) ────────────────────────────────────────────
// Recette PETRO 2026-08-15 : « Fais-moi les points de contrôle pour ma prochaine
// visite » créait un point de visite intitulé avec la question elle-même. La
// fonction essentielle « prépare ma visite » ne doit dépendre d'aucun appel LLM :
// ces cas sont donc tous DÉTERMINISTES et `strong`.

describe('READ — demande de préparation de visite (déterministe)', () => {
  const cases = [
    'Fais-moi les points de contrôle pour ma prochaine visite',
    'Prépare-moi ma visite de demain.',
    'Prépare ma prochaine visite',
    'Donne-moi les points de contrôle',
    'Liste-moi les points de contrôle de la visite',
    'Génère la check-list de ma prochaine visite',
    "Qu'est-ce que je dois surveiller si j'y vais demain ?",
    'Que dois-je vérifier sur place ?',
    'Je vais sur le chantier demain, je vérifie quoi ?',
    'Que vérifier sur place ?',
    'Que surveiller demain ?',
    'À quoi faire attention lors de ma prochaine visite ?',
    'Sur quoi me concentrer demain ?',
  ]
  for (const q of cases) {
    it(`"${q.slice(0, 60)}" → READ strong`, () => {
      expect(intent(q)).toBe('READ')
      expect(confidence(q)).toBe('strong')
    })
  }
})

describe('Frontière préparation / écriture', () => {
  // Un verbe d'insertion nomme un objet à créer : la finalité « préparer la
  // visite » n'en fait pas une demande de génération de plan.
  const writes: [string, string][] = [
    ['Ajoute une action pour préparer la prochaine visite', 'CREATE_ACTION'],
    ["Ajoute l'accès sécurisé aux points à vérifier à la prochaine visite.", 'ADD_VISIT_ITEM'],
    ['Ajoute R4 au plan de visite', 'ADD_VISIT_ITEM'],
    ['Mets les points de contrôle dans mon plan de visite', 'ADD_VISIT_ITEM'],
    ['Planifie une visite pour vérifier R4', 'SCHEDULE_VISIT'],
    ['Note une action de suivi pour la prochaine visite', 'CREATE_ACTION'],
  ]
  for (const [q, expected] of writes) {
    it(`"${q.slice(0, 60)}" → ${expected}`, () => {
      expect(intent(q)).toBe(expected)
    })
  }
})

// ── CREATE_ACTION ─────────────────────────────────────────────────────────────

describe('CREATE_ACTION — formulations explicites', () => {
  const cases = [
    'Crée une action pour contrôler R4',
    'Créé moi une action pour R4',
    'Ajoute une action sur R4',
    'Ajoute une action pour contrôler R4',
    'Mets une tâche pour contrôler R4',
    'Fais une tâche pour R4',
    'Ouvre une action pour G3',
  ]
  for (const q of cases) {
    it(`"${q}" → CREATE_ACTION`, () => {
      expect(intent(q)).toBe('CREATE_ACTION')
    })
  }
})

describe('CREATE_ACTION — formulations implicites', () => {
  it('"Note qu\'il faut contrôler R4" → CREATE_ACTION', () => {
    expect(intent("Note qu'il faut contrôler R4")).toBe('CREATE_ACTION')
  })
  it('"Faut contrôler R4" → CREATE_ACTION', () => {
    expect(intent('Faut contrôler R4')).toBe('CREATE_ACTION')
  })
  it('"Programme le contrôle de R4" → CREATE_ACTION (ambiguous)', () => {
    expect(intent('Programme le contrôle de R4')).toBe('CREATE_ACTION')
    expect(confidence('Programme le contrôle de R4')).toBe('ambiguous')
  })
})

describe('CREATE_ACTION — strong quand "action" explicite', () => {
  it('"Crée une action pour planifier les essais béton" → CREATE_ACTION strong', () => {
    expect(intent('Crée une action pour planifier les essais béton')).toBe('CREATE_ACTION')
    expect(confidence('Crée une action pour planifier les essais béton')).toBe('strong')
  })
  it('"Ajoute une action de suivi" → CREATE_ACTION strong', () => {
    expect(intent('Ajoute une action de suivi')).toBe('CREATE_ACTION')
    expect(confidence('Ajoute une action de suivi')).toBe('strong')
  })
})

// ── ADD_VISIT_ITEM ────────────────────────────────────────────────────────────

describe('ADD_VISIT_ITEM — formulations explicites', () => {
  const cases = [
    'Ajoute R4 à ma prochaine visite',
    'Ajoute R4 au plan de visite',
    'Ajoutes R4 au plan de visite',
    'Mets R4 dans mon plan de visite',
    'Garde R4 pour la prochaine visite',
    'Je veux contrôler R4 à la prochaine visite',
    'Vérifier R4 lors de la prochaine visite',
    'Ajoute R4 au plan de la prochaine visite',
  ]
  for (const q of cases) {
    it(`"${q}" → ADD_VISIT_ITEM`, () => {
      expect(intent(q)).toBe('ADD_VISIT_ITEM')
    })
  }
})

describe('ADD_VISIT_ITEM — formulations implicites (prochaine visite)', () => {
  it('"Pense à vérifier R4 à la prochaine visite" → ADD_VISIT_ITEM strong', () => {
    expect(intent('Pense à vérifier R4 à la prochaine visite')).toBe('ADD_VISIT_ITEM')
    expect(confidence('Pense à vérifier R4 à la prochaine visite')).toBe('strong')
  })
  it('"Faudrait checker R4 à la prochaine visite" → ADD_VISIT_ITEM strong', () => {
    expect(intent('Faudrait checker R4 à la prochaine visite')).toBe('ADD_VISIT_ITEM')
    expect(confidence('Faudrait checker R4 à la prochaine visite')).toBe('strong')
  })
  it('"Mets R4 dans mon plan" → ADD_VISIT_ITEM', () => {
    expect(intent('Mets R4 dans mon plan')).toBe('ADD_VISIT_ITEM')
  })
})

describe('ADD_VISIT_ITEM — signals collectés', () => {
  it('"Ajoute R4 au plan de visite" → signals contient next_visit + write_verb', () => {
    const { signals } = detectIntent('Ajoute R4 au plan de visite')
    expect(signals).toContain('next_visit')
  })
  it('"Faudrait checker R4 à la prochaine visite" → signals contient next_visit + implicit_write', () => {
    const { signals } = detectIntent('Faudrait checker R4 à la prochaine visite')
    expect(signals).toContain('next_visit')
    expect(signals).toContain('implicit_write')
  })
})

// ── SCHEDULE_VISIT ────────────────────────────────────────────────────────────

describe('SCHEDULE_VISIT — familles de verbes', () => {
  const cases = [
    'Planifie une visite mercredi à 9h',
    'Planifies une visite mercredi à 9 heures',
    'Planifier une visite le 12 août à 9h',
    'Programme-moi une visite mercredi',
    'Organise une visite le 12 août à 9h',
    'Organises une visite mercredi matin',
    'Prévois une visite mercredi matin',
    'Inscris une visite vendredi à 10h',
    'Marque une visite le 15 août',
    'Inscrit une visite demain à 9h',
    'Ajoute une visite mercredi à 9h',
  ]
  for (const q of cases) {
    it(`"${q.slice(0, 55)}" → SCHEDULE_VISIT`, () => {
      expect(intent(q)).toBe('SCHEDULE_VISIT')
    })
  }
})

describe('SCHEDULE_VISIT — strong quand verbe planification présent', () => {
  it('"Planifie une visite pour vérifier R4 mercredi" → SCHEDULE_VISIT strong', () => {
    expect(intent('Planifie une visite pour vérifier R4 mercredi')).toBe('SCHEDULE_VISIT')
    expect(confidence('Planifie une visite pour vérifier R4 mercredi')).toBe('strong')
  })
  it('"Ajoute une visite mercredi" (datetime only) → SCHEDULE_VISIT ambiguous', () => {
    expect(intent('Ajoute une visite mercredi')).toBe('SCHEDULE_VISIT')
    expect(confidence('Ajoute une visite mercredi')).toBe('ambiguous')
  })
})

describe('SCHEDULE_VISIT — signals collectés', () => {
  it('"Planifie une visite mercredi à 9h" → schedule_verb + visit + future_datetime', () => {
    const { signals } = detectIntent('Planifie une visite mercredi à 9h')
    expect(signals).toContain('schedule_verb')
    expect(signals).toContain('visit')
    expect(signals).toContain('future_datetime')
  })
})

describe('SCHEDULE_VISIT — création sans temporalité (hasCreateVisit)', () => {
  const cases = [
    'crée une visite',
    'crée-moi une visite',
    'créer une visite',
    'nouvelle visite',
    'une nouvelle visite',
    'crée une visite demain',
    'crée une visite jeudi à 9h',
  ]
  for (const q of cases) {
    it(`"${q}" → SCHEDULE_VISIT`, () => {
      expect(intent(q)).toBe('SCHEDULE_VISIT')
    })
  }
})

describe('SCHEDULE_VISIT — non-régression lancement opérationnel', () => {
  it('"démarre une visite" → NOT SCHEDULE_VISIT', () => {
    expect(intent('démarre une visite')).not.toBe('SCHEDULE_VISIT')
  })
  it('"commence une visite" → NOT SCHEDULE_VISIT', () => {
    expect(intent('commence une visite')).not.toBe('SCHEDULE_VISIT')
  })
  it('"je commence ma visite" → NOT SCHEDULE_VISIT', () => {
    expect(intent('je commence ma visite')).not.toBe('SCHEDULE_VISIT')
  })
  it('"lance la visite" → NOT SCHEDULE_VISIT', () => {
    expect(intent('lance la visite')).not.toBe('SCHEDULE_VISIT')
  })
})

// ── SCHEDULE_MEETING ──────────────────────────────────────────────────────────

describe('SCHEDULE_MEETING — familles de verbes', () => {
  const cases = [
    'Planifie une réunion vendredi à 14h',
    'Planifies une réunion vendredi',
    'Planifier une réunion le 13 août à 14h',
    'Organises une réunion vendredi',
    'Programme une réunion de chantier lundi à 9h',
    'Marque une réunion le 12 août à 9h',
    'Marques une réunion vendredi à 14 heures',
    'Prévois une réunion jeudi',
    'Inscris une réunion vendredi à 14h',
    'Convoque une réunion',
  ]
  for (const q of cases) {
    it(`"${q.slice(0, 55)}" → SCHEDULE_MEETING`, () => {
      expect(intent(q)).toBe('SCHEDULE_MEETING')
    })
  }
})

// ── UNKNOWN_WRITE ─────────────────────────────────────────────────────────────

describe('UNKNOWN_WRITE — objets non supportés', () => {
  it('"Mets-moi une réserve sur R4" → UNKNOWN_WRITE', () => {
    expect(intent('Mets-moi une réserve sur R4')).toBe('UNKNOWN_WRITE')
  })
  it('"Ajoute une échéance sur R4" → UNKNOWN_WRITE', () => {
    expect(intent('Ajoute une échéance sur R4')).toBe('UNKNOWN_WRITE')
  })
  it('"Crée un point de vigilance sur G3" → UNKNOWN_WRITE', () => {
    expect(intent('Crée un point de vigilance sur G3')).toBe('UNKNOWN_WRITE')
  })
})

describe('UNKNOWN_WRITE — verbe implicite sans objet résolu', () => {
  it('"Faudrait voir R4" → UNKNOWN_WRITE ambiguous', () => {
    expect(intent('Faudrait voir R4')).toBe('UNKNOWN_WRITE')
    expect(confidence('Faudrait voir R4')).toBe('ambiguous')
  })
})

// ── OBSERVATION (P4-A) ────────────────────────────────────────────────────────
// Spec Vincent (2026-08-17) : constat factuel daté implicitement maintenant.
// Un constat peut confirmer un état inchangé — jamais de promotion en
// "évolution" dans le routeur, cette décision se prend après matérialisation.

describe('OBSERVATION — constats positifs (spec Vincent)', () => {
  const cases = [
    "Le cadenas n'est toujours pas installé.",
    'Le tableau électrique est encore hors tension.',
    "Clim Expair n'est pas venu aujourd'hui.",
    'Les gaines sont arrivées ce matin.',
    'Le portail est maintenant réparé.',
  ]
  for (const q of cases) {
    it(`"${q}" → OBSERVATION`, () => {
      expect(intent(q)).toBe('OBSERVATION')
      expect(confidence(q)).toBe('ambiguous')
    })
  }
})

describe('OBSERVATION — non-régression (spec Vincent, contre-exemples)', () => {
  it('"Il faut rappeler Clim Expair" → CREATE_ACTION (pas OBSERVATION)', () => {
    expect(intent('Il faut rappeler Clim Expair')).toBe('CREATE_ACTION')
  })
  it('"Qui intervient sur la clim ?" → READ (pas OBSERVATION)', () => {
    expect(intent('Qui intervient sur la clim ?')).toBe('READ')
  })
  it('"Le cadenas sera installé vendredi" → pas OBSERVATION (engagement futur)', () => {
    expect(intent('Le cadenas sera installé vendredi')).not.toBe('OBSERVATION')
  })
  it('"Je pense que Clim Expair est encore responsable" → pas OBSERVATION (opinion)', () => {
    expect(intent('Je pense que Clim Expair est encore responsable')).not.toBe('OBSERVATION')
  })
  it('"Mets ça dans ma prochaine visite" → ADD_VISIT_ITEM (pas OBSERVATION)', () => {
    expect(intent('Mets ça dans ma prochaine visite')).toBe('ADD_VISIT_ITEM')
  })
})

describe('OBSERVATION — recette terrain (6 scénarios, spec Vincent)', () => {
  it('1. état inchangé : "Le cadenas n\'est toujours pas installé." → OBSERVATION', () => {
    expect(intent("Le cadenas n'est toujours pas installé.")).toBe('OBSERVATION')
  })
  it('2. état résolu : "Le portail est maintenant réparé." → OBSERVATION', () => {
    expect(intent('Le portail est maintenant réparé.')).toBe('OBSERVATION')
  })
  it('3. nouvelle information : "Les gaines sont arrivées ce matin." → OBSERVATION', () => {
    expect(intent('Les gaines sont arrivées ce matin.')).toBe('OBSERVATION')
  })
  it('4. phrase ambiguë action vs observation : "Il faut vérifier le tableau qui est encore hors tension" → CREATE_ACTION (verbe fort domine)', () => {
    expect(intent('Il faut vérifier le tableau qui est encore hors tension')).toBe('CREATE_ACTION')
  })
  it('5. phrase future : "Le cadenas sera installé vendredi" → pas OBSERVATION', () => {
    expect(intent('Le cadenas sera installé vendredi')).not.toBe('OBSERVATION')
  })
  it('6. observation avec acteur mentionné : "Clim Expair n\'est pas venu aujourd\'hui." → OBSERVATION', () => {
    const { intent: i, signals } = detectIntent("Clim Expair n'est pas venu aujourd'hui.")
    expect(i).toBe('OBSERVATION')
    expect(signals).toContain('observation_state')
  })
})

describe('OBSERVATION — n\'affecte pas les autres intentions', () => {
  it('READ reste READ : "Où en est R4 ?"', () => {
    expect(intent('Où en est R4 ?')).toBe('READ')
  })
  it('CREATE_ACTION reste CREATE_ACTION : "Crée une action pour contrôler R4"', () => {
    expect(intent('Crée une action pour contrôler R4')).toBe('CREATE_ACTION')
  })
  it('SCHEDULE_VISIT reste SCHEDULE_VISIT : "Planifie une visite mercredi à 9h"', () => {
    expect(intent('Planifie une visite mercredi à 9h')).toBe('SCHEDULE_VISIT')
  })
  it('SCHEDULE_MEETING reste SCHEDULE_MEETING : "Planifie une réunion vendredi à 14h"', () => {
    expect(intent('Planifie une réunion vendredi à 14h')).toBe('SCHEDULE_MEETING')
  })
  it('UNKNOWN_WRITE reste UNKNOWN_WRITE : "Mets-moi une réserve sur R4"', () => {
    expect(intent('Mets-moi une réserve sur R4')).toBe('UNKNOWN_WRITE')
  })
})

// ── COLLISIONS — les tests les plus importants ────────────────────────────────

describe('COLLISION : ADD_VISIT_ITEM vs CREATE_ACTION', () => {
  it('"Ajoute R4 au plan de visite" → ADD_VISIT_ITEM (next_visit domine)', () => {
    expect(intent('Ajoute R4 au plan de visite')).toBe('ADD_VISIT_ITEM')
  })
  it('"Ajoute une action pour préparer la prochaine visite" → CREATE_ACTION (action domine)', () => {
    expect(intent('Ajoute une action pour préparer la prochaine visite')).toBe('CREATE_ACTION')
  })
  it('"Crée une action pour planifier les essais béton" → CREATE_ACTION', () => {
    expect(intent('Crée une action pour planifier les essais béton')).toBe('CREATE_ACTION')
  })
  it('"Note une action de suivi pour la prochaine visite" → CREATE_ACTION (action explicite)', () => {
    expect(intent('Note une action de suivi pour la prochaine visite')).toBe('CREATE_ACTION')
  })
})

describe('COLLISION : SCHEDULE_VISIT vs ADD_VISIT_ITEM', () => {
  it('"Planifie une visite pour vérifier R4" → SCHEDULE_VISIT (pas ADD_VISIT_ITEM)', () => {
    expect(intent('Planifie une visite pour vérifier R4')).toBe('SCHEDULE_VISIT')
  })
  it('"Ajoute une visite mercredi à 9h" → SCHEDULE_VISIT (visite + datetime, pas next_visit)', () => {
    expect(intent('Ajoute une visite mercredi à 9h')).toBe('SCHEDULE_VISIT')
  })
  it('"Vérifier R4 lors de la prochaine visite" → ADD_VISIT_ITEM (next_visit présent)', () => {
    expect(intent('Vérifier R4 lors de la prochaine visite')).toBe('ADD_VISIT_ITEM')
  })
})

describe('COLLISION : READ vs WRITE (les plus critiques)', () => {
  it('"Où en est R4 ?" → READ (jamais WRITE)', () => {
    expect(intent('Où en est R4 ?')).toBe('READ')
    expect(confidence('Où en est R4 ?')).toBe('strong')
  })
  it('"Parle-moi de la prochaine visite" → READ (jamais ADD_VISIT_ITEM)', () => {
    expect(intent('Parle-moi de la prochaine visite')).toBe('READ')
  })
  it('"Quand est ma prochaine visite ?" → READ (jamais ADD_VISIT_ITEM)', () => {
    expect(intent('Quand est ma prochaine visite ?')).toBe('READ')
  })
  it('"Comment avance R4 ?" → READ', () => {
    expect(intent('Comment avance R4 ?')).toBe('READ')
  })
  it('"Dis-moi ce qu\'il y a prévu mercredi" → READ (pas SCHEDULE_VISIT)', () => {
    expect(intent("Dis-moi ce qu'il y a prévu mercredi")).toBe('READ')
  })
})

describe('COLLISION : SCHEDULE_VISIT vs CREATE_ACTION', () => {
  it('"Ajoute une réunion vendredi à 14h" → SCHEDULE_MEETING (pas CREATE_ACTION)', () => {
    expect(intent('Ajoute une réunion vendredi à 14h')).toBe('SCHEDULE_MEETING')
  })
  it('"Programme une réunion de synthèse" → SCHEDULE_MEETING (pas CREATE_ACTION)', () => {
    expect(intent('Programme une réunion de synthèse')).toBe('SCHEDULE_MEETING')
  })
})

// ── Normalisation ─────────────────────────────────────────────────────────────

describe('Tolérance de formulation', () => {
  it('casse : "PLANIFIE UNE VISITE MERCREDI" → SCHEDULE_VISIT', () => {
    expect(intent('PLANIFIE UNE VISITE MERCREDI')).toBe('SCHEDULE_VISIT')
  })
  it('tirets : "Planifies-moi une visite mercredi" → SCHEDULE_VISIT', () => {
    expect(intent('Planifies-moi une visite mercredi')).toBe('SCHEDULE_VISIT')
  })
  it('accents manquants : "planifies une reunion vendredi" → SCHEDULE_MEETING', () => {
    expect(intent('planifies une reunion vendredi')).toBe('SCHEDULE_MEETING')
  })
  it('ponctuation : "Ajoute, R4 au plan de visite." → ADD_VISIT_ITEM', () => {
    expect(intent('Ajoute, R4 au plan de visite.')).toBe('ADD_VISIT_ITEM')
  })
})

// ── Spéculation de contexte ───────────────────────────────────────────────────
// `readRemainsPlausible` ne décide d'AUCUNE branche métier : il autorise
// seulement le chargement anticipé du contexte chantier. Une réponse fausse ne
// peut donc coûter que des lectures inutiles.

describe('readRemainsPlausible — anticipation du contexte', () => {
  const plausible = (q: string) => readRemainsPlausible(detectIntent(q))

  it('anticipe sur la formulation qui perdait 1,7 s en production (audit 16/08)', () => {
    const q = 'Quels sont les points de la réunion de demain à évoquer ?'
    // Le routeur déterministe se trompe encore de branche…
    expect(intent(q)).toBe('SCHEDULE_MEETING')
    expect(confidence(q)).toBe('ambiguous')
    // …mais il n'est pas sûr, donc le contexte part quand même.
    expect(plausible(q)).toBe(true)
  })

  it('anticipe sur toute lecture', () => {
    expect(plausible('Où en est le chantier ?')).toBe(true)
    expect(plausible('Quels sujets stagnent ?')).toBe(true)
    expect(plausible('Que dois-je préparer pour ma prochaine visite ?')).toBe(true)
  })

  it('n’anticipe pas sur une écriture franche', () => {
    expect(plausible('Planifie une visite mercredi à 9h')).toBe(false)
    expect(plausible('Crée une action pour reprendre le SSI')).toBe(false)
    expect(plausible('Ajoute R4 au plan de visite')).toBe(false)
  })

  it('anticipe sur une écriture non résolue, jamais sur une écriture certaine', () => {
    // Une intention d'écriture ambiguë reste requalifiable en lecture par la
    // couche de compréhension : c'est exactement le cas à couvrir.
    const ambiguousWrites = ['Réunion vendredi', 'Une visite mercredi']
    for (const q of ambiguousWrites) {
      if (intent(q) !== 'READ') expect(confidence(q)).toBe('ambiguous')
      expect(plausible(q)).toBe(true)
    }
  })
})

// ── CORRECTION_IDENTITY (P4-B.2, Vincent 2026-08-17) ───────────────────────────

describe('CORRECTION_IDENTITY — 3 formes reconnues (spec Vincent)', () => {
  it('"Quand je dis Clim Expert, je parle de Clim Expair." → CORRECTION_IDENTITY strong', () => {
    expect(intent('Quand je dis Clim Expert, je parle de Clim Expair.')).toBe('CORRECTION_IDENTITY')
    expect(confidence('Quand je dis Clim Expert, je parle de Clim Expair.')).toBe('strong')
  })
  it('"Jérôme, c\'est Jérôme Martin de BECIB." → CORRECTION_IDENTITY strong', () => {
    expect(intent("Jérôme, c'est Jérôme Martin de BECIB.")).toBe('CORRECTION_IDENTITY')
  })
  it('"Non, Vincent Millon c\'est Vincent Milon." → CORRECTION_IDENTITY strong', () => {
    expect(intent("Non, Vincent Millon c'est Vincent Milon.")).toBe('CORRECTION_IDENTITY')
  })
})

describe('CORRECTION_IDENTITY — frontière RELATION_CLAIM (P4-B.3, jamais absorbée)', () => {
  it('"Clim Expair s\'occupe de la climatisation." → PAS CORRECTION_IDENTITY', () => {
    expect(intent("Clim Expair s'occupe de la climatisation.")).not.toBe('CORRECTION_IDENTITY')
  })
  it('"Jérôme travaille chez BECIB." → PAS CORRECTION_IDENTITY', () => {
    expect(intent('Jérôme travaille chez BECIB.')).not.toBe('CORRECTION_IDENTITY')
  })
  it('"Le SSI dépend de la mise sous tension." → PAS CORRECTION_IDENTITY', () => {
    expect(intent('Le SSI dépend de la mise sous tension.')).not.toBe('CORRECTION_IDENTITY')
  })
})

describe('CORRECTION_IDENTITY — formes 4 et 5 (Vincent, 2026-08-17)', () => {
  it('"On appelle aussi Clim Expair, Climatisation Expair." → CORRECTION_IDENTITY strong', () => {
    expect(intent('On appelle aussi Clim Expair, Climatisation Expair.')).toBe('CORRECTION_IDENTITY')
    expect(confidence('On appelle aussi Clim Expair, Climatisation Expair.')).toBe('strong')
  })
  it('"Clim Expair, c\'est Climatisation Expair." (forme nue) → CORRECTION_IDENTITY strong', () => {
    expect(intent("Clim Expair, c'est Climatisation Expair.")).toBe('CORRECTION_IDENTITY')
    expect(confidence("Clim Expair, c'est Climatisation Expair.")).toBe('strong')
  })
  it('heuristique nom propre : "Le plan, c\'est de refaire la dalle." → PAS CORRECTION_IDENTITY (2ᵉ mot en minuscule)', () => {
    expect(intent("Le plan, c'est de refaire la dalle.")).not.toBe('CORRECTION_IDENTITY')
  })
  it('heuristique nom propre : "Ce sujet, c\'est important." → PAS CORRECTION_IDENTITY', () => {
    expect(intent("Ce sujet, c'est important.")).not.toBe('CORRECTION_IDENTITY')
  })
})

describe('CORRECTION_IDENTITY — n\'affecte pas les autres intentions', () => {
  it('READ reste READ : "Où en est R4 ?"', () => {
    expect(intent('Où en est R4 ?')).toBe('READ')
  })
  it('OBSERVATION reste OBSERVATION : "Le cadenas n\'est toujours pas installé."', () => {
    expect(intent("Le cadenas n'est toujours pas installé.")).toBe('OBSERVATION')
  })
})

// ── FACT (P4-C, Vincent 2026-08-17) ────────────────────────────────────────────

describe('FACT — 8 phrases de l\'audit (spec Vincent)', () => {
  const cases = [
    'Jérôme passe demain matin.',
    'Le client veut conserver cette porte.',
    "Vincent Milon est l'interlocuteur principal sur ce dossier.",
    'La réunion de coordination est toujours le mardi.',
    "L'accès livraison se fait par l'arrière du bâtiment.",
    'Le code du portail est 4812.',
    "L'entreprise a prévu deux personnes pour la mise en service.",
    'Le chantier sera fermé vendredi après-midi.',
  ]
  for (const q of cases) {
    it(`"${q}" → FACT`, () => {
      expect(intent(q)).toBe('FACT')
      expect(confidence(q)).toBe('ambiguous')
    })
  }
})

describe('FACT — frontière OBSERVATION (jamais absorbée)', () => {
  it('"Le cadenas n\'est toujours pas installé." → OBSERVATION (pas FACT)', () => {
    expect(intent("Le cadenas n'est toujours pas installé.")).toBe('OBSERVATION')
  })
  it('"Le portail est maintenant réparé." → OBSERVATION (pas FACT)', () => {
    expect(intent('Le portail est maintenant réparé.')).toBe('OBSERVATION')
  })
  it('"Le cadenas sera installé vendredi" → FACT (futur, exclu d\'OBSERVATION)', () => {
    expect(intent('Le cadenas sera installé vendredi')).toBe('FACT')
  })
})

describe('FACT — frontière CREATE_ACTION (jamais absorbée)', () => {
  it('"Crée une action pour planifier les essais béton" → CREATE_ACTION (pas FACT)', () => {
    expect(intent('Crée une action pour planifier les essais béton')).toBe('CREATE_ACTION')
  })
  it('"Il faut rappeler Clim Expair" → CREATE_ACTION (pas FACT)', () => {
    expect(intent('Il faut rappeler Clim Expair')).toBe('CREATE_ACTION')
  })
})

describe('FACT — frontière SCHEDULE_MEETING (jamais absorbée)', () => {
  it('"Planifie une réunion vendredi à 14h" → SCHEDULE_MEETING (pas FACT)', () => {
    expect(intent('Planifie une réunion vendredi à 14h')).toBe('SCHEDULE_MEETING')
  })
  it('"Quels sont les points de la réunion de demain à évoquer ?" → SCHEDULE_MEETING (pas FACT, question)', () => {
    expect(intent('Quels sont les points de la réunion de demain à évoquer ?')).toBe('SCHEDULE_MEETING')
  })
})

describe('FACT — frontière CORRECTION_IDENTITY (jamais absorbée)', () => {
  it('"Jérôme, c\'est Jérôme Martin de BECIB." → CORRECTION_IDENTITY (pas FACT)', () => {
    expect(intent("Jérôme, c'est Jérôme Martin de BECIB.")).toBe('CORRECTION_IDENTITY')
  })
  it('"Quand je dis Clim Expert, je parle de Clim Expair." → CORRECTION_IDENTITY (pas FACT)', () => {
    expect(intent('Quand je dis Clim Expert, je parle de Clim Expair.')).toBe('CORRECTION_IDENTITY')
  })
})

describe('FACT — frontière RELATION_CLAIM (P4-D1, jamais absorbée par FACT)', () => {
  // "s'occupe de" / "travaille chez" restent hors périmètre RELATION_CLAIM
  // (acteur↔domaine / affiliation, cf. copilot-relation-claim.ts) et ne
  // déclenchent aucun signal FACT_ASSERTION_RE non plus : READ fallback.
  // "dépend de" déclenche désormais RELATION_CLAIM (Priorité 2ter), plus FACT
  // ni READ, depuis l'implémentation P4-D1.
  it('"Clim Expair s\'occupe de la climatisation." → READ fallback (pas FACT, pas RELATION_CLAIM)', () => {
    expect(intent("Clim Expair s'occupe de la climatisation.")).toBe('READ')
  })
  it('"Jérôme travaille chez BECIB." → READ fallback (pas FACT, pas RELATION_CLAIM)', () => {
    expect(intent('Jérôme travaille chez BECIB.')).toBe('READ')
  })
  it('"Le SSI dépend de la mise sous tension." → RELATION_CLAIM (pas FACT)', () => {
    expect(intent('Le SSI dépend de la mise sous tension.')).toBe('RELATION_CLAIM')
  })
})

describe('RELATION_CLAIM — cinq verbes reconnus (P4-D1)', () => {
  it('"Le SSI dépend de la mise sous tension." → RELATION_CLAIM (requires)', () => {
    expect(intent('Le SSI dépend de la mise sous tension.')).toBe('RELATION_CLAIM')
  })
  it('"La mise sous tension permet le SSI." → RELATION_CLAIM (enables)', () => {
    expect(intent('La mise sous tension permet le SSI.')).toBe('RELATION_CLAIM')
  })
  it('"Le rapport d\'essai valide la mise en service." → RELATION_CLAIM (validates)', () => {
    expect(intent("Le rapport d'essai valide la mise en service.")).toBe('RELATION_CLAIM')
  })
  it('"La fuite cause le retard du terrassement." → RELATION_CLAIM (causes)', () => {
    expect(intent('La fuite cause le retard du terrassement.')).toBe('RELATION_CLAIM')
  })
  it('"Le nouveau schéma remplace le schéma électrique." → RELATION_CLAIM (replaces)', () => {
    expect(intent('Le nouveau schéma remplace le schéma électrique.')).toBe('RELATION_CLAIM')
  })
})

describe('RELATION_CLAIM — frontière question/action/planification (jamais absorbée)', () => {
  it('"Est-ce que le SSI dépend de la mise sous tension ?" → pas RELATION_CLAIM (question)', () => {
    expect(intent('Est-ce que le SSI dépend de la mise sous tension ?')).not.toBe('RELATION_CLAIM')
  })
  it('"Planifie une réunion, la mise sous tension dépend du SSI." → SCHEDULE_MEETING (pas RELATION_CLAIM)', () => {
    expect(intent('Planifie une réunion, la mise sous tension dépend du SSI.')).toBe('SCHEDULE_MEETING')
  })
})

describe('FACT — vraie question READ inchangée', () => {
  it('"Où en est R4 ?" → READ (inchangé)', () => {
    expect(intent('Où en est R4 ?')).toBe('READ')
  })
  it('"Qui est l\'interlocuteur principal sur ce dossier ?" → pas FACT (question)', () => {
    expect(intent("Qui est l'interlocuteur principal sur ce dossier ?")).not.toBe('FACT')
  })
})

describe('FACT — n\'affecte pas les autres intentions', () => {
  it('CREATE_ACTION reste CREATE_ACTION : "Ajoute une action de suivi"', () => {
    expect(intent('Ajoute une action de suivi')).toBe('CREATE_ACTION')
  })
  it('OBSERVATION reste OBSERVATION : "Les gaines sont arrivées ce matin."', () => {
    expect(intent('Les gaines sont arrivées ce matin.')).toBe('OBSERVATION')
  })
  it('CORRECTION_IDENTITY reste CORRECTION_IDENTITY : "Non, Vincent Millon c\'est Vincent Milon."', () => {
    expect(intent("Non, Vincent Millon c'est Vincent Milon.")).toBe('CORRECTION_IDENTITY')
  })
})

// ── CREATE_WATCHPOINT (P4-E1, Vincent 2026-08-17) ────────────────────────────
// Vigilance durable SANS échéance et SANS ancrage sur la prochaine visite.

describe('CREATE_WATCHPOINT — exemples positifs (spec Vincent)', () => {
  it('"Surveille le SSI tant que ce n\'est pas réglé." → CREATE_WATCHPOINT', () => {
    expect(intent("Surveille le SSI tant que ce n'est pas réglé.")).toBe('CREATE_WATCHPOINT')
    expect(confidence("Surveille le SSI tant que ce n'est pas réglé.")).toBe('strong')
  })
  it('"Garde un œil sur la fissure du mur nord." → CREATE_WATCHPOINT', () => {
    expect(intent('Garde un œil sur la fissure du mur nord.')).toBe('CREATE_WATCHPOINT')
    expect(confidence('Garde un œil sur la fissure du mur nord.')).toBe('strong')
  })
  it('"Ça fait trois visites qu\'on parle du SSI, il faudrait le suivre." → CREATE_WATCHPOINT', () => {
    expect(intent("Ça fait trois visites qu'on parle du SSI, il faudrait le suivre.")).toBe('CREATE_WATCHPOINT')
    expect(confidence("Ça fait trois visites qu'on parle du SSI, il faudrait le suivre.")).toBe('strong')
  })
})

describe('CREATE_WATCHPOINT — non-régression (spec Vincent)', () => {
  it('"À ma prochaine visite, vérifie le SSI." → ADD_VISIT_ITEM (pas CREATE_WATCHPOINT)', () => {
    expect(intent('À ma prochaine visite, vérifie le SSI.')).toBe('ADD_VISIT_ITEM')
  })
  it('"Fais poser un cadenas sur le portail." → CREATE_ACTION (pas CREATE_WATCHPOINT)', () => {
    expect(intent('Fais poser un cadenas sur le portail.')).toBe('CREATE_ACTION')
  })
  it('"Appelle le fournisseur pour la fissure." → pas CREATE_WATCHPOINT (préexistant, hors verbes d\'écriture forts)', () => {
    expect(intent('Appelle le fournisseur pour la fissure.')).not.toBe('CREATE_WATCHPOINT')
  })
  it('"Demande au chef d\'équipe de vérifier le SSI." → pas CREATE_WATCHPOINT', () => {
    expect(intent("Demande au chef d'équipe de vérifier le SSI.")).not.toBe('CREATE_WATCHPOINT')
  })
})

// ── Frontière READ ↔ CREATE_WATCHPOINT (bug OCEF, Vincent 2026-08-18) ────────
// "Quels sont les sujets importants à surveiller ?" était routée deux fois de
// manière déterministe vers CREATE_WATCHPOINT/strong (proposition de créer un
// point de vigilance intitulé avec la question elle-même) alors qu'il s'agit
// d'une lecture. Cause : READ_RE n'a pas d'alternative "quels/quelles sont…",
// et la Priorité 1bis CREATE_WATCHPOINT ne vérifiait pas hasQuestionMark,
// contrairement à FACT/RELATION_CLAIM/CREATE_DEADLINE.
describe('Frontière READ ↔ CREATE_WATCHPOINT (spec Vincent 2026-08-18)', () => {
  it('"Quels sont les sujets importants à surveiller ?" → READ (pas CREATE_WATCHPOINT)', () => {
    expect(intent('Quels sont les sujets importants à surveiller ?')).toBe('READ')
  })
  it('"Qu\'est-ce que je dois surveiller ?" → READ', () => {
    expect(intent("Qu'est-ce que je dois surveiller ?")).toBe('READ')
  })
  it('"Quels points dois-je garder à l\'œil ?" → READ', () => {
    expect(intent("Quels points dois-je garder à l'œil ?")).toBe('READ')
  })
  it('"Surveille le SSI tant que ce n\'est pas réglé" → CREATE_WATCHPOINT (pas de "?", reste une commande)', () => {
    expect(intent("Surveille le SSI tant que ce n'est pas réglé")).toBe('CREATE_WATCHPOINT')
  })
  it('"Garde un œil sur le SSI" → CREATE_WATCHPOINT (pas de "?", reste une commande)', () => {
    expect(intent('Garde un œil sur le SSI')).toBe('CREATE_WATCHPOINT')
  })
  it('toute question avec "surveiller" reste READ, jamais CREATE_WATCHPOINT', () => {
    const questions = [
      'Quels sont les points à surveiller sur ce chantier ?',
      'Est-ce qu\'il y a des choses à surveiller ?',
      'Qu\'y a-t-il à surveiller cette semaine ?',
    ]
    for (const q of questions) {
      expect(intent(q)).not.toBe('CREATE_WATCHPOINT')
    }
  })
})

// ── Frontière READ ↔ OBSERVATION (recette OCEF, Vincent 2026-08-18) ─────────
// "Quelles sont les réserves encore ouvertes ?" était routée en OBSERVATION/
// ambiguous (résolution de sujet unique, échec) au lieu d'une lecture globale.
// Cause : la Priorité 4bis OBSERVATION était la seule branche create/read
// encore privée du garde !hasQuestionMark posé ailleurs le même jour.
describe('Frontière READ ↔ OBSERVATION (spec Vincent 2026-08-18)', () => {
  it('"Quelles sont les réserves encore ouvertes ?" → READ (pas OBSERVATION)', () => {
    expect(intent('Quelles sont les réserves encore ouvertes ?')).toBe('READ')
  })
  it('"Quelles observations sont encore ouvertes ?" → READ (pas OBSERVATION)', () => {
    expect(intent('Quelles observations sont encore ouvertes ?')).toBe('READ')
  })
  it('"Le regard R4 est encore ouvert." → OBSERVATION (pas de "?", reste un constat)', () => {
    expect(intent('Le regard R4 est encore ouvert.')).toBe('OBSERVATION')
  })
  it('"Le regard R4 est encore ouvert, crée une action." → CREATE_ACTION (verbe fort domine)', () => {
    expect(intent('Le regard R4 est encore ouvert, crée une action.')).toBe('CREATE_ACTION')
  })
})

describe('CREATE_WATCHPOINT — récurrence non gérée (tripwire P4-E4)', () => {
  // "à chaque visite" reste NON GÉRÉ pour P4-E1 : ni absorbé silencieusement
  // dans un simple watchpoint, ni traité comme ADD_VISIT_ITEM — remonte comme
  // clarification (UNKNOWN_WRITE), en attendant un futur objet de contrôle
  // récurrent (P4-E4, non conçu, non implémenté).
  it('"Pense à revérifier le SSI à chaque visite tant que ce n\'est pas réglé." → UNKNOWN_WRITE', () => {
    expect(intent("Pense à revérifier le SSI à chaque visite tant que ce n'est pas réglé.")).toBe('UNKNOWN_WRITE')
  })
  it('"Surveille le SSI à chaque visite." → UNKNOWN_WRITE (pas CREATE_WATCHPOINT silencieux)', () => {
    expect(intent('Surveille le SSI à chaque visite.')).toBe('UNKNOWN_WRITE')
  })
})

describe('CREATE_WATCHPOINT — n\'affecte pas les autres intentions', () => {
  it('ADD_VISIT_ITEM reste ADD_VISIT_ITEM : "Ajoute R4 au plan de visite"', () => {
    expect(intent('Ajoute R4 au plan de visite')).toBe('ADD_VISIT_ITEM')
  })
  it('CREATE_ACTION reste CREATE_ACTION : "Il faut rappeler Clim Expair"', () => {
    expect(intent('Il faut rappeler Clim Expair')).toBe('CREATE_ACTION')
  })
  it('FACT reste FACT : "Jérôme passe demain matin."', () => {
    expect(intent('Jérôme passe demain matin.')).toBe('FACT')
  })
})

// ── CREATE_DEADLINE (P4-E2, Vincent 2026-08-17) ──────────────────────────────
// Obligation sur un état attendu + contrainte temporelle explicite.

describe('CREATE_DEADLINE — exemples positifs (spec Vincent)', () => {
  it('"Le SSI doit être réglé avant vendredi." → CREATE_DEADLINE', () => {
    expect(intent('Le SSI doit être réglé avant vendredi.')).toBe('CREATE_DEADLINE')
    expect(confidence('Le SSI doit être réglé avant vendredi.')).toBe('strong')
  })
  it('"Le VISA doit arriver avant le 25 août." → CREATE_DEADLINE', () => {
    expect(intent('Le VISA doit arriver avant le 25 août.')).toBe('CREATE_DEADLINE')
    expect(confidence('Le VISA doit arriver avant le 25 août.')).toBe('strong')
  })
})

describe('CREATE_DEADLINE — non-régression (spec Vincent)', () => {
  it('"Fais régler le SSI vendredi." → CREATE_ACTION (pas CREATE_DEADLINE)', () => {
    expect(intent('Fais régler le SSI vendredi.')).toBe('CREATE_ACTION')
  })
  it('"Le chantier sera fermé vendredi." → FACT (pas CREATE_DEADLINE)', () => {
    expect(intent('Le chantier sera fermé vendredi.')).toBe('FACT')
  })
  it('"Réunion vendredi à 14h." → SCHEDULE_MEETING (pas CREATE_DEADLINE)', () => {
    expect(intent('Réunion vendredi à 14h.')).toBe('SCHEDULE_MEETING')
  })
  it('"Rappelle-moi vendredi de vérifier le SSI." → CREATE_ACTION (pas CREATE_DEADLINE)', () => {
    expect(intent('Rappelle-moi vendredi de vérifier le SSI.')).toBe('CREATE_ACTION')
  })
})

describe('CREATE_DEADLINE — n\'affecte pas les autres intentions', () => {
  it('ADD_VISIT_ITEM reste ADD_VISIT_ITEM : "Ajoute R4 au plan de visite"', () => {
    expect(intent('Ajoute R4 au plan de visite')).toBe('ADD_VISIT_ITEM')
  })
  it('CREATE_WATCHPOINT reste CREATE_WATCHPOINT : "Surveille le SSI tant que ce n\'est pas réglé."', () => {
    expect(intent("Surveille le SSI tant que ce n'est pas réglé.")).toBe('CREATE_WATCHPOINT')
  })
  it('FACT reste FACT : "Jérôme passe demain matin."', () => {
    expect(intent('Jérôme passe demain matin.')).toBe('FACT')
  })
})

// ── CREATE_RESERVE (P4-E3, Vincent 2026-08-17) ───────────────────────────────
// Intention explicite de créer une réserve. Formulations anaphoriques
// ("mets ça en réserve") restent hors V1 tant qu'il n'y a pas de résolution
// de contexte.

describe('CREATE_RESERVE — exemples positifs (spec Vincent)', () => {
  it('"Crée une réserve sur le portail cassé." → CREATE_RESERVE', () => {
    expect(intent('Crée une réserve sur le portail cassé.')).toBe('CREATE_RESERVE')
    expect(confidence('Crée une réserve sur le portail cassé.')).toBe('strong')
  })
  it('"Ajoute une réserve sur la fissure du mur." → CREATE_RESERVE', () => {
    expect(intent('Ajoute une réserve sur la fissure du mur.')).toBe('CREATE_RESERVE')
    expect(confidence('Ajoute une réserve sur la fissure du mur.')).toBe('strong')
  })
  it('"Mets une réserve sur le carrelage décollé." → CREATE_RESERVE', () => {
    expect(intent('Mets une réserve sur le carrelage décollé.')).toBe('CREATE_RESERVE')
  })
})

describe('CREATE_RESERVE — frontières du mandat (matrice Vincent)', () => {
  it('"Le portail est cassé." → pas CREATE_RESERVE (simple constat)', () => {
    expect(intent('Le portail est cassé.')).not.toBe('CREATE_RESERVE')
  })
  it('"Surveille le portail." → CREATE_WATCHPOINT (pas CREATE_RESERVE)', () => {
    expect(intent('Surveille le portail.')).toBe('CREATE_WATCHPOINT')
  })
  it('"Fais réparer le portail." → CREATE_ACTION (pas CREATE_RESERVE)', () => {
    expect(intent('Fais réparer le portail.')).toBe('CREATE_ACTION')
  })
  it('"Le portail doit être réparé avant vendredi." → CREATE_DEADLINE (pas CREATE_RESERVE)', () => {
    expect(intent('Le portail doit être réparé avant vendredi.')).toBe('CREATE_DEADLINE')
  })
  it('"Mets ça en réserve." → pas CREATE_RESERVE (anaphorique, hors V1)', () => {
    expect(intent('Mets ça en réserve.')).not.toBe('CREATE_RESERVE')
  })
})

describe('CREATE_RESERVE — n\'affecte pas les autres intentions', () => {
  it('ADD_VISIT_ITEM reste ADD_VISIT_ITEM : "Ajoute R4 au plan de visite"', () => {
    expect(intent('Ajoute R4 au plan de visite')).toBe('ADD_VISIT_ITEM')
  })
  it('CREATE_WATCHPOINT reste CREATE_WATCHPOINT : "Surveille le SSI tant que ce n\'est pas réglé."', () => {
    expect(intent("Surveille le SSI tant que ce n'est pas réglé.")).toBe('CREATE_WATCHPOINT')
  })
  it('CREATE_DEADLINE reste CREATE_DEADLINE : "Le SSI doit être réglé avant vendredi."', () => {
    expect(intent('Le SSI doit être réglé avant vendredi.')).toBe('CREATE_DEADLINE')
  })
  it('FACT reste FACT : "Jérôme passe demain matin."', () => {
    expect(intent('Jérôme passe demain matin.')).toBe('FACT')
  })
})

// ── CORRECTION_KNOWLEDGE (P5-F2b, Vincent 2026-08-17) ──────────────────────────
//
// Marqueur explicite de correction/obsolescence d'une information mémorisée
// (site_knowledge_entries, kind='current_information' uniquement). Une simple
// nouvelle affirmation sans marqueur reste FACT — aucune recherche de
// supersession n'est déclenchée par défaut (cadrage Vincent, pour ne pas
// dériver en détecteur de contradiction général).

describe('CORRECTION_KNOWLEDGE — 4 formes reconnues (spec Vincent)', () => {
  it('"Correction, Jérôme passe lundi." → CORRECTION_KNOWLEDGE', () => {
    expect(intent('Correction, Jérôme passe lundi.')).toBe('CORRECTION_KNOWLEDGE')
    expect(confidence('Correction, Jérôme passe lundi.')).toBe('strong')
  })
  it('"Finalement Jérôme ne vient plus demain." → CORRECTION_KNOWLEDGE', () => {
    expect(intent('Finalement Jérôme ne vient plus demain.')).toBe('CORRECTION_KNOWLEDGE')
    expect(confidence('Finalement Jérôme ne vient plus demain.')).toBe('strong')
  })
  it('"Ce n\'est plus 4812, c\'est 5830." → CORRECTION_KNOWLEDGE', () => {
    expect(intent("Ce n'est plus 4812, c'est 5830.")).toBe('CORRECTION_KNOWLEDGE')
    expect(confidence("Ce n'est plus 4812, c'est 5830.")).toBe('strong')
  })
  it('"Cette information n\'est plus valable." → CORRECTION_KNOWLEDGE', () => {
    expect(intent("Cette information n'est plus valable.")).toBe('CORRECTION_KNOWLEDGE')
    expect(confidence("Cette information n'est plus valable.")).toBe('strong')
  })
})

describe('CORRECTION_KNOWLEDGE — frontière FACT (jamais absorbée par défaut)', () => {
  it('"Jérôme passe lundi." → reste FACT, aucun marqueur de correction', () => {
    expect(intent('Jérôme passe lundi.')).toBe('FACT')
    expect(intent('Jérôme passe lundi.')).not.toBe('CORRECTION_KNOWLEDGE')
  })
  it('"Le code d\'accès est 5830." → reste FACT, simple affirmation', () => {
    expect(intent("Le code d'accès est 5830.")).toBe('FACT')
    expect(intent("Le code d'accès est 5830.")).not.toBe('CORRECTION_KNOWLEDGE')
  })
})

describe('CORRECTION_KNOWLEDGE — n\'affecte pas les autres intentions', () => {
  it('FACT reste FACT : "Jérôme passe demain matin."', () => {
    expect(intent('Jérôme passe demain matin.')).toBe('FACT')
  })
  it('CORRECTION_IDENTITY reste CORRECTION_IDENTITY : "Non, Vincent Millon c\'est Vincent Milon."', () => {
    expect(intent("Non, Vincent Millon c'est Vincent Milon.")).toBe('CORRECTION_IDENTITY')
  })
  it('CREATE_RESERVE reste CREATE_RESERVE : "Crée une réserve sur le portail cassé."', () => {
    expect(intent('Crée une réserve sur le portail cassé.')).toBe('CREATE_RESERVE')
  })
})

// ── Audit de robustesse du routeur (Vincent 2026-08-18) ──────────────────────
// Chasse systématique de l'asymétrie « verbe fort d'écriture + question »
// repérée sur CREATE_WATCHPOINT (bug OCEF, d35e50ad) : même trou vérifié et
// corrigé sur ADD_VISIT_ITEM, SCHEDULE_VISIT, CREATE_RESERVE, SCHEDULE_MEETING
// (confiance), CREATE_ACTION, CORRECTION_IDENTITY, CORRECTION_KNOWLEDGE.
// Une seule table factorisée : question → intent attendu → confiance attendue.

describe('Frontière interrogative ↔ écriture (audit de robustesse, corrections)', () => {
  const cases: [string, string, string][] = [
    ['Est-ce que je dois créer une action pour R4 ?', 'UNKNOWN_WRITE', 'ambiguous'],
    ['Quelle action dois-je créer pour R4 ?', 'UNKNOWN_WRITE', 'ambiguous'],
    ["Qui doit créer l'action de suivi ?", 'UNKNOWN_WRITE', 'ambiguous'],
    ["Est-ce qu'il faut ajouter R4 à ma prochaine visite ?", 'UNKNOWN_WRITE', 'ambiguous'],
    ['Quels points dois-je ajouter à ma prochaine visite ?', 'UNKNOWN_WRITE', 'ambiguous'],
    ["Est-ce qu'il faut planifier une visite mercredi ?", 'UNKNOWN_WRITE', 'ambiguous'],
    ["Est-ce qu'il faut planifier une réunion vendredi ?", 'SCHEDULE_MEETING', 'ambiguous'],
  ]
  for (const [q, expectedIntent, expectedConfidence] of cases) {
    it(`"${q}" → ${expectedIntent}/${expectedConfidence}`, () => {
      expect(intent(q)).toBe(expectedIntent)
      expect(confidence(q)).toBe(expectedConfidence)
    })
  }
})

describe('Frontière interrogative ↔ écriture (audit de robustesse, intent seul)', () => {
  const cases: [string, string][] = [
    ['Est-ce que je dois créer une réserve sur le portail cassé ?', 'UNKNOWN_WRITE'],
    ["Jérôme, c'est bien Jérôme Martin de BECIB ?", 'READ'],
    ['Tu peux surveiller le SSI ?', 'READ'],
  ]
  for (const [q, expectedIntent] of cases) {
    it(`"${q}" → ${expectedIntent}`, () => {
      expect(intent(q)).toBe(expectedIntent)
    })
  }
})

describe('Frontière interrogative ↔ écriture (audit de robustesse, non-régression)', () => {
  // La question ne doit jamais déclencher l'intention d'écriture correspondante.
  const cases: [string, string][] = [
    ['Est-ce que le SSI doit être réglé avant vendredi ?', 'CREATE_DEADLINE'],
    ['Est-ce que Jérôme ne vient plus demain ?', 'CORRECTION_KNOWLEDGE'],
  ]
  for (const [q, forbidden] of cases) {
    it(`"${q}" → pas ${forbidden}`, () => {
      expect(intent(q)).not.toBe(forbidden)
    })
  }
})

// Formes non interrogatives jamais testées pour CREATE_WATCHPOINT : déclarative,
// condition, futur/suggestion. Comportement jugé raisonnable par lecture du
// code (sémantique proche de l'impératif) mais non validé sur du vrai terrain
// — à confirmer ou corriger si le terrain contredit ces trois cas.
describe('CREATE_WATCHPOINT — formes non testées, assumées (audit de robustesse)', () => {
  const cases: [string, string, string][] = [
    ['Le SSI est à surveiller.', 'CREATE_WATCHPOINT', 'strong'],
    ['Si le SSI reste ouvert, surveille-le.', 'CREATE_WATCHPOINT', 'strong'],
    ['Il faudra surveiller le SSI.', 'CREATE_WATCHPOINT', 'strong'],
  ]
  for (const [q, expectedIntent, expectedConfidence] of cases) {
    it(`"${q}" → ${expectedIntent}/${expectedConfidence} (assumé)`, () => {
      expect(intent(q)).toBe(expectedIntent)
      expect(confidence(q)).toBe(expectedConfidence)
    })
  }
})

// ── NEGATION_SCOPE (spec Vincent 2026-08-18) ─────────────────────────────────
// Découvert en recette terrain OCEF : « Je surveille pas le regard aircon »
// (français oral spontané, sans "ne") produisait une vigilance POSITIVE — la
// négation ne protégeait aucune des 7 branches d'écriture du routeur.
//
// Portée bornée : adjacence stricte entre un verbe d'écriture et le token
// "pas", dans la CLAUSE (segment séparé par virgule/point-virgule dans le
// texte ORIGINAL). Jamais un filtre global sur le mot "pas" — une négation
// descriptive dans le contenu (« Le SSI n'est pas réglé ») ne doit neutraliser
// aucune action légitime portée par une autre clause.
const WRITER_INTENTS = [
  'CREATE_ACTION', 'ADD_VISIT_ITEM', 'SCHEDULE_VISIT', 'SCHEDULE_MEETING',
  'CREATE_WATCHPOINT', 'CREATE_DEADLINE', 'CREATE_RESERVE',
]

describe('NEGATION_SCOPE — négation du verbe d\'écriture → jamais un writer', () => {
  // La négation porte sur le verbe d'écriture/intention lui-même (avec ou sans
  // "ne" — l'oral spontané l'omet systématiquement) : aucune proposition
  // positive ne doit être créée. Cible précise établie par lecture du code
  // (READ quand aucun autre signal ne subsiste, UNKNOWN_WRITE quand un verbe
  // fort résiduel existe) — l'invariant qui compte pour Vincent est "jamais un
  // writer", vérifié séparément ci-dessous en plus de la cible exacte.
  const cases: [string, string][] = [
    ['Ne surveille pas le SSI', 'READ'],
    ['Je surveille pas le SSI', 'READ'],
    ['Surveille pas le SSI', 'READ'],
    ['Ne planifie pas de réunion vendredi', 'UNKNOWN_WRITE'],
    ['Planifie pas de réunion vendredi', 'UNKNOWN_WRITE'],
    ["Il ne faut pas créer d'action", 'UNKNOWN_WRITE'],
    ["Faut pas créer d'action", 'UNKNOWN_WRITE'],
    ["Je veux pas créer d'action", 'UNKNOWN_WRITE'],
  ]
  for (const [q, expectedIntent] of cases) {
    it(`"${q}" → ${expectedIntent} (jamais un writer)`, () => {
      expect(intent(q)).toBe(expectedIntent)
      expect(WRITER_INTENTS).not.toContain(intent(q))
    })
  }
})

describe('NEGATION_SCOPE — négation descriptive ne neutralise jamais une action légitime', () => {
  it('"Le SSI n\'est pas réglé" → FACT (négation descriptive, aucun verbe d\'écriture adjacent à "pas")', () => {
    expect(intent("Le SSI n'est pas réglé")).toBe('FACT')
  })
  it('"Crée une action pour que le SSI ne reste pas ouvert" → CREATE_ACTION ("reste"/"ouvert" ne sont pas des verbes d\'écriture)', () => {
    expect(intent('Crée une action pour que le SSI ne reste pas ouvert')).toBe('CREATE_ACTION')
  })
  it('"Le SSI n\'est pas réglé, crée une action." → CREATE_ACTION (clause négative ≠ clause positive, jamais fusionnées)', () => {
    expect(intent("Le SSI n'est pas réglé, crée une action.")).toBe('CREATE_ACTION')
  })
})

// ── NEGATION_SCOPE — extension bornée jamais/rien/plus structurés
// (bloqueur n°2 de l'audit causal P6-A2, 2026-08-18) ─────────────────────────
// clauseHasNegatedWriteVerb() ne reconnaissait que le token isolé "pas",
// jamais "jamais"/"rien"/"plus" : « Enfin, ne fait rien plus demain. »,
// « Ne planifie jamais de réunion vendredi. », « Ne crée rien pour demain. »
// et « Ne programme plus de visite vendredi. » produisaient un writer positif
// malgré une négation explicite et non ambiguë. Correctif borné mandaté par
// Vincent : reconnaître des PATRONS structurés (ne/n' ... {jamais|rien|plus},
// ou forme orale équivalente déjà admise pour "pas") autour du verbe
// d'écriture — jamais un mot isolé. "plus" reste ambigu ("plus tard", "plus
// importante") et ne doit JAMAIS déclencher de négation sans marqueur "ne"/
// "n'" (ou équivalent oral) structurellement associé au verbe d'écriture.
describe('NEGATION_SCOPE — jamais/rien/plus structurés → jamais un writer (bloqueur n°2)', () => {
  const cases: [string, string][] = [
    ['vert. Enfin, ne fait rien plus demain.', 'CREATE_ACTION'],
    ['Le garage R4 est toujours ouvert. Enfin, ne fait rien plus demain.', 'CREATE_ACTION'],
    ['Ne planifie jamais de réunion vendredi.', 'SCHEDULE_MEETING'],
    ['Ne crée rien pour demain.', 'CREATE_ACTION'],
    ['Ne programme plus de visite vendredi.', 'SCHEDULE_VISIT'],
  ]
  for (const [q, forbidden] of cases) {
    it(`"${q}" → jamais ${forbidden} (aucun writer)`, () => {
      expect(intent(q)).not.toBe(forbidden)
      expect(WRITER_INTENTS).not.toContain(intent(q))
    })
  }
})

describe('NEGATION_SCOPE — "plus" ne neutralise jamais sans marqueur "ne" structuré', () => {
  const cases: [string, string][] = [
    ['Programme une réunion plus tard.', 'SCHEDULE_MEETING'],
    ['Crée une action plus importante.', 'CREATE_ACTION'],
    ["Le SSI n'est plus réglé, crée une action.", 'CREATE_ACTION'],
    ['Crée une action pour que le SSI ne reste jamais ouvert.', 'CREATE_ACTION'],
  ]
  for (const [q, expectedIntent] of cases) {
    it(`"${q}" → reste ${expectedIntent} (écriture autorisée)`, () => {
      expect(intent(q)).toBe(expectedIntent)
    })
  }
})

// ── NEGATION_SCOPE — contrat neutralizedWrite pour copilot-free-answer.ts
// (fix mutation-claim, Vincent 2026-08-18) ───────────────────────────────────
// copilot-free-prepare.ts calcule `neutralizedWrite = intentResult.signals
// .includes('negated_write_verb')` — le signal EXACT vérifié ici, pas
// seulement l'intent final. Un cas par famille d'écriture neutralisable,
// couvrant les 7 familles listées par Vincent dans le mandat de correction.
// CREATE_RESERVE, CREATE_DEADLINE et ADD_VISIT_ITEM n'avaient jusqu'ici aucun
// cas NEGATION_SCOPE dédié (seuls action/réunion/visite/watchpoint l'étaient) ;
// probé lecture seule via detectIntent avant d'écrire ces cas — la détection
// est déjà générique par verbe (WRITE_TRIGGER_VERB_RE), aucune modification du
// routeur n'a été nécessaire.
describe('NEGATION_SCOPE — signal negated_write_verb couvre les 7 familles', () => {
  const cases: [string, string][] = [
    ['Ne crée rien pour demain.', 'action'],
    ['Ne crée pas de réserve sur le portail cassé.', 'réserve'],
    ['Ne programme plus de visite vendredi.', 'visite'],
    ['Ne planifie jamais de réunion vendredi.', 'réunion'],
    ['Le SSI ne doit pas être réglé avant vendredi.', 'échéance'],
    ["N'ajoute pas R4 au plan de visite.", 'point de visite'],
    ['Ne surveille pas le SSI', 'watchpoint'],
  ]
  for (const [q, famille] of cases) {
    it(`"${q}" → signal negated_write_verb (famille: ${famille})`, () => {
      expect(signals(q)).toContain('negated_write_verb')
    })
  }
})

// ── NEGATION_SCOPE — correctif générique 2026-08-19 (Vincent) ───────────────
// Audit causal du 18/08 : deux phrases terrain réelles produisaient une
// proposition d'écriture POSITIVE malgré une négation explicite.
//   1. « ne fait aucune action » — "aucun/aucune" était absent de
//      NEGATION_PARTICLES_UNAMBIGUOUS : aucune particule de la phrase
//      n'était reconnue, la négation entière échappait à la détection.
//   2. « ne garde pas ce point sous surveillance » — WRITE_TRIGGER_VERB_RE
//      était une liste manuelle qui avait dérivé de WEAK_WRITE_RE (le verbe
//      "garde" n'y figurait pas).
// Correctif : WRITE_TRIGGER_VERB_RE est désormais construit PAR CONSTRUCTION
// (union des .source des 6 familles), pas une liste recopiée à la main.
describe('NEGATION_SCOPE — cas terrain 2026-08-19 (aucun/aucune, garde)', () => {
  it('"Le regard R4 n\'est toujours pas réglé, ne fait aucune action pour demain." → jamais CREATE_ACTION', () => {
    const q = "Le regard R4 n'est toujours pas réglé, ne fait aucune action pour demain."
    expect(intent(q)).not.toBe('CREATE_ACTION')
    expect(WRITER_INTENTS).not.toContain(intent(q))
    expect(signals(q)).toContain('negated_write_verb')
  })

  it('"Le regard R4 est toujours ouvert et ne garde pas ce point sous surveillance." → jamais CREATE_WATCHPOINT', () => {
    const q = 'Le regard R4 est toujours ouvert et ne garde pas ce point sous surveillance.'
    expect(intent(q)).not.toBe('CREATE_WATCHPOINT')
    expect(WRITER_INTENTS).not.toContain(intent(q))
    expect(signals(q)).toContain('negated_write_verb')
  })
})

// ── NEGATION_SCOPE — matrice WEAK_WRITE_RE × particules (Vincent 2026-08-19) ─
// Avant ce correctif, WRITE_TRIGGER_VERB_RE excluait ENTIÈREMENT la famille
// WEAK_WRITE_RE (aucune de ses tiges — "garde", "faudrait", "pense à",
// "conserve", "vérifie", "checker/contrôle" — ne pouvait jamais être détectée
// comme négatée). "pense à" et "contrôle" exigent en négation orale une
// tolérance dédiée (la particule s'insère entre le verbe et son complément :
// « ne pense PAS à ça », « ne contrôle PAS le SSI ») — cf. commentaire
// WRITE_TRIGGER_NEGATION_ONLY_RE dans le routeur.
describe('NEGATION_SCOPE — matrice verbes WEAK_WRITE_RE × particules négatives', () => {
  const verbs: [string, string][] = [
    ['vérifie', 'le SSI'],
    ['contrôle', 'le SSI'],
    ['garde', 'ce point'],
    ['conserve', 'ce document'],
    ['pense', 'à ça'],
    ['faudrait', 'le faire'],
  ]
  const particles: [string, (verb: string, obj: string) => string][] = [
    ['pas', (v, o) => `Je ne ${v} pas ${o}.`],
    ['jamais', (v, o) => `Je ne ${v} jamais ${o}.`],
    ['rien', (v, o) => `Je ne ${v} rien ${o !== '' ? 'pour ' + o : ''}.`],
    ['aucun/aucune', (v, o) => `Je n'y ${v} aucune attention pour ${o}.`],
  ]

  for (const [verb, obj] of verbs) {
    for (const [particleLabel, build] of particles) {
      // "rien"/"aucune" collés à un verbe transitif ne produisent pas toujours
      // une phrase naturelle — seul le patron "ne V pas/jamais O" est garanti
      // grammatical pour tous les verbes de la matrice ; les deux autres
      // patrons sont couverts séparément ci-dessous avec des tournures dédiées.
      if (particleLabel === 'rien' || particleLabel === 'aucun/aucune') continue
      const q = build(verb, obj)
      it(`"${q}" → signal negated_write_verb (verbe: ${verb}, particule: ${particleLabel})`, () => {
        expect(signals(q)).toContain('negated_write_verb')
        expect(WRITER_INTENTS).not.toContain(intent(q))
      })
    }
  }

  it('"Je ne garde rien sous surveillance." → signal negated_write_verb (particule: rien)', () => {
    const q = 'Je ne garde rien sous surveillance.'
    expect(signals(q)).toContain('negated_write_verb')
  })
  it('"Je ne fais aucune vérification aujourd\'hui." → signal negated_write_verb (particule: aucune)', () => {
    const q = "Je ne fais aucune vérification aujourd'hui."
    expect(signals(q)).toContain('negated_write_verb')
  })
  it('"Je ne fais plus de contrôle sur ce point." → signal negated_write_verb (particule: plus + marqueur ne)', () => {
    const q = 'Je ne fais plus de contrôle sur ce point.'
    expect(signals(q)).toContain('negated_write_verb')
  })
})

describe('NEGATION_SCOPE — témoins positifs (aucune régression)', () => {
  const cases: [string, string][] = [
    ['Vérifie le regard R4', 'UNKNOWN_WRITE'],
    ['Garde le regard R4 sous surveillance', 'CREATE_WATCHPOINT'],
    ['Programme une visite vendredi', 'SCHEDULE_VISIT'],
    ['Crée une action', 'CREATE_ACTION'],
  ]
  for (const [q, expectedIntent] of cases) {
    it(`"${q}" → reste ${expectedIntent} (écriture positive intacte)`, () => {
      expect(intent(q)).toBe(expectedIntent)
      expect(signals(q)).not.toContain('negated_write_verb')
    })
  }
})

// ── negated_assertion_claim (Vincent 2026-08-19) ─────────────────────────────
//
// Bug terrain tour [4] : « Ne considère pas que le regard R4 est réglé. » —
// FACT/ambiguous, aucun signal de négation (negated_write_verb ne peut pas
// s'appliquer : "considère" n'est pas un verbe d'écriture) → la compréhension
// LLM voit POSSIBLE_WRITE/create_action → mergeComprehension rule 2 refine en
// CREATE_ACTION/ambiguous → proposition d'action fabriquée sur un simple rejet
// d'assertion. Catégorie sémantique distincte de negated_write_verb (négation
// d'un ACTE D'ÉCRITURE) et d'un constat métier négatif valide (aucun signal).
//
// Détection STRUCTURELLE : [je/on, ou sujet ellipsé en tête de clause] +
// [ne] + verbe d'attitude propositionnelle (considère/pense/crois/estime) +
// pas/jamais + ... que + proposition. Jamais un patch lexical sur "considère"
// seul.
describe('negated_assertion_claim — rejet d\'une assertion rapportée (tour terrain [4])', () => {
  it('"Ne considère pas que R4 est réglé" → FACT + negated_assertion_claim, jamais CREATE_ACTION', () => {
    const q = 'Ne considère pas que le regard R4 est réglé.'
    expect(intent(q)).toBe('FACT')
    expect(signals(q)).toContain('negated_assertion_claim')
  })

  it('"Je considère pas que R4 est réglé" (sans "ne") → idem', () => {
    const q = 'Je considère pas que le regard R4 est réglé.'
    expect(intent(q)).toBe('FACT')
    expect(signals(q)).toContain('negated_assertion_claim')
  })

  it('"Je ne pense pas que R4 soit réglé" → negated_assertion_claim', () => {
    const q = 'Je ne pense pas que le regard R4 soit réglé.'
    expect(signals(q)).toContain('negated_assertion_claim')
  })

  it('"Je ne crois pas que R4 soit fermé" → negated_assertion_claim', () => {
    const q = 'Je ne crois pas que le regard R4 soit fermé.'
    expect(signals(q)).toContain('negated_assertion_claim')
  })

  it('"Je n\'estime pas que ce point soit résolu" → negated_assertion_claim', () => {
    const q = "Je n'estime pas que ce point soit résolu."
    expect(signals(q)).toContain('negated_assertion_claim')
  })

  it('"R4 n\'est pas réglé" (constat métier négatif valide) → aucun signal de négation', () => {
    const q = "R4 n'est pas réglé."
    expect(signals(q)).not.toContain('negated_assertion_claim')
    expect(signals(q)).not.toContain('negated_write_verb')
  })

  it('"Je pense que R4 n\'est pas réglé" (négation dans la complétive, pas sur le verbe d\'attitude) → pas de negated_assertion_claim', () => {
    const q = "Je pense que le regard R4 n'est pas réglé."
    expect(signals(q)).not.toContain('negated_assertion_claim')
  })

  it('"Paul ne pense pas que R4 est réglé" (sujet tiers explicite) → pas de negated_assertion_claim', () => {
    const q = 'Paul ne pense pas que le regard R4 est réglé.'
    expect(signals(q)).not.toContain('negated_assertion_claim')
  })

  it('"Ne crée pas d\'action pour R4" → garde negated_write_verb existante inchangée', () => {
    const q = "Ne crée pas d'action pour le regard R4."
    expect(signals(q)).toContain('negated_write_verb')
    expect(signals(q)).not.toContain('negated_assertion_claim')
  })

  it('"Je ne pense pas créer une action demain" (rejet d\'une intention, pas d\'une assertion : pas de "que") → pas de negated_assertion_claim, déjà bloqué par negated_write_verb', () => {
    const q = 'Je ne pense pas créer une action demain.'
    expect(signals(q)).not.toContain('negated_assertion_claim')
    expect(signals(q)).toContain('negated_write_verb')
  })
})

describe('hasWriteBlockingSemanticSignal — propriété centrale sticky', () => {
  it('regroupe negated_write_verb et negated_assertion_claim', async () => {
    const { hasWriteBlockingSemanticSignal } = await import('@/lib/visits/copilot-intent-router')
    expect(hasWriteBlockingSemanticSignal(['negated_write_verb'])).toBe(true)
    expect(hasWriteBlockingSemanticSignal(['negated_assertion_claim'])).toBe(true)
    expect(hasWriteBlockingSemanticSignal(['fact_assertion'])).toBe(false)
    expect(hasWriteBlockingSemanticSignal([])).toBe(false)
  })
})
