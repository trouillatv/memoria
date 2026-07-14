// Le calendrier scolaire → des fermetures.
//
// Ce qu'on protège :
//   • le calendrier PRODUIT des fermetures ordinaires — pas un second mécanisme.
//     Toute la chaîne (semaine, aperçu, conflits, tableau de bord) les voit sans
//     une ligne de code de plus ;
//   • le LIBELLÉ de l'utilisateur devient le motif : on ne réécrit pas ses mots ;
//   • le PASSÉ n'est jamais régénéré — une fermeture vécue a pu porter une
//     décision, la réécrire changerait l'histoire ;
//   • une période bancale ne produit RIEN (mieux vaut aucune fermeture qu'une
//     fausse : une fausse déplacerait du vrai travail).

import { describe, it, expect } from 'vitest'
import {
  derivedClosuresFor,
  upcomingPeriods,
  isValidPeriod,
  periodRangeFr,
  periodDays,
  closingPeriods,
  CALENDAR_EFFECT_FR,
  type CalendarPeriod,
  type KindedPeriod,
} from '@/lib/planning/school-calendar'

const p = (over: Partial<CalendarPeriod> = {}): CalendarPeriod => ({
  id: 'p1',
  label: 'Vacances de juillet',
  startsOn: '2026-07-04',
  endsOn: '2026-08-03',
  ...over,
})

describe('Le calendrier PRODUIT des fermetures ordinaires', () => {
  it('une période → une fermeture, avec le motif de l’utilisateur', () => {
    const [c] = derivedClosuresFor('s1', [p()])
    expect(c).toEqual({
      siteId: 's1',
      calendarPeriodId: 'p1',
      reasonKind: 'holiday',
      reason: 'Vacances de juillet',
      startsOn: '2026-07-04',
      endsOn: '2026-08-03',
    })
  })

  it('on ne réécrit pas ses mots — juste les espaces en trop', () => {
    const [c] = derivedClosuresFor('s1', [p({ label: '  Rentrée  ' })])
    expect(c.reason).toBe('Rentrée')
  })

  it('plusieurs périodes → plusieurs fermetures, dans l’ordre reçu', () => {
    const rows = derivedClosuresFor('s1', [
      p({ id: 'a', label: 'A' }),
      p({ id: 'b', label: 'B', startsOn: '2026-12-12', endsOn: '2027-02-15' }),
    ])
    expect(rows.map((r) => r.calendarPeriodId)).toEqual(['a', 'b'])
  })
})

describe('Une période bancale ne produit RIEN', () => {
  it('une fin avant le début est refusée — une fausse fermeture déplacerait du vrai travail', () => {
    expect(isValidPeriod(p({ startsOn: '2026-08-03', endsOn: '2026-07-04' }))).toBe(false)
    expect(derivedClosuresFor('s1', [p({ startsOn: '2026-08-03', endsOn: '2026-07-04' })])).toEqual([])
  })

  it('une date qui n’est pas une date est refusée', () => {
    expect(isValidPeriod(p({ startsOn: 'juillet' }))).toBe(false)
  })

  it('un libellé vide est refusé — une fermeture sans motif n’explique rien', () => {
    expect(isValidPeriod(p({ label: '   ' }))).toBe(false)
  })

  it('un seul jour est une période valide', () => {
    expect(isValidPeriod(p({ startsOn: '2026-07-14', endsOn: '2026-07-14' }))).toBe(true)
  })
})

describe('Le PASSÉ n’est jamais régénéré', () => {
  it('une période terminée sort de la régénération', () => {
    const passe = p({ id: 'vieux', startsOn: '2025-07-04', endsOn: '2025-08-03' })
    const futur = p({ id: 'futur' })
    expect(upcomingPeriods([passe, futur], '2026-07-14').map((x) => x.id)).toEqual(['futur'])
  })

  it('une période EN COURS reste régénérée — elle n’est pas finie', () => {
    const enCours = p({ startsOn: '2026-07-04', endsOn: '2026-08-03' })
    expect(upcomingPeriods([enCours], '2026-07-14')).toHaveLength(1)
  })

  it('une période qui se termine AUJOURD’HUI compte encore', () => {
    const finitAujourdhui = p({ endsOn: '2026-07-14' })
    expect(upcomingPeriods([finitAujourdhui], '2026-07-14')).toHaveLength(1)
  })
})

