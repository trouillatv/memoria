import { describe, expect, it } from 'vitest'
import {
  CR_VISITE_TEMPLATE_KEY,
  buildVisitCrSections,
  type VisitCrAnalysis,
} from '@/lib/visits/cr-visite-sections'

const full: VisitCrAnalysis = {
  summary: 'La dépose est lancée sur le lot 2.',
  decisions: ['Démarrer la dépose jeudi', 'Faire intervenir Clim Expert avant l’électricien'],
  actions: [
    { title: 'Relancer Yann pour les plans', rationale: 'Ses informations manquent au planning', priority: 'haute', owner: 'Guillaume', due: '2026-07-24' },
    { title: 'Vérifier le TD', rationale: 'Aucun jus le jour de la visite', priority: null, owner: '', due: '' },
  ],
  watchpoints: [
    { label: 'Retard accumulé', impact: 'Quelques semaines sur le planning', owner: 'Guillaume', due: '' },
  ],
  a_savoir: ['Le cadenas a un code communiqué aux entreprises'],
  echeances: [
    { label: 'Intervention Clim Expert', date: '2026-07-23', constraint: '' },
    { label: 'Passage de l’électricien', date: '', constraint: 'Avant le démarrage' },
  ],
  intervenants: ['Clim Expert', 'AGP'],
}

describe('buildVisitCrSections', () => {
  it('rend les sept sections du CR de visite, dans l’ordre de lecture', () => {
    const sections = buildVisitCrSections(full)
    expect(sections.map((s) => s.key)).toEqual([
      'resume',
      'decisions',
      'actions',
      'vigilances',
      'a_savoir',
      'echeances',
      'intervenants',
    ])
    expect(sections.every((s) => s.kind === 'generative')).toBe(true)
  })

  it('écrit le contenu que le conducteur relira, pas du JSON', () => {
    const byKey = Object.fromEntries(buildVisitCrSections(full).map((s) => [s.key, s.content]))
    expect(byKey.resume).toBe('La dépose est lancée sur le lot 2.')
    expect(byKey.decisions).toBe('- Démarrer la dépose jeudi\n- Faire intervenir Clim Expert avant l’électricien')
    // Une action dit ce qu'il faut faire, puis qui et quand — quand on le sait.
    expect(byKey.actions).toContain('- Relancer Yann pour les plans — Guillaume, pour le 2026-07-24')
    expect(byKey.actions).toContain('- Vérifier le TD')
    expect(byKey.actions).not.toContain('undefined')
    // Une échéance sans date garde SA contrainte, jamais une date devinée.
    expect(byKey.echeances).toContain('- Passage de l’électricien — Avant le démarrage')
    expect(byKey.echeances).toContain('- Intervention Clim Expert — 2026-07-23')
    expect(byKey.intervenants).toBe('- Clim Expert\n- AGP')
  })

  it('n’invente rien quand la matière manque : une section vide reste vide', () => {
    const sections = buildVisitCrSections({
      summary: '',
      decisions: [],
      actions: [],
      watchpoints: [],
      a_savoir: [],
      echeances: [],
      intervenants: [],
    })
    expect(sections).toHaveLength(7)
    expect(sections.every((s) => s.content === '')).toBe(true)
  })

  it('survit à une analyse ancienne ou partielle sans jeter la matière connue', () => {
    const byKey = Object.fromEntries(
      buildVisitCrSections({ summary: 'Visite courte.' } as VisitCrAnalysis).map((s) => [s.key, s.content]),
    )
    expect(byKey.resume).toBe('Visite courte.')
    expect(byKey.actions).toBe('')
    expect(byKey.echeances).toBe('')
  })

  it('porte une clé de template propre à la visite', () => {
    expect(CR_VISITE_TEMPLATE_KEY).toBe('cr_visite.v1')
  })
})
