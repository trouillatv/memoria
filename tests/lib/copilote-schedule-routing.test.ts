// Tests de non-régression pour le routage schedule_visit / schedule_meeting
// et le parsing de dates en langage naturel français.
//
// Matrice issue de la recette Point 6 (2026-08-05).

import { describe, it, expect } from 'vitest'
import { classifyIntent } from '@/lib/visits/copilot-classify'
import { detectKind } from '@/lib/visits/copilot-proposal'
import { parseScheduleFromQuestion, parseTime } from '@/lib/visits/copilot-schedule-parse'

// ── Détection schedule ─────────────────────────────────────────────────────────

describe('detectKind — schedule_visit', () => {
  const cases = [
    'Planifie une visite le 12 août à 9h',
    'planifies une visite le 12 aout a 9h',
    'Planifier une visite le 12 août à 09h30',
    'Programme une visite mercredi à 9 heures',
    'Organise une visite le 15 août à 14h',
    'Prévois une visite demain à 10h',
    'planifies une visite le 13 aout a 9 heures',
    'Planifie une visite le 12 août à 9h pour contrôler R4',
  ]
  for (const q of cases) {
    it(`"${q.slice(0, 55)}" → schedule_visit`, () => {
      expect(detectKind(q)).toBe('schedule_visit')
    })
  }
})

describe('detectKind — schedule_meeting', () => {
  const cases = [
    'Planifie une réunion dimanche à 14h',
    'planifies une réunion dimanche à 14 heures',
    'Planifier une réunion le 13 août à 14h',
    'Programme une réunion de chantier lundi à 9h',
    'Organise une réunion jeudi à 10h',
  ]
  for (const q of cases) {
    it(`"${q.slice(0, 55)}" → schedule_meeting`, () => {
      expect(detectKind(q)).toBe('schedule_meeting')
    })
  }
})

describe('detectKind — visit_item (non affecté)', () => {
  const cases = [
    'Ajoute R4 au plan de visite',
    'Préparer la prochaine visite',
    'Mets en plan R4',
    'Vérifie G3 lors de la prochaine visite',
  ]
  for (const q of cases) {
    it(`"${q}" → visit_item`, () => {
      expect(detectKind(q)).toBe('visit_item')
    })
  }
})

describe('detectKind — action (non affecté)', () => {
  const cases = [
    'Crée une action pour vérifier R4',
    'Ajoute une action de suivi',
    'Note un problème sur G3',
  ]
  for (const q of cases) {
    it(`"${q}" → action`, () => {
      expect(detectKind(q)).toBe('action')
    })
  }
})

// ── isWriteRequest (classifyIntent) ───────────────────────────────────────────

describe('classifyIntent — isWriteRequest pour schedule', () => {
  const cases = [
    'Planifie une visite le 12 août à 9h',
    'planifies une visite le 12 aout a 9h',      // conjugaison avec s
    'planifies une réunion dimanche à 14 heures', // conjugaison avec s
    'Programme une visite mercredi à 9 heures',
    'Organise une réunion jeudi à 10h',
  ]
  for (const q of cases) {
    it(`"${q.slice(0, 55)}" → isWriteRequest=true`, () => {
      expect(classifyIntent(q).isWriteRequest).toBe(true)
    })
  }
})

// ── extractSubjectLabels — 9H ne doit pas être extrait ────────────────────────

describe('classifyIntent — 9H exclue des subjectLabels', () => {
  const timePhrases = [
    'planifies une visite le 12 aout a 9h',
    'Planifie une visite le 12 août à 9H',
    'Planifie une visite le 12 août à 09h30',
    'Planifie une réunion à 14h00',
    'visite le 12 à 09:30',
  ]
  for (const q of timePhrases) {
    it(`"${q.slice(0, 55)}" → subjectLabels ne contient aucun pattern horaire`, () => {
      const { entities } = classifyIntent(q)
      const hasTimeCode = entities.subjectLabels.some((l) => /^\d{1,2}[hH]\d*$/.test(l))
      expect(hasTimeCode).toBe(false)
    })
  }
})

