import { describe, expect, it } from 'vitest'
import { readOperationalItems, diffOperationalItems, asProposedSections } from '@/lib/visits/cr-concretisation'
import type { ReportDocumentSection } from '@/types/db'

const s = (key: string, content: string, ai = 'TEXTE IA À NE JAMAIS LIRE'): ReportDocumentSection => ({
  key,
  title: key,
  kind: 'generative',
  content,
  ai_content: ai,
})

const corrige: ReportDocumentSection[] = [
  s('resume', 'Le chantier est entré en phase de dépose.'),
  s('decisions', '- Démarrer la dépose jeudi\n- Faire passer Clim Expert avant l’électricien'),
  s('actions', '- Relancer Yann pour les plans — Guillaume, pour le 2026-07-24\n- Vérifier le TD'),
  s('vigilances', '- Retard accumulé — plusieurs semaines sur le planning'),
  s('a_savoir', '- Le cadenas a un code communiqué aux entreprises'),
  s('echeances', '- Intervention Clim Expert — 2026-07-23\n- Passage de l’électricien — Avant le démarrage'),
  s('intervenants', '- Clim Expert\n- AGP'),
]

describe('readOperationalItems — la concrétisation lit le TEXTE CORRIGÉ', () => {
  it('ne lit jamais la proposition IA, seulement ce que l’humain a validé', () => {
    const items = readOperationalItems(corrige)
    const tous = JSON.stringify(items)
    expect(tous).not.toContain('TEXTE IA À NE JAMAIS LIRE')
  })

  it('relit une action avec son responsable et sa date', () => {
    const [premiere] = readOperationalItems(corrige).filter((i) => i.kind === 'action')
    expect(premiere).toMatchObject({
      kind: 'action',
      label: 'Relancer Yann pour les plans',
      owner: 'Guillaume',
      due: '2026-07-24',
    })
  })

  it('relit une action sans complément sans rien inventer', () => {
    const sans = readOperationalItems(corrige).filter((i) => i.kind === 'action')[1]
    expect(sans).toMatchObject({ label: 'Vérifier le TD', owner: null, due: null })
  })

  it('distingue une date dite d’une contrainte dite', () => {
    const ech = readOperationalItems(corrige).filter((i) => i.kind === 'echeance')
    expect(ech[0]).toMatchObject({ label: 'Intervention Clim Expert', due: '2026-07-23', constraint: null })
    expect(ech[1]).toMatchObject({ label: 'Passage de l’électricien', due: null, constraint: 'Avant le démarrage' })
  })

  it('compte les cinq familles concrétisables, et elles seules', () => {
    const parFamille = readOperationalItems(corrige).reduce<Record<string, number>>((acc, i) => {
      acc[i.kind] = (acc[i.kind] ?? 0) + 1
      return acc
    }, {})
    expect(parFamille).toEqual({ action: 2, echeance: 2, intervenant: 2, decision: 2, memoire: 1 })
  })

  it('ne concrétise NI le résumé NI les vigilances — ils racontent, ils ne créent pas', () => {
    const items = readOperationalItems(corrige)
    expect(items.some((i) => i.label.includes('phase de dépose'))).toBe(false)
    expect(items.some((i) => i.label.includes('Retard accumulé'))).toBe(false)
  })

  it('porte la section d’origine sur chaque élément — la provenance ne se perd pas', () => {
    for (const item of readOperationalItems(corrige)) {
      expect(['decisions', 'actions', 'a_savoir', 'echeances', 'intervenants']).toContain(item.sourceSection)
    }
  })

  it('ne rend rien d’une section vide, et ne tombe pas sur un document partiel', () => {
    expect(readOperationalItems([s('actions', '')])).toEqual([])
    expect(readOperationalItems([])).toEqual([])
  })

  it('donne à chaque élément une clé stable — cocher/décocher doit survivre au rendu', () => {
    const a = readOperationalItems(corrige).map((i) => i.key)
    const b = readOperationalItems(corrige).map((i) => i.key)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(a.length)
  })
})

describe('diffOperationalItems — ce que mes corrections ont changé', () => {
  const proposé: ReportDocumentSection[] = [
    { key: 'actions', title: 'Actions', kind: 'generative', content: '', ai_content: '- Relancer Yann — Guillaume, pour le 2026-07-24\n- Vérifier le TD' },
    { key: 'echeances', title: 'Échéances', kind: 'generative', content: '', ai_content: '- Passage électricien — 2026-07-30' },
  ]
  const corrigé = proposé.map((s) =>
    s.key === 'actions'
      ? { ...s, content: '- Relancer Yann — Guillaume, pour le 2026-07-22\n- Commander le tableau' }
      : { ...s, content: '' },
  )

  const before = readOperationalItems(asProposedSections(proposé))
  const after = readOperationalItems(corrigé)
  const diff = diffOperationalItems(before, after)

  it('voit ce que le texte corrigé fait APPARAÎTRE', () => {
    expect(diff.added.map((i) => i.label)).toEqual(['Commander le tableau'])
  })

  it('voit ce que les corrections ont fait DISPARAÎTRE', () => {
    expect(diff.removed.map((i) => i.label).sort()).toEqual(['Passage électricien', 'Vérifier le TD'])
  })

  it('voit une date changée sans crier à la nouveauté', () => {
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]!.before.due).toBe('2026-07-24')
    expect(diff.changed[0]!.after.due).toBe('2026-07-22')
  })

  it('dit franchement quand rien n’a bougé', () => {
    const rien = diffOperationalItems(before, before)
    expect(rien.unchanged).toBe(true)
    expect(rien.added).toEqual([])
  })
})
