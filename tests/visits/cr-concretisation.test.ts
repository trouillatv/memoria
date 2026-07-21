import { describe, expect, it } from 'vitest'
import {
  readOperationalItems,
  diffOperationalItems,
  asProposedSections,
  toCreate,
  matchConcretisation,
  withConcretisation,
  canonicalFamily,
} from '@/lib/visits/cr-concretisation'
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

describe('toCreate — jamais deux fois le même objet', () => {
  const item = (kind: string, label: string) =>
    ({ key: `${kind}:${label}`, kind, label, owner: null, due: null, constraint: null, sourceSection: kind }) as never

  it('écarte ce qui existe déjà dans le chantier', () => {
    const { create, skipped } = toCreate(
      [item('action', 'Relancer Yann'), item('action', 'Commander le tableau')],
      new Set(['action:relancer yann']),
    )
    expect(create.map((i) => i.label)).toEqual(['Commander le tableau'])
    expect(skipped.map((i) => i.label)).toEqual(['Relancer Yann'])
  })

  it('ignore la casse et les espaces — « Relancer Yann » ne revient pas deux fois', () => {
    const { create } = toCreate([item('action', '  RELANCER yann ')], new Set(['action:relancer yann']))
    expect(create).toEqual([])
  })

  it('dédoublonne AUSSI à l’intérieur du même envoi', () => {
    const { create, skipped } = toCreate(
      [item('action', 'Vérifier le TD'), item('action', 'Vérifier le TD')],
      new Set(),
    )
    expect(create).toHaveLength(1)
    expect(skipped).toHaveLength(1)
  })

  it('ne confond pas deux familles portant le même libellé', () => {
    const { create } = toCreate(
      [item('action', 'Passage électricien'), item('echeance', 'Passage électricien')],
      new Set(),
    )
    expect(create).toHaveLength(2)
  })
})

describe('matchConcretisation — l’identité survit à la correction du texte', () => {
  const registre = [
    {
      item_key: 'action:0',
      entity_type: 'action' as const,
      entity_id: 'act-1',
      created_at: '2026-07-21T06:00:00Z',
      source_text: 'Relancer Yann pour les plans',
    },
  ]
  const item = (label: string, key = 'action:0', kind = 'action') =>
    ({ kind, label, key }) as never

  it('reconnaît un élément au texte inchangé', () => {
    const m = matchConcretisation(item('Relancer Yann pour les plans'), registre)
    expect(m).toMatchObject({ textChanged: false })
    expect(m!.entry.entity_id).toBe('act-1')
  })

  it('le reconnaît ENCORE quand son texte a été corrigé depuis', () => {
    const m = matchConcretisation(item('Relancer Yann — plans du lot 2'), registre)
    expect(m).toMatchObject({ textChanged: true })
    expect(m!.entry.entity_id).toBe('act-1')
  })

  it('ne confond pas deux familles portant la même clé', () => {
    expect(matchConcretisation(item('Relancer Yann pour les plans', 'action:0', 'echeance'), registre)).toBeNull()
  })

  it('ne reconnaît pas un élément réellement neuf', () => {
    expect(matchConcretisation(item('Commander le tableau', 'action:7'), registre)).toBeNull()
  })

  it('n’invente rien quand le registre est vide ou absent', () => {
    expect(matchConcretisation(item('Relancer Yann pour les plans'), [])).toBeNull()
    expect(matchConcretisation(item('Relancer Yann pour les plans'), undefined)).toBeNull()
  })
})

describe('withConcretisation — le registre n’abîme pas le document', () => {
  const sections = [
    { key: 'actions', title: 'Actions', kind: 'generative' as const, content: 'texte', ai_content: 'ia' },
    { key: 'resume', title: 'Résumé', kind: 'generative' as const, content: 'r', ai_content: 'r' },
  ]
  const entry = {
    item_key: 'action:0', entity_type: 'action' as const, entity_id: 'act-9',
    created_at: '2026-07-21T06:00:00Z', source_text: 'Relancer Yann',
  }

  it('inscrit la création dans SA section, et n’écrit que là', () => {
    const out = withConcretisation(sections, 'actions', entry)
    expect(out[0]!.concretisations).toEqual([entry])
    expect(out[1]!.concretisations).toBeUndefined()
  })

  it('ne touche ni au contenu ni à la proposition IA', () => {
    const out = withConcretisation(sections, 'actions', entry)
    expect(out[0]!.content).toBe('texte')
    expect(out[0]!.ai_content).toBe('ia')
  })

  it('empile sans écraser les inscriptions précédentes', () => {
    const once = withConcretisation(sections, 'actions', entry)
    const twice = withConcretisation(once, 'actions', { ...entry, item_key: 'action:1', entity_id: 'act-10' })
    expect(twice[0]!.concretisations).toHaveLength(2)
  })
})

describe('canonicalFamily — les deux portes se reconnaissent', () => {
  it.each([
    ['deadline', 'echeance'],
    ['echeance', 'echeance'],
    ['knowledge', 'memoire'],
    ['memoire', 'memoire'],
    ['stakeholder', 'intervenant'],
    ['intervenant', 'intervenant'],
    ['action', 'action'],
    ['decision', 'decision'],
  ])('%s → %s', (source, attendu) => {
    expect(canonicalFamily(source)).toBe(attendu)
  })

  it('ne force pas une famille pour ce qui ne se concrétise pas', () => {
    expect(canonicalFamily('vigilance')).toBeNull()
    expect(canonicalFamily('inconnu')).toBeNull()
  })
})