describe('classifyIntent — codes réels toujours extraits', () => {
  it('"Où en est R4 ?" → subjectLabels contient R4', () => {
    expect(classifyIntent('Où en est R4 ?').entities.subjectLabels).toContain('R4')
  })
  it('"Où en est G3 ?" → subjectLabels contient G3', () => {
    expect(classifyIntent('Où en est G3 ?').entities.subjectLabels).toContain('G3')
  })
  it('"Planifie une visite le 12 août à 9h pour contrôler R4" → R4 extrait, 9H absent', () => {
    const { entities } = classifyIntent('Planifie une visite le 12 août à 9h pour contrôler R4')
    expect(entities.subjectLabels).toContain('R4')
    expect(entities.subjectLabels).not.toContain('9H')
  })
})

// ── Parsing de dates ──────────────────────────────────────────────────────────

describe('parseScheduleFromQuestion — dates valides', () => {
  const TODAY = '2026-08-05' // mercredi

  it('12 août → 2026-08-12', () => {
    expect(parseScheduleFromQuestion('Planifie une visite le 12 août à 9h', TODAY)?.date).toBe('2026-08-12')
  })
  it('12 aout (sans accent) → 2026-08-12', () => {
    expect(parseScheduleFromQuestion('planifies une visite le 12 aout a 9h', TODAY)?.date).toBe('2026-08-12')
  })
  it('demain → 2026-08-06', () => {
    expect(parseScheduleFromQuestion('Planifie une visite demain à 8h', TODAY)?.date).toBe('2026-08-06')
  })
  it('mercredi prochain → 2026-08-12 (même jour = semaine suivante)', () => {
    expect(parseScheduleFromQuestion('Programme une visite mercredi à 9 heures', TODAY)?.date).toBe('2026-08-12')
  })
  it('dimanche → 2026-08-09', () => {
    expect(parseScheduleFromQuestion('Planifie une réunion dimanche à 14h', TODAY)?.date).toBe('2026-08-09')
  })
  it('vendredi → 2026-08-07', () => {
    expect(parseScheduleFromQuestion('Planifie une visite vendredi à 9h', TODAY)?.date).toBe('2026-08-07')
  })
  it('13 août 2026 → 2026-08-13', () => {
    expect(parseScheduleFromQuestion('Planifie une réunion le 13 août 2026 à 14h', TODAY)?.date).toBe('2026-08-13')
  })
})

describe('parseScheduleFromQuestion — dates passées rejetées', () => {
  const TODAY = '2026-08-05'

  it('2 août (passé) → null', () => {
    expect(parseScheduleFromQuestion('Planifie une visite le 2 août à 9h', TODAY)).toBeNull()
  })
  it('hier → null', () => {
    // hier = 2026-08-04 < today
    expect(parseScheduleFromQuestion('Planifie une visite hier à 9h', TODAY)).toBeNull()
  })
})

describe('parseScheduleFromQuestion — heure', () => {
  const TODAY = '2026-08-05'

  it('à 9h → 09:00', () => {
    expect(parseScheduleFromQuestion('visite le 12 août à 9h', TODAY)?.time).toBe('09:00')
  })
  it('à 09h30 → 09:30', () => {
    expect(parseScheduleFromQuestion('visite le 12 août à 09h30', TODAY)?.time).toBe('09:30')
  })
  it('à 14:00 → 14:00', () => {
    expect(parseScheduleFromQuestion('visite le 12 août à 14:00', TODAY)?.time).toBe('14:00')
  })
  it('9 heures → 09:00', () => {
    expect(parseScheduleFromQuestion('visite mercredi à 9 heures', TODAY)?.time).toBe('09:00')
  })
  it('sans heure → time null', () => {
    expect(parseScheduleFromQuestion('visite le 12 août', TODAY)?.time).toBeNull()
  })
})

