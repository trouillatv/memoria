import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  it('affiche les sept sections du document', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(document.querySelectorAll('[data-section]')).toHaveLength(7)
    expect(screen.getByText('Brouillon — non validé')).toBeTruthy()
  })

  it('propose « Modifier » sur chaque section', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(screen.getAllByRole('button', { name: /Modifier/ })).toHaveLength(7)
  })

  it('n’écrit rien au simple affichage', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(restoreSpy).not.toHaveBeenCalled()
  })

  it('dit le vide au lieu de l’inventer', () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    expect(within(row('vigilances')).getByText('Rien à ce sujet.')).toBeTruthy()
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
