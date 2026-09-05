import { describe, it, expect } from 'vitest'
import { filterPilotageSubjects, countByFilter, cboMatchesFilter, normalizeSearch } from '@/lib/knowledge/actions-filter'
import type { PilotageSubject, PilotageCbo } from '@/lib/knowledge/actions-pilotage'
import type { CboComputedCurrentState } from '@/lib/knowledge/cbo-lifecycle-reducer'

// P3-3c — navigation pure (recherche + filtres). Zéro vérité : lit les états C2A exposés.

const ACTIVE = new Set<CboComputedCurrentState>(['open', 'progressing', 'documentary_reopened', 'native_reopened'])
const TERMINAL = new Set<CboComputedCurrentState>(['documentary_completed', 'native_completed', 'native_cancelled', 'conforme_at'])
const cbo = (label: string, state: CboComputedCurrentState): PilotageCbo => ({
  cboId: label + state, label, computedCurrentState: state,
  active: ACTIVE.has(state), terminal: TERMINAL.has(state),
  stateBasis: [], conflicts: state === 'conflict' ? ['x'] : [], documentaryDivergences: [], targetActionId: 'a',
})
const subj = (label: string, cbos: PilotageCbo[]): PilotageSubject => ({
  canonicalSubjectId: label, label, displayState: 'open',
  activeCboCount: cbos.filter((c) => c.active).length, completedCboCount: 0, unknownCboCount: 0, totalCboCount: cbos.length,
  lastMeaningfulChangeAt: null, pvCount: 0, cbos, formulations: [], formulationPvCount: 0,
})

const SUBJECTS: PilotageSubject[] = [
  subj('Extincteurs', [cbo('Transmettre le listing et le plan des extincteurs', 'open'), cbo('Vérifier la dotation des extincteurs', 'open')]),
  subj('Système Sprinkler', [cbo('Modification réseau sprinkler', 'native_reopened'), cbo('Évacuer les batteries', 'open')]),
  subj('VGP', [cbo('Mettre en place un contrat VGP annuel', 'documentary_completed')]),
  subj('SSI', [cbo('Organiser un test SSI', 'unknown'), cbo('Fichier des travaux', 'conflict')]),
  subj('Désenfumage', [cbo('Nettoyer les exutoires', 'native_completed')]),
]

describe('normalizeSearch', () => {
  it('minuscule + sans accents + trim', () => {
    expect(normalizeSearch('  Réséda ')).toBe('reseda')
    expect(normalizeSearch('EXTINCTEUR')).toBe('extincteur')
  })
})

describe('recherche', () => {
  const ids = (q: string) => filterPilotageSubjects(SUBJECTS, q, 'all').map((s) => s.label)
  it('1. sur titre de sujet', () => { expect(ids('extincteur')).toEqual(['Extincteurs']) })
  it('2. sur label de CBO (titre sujet ne matche pas)', () => { expect(ids('batteries')).toEqual(['Système Sprinkler']) })
  it('3. case-insensitive', () => { expect(ids('VGP')).toEqual(['VGP']); expect(ids('vgp')).toEqual(['VGP']) })
  it('4. accent-insensitive', () => { expect(ids('desenfumage')).toEqual(['Désenfumage']) })
  it('substring partielle', () => { expect(ids('sprink')).toEqual(['Système Sprinkler']) })
  it('sujet visible si AU MOINS un CBO matche', () => { expect(ids('contrat')).toEqual(['VGP']) })
  it('11. aucun résultat', () => { expect(ids('inexistantxyz')).toEqual([]) })
})

describe('filtres', () => {
  const ids = (f: Parameters<typeof filterPilotageSubjects>[2]) => filterPilotageSubjects(SUBJECTS, '', f).map((s) => s.label)
  it('5. Tous', () => { expect(ids('all')).toHaveLength(5) })
  it('6. Ouverts (open/progressing, hors reopened)', () => { expect(ids('open').sort()).toEqual(['Extincteurs', 'Système Sprinkler'].sort()) })
  it('7. Réouverts (uniquement reopened C2A)', () => { expect(ids('reopened')).toEqual(['Système Sprinkler']) })
  it('8. Traités (terminal : native + documentary)', () => { expect(ids('treated').sort()).toEqual(['Désenfumage', 'VGP'].sort()) })
  it('9. pas de filtre « À qualifier » exposé (les unknown/conflict n’apparaissent dans aucun filtre sauf Tous)', () => {
    // SSI (unknown+conflict) n’est visible que sous « Tous », jamais Ouverts/Réouverts/Traités
    expect(ids('open')).not.toContain('SSI')
    expect(ids('reopened')).not.toContain('SSI')
    expect(ids('treated')).not.toContain('SSI')
    expect(ids('all')).toContain('SSI')
  })
  it('cbo cancelled/conforme comptent comme traités', () => {
    expect(cboMatchesFilter(cbo('x', 'native_cancelled'), 'treated')).toBe(true)
    expect(cboMatchesFilter(cbo('x', 'conforme_at'), 'treated')).toBe(true)
  })
})

describe('recherche + filtre combinés (ET)', () => {
  it('10. Réouverts + « sprink » → Sprinkler ; Réouverts + « extincteur » → vide', () => {
    expect(filterPilotageSubjects(SUBJECTS, 'sprink', 'reopened').map((s) => s.label)).toEqual(['Système Sprinkler'])
    expect(filterPilotageSubjects(SUBJECTS, 'extincteur', 'reopened')).toEqual([])
  })
})

describe('countByFilter (chips)', () => {
  it('compte les sujets par filtre à recherche vide', () => {
    expect(countByFilter(SUBJECTS, '')).toEqual({ all: 5, open: 2, reopened: 1, treated: 2 })
  })
  it('compte à recherche appliquée', () => {
    expect(countByFilter(SUBJECTS, 'sprink')).toEqual({ all: 1, open: 1, reopened: 1, treated: 0 })
  })
})
