// La Vue Mois — les règles qui la gardent lisible en une seconde.
//
// Ce qu'on protège :
//   • la PRÉSÉANCE des états — le conflit crie, la fermeture informe, le trou
//     n'existe QUE là où un roulement était censé couvrir ;
//   • le VERDICT — fermetures et exceptions sont de l'information, jamais des
//     problèmes : elles n'empêchent pas un jour d'être « prêt » ;
//   • le CLIC — l'écran canonique le plus pertinent, jamais un nouveau.

import { describe, it, expect } from 'vitest'
import {
  dayState,
  dayTarget,
  monthVerdict,
  verdictPhrase,
  monthDays,
  isoWeekParamOf,
  peopleOn,
  presenceByDay,
  rowTotal,
  teamDayState,
  teamPresenceByDay,
  teamWorkedDays,
  type DayFacts,
  type TeamDayFacts,
} from '@/lib/planning/month-view'

const f = (over: Partial<DayFacts> = {}): DayFacts => ({
  expected: 0,
  done: 0,
  kept: 0,
  projected: 0,
  closed: false,
  hasException: false,
  cycleCovers: false,
  ...over,
})

describe('La préséance des états — une cellule, un état, une seconde', () => {
  it('fermé ET du monde prévu → CONFLIT (le rouge crie)', () => {
    expect(dayState(f({ closed: true, expected: 2 }))).toBe('conflict')
  })

  it('fermé ET du monde PROJETÉ → conflit aussi — le futur se corrige avant d’arriver', () => {
    expect(dayState(f({ closed: true, projected: 1 }))).toBe('conflict')
  })

  it('fermé sans personne → FERMÉ (le bleu informe, n’alarme pas)', () => {
    expect(dayState(f({ closed: true }))).toBe('closed')
  })

  it('du monde prévu → OK', () => {
    expect(dayState(f({ expected: 1 }))).toBe('ok')
  })

  it('du monde projeté, pas encore généré → PROJETÉ (atténué, pas absent)', () => {
    expect(dayState(f({ projected: 2 }))).toBe('projected')
  })

  it('vide SOUS un roulement → TROU — quelqu’un devait venir', () => {
    expect(dayState(f({ cycleCovers: true }))).toBe('hole')
  })

  it('vide SANS roulement → juste vide — crier « 0 » partout apprendrait à ignorer le rouge', () => {
    expect(dayState(f())).toBe('empty')
  })

  it('un jour PASSÉ où le travail est FAIT → OK, pas un trou', () => {
    expect(dayState(f({ done: 1, cycleCovers: true }))).toBe('ok')
  })

  it('MAINTENUE malgré la fermeture → FERMÉ, plus jamais conflit — la décision est prise', () => {
    // Re-crier tous les mois un conflit déjà tranché userait le rouge — et le
    // jour où un vrai conflit arrive, plus personne ne le lit.
    expect(dayState(f({ closed: true, kept: 1 }))).toBe('closed')
  })
})

describe('Le clic — l’écran canonique le plus pertinent', () => {
  it('un conflit ouvre le TIROIR (les gestes y sont déjà)', () => {
    expect(dayTarget('conflict', false)).toBe('week_drawer')
  })

  it('une exception ouvre le TIROIR, même sur un jour OK', () => {
    expect(dayTarget('ok', true)).toBe('week_drawer')
  })

  it('un jour fermé ouvre le Calendrier', () => {
    expect(dayTarget('closed', false)).toBe('calendar')
  })

  it('un jour normal ouvre la semaine', () => {
    expect(dayTarget('ok', false)).toBe('week')
    expect(dayTarget('empty', false)).toBe('week')
  })
})

describe('Le verdict — « est-ce que je peux dormir tranquille ? »', () => {
  it('fermetures et exceptions n’empêchent PAS un jour d’être prêt', () => {
    // C'est le cœur de « le calendrier avant le conflit » : une fermeture est
    // de l'information. Seuls le conflit et le trou sont des problèmes.
    const v = monthVerdict({
      '2026-09-01': [f({ expected: 1 }), f({ closed: true })],
      '2026-09-02': [f({ expected: 1, hasException: true })],
    })
    expect(v.readyDays).toBe(2)
    expect(v.readyPct).toBe(100)
    expect(v.closedDays).toBe(1)
    expect(v.exceptions).toBe(1)
  })

  it('un conflit ou un trou rend le JOUR non prêt', () => {
    const v = monthVerdict({
      '2026-09-01': [f({ closed: true, expected: 1 })], // conflit
      '2026-09-02': [f({ cycleCovers: true })], // trou
      '2026-09-03': [f({ expected: 1 })],
    })
    expect(v.readyDays).toBe(1)
    expect(v.totalDays).toBe(3)
    expect(v.readyPct).toBe(33)
    expect(v.conflicts).toBe(1)
    expect(v.holes).toBe(1)
  })

  it('la phrase suit le pourcentage', () => {
    expect(verdictPhrase({ readyPct: 100 } as never)).toBe('Le mois est prêt.')
    expect(verdictPhrase({ readyPct: 93 } as never)).toBe('Le mois est quasiment prêt.')
    expect(verdictPhrase({ readyPct: 60 } as never)).toBe('Le mois demande votre attention.')
  })

  it('un mois vide est prêt — pas de division par zéro', () => {
    expect(monthVerdict({}).readyPct).toBe(100)
  })
})

