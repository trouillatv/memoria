// PL3a — la détection, prouvée à sec.
//
// Les critères que ces tests verrouillent, un par un :
//  • un site fermé SANS prestation → PAS de conflit ;
//  • une prestation sur un site OUVERT → PAS de conflit ;
//  • une fermeture retirée → ignorée (elle n'arrive jamais au détecteur) ;
//  • chevauchement → résultat DÉTERMINISTE (règle PL2) ;
//  • seules les prestations où une DÉCISION reste possible comptent.

import { describe, it, expect } from 'vitest'
import { detectClosureConflicts, isStillExpected } from '@/lib/planning/conflicts'
import type { ProjectableClosure } from '@/lib/planning/closures'

const SITE = 'site-pointiere'
const AUTRE = 'site-autre'

const closure = (
  p: Partial<ProjectableClosure> & { id: string; startsOn: string; endsOn: string },
): ProjectableClosure => ({
  siteId: SITE,
  reasonKind: 'holiday',
  reason: null,
  defaultResolution: 'none',
  ...p,
})

const cell = (status = 'planned') => ({ status })

/** Une ligne de grille : un chantier, ses jours, leurs interventions. */
const row = (siteId: string, days: Record<string, Array<{ status: string }>>) => ({
  site_id: siteId,
  days,
})

const FERIE = closure({ id: 'c1', startsOn: '2026-07-14', endsOn: '2026-07-14', reason: 'Magasin fermé' })

describe('detectClosureConflicts — le conflit', () => {
  it('site fermé + prestation prévue → CONFLIT, avec le pourquoi', () => {
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-14': [cell()] })],
      closuresBySite: { [SITE]: [FERIE] },
    })
    expect(out[SITE]['2026-07-14'].closure.id).toBe('c1')
    expect(out[SITE]['2026-07-14'].closure.reason).toBe('Magasin fermé')
    expect(out[SITE]['2026-07-14'].expectedCount).toBe(1)
  })

  it('plusieurs prestations le même jour fermé → le compte est juste', () => {
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-14': [cell(), cell(), cell()] })],
      closuresBySite: { [SITE]: [FERIE] },
    })
    expect(out[SITE]['2026-07-14'].expectedCount).toBe(3)
  })
})

describe('detectClosureConflicts — les SILENCES (l’absence de conflit est l’état normal)', () => {
  it('site fermé SANS prestation → aucun conflit (une fermeture n’est pas un problème)', () => {
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-14': [] })],
      closuresBySite: { [SITE]: [FERIE] },
    })
    expect(out).toEqual({})
  })

  it('prestation sur un site OUVERT ce jour-là → aucun conflit', () => {
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-15': [cell()] })], // la fermeture est le 14
      closuresBySite: { [SITE]: [FERIE] },
    })
    expect(out).toEqual({})
  })

  it('site sans AUCUNE fermeture → aucun conflit (et aucune clé créée)', () => {
    const out = detectClosureConflicts({
      rows: [row(AUTRE, { '2026-07-14': [cell()] })],
      closuresBySite: { [SITE]: [FERIE] },
    })
    expect(out).toEqual({})
  })

  it('une fermeture RETIRÉE n’arrive jamais ici → aucun conflit', () => {
    // La couche DB filtre `deleted_at`. On simule : la liste est vide.
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-14': [cell()] })],
      closuresBySite: { [SITE]: [] },
    })
    expect(out).toEqual({})
  })

  it('la fermeture d’un AUTRE chantier ne contamine pas celui-ci', () => {
    const out = detectClosureConflicts({
      rows: [row(AUTRE, { '2026-07-14': [cell()] })],
      closuresBySite: { [SITE]: [FERIE], [AUTRE]: [] },
    })
    expect(out).toEqual({})
  })
})

describe('detectClosureConflicts — seules les prestations DÉCIDABLES comptent', () => {
  it('« pas passés » (skipped) → plus rien à trancher, aucun conflit', () => {
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-14': [cell('skipped')] })],
      closuresBySite: { [SITE]: [FERIE] },
    })
    expect(out).toEqual({})
  })

  it('déjà faite (completed / validated) → le passé ne se déplace pas', () => {
    for (const status of ['completed', 'validated']) {
      const out = detectClosureConflicts({
        rows: [row(SITE, { '2026-07-14': [cell(status)] })],
        closuresBySite: { [SITE]: [FERIE] },
      })
      expect(out).toEqual({})
    }
  })

  it('en cours (in_progress) → quelqu’un est SUR PLACE : dire « c’est fermé » serait absurde', () => {
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-14': [cell('in_progress')] })],
      closuresBySite: { [SITE]: [FERIE] },
    })
    expect(out).toEqual({})
  })

  it('mélange : seules les « planned » sont comptées', () => {
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-14': [cell('planned'), cell('skipped'), cell('completed')] })],
      closuresBySite: { [SITE]: [FERIE] },
    })
    expect(out[SITE]['2026-07-14'].expectedCount).toBe(1)
  })

  it('isStillExpected : contrat explicite', () => {
    expect(isStillExpected('planned')).toBe(true)
    for (const s of ['skipped', 'in_progress', 'completed', 'validated', 'n’importe quoi']) {
      expect(isStillExpected(s)).toBe(false)
    }
  })
})

describe('detectClosureConflicts — chevauchement DÉTERMINISTE (règle PL2)', () => {
  const a = closure({ id: 'aaa', startsOn: '2026-07-10', endsOn: '2026-07-20', reasonKind: 'client' })
  const b = closure({ id: 'bbb', startsOn: '2026-07-15', endsOn: '2026-07-30', reasonKind: 'maintenance' })

  it('la fermeture DÉJÀ EN VIGUEUR s’applique, quel que soit l’ordre d’arrivée', () => {
    const rows = [row(SITE, { '2026-07-16': [cell()] })]
    const un = detectClosureConflicts({ rows, closuresBySite: { [SITE]: [a, b] } })
    const deux = detectClosureConflicts({ rows, closuresBySite: { [SITE]: [b, a] } })
    expect(un[SITE]['2026-07-16'].closure.id).toBe('aaa')
    expect(deux[SITE]['2026-07-16'].closure.id).toBe('aaa')
  })

  it('après la fin de la première, la seconde prend le relais', () => {
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-21': [cell()] })],
      closuresBySite: { [SITE]: [a, b] },
    })
    expect(out[SITE]['2026-07-21'].closure.reasonKind).toBe('maintenance')
  })
})

describe('detectClosureConflicts — une semaine entière', () => {
  it('n’expose QUE les jours réellement en conflit', () => {
    const semaine = row(SITE, {
      '2026-07-13': [cell()],          // lundi — ouvert
      '2026-07-14': [cell(), cell()],  // mardi — FERMÉ, 2 prestations
      '2026-07-15': [],                // mercredi — rien de prévu
      '2026-07-16': [cell()],          // jeudi — ouvert
    })
    const out = detectClosureConflicts({
      rows: [semaine],
      closuresBySite: { [SITE]: [FERIE, closure({ id: 'c2', startsOn: '2026-07-15', endsOn: '2026-07-15' })] },
    })
    expect(Object.keys(out[SITE])).toEqual(['2026-07-14']) // le 15 est fermé, mais rien n'est prévu
    expect(out[SITE]['2026-07-14'].expectedCount).toBe(2)
  })

  it('aucun conflit nulle part → objet vide (silence positif)', () => {
    const out = detectClosureConflicts({
      rows: [row(SITE, { '2026-07-13': [cell()] })],
      closuresBySite: {},
    })
    expect(out).toEqual({})
  })
})
