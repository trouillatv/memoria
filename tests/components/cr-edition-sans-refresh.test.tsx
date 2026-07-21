import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReportDocumentSection } from '@/types/db'

// L'ÉDITION NE DOIT PAS RECONSTRUIRE LA PAGE (Vincent, 2026-07-21).
// Corriger la sixième section puis repartir en haut de page, c'est perdre le
// contexte à chaque enregistrement — et croire que le bloc a disparu.
// Ces tests prouvent qu'aucun rafraîchissement global n'a lieu, que la réponse
// SERVEUR est adoptée, et qu'un échec ne mange pas le travail en cours.

const refreshSpy = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshSpy, push: vi.fn(), replace: vi.fn() }),
}))

const saveSpy = vi.fn()
let saveResult: unknown = null
const restoreSpy = vi.fn()
vi.mock('@/app/(field)/m/visite/[reportId]/cr/cr-document-actions', () => ({
  saveCrSectionAction: (...a: unknown[]) => { saveSpy(...a); return Promise.resolve(saveResult) },
  restoreCrSectionAction: (...a: unknown[]) => { restoreSpy(...a); return Promise.resolve(saveResult) },
}))

const { CrDocumentSections } = await import('@/app/(field)/m/visite/[reportId]/cr/CrDocumentSections')

const KEYS = ['resume', 'decisions', 'actions', 'vigilances', 'a_savoir', 'echeances', 'intervenants']
const sections: ReportDocumentSection[] = KEYS.map((key) => ({
  key,
  title: key,
  kind: 'generative',
  content: `proposition ${key}`,
  ai_content: `proposition ${key}`,
}))

/** La réponse du serveur : la section basse « echeances » a été persistée. */
const persisted = {
  ok: true,
  document: {
    id: 'doc-1',
    status: 'draft' as const,
    sections: sections.map((s) => (s.key === 'echeances' ? { ...s, content: 'TEXTE CORRIGÉ' } : s)),
    updatedAt: '2026-07-21T06:00:00Z',
  },
}

const row = (key: string) => document.querySelector(`[data-section="${key}"]`) as HTMLElement

beforeEach(() => {
  refreshSpy.mockClear()
  saveSpy.mockClear()
  restoreSpy.mockClear()
  saveResult = persisted
})

async function editSection(key: string, texte: string) {
  fireEvent.click(within(row(key)).getByRole('button', { name: /Modifier/ }))
  fireEvent.change(within(row(key)).getByRole('textbox'), { target: { value: texte } })
  fireEvent.click(within(row(key)).getByRole('button', { name: /Enregistrer/ }))
}

describe('Éditer une section basse ne reconstruit pas la page', () => {
  it('adopte la réponse du serveur, sans rafraîchissement global', async () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    await editSection('echeances', 'TEXTE CORRIGÉ')

    await waitFor(() => expect(within(row('echeances')).getByText('TEXTE CORRIGÉ')).toBeTruthy())
    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('laisse la section montée et les autres intactes', async () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    await editSection('echeances', 'TEXTE CORRIGÉ')

    await waitFor(() => expect(within(row('echeances')).getByText('TEXTE CORRIGÉ')).toBeTruthy())
    expect(document.querySelectorAll('[data-section]')).toHaveLength(7)
    expect(within(row('resume')).getByText('proposition resume')).toBeTruthy()
    expect(within(row('a_savoir')).getByText('proposition a_savoir')).toBeTruthy()
  })

  it('n’écrit qu’une fois même sur un double clic', async () => {
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    fireEvent.click(within(row('echeances')).getByRole('button', { name: /Modifier/ }))
    const bouton = within(row('echeances')).getByRole('button', { name: /Enregistrer/ })
    fireEvent.click(bouton)
    fireEvent.click(bouton)
    await waitFor(() => expect(saveSpy).toHaveBeenCalled())
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})

describe('Un échec serveur ne mange pas le travail en cours', () => {
  it('garde le texte saisi et affiche l’erreur près de la section', async () => {
    saveResult = { ok: false, error: 'Enregistrement impossible' }
    render(<CrDocumentSections reportId="r1" sections={sections} status="draft" />)
    await editSection('echeances', 'MON TRAVAIL')

    await waitFor(() => expect(within(row('echeances')).getByText('Enregistrement impossible')).toBeTruthy())
    expect((within(row('echeances')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('MON TRAVAIL')
    expect(refreshSpy).not.toHaveBeenCalled()
  })
})

describe('« Restaurer l’IA » suit aussi la réponse du serveur', () => {
  it('adopte ce que la base porte, sans supposer côté client', async () => {
    const corrige = sections.map((s) => (s.key === 'resume' ? { ...s, content: 'à jeter' } : s))
    saveResult = { ok: true, document: { id: 'doc-1', status: 'draft' as const, sections, updatedAt: 'x' } }
    render(<CrDocumentSections reportId="r1" sections={corrige} status="draft" />)

    fireEvent.click(within(row('resume')).getByRole('button', { name: /Restaurer l’IA/ }))
    await waitFor(() => expect(within(row('resume')).getByText('proposition resume')).toBeTruthy())
    expect(restoreSpy).toHaveBeenCalledWith('r1', 'resume')
    expect(refreshSpy).not.toHaveBeenCalled()
  })
})