describe('Les jours du mois', () => {
  it('septembre 2026 : 30 jours, le 5 est un samedi', () => {
    const days = monthDays('2026-09')
    expect(days).toHaveLength(30)
    expect(days[4]).toMatchObject({ date: '2026-09-05', weekend: true })
    expect(days[0]).toMatchObject({ date: '2026-09-01', weekday: 2 }) // mardi
  })

  it('le clic atterrit sur la BONNE semaine — pas la semaine courante', () => {
    expect(isoWeekParamOf('2026-09-15')).toBe('2026-W38')
    // Frontière d'année : le 1er janvier 2027 (vendredi) est en semaine 53 de 2026.
    expect(isoWeekParamOf('2027-01-01')).toBe('2026-W53')
  })
})

// ── LE CHIFFRE ET LES DEUX AXES (PL6a) ──────────────────────────────────────
//
// Ce qu'on protège :
//   • le CHIFFRE — « combien de monde ce jour-là ». Le projeté REMPLACE le réel,
//     il ne s'y ajoute jamais : sinon la même occurrence compterait double ;
//   • la ligne PRÉSENTS — la couverture, c'est elle qu'on cherche du regard ;
//   • le mode ÉQUIPE — les mêmes faits, autre axe. La ligne est une ÉQUIPE,
//     jamais une personne : une grille de jours travaillés par individu serait
//     une feuille de présence, pas un planning.

describe('Le chiffre de la cellule — combien de monde', () => {
  it('compte le réel : attendu + fait + maintenu', () => {
    expect(peopleOn(f({ expected: 1, done: 1, kept: 1 }))).toBe(3)
  })

  it("le projeté REMPLACE le réel, il ne s'y ajoute pas", () => {
    expect(peopleOn(f({ expected: 2, projected: 5 }))).toBe(2)
    expect(peopleOn(f({ projected: 2 }))).toBe(2)
  })

  it('un jour vide vaut zéro', () => {
    expect(peopleOn(f())).toBe(0)
  })

  it("le total d'une ligne additionne ses jours", () => {
    expect(rowTotal({ a: f({ expected: 2 }), b: f({ projected: 1 }), c: f() })).toBe(3)
  })

  it('la ligne « Présents » additionne tous les chantiers du jour, et le zéro se voit', () => {
    const p = presenceByDay({
      '2026-09-01': [f({ expected: 2 }), f({ projected: 1 })],
      '2026-09-02': [f(), f()],
    })
    expect(p['2026-09-01']).toBe(3)
    expect(p['2026-09-02']).toBe(0)
  })
})

describe('Le mode Équipe — les mêmes faits, autre axe', () => {
  const t = (over: Partial<TeamDayFacts> = {}): TeamDayFacts => ({
    worked: 0,
    projected: 0,
    conflicts: 0,
    hasException: false,
    ...over,
  })

  it('chantier fermé sous une équipe prévue → CONFLIT (le rouge prime)', () => {
    expect(teamDayState(t({ worked: 1, conflicts: 1 }))).toBe('conflict')
  })

  it('travail, puis projeté, puis repos', () => {
    expect(teamDayState(t({ worked: 2 }))).toBe('work')
    expect(teamDayState(t({ projected: 1 }))).toBe('projected')
    expect(teamDayState(t())).toBe('rest')
  })

  it("le total d'une équipe compte ses JOURS travaillés, pas ses occurrences", () => {
    expect(teamWorkedDays({ a: t({ worked: 2 }), b: t({ projected: 1 }), c: t() })).toBe(2)
  })

  it('« Présents » compte les ÉQUIPES qui tournent, pas les personnes', () => {
    const p = teamPresenceByDay({
      '2026-09-01': [t({ worked: 1 }), t({ projected: 1 }), t()],
      '2026-09-02': [t(), t()],
    })
    expect(p['2026-09-01']).toBe(2)
    expect(p['2026-09-02']).toBe(0)
  })
})
