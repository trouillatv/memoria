import { describe, expect, it } from 'vitest'
import {
  promoteIntoSection,
  traceLine,
  alreadyPromoted,
  notPromotedFrom,
  type PromotionRequest,
} from '@/lib/visits/promotion'
import type { ReportDocumentSection } from '@/types/db'

// ── N3.1 — LA PROMOTION CRÉE DE LA PROVENANCE ───────────────────────────────
//
// Les sections du CR naissent du corpus entier : elles ne savent nommer aucune
// capture. Promouvoir une phrase depuis une preuve crée le maillon manquant —
// et sans inférence, puisque c'est l'humain qui le désigne.

const sections = (): ReportDocumentSection[] => [
  { key: 'resume', title: 'Résumé', kind: 'generative', content: 'La dépose est lancée.', ai_content: 'La dépose est lancée.' },
  { key: 'a_savoir', title: 'À savoir', kind: 'generative', content: '- Le chantier ouvre à 7h', ai_content: '- Le chantier ouvre à 7h' },
  { key: 'actions', title: 'Actions', kind: 'generative', content: '', ai_content: '' },
]

const req = (over: Partial<PromotionRequest> = {}): PromotionRequest => ({
  sectionKey: 'a_savoir',
  text: 'L’accès se fera par le portail, avec un cadenas à code',
  captureId: 'cap-3',
  captureKind: 'vocal',
  capturedAt: '2026-07-20T23:54:00Z',
  promotedAt: '2026-07-22T08:00:00Z',
  promotedBy: 'user-1',
  ...over,
})

describe('Promouvoir ajoute la phrase, et sa provenance', () => {
  it('inscrit la capture d’origine — le maillon qui manquait', () => {
    const { sections: out, added } = promoteIntoSection(sections(), req())
    expect(added).toBe(true)
    const s = out.find((x) => x.key === 'a_savoir')!
    expect(s.promotions).toHaveLength(1)
    expect(s.promotions![0]).toMatchObject({ capture_id: 'cap-3', capture_kind: 'vocal' })
  })

  it('respecte la forme de la section : puce dans une liste', () => {
    const out = promoteIntoSection(sections(), req()).sections
    expect(out.find((x) => x.key === 'a_savoir')!.content).toBe(
      '- Le chantier ouvre à 7h\n- L’accès se fera par le portail, avec un cadenas à code',
    )
  })

  it('respecte la forme de la section : prose dans le résumé', () => {
    const out = promoteIntoSection(sections(), req({ sectionKey: 'resume', text: 'Jérôme était absent.' })).sections
    expect(out.find((x) => x.key === 'resume')!.content).toBe('La dépose est lancée.\nJérôme était absent.')
  })

  it('remplit une section vide sans laisser de ligne morte', () => {
    const out = promoteIntoSection(sections(), req({ sectionKey: 'actions', text: 'Relancer Yann' })).sections
    expect(out.find((x) => x.key === 'actions')!.content).toBe('- Relancer Yann')
  })

  it('ne RÉÉCRIT jamais le texte existant — promouvoir n’est pas corriger', () => {
    const before = sections()
    const out = promoteIntoSection(before, req()).sections
    expect(out.find((x) => x.key === 'resume')!.content).toBe(before[0]!.content)
    expect(out.find((x) => x.key === 'a_savoir')!.ai_content).toBe(before[1]!.ai_content)
  })
})

describe('On ne promeut pas deux fois la même phrase', () => {
  it('refuse un doublon exact', () => {
    const once = promoteIntoSection(sections(), req()).sections
    const twice = promoteIntoSection(once, req())
    expect(twice.added).toBe(false)
    expect(twice.sections.find((x) => x.key === 'a_savoir')!.promotions).toHaveLength(1)
  })

  it('ignore la casse et les espaces multiples', () => {
    const once = promoteIntoSection(sections(), req()).sections
    expect(alreadyPromoted(once.find((x) => x.key === 'a_savoir'), '  L’ACCÈS se fera  par le portail, avec un cadenas à code ')).toBe(true)
  })

  it('refuse aussi une phrase déjà présente dans le texte, même non promue', () => {
    expect(alreadyPromoted(sections()[1], 'Le chantier ouvre à 7h')).toBe(true)
  })

  it('ne fait rien pour une section inconnue ou un texte vide', () => {
    expect(promoteIntoSection(sections(), req({ sectionKey: 'inexistante' })).added).toBe(false)
    expect(promoteIntoSection(sections(), req({ text: '   ' })).added).toBe(false)
  })
})

describe('Remonter d’une ligne jusqu’à sa preuve', () => {
  it('retrouve la capture d’une phrase promue', () => {
    const out = promoteIntoSection(sections(), req()).sections
    const trace = traceLine(out.find((x) => x.key === 'a_savoir'), 'L’accès se fera par le portail, avec un cadenas à code')
    expect(trace).toMatchObject({ capture_id: 'cap-3', captured_at: '2026-07-20T23:54:00Z' })
  })

  it('répond NULL pour une ligne née de l’analyse — et c’est la vérité', () => {
    // Deviner la capture par ressemblance de texte reviendrait à fabriquer la
    // preuve qu'on prétend fournir.
    expect(traceLine(sections()[1], 'Le chantier ouvre à 7h')).toBeNull()
  })
})

describe('La question inverse — ce qui N’EST PAS entré dans le compte-rendu', () => {
  it('liste les phrases d’une preuve restées dehors', () => {
    const out = promoteIntoSection(sections(), req()).sections
    const dehors = notPromotedFrom(out, 'cap-3', [
      'L’accès se fera par le portail, avec un cadenas à code',
      'Clim Expert passe jeudi',
      'AGP interviendra après',
    ])
    expect(dehors).toEqual(['Clim Expert passe jeudi', 'AGP interviendra après'])
  })

  it('ne compte pas les promotions venues d’une AUTRE capture', () => {
    const out = promoteIntoSection(sections(), req()).sections
    expect(notPromotedFrom(out, 'cap-9', ['L’accès se fera par le portail, avec un cadenas à code']))
      .toHaveLength(1)
  })
})
