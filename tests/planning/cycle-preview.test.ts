// PL5b — l'aperçu, prouvé à sec.
//
// La règle qu'on protège : **l'aperçu ne matérialise RIEN**. Il ne fait que
// projeter. Ce fichier vérifie qu'il répond aux quatre questions de Guillaume :
//   • qui travaille chaque jour ?
//   • y a-t-il au moins une personne ?
//   • y a-t-il une fermeture, un conflit ?
//   • est-ce que ça correspond à MA feuille ?
//
// Le dernier test rejoue SON planning de juillet 2026 (Discount Poindimié).

import { describe, it, expect } from 'vitest'
import { previewCycle, draftTemplates, type DraftCycle, type DraftSlot } from '@/lib/planning/cycle-preview'
import type { ProjectableClosure } from '@/lib/planning/closures'

const MT = 'team-marie-therese'
const GI = 'team-giselle'
const ES = 'team-estelle'

const slot = (
  weekIndex: number,
  weekday: number,
  teamId: string,
  state: 'work' | 'rest' = 'work',
): DraftSlot => ({
  weekIndex,
  weekday,
  teamId,
  state,
  startTime: state === 'work' ? '06:00' : null,
  endTime: state === 'work' ? '09:00' : null,
})

/** Juillet 2026 : le 1er est un mercredi ; le lundi d'ancrage est le 29 juin. */
const ANCHOR = '2026-06-29'

const cycle = (slots: DraftSlot[], weeks = 2, endsOn: string | null = null): DraftCycle => ({
  missionId: 'm1',
  cycleLengthWeeks: weeks,
  anchorDate: ANCHOR,
  startsOn: '2026-07-01',
  endsOn,
  slots,
})

describe('draftTemplates — des rythmes VIRTUELS, jamais écrits', () => {
  it('un rythme par case TRAVAILLÉE ; les repos n’en produisent aucun', () => {
    const tpls = draftTemplates(cycle([slot(0, 1, MT), slot(0, 2, MT, 'rest'), slot(1, 1, GI)]))
    expect(tpls).toHaveLength(2)
    expect(tpls.map((t) => t.week_index)).toEqual([0, 1])
  })

  it('chaque rythme porte le cycle (sinon il tomberait toutes les semaines)', () => {
    const [t] = draftTemplates(cycle([slot(0, 1, MT)]))
    expect(t.cycle_length_weeks).toBe(2)
    expect(t.anchor_date).toBe(ANCHOR)
    expect(t.week_index).toBe(0)
    expect(t.planned_start_hhmm).toBe('06:00')
  })
})

describe('previewCycle — les quatre questions de Guillaume', () => {
  it('QUI travaille ce jour-là, et à quelle heure', () => {
    // Lundi semaine A : Marie-Thérèse et Giselle. Estelle au repos.
    // ⚠️ l'ancrage est le lundi 29 juin : le 6 juillet est donc en semaine B,
    // et le 13 en semaine A. C'est exactement le piège que le cycle doit gérer.
    const c = cycle([slot(0, 1, MT), slot(0, 1, GI), slot(0, 1, ES, 'rest')])
    const { days } = previewCycle({ cycle: c, closures: [], from: '2026-07-13', to: '2026-07-13' })
    expect(days).toHaveLength(1)
    expect(days[0].working.map((w) => w.teamId).sort()).toEqual([GI, MT].sort())
    expect(days[0].working[0].startTime).toBe('06:00')
    expect(days[0].working[0].endTime).toBe('09:00')
    expect(days[0].restingTeamIds).toEqual([ES])
    expect(days[0].coverage).toBe(2)
  })

  it('Y A-T-IL AU MOINS UNE PERSONNE ? — le trou se voit', () => {
    // Personne le mardi.
    const c = cycle([slot(0, 1, MT)], 1)
    const { days, summary } = previewCycle({ cycle: c, closures: [], from: '2026-07-06', to: '2026-07-07' })
    expect(days[0].coverage).toBe(1) // lundi
    expect(days[1].coverage).toBe(0) // mardi — le trou
    expect(summary.uncoveredDays).toBe(1)
  })

  it('Y A-T-IL UNE FERMETURE, UN CONFLIT ?', () => {
    const ferie: ProjectableClosure = {
      id: 'c1',
      siteId: 's1',
      reasonKind: 'holiday',
      reason: 'Magasin fermé',
      startsOn: '2026-07-06',
      endsOn: '2026-07-06',
      defaultResolution: 'none',
    }
    const c = cycle([slot(0, 1, MT)], 1)
    const { days, summary } = previewCycle({ cycle: c, closures: [ferie], from: '2026-07-06', to: '2026-07-06' })
    expect(days[0].closure?.reason).toBe('Magasin fermé')
    expect(days[0].conflict).toBe(true) // fermé ET du monde prévu
    expect(summary.conflicts).toBe(1)
  })

  it('un jour FERMÉ sans personne n’est PAS un trou — c’est la normale', () => {
    // Le calendrier du chantier D'ABORD : s'il est fermé, zéro personne est
    // exactement ce qui est prévu. Le trou, c'est un jour OUVERT que personne
    // ne couvre. Confondre les deux ferait crier l'écran pour rien.
    const vacances: ProjectableClosure = {
      id: 'c1', siteId: 's1', reasonKind: 'holiday', reason: 'Fermeture annuelle',
      startsOn: '2026-07-07', endsOn: '2026-07-07', defaultResolution: 'none',
    }
    const c = cycle([slot(0, 1, MT)], 1) // ne travaille que le lundi
    const { days, summary } = previewCycle({ cycle: c, closures: [vacances], from: '2026-07-07', to: '2026-07-07' })
    expect(days[0].coverage).toBe(0)
    expect(days[0].closure?.reason).toBe('Fermeture annuelle')
    expect(summary.uncoveredDays).toBe(0) // fermé ≠ trou
    expect(summary.closedDays).toBe(1)
  })

  it('un jour OUVERT sans personne reste un trou', () => {
    const c = cycle([slot(0, 1, MT)], 1)
    const { summary } = previewCycle({ cycle: c, closures: [], from: '2026-07-07', to: '2026-07-07' })
    expect(summary.uncoveredDays).toBe(1)
    expect(summary.closedDays).toBe(0)
  })

  it('une fermeture SANS personne prévue n’est PAS un conflit', () => {
    const ferie: ProjectableClosure = {
      id: 'c1', siteId: 's1', reasonKind: 'holiday', reason: null,
      startsOn: '2026-07-07', endsOn: '2026-07-07', defaultResolution: 'none',
    }
    const c = cycle([slot(0, 1, MT)], 1) // ne travaille que le lundi
    const { days, summary } = previewCycle({ cycle: c, closures: [ferie], from: '2026-07-07', to: '2026-07-07' })
    expect(days[0].closure).not.toBeNull()
    expect(days[0].conflict).toBe(false) // fermé, mais personne n'était prévu
    expect(summary.conflicts).toBe(0)
  })
})