describe('parseTime', () => {
  it('9h → 09:00', () => expect(parseTime('9h')).toBe('09:00'))
  it('09h → 09:00', () => expect(parseTime('09h')).toBe('09:00'))
  it('9h30 → 09:30', () => expect(parseTime('9h30')).toBe('09:30'))
  it('14h00 → 14:00', () => expect(parseTime('14h00')).toBe('14:00'))
  it('14:30 → 14:30', () => expect(parseTime('14:30')).toBe('14:30'))
  it('texte sans heure → null', () => expect(parseTime('bonjour')).toBeNull())
  // Formats "heures" en toutes lettres
  it('9 heures → 09:00', () => expect(parseTime('9 heures')).toBe('09:00'))
  it('9 heure → 09:00', () => expect(parseTime('9 heure')).toBe('09:00'))
  it('9 heures 30 → 09:30', () => expect(parseTime('9 heures 30')).toBe('09:30'))
  it('9 h → 09:00', () => expect(parseTime('9 h')).toBe('09:00'))
  it('9 h 30 → 09:30', () => expect(parseTime('9 h 30')).toBe('09:30'))
  it('14 heures → 14:00', () => expect(parseTime('14 heures')).toBe('14:00'))
  it('14 heures 30 → 14:30', () => expect(parseTime('14 heures 30')).toBe('14:30'))
})

// ── Nouveaux verbes schedule ───────────────────────────────────────────────────

describe('detectKind — schedule_visit (marquer / inscrire / ajouter)', () => {
  const cases = [
    'Marque une visite le 12 août à 9h',
    'Marques une visite le 15 août',
    'Inscris une visite mercredi à 10h',
    'Inscrit une visite vendredi à 14h',
    'Ajoute une visite le 20 août à 8h',
    'Ajoutes une visite demain à 9h',
  ]
  for (const q of cases) {
    it(`"${q}" → schedule_visit`, () => {
      expect(detectKind(q)).toBe('schedule_visit')
    })
  }
})

describe('detectKind — schedule_meeting (marquer / inscrire / ajouter)', () => {
  const cases = [
    'Marque une réunion le 12 août à 9h',
    'Marques une réunion dimanche à 14h',
    'Inscris une réunion jeudi à 10h',
    'Ajoute une réunion vendredi à 14h',
    'Ajoutes une réunion le 13 août à 14h',
  ]
  for (const q of cases) {
    it(`"${q}" → schedule_meeting`, () => {
      expect(detectKind(q)).toBe('schedule_meeting')
    })
  }
})

describe('detectKind — visit_item non affecté par "ajoute" seul (régression)', () => {
  // "Ajoute une visite" → schedule_visit, mais "ajoute X au plan de visite" → visit_item
  const cases = [
    'Ajoute R4 au plan de visite',
    'Ajoutes R4 au plan de visite',
  ]
  for (const q of cases) {
    it(`"${q}" → visit_item`, () => {
      expect(detectKind(q)).toBe('visit_item')
    })
  }
})

describe('classifyIntent — isWriteRequest pour marquer / inscrire', () => {
  const cases = [
    'Marque une réunion le 12 août à 9h',
    'Marques une visite dimanche à 14h',
    'Inscris une réunion jeudi à 10h',
    'Inscrit une visite vendredi à 9h',
  ]
  for (const q of cases) {
    it(`"${q.slice(0, 55)}" → isWriteRequest=true`, () => {
      expect(classifyIntent(q).isWriteRequest).toBe(true)
    })
  }
})

describe('parseScheduleFromQuestion — heure en toutes lettres', () => {
  const TODAY = '2026-08-05'

  it('Planifie une visite le 13 août à 9 heures → time 09:00', () => {
    expect(parseScheduleFromQuestion('Planifie une visite le 13 août à 9 heures', TODAY)?.time).toBe('09:00')
  })
  it('à 9 heures 30 → time 09:30', () => {
    expect(parseScheduleFromQuestion('visite le 12 août à 9 heures 30', TODAY)?.time).toBe('09:30')
  })
  it('à 9 h → time 09:00', () => {
    expect(parseScheduleFromQuestion('visite le 12 août à 9 h', TODAY)?.time).toBe('09:00')
  })
  it('à 9 h 30 → time 09:30', () => {
    expect(parseScheduleFromQuestion('visite le 12 août à 9 h 30', TODAY)?.time).toBe('09:30')
  })
  it('à 14 heures 30 → time 14:30', () => {
    expect(parseScheduleFromQuestion('réunion le 13 août à 14 heures 30', TODAY)?.time).toBe('14:30')
  })
})
