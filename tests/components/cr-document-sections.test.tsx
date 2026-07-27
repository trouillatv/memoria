import { describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import type { ReportDocumentSection } from '@/types/db'

// L'écran ne doit RIEN écrire tout seul : on remplace les gestes serveur par des
// espions. Si un rendu appelait une action, ce test le verrait.
const saveSpy = vi.fn()
const restoreSpy = vi.fn()
vi.mock('@/app/(field)/m/visite/[reportId]/cr/cr-document-actions', () => ({
  saveCrSectionAction: (...args: unknown[]) => { saveSpy(...args); return Promise.resolve({ ok: true }) },
  restoreCrSectionAction: (...args: unknown[]) => { restoreSpy(...args); return Promise.resolve({ ok: true }) },
}))

const { CrDocumentSections } = await import('@/app/(field)/m/visite/[reportId]/cr/CrDocumentSections')

const sections: ReportDocumentSection[] = [
  { key: 'resume', title: 'Résumé', kind: 'generative', content: 'Résumé corrigé', ai_content: 'Résumé IA' },
  { key: 'decisions', title: 'Décisions', kind: 'generative', content: '- Démarrer jeudi', ai_content: '- Démarrer jeudi' },
  { key: 'actions', title: 'Actions', kind: 'generative', content: 'Écrit à la main' },
  { key: 'vigilances', title: 'Points de vigilance', kind: 'generative', content: '', ai_content: '' },
  { key: 'a_savoir', title: 'À savoir', kind: 'generative', content: '', ai_content: '' },
  { key: 'echeances', title: 'Échéances', kind: 'generative', content: '', ai_content: '' },
  { key: 'intervenants', title: 'Intervenants', kind: 'generative', content: '- AGP', ai_content: '- AGP' },
]

const row = (key: string) => document.querySelector(`[data-section="${key}"]`) as HTMLElement

describe('CrDocumentSections — brouillon', () => {
  it('affiche les rubriques PLEINES en clair, les vides repliées en « compléter »', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    // resume, decisions, actions, intervenants portent du texte → affichées.
    expect(document.querySelectorAll('[data-section]')).toHaveLength(4)
    for (const key of ['resume', 'decisions', 'actions', 'intervenants']) {
      expect(row(key)).toBeTruthy()
    }
    // vigilances, a_savoir, echeances sont vides → repliées, jamais rendues en ligne.
    for (const key of ['vigilances', 'a_savoir', 'echeances']) {
      expect(row(key)).toBeNull()
    }
    expect(screen.getByText('Brouillon — non validé')).toBeTruthy()
  })

  it('propose « Modifier » sur chaque rubrique pleine', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(screen.getAllByRole('button', { name: /Modifier/ })).toHaveLength(4)
  })

  it('n’écrit rien au simple affichage', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(restoreSpy).not.toHaveBeenCalled()
  })

  it('les rubriques vides ne s’enfilent plus en « Rien à ce sujet »', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(screen.queryByText('Rien à ce sujet.')).toBeNull()
  })

  it('« compléter » ouvre une rubrique vide en édition, sans rien écrire', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    // La rubrique vide est un bouton « + Points de vigilance », pas une ligne.
    expect(row('vigilances')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Points de vigilance/ }))
    // Après clic : la ligne apparaît, ouverte en édition (textarea prêt).
    const opened = row('vigilances')
    expect(opened).toBeTruthy()
    expect(within(opened).getByRole('textbox', { name: /Points de vigilance/ })).toBeTruthy()
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('CrDocumentSections — le bouton de restauration ne ment jamais', () => {
  it('apparaît quand une proposition MemorIA existe ET que le texte a bougé', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(within(row('resume')).getByRole('button', { name: /Restaurer l’IA/ })).toBeTruthy()
  })

  it('reste absent quand le texte n’a pas bougé', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(within(row('decisions')).queryByRole('button', { name: /Restaurer l’IA/ })).toBeNull()
  })

  it('reste absent sur une section écrite entièrement à la main', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(within(row('actions')).queryByRole('button', { name: /Restaurer l’IA/ })).toBeNull()
  })
})

describe('CrDocumentSections — lecture seule', () => {
  it.each([
    ['validated', 'Validé'],
    ['exported', 'Exporté'],
  ] as const)('un document %s ne s’édite pas', (status, label) => {
    render(<CrDocumentSections reportId="r1" sections={sections} status={status} />)
    expect(screen.getByText(label)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Modifier/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Restaurer l’IA/ })).toBeNull()
    expect(screen.getByText(/ne se modifie plus/)).toBeTruthy()
  })
})