describe('previewCycle — les bornes du roulement', () => {
  it('aucun jour AVANT la date de début', () => {
    const c = cycle([slot(0, 1, MT)], 1)
    const { days } = previewCycle({ cycle: c, closures: [], from: '2026-06-01', to: '2026-07-02' })
    expect(days.every((d) => d.date >= '2026-07-01')).toBe(true)
  })

  it('aucun jour APRÈS la date de fin (« jusqu’au 15 juillet »)', () => {
    const c = cycle([slot(0, 1, MT)], 1, '2026-07-15')
    const { days } = previewCycle({ cycle: c, closures: [], from: '2026-07-01', to: '2026-07-31' })
    expect(days.every((d) => d.date <= '2026-07-15')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LE TEST QUI COMPTE : sa feuille de juillet 2026, rejouée.
// ─────────────────────────────────────────────────────────────────────────────

describe('SA FEUILLE — Planning Discount Poindimié, juillet 2026', () => {
  // Décodé du PDF. Motif à 14 jours ; l'ancrage est le lundi 29 juin (le
  // 1er juillet, mercredi, tombe donc en semaine A).
  //
  // Marie-Thérèse : mardi + mercredi, TOUTES les semaines (donc en A ET en B).
  // Giselle et Estelle : rotation sur 2 semaines.
  const D = 'work' as const
  const R = 'rest' as const

  // (semaine, jour ISO) → état, tel que lu sur sa feuille.
  // Grille RECALCULÉE depuis le PDF (et non retapée) : sa feuille se replie sans
  // UNE SEULE incohérence sur un cycle de 2 semaines. Elle EST un cycle.
  type Row = Array<[number, typeof D | typeof R]>
  const MT_A: Row = [[1, R], [2, D], [3, D], [4, R], [5, R], [6, R], [7, R]]
  const MT_B: Row = MT_A // identique : son rythme est hebdomadaire
  const GI_A: Row = [[1, D], [2, R], [3, D], [4, D], [5, D], [6, R], [7, R]]
  const GI_B: Row = [[1, D], [2, D], [3, R], [4, D], [5, D], [6, D], [7, D]]
  const ES_A: Row = [[1, D], [2, D], [3, R], [4, D], [5, D], [6, D], [7, D]]
  const ES_B: Row = [[1, D], [2, R], [3, D], [4, D], [5, D], [6, R], [7, R]]

  const build = (team: string, w: number, row: Row): DraftSlot[] =>
    row.map(([day, state]) => slot(w, day, team, state))

  const feuille = cycle(
    [
      ...build(MT, 0, MT_A), ...build(MT, 1, MT_B),
      ...build(GI, 0, GI_A), ...build(GI, 1, GI_B),
      ...build(ES, 0, ES_A), ...build(ES, 1, ES_B),
    ],
    2,
  )

  const { days, summary } = previewCycle({
    cycle: feuille,
    closures: [],
    from: '2026-07-01',
    to: '2026-07-31',
  })

  it('couvre les 31 jours de juillet', () => {
    expect(days).toHaveLength(31)
  })

  it('LA COUVERTURE N’EST JAMAIS À ZÉRO — c’est ce qu’il vérifie du regard', () => {
    expect(summary.uncoveredDays).toBe(0)
    expect(days.every((d) => d.coverage >= 1)).toBe(true)
  })

  it('chaque jour : une ou deux personnes, jamais trois', () => {
    const couvertures = new Set(days.map((d) => d.coverage))
    expect([...couvertures].sort()).toEqual([1, 2])
  })

  it('LES TOTAUX DE SA FEUILLE : 9 / 23 / 22 jours', () => {
    expect(summary.daysByTeam[MT]).toBe(9)
    expect(summary.daysByTeam[GI]).toBe(23)
    expect(summary.daysByTeam[ES]).toBe(22)
  })

  it('Marie-Thérèse ne travaille QUE les mardis et mercredis', () => {
    const sesJours = days
      .filter((d) => d.working.some((w) => w.teamId === MT))
      .map((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay()) // 2=mardi, 3=mercredi
    expect([...new Set(sesJours)].sort()).toEqual([2, 3])
  })

  it('les WEEK-ENDS sont travaillés (samedi et dimanche sont des jours normaux)', () => {
    const weekend = days.filter((d) => {
      const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay()
      return dow === 0 || dow === 6
    })
    expect(weekend.every((d) => d.coverage >= 1)).toBe(true)
  })
})