describe('Ça se lit en français', () => {
  it('« du 4 juillet au 3 août »', () => {
    expect(periodRangeFr(p())).toBe('du 4 juillet au 3 août')
  })

  it('un seul jour se dit « le 14 juillet »', () => {
    expect(periodRangeFr({ startsOn: '2026-07-14', endsOn: '2026-07-14' })).toBe('le 14 juillet')
  })

  it('les jours se comptent bornes comprises', () => {
    expect(periodDays({ startsOn: '2026-07-14', endsOn: '2026-07-14' })).toBe(1)
    expect(periodDays({ startsOn: '2026-07-04', endsOn: '2026-08-03' })).toBe(31)
  })
})


describe('LE CALENDRIER DIT QUAND ; LE CHANTIER DIT QUOI (mig 208)', () => {
  const vacances: KindedPeriod = {
    ...p({ id: 'v1', label: 'Vacances de septembre', startsOn: '2026-09-07', endsOn: '2026-09-18' }),
    kind: 'scolaire',
  }
  const ferie: KindedPeriod = {
    ...p({ id: 'f1', label: 'Fête de la citoyenneté', startsOn: '2026-09-24', endsOn: '2026-09-24' }),
    kind: 'ferie',
  }

  it('1. école FERMÉE pendant les vacances → la période devient fermeture', () => {
    const closing = closingPeriods([vacances, ferie], { scolaire: 'closed', feries: 'none' })
    expect(closing.map((x) => x.id)).toEqual(['v1'])
    // …et le conflit suivra la chaîne existante : fermé + prestation = rouge.
    expect(derivedClosuresFor('s1', closing)).toHaveLength(1)
  })

  it('2. école TRAVAILLÉE pendant les vacances → AUCUNE fermeture, aucun conflit', () => {
    // Le grand nettoyage se fait PENDANT les vacances : transformer la période
    // en fermeture fabriquait de FAUX conflits — le pire poison pour le rouge.
    expect(closingPeriods([vacances], { scolaire: 'works', feries: 'none' })).toEqual([])
  })

  it('3. chantier NON CONCERNÉ → aucune conséquence', () => {
    expect(closingPeriods([vacances, ferie], { scolaire: 'none', feries: 'none' })).toEqual([])
  })

  it('les deux règles sont INDÉPENDANTES — fermé aux fériés, travaillé aux vacances', () => {
    const closing = closingPeriods([vacances, ferie], { scolaire: 'works', feries: 'closed' })
    expect(closing.map((x) => x.id)).toEqual(['f1'])
  })

  it('4. changer de règle → la régénération ne touche que le FUTUR', () => {
    // La brique qui garantit « sans réécrire le passé » : seules les périodes
    // en cours ou à venir se régénèrent — une fermeture vécue a pu porter une
    // décision, la réécrire changerait son histoire.
    const passee: KindedPeriod = {
      ...p({ id: 'old', startsOn: '2025-07-01', endsOn: '2025-07-31' }),
      kind: 'scolaire',
    }
    const futures = upcomingPeriods([passee, vacances], '2026-07-15') as KindedPeriod[]
    expect(closingPeriods(futures, { scolaire: 'closed', feries: 'none' }).map((x) => x.id)).toEqual(['v1'])
  })

  it('la règle se dit en français, sur la fiche comme dans la liste', () => {
    expect(CALENDAR_EFFECT_FR.none).toBe('Non concerné')
    expect(CALENDAR_EFFECT_FR.closed).toBe('Fermé pendant la période')
    expect(CALENDAR_EFFECT_FR.works).toBe('Travail prévu pendant la période')
  })
})
