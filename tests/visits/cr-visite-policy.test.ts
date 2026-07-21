import { describe, expect, it } from 'vitest'
import {
  decideVisitCrDocument,
  hasHumanEdits,
  restoreSectionProposal,
  withAiBaseline,
} from '@/lib/visits/cr-visite-policy'
import type { ReportDocumentSection } from '@/types/db'

const ai: ReportDocumentSection[] = [
  { key: 'resume', title: 'Résumé', kind: 'generative', content: 'La dépose est lancée.', ai_content: 'La dépose est lancée.' },
  { key: 'decisions', title: 'Décisions', kind: 'generative', content: '- Démarrer jeudi', ai_content: '- Démarrer jeudi' },
]

describe('decideVisitCrDocument — get or create, JAMAIS get or overwrite', () => {
  it('crée seulement quand aucun document n’existe', () => {
    expect(decideVisitCrDocument(null)).toEqual({ action: 'create' })
  })

  it.each(['draft', 'validated', 'exported'] as const)(
    'réutilise un document existant en %s sans toucher à ses sections',
    (status) => {
      expect(decideVisitCrDocument({ status })).toEqual({ action: 'reuse' })
    },
  )
})

describe('withAiBaseline — l’origine IA est conservée à part de la version éditée', () => {
  it('fige la proposition IA au moment de la création', () => {
    const sections = withAiBaseline([
      { key: 'resume', title: 'Résumé', kind: 'generative', content: 'Texte IA' },
    ])
    expect(sections[0]).toMatchObject({ content: 'Texte IA', ai_content: 'Texte IA' })
  })

  it('ne réécrit pas une origine déjà posée', () => {
    const corrigee: ReportDocumentSection[] = [
      { key: 'resume', title: 'Résumé', kind: 'generative', content: 'Texte corrigé', ai_content: 'Texte IA' },
    ]
    expect(withAiBaseline(corrigee)[0]).toMatchObject({ content: 'Texte corrigé', ai_content: 'Texte IA' })
  })
})

describe('restoreSectionProposal — « revenir à la proposition »', () => {
  const corrige: ReportDocumentSection[] = [
    { ...ai[0]!, content: 'Résumé réécrit par Guillaume' },
    { ...ai[1]!, content: '- Démarrer vendredi, pas jeudi' },
  ]

  it('ne restaure QUE la section ciblée', () => {
    const out = restoreSectionProposal(corrige, 'resume')
    expect(out[0]!.content).toBe('La dépose est lancée.')
    expect(out[1]!.content).toBe('- Démarrer vendredi, pas jeudi')
  })

  it('laisse le tableau intact pour une clé inconnue', () => {
    expect(restoreSectionProposal(corrige, 'inexistante')).toEqual(corrige)
  })

  it('ne vide jamais une section sans origine IA connue', () => {
    const sansOrigine: ReportDocumentSection[] = [
      { key: 'resume', title: 'Résumé', kind: 'generative', content: 'Écrit à la main' },
    ]
    expect(restoreSectionProposal(sansOrigine, 'resume')).toEqual(sansOrigine)
  })

  it('ne mute pas le tableau reçu', () => {
    const avant = JSON.parse(JSON.stringify(corrige))
    restoreSectionProposal(corrige, 'resume')
    expect(corrige).toEqual(avant)
  })
})

describe('hasHumanEdits — la garde contre toute régénération', () => {
  it('est faux tant que rien n’a été corrigé', () => {
    expect(hasHumanEdits(ai)).toBe(false)
  })

  it('est vrai dès qu’une seule section diffère de sa proposition', () => {
    expect(hasHumanEdits([ai[0]!, { ...ai[1]!, content: '- Démarrer vendredi' }])).toBe(true)
  })

  it('traite une section sans origine IA comme humaine — dans le doute, on protège', () => {
    expect(hasHumanEdits([{ key: 'libre', title: 'Libre', kind: 'generative', content: 'ajout' }])).toBe(true)
  })
})
