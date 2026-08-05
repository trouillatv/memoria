// Tests du routeur d'intention V2 — couverture complète avec cas de collision.
// Matrice issue de la spec Intent Router V2 (2026-08-05).
//
// Principe : un faux positif d'écriture est plus grave qu'une commande non reconnue.
// Les tests READ sont donc les plus critiques.

import { describe, it, expect } from 'vitest'
import { detectIntent } from '@/lib/visits/copilot-intent-router'

const intent = (q: string) => detectIntent(q).intent
const confidence = (q: string) => detectIntent(q).confidence

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
