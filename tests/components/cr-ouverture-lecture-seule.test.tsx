import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReportDocumentSection } from '@/types/db'

// LE DÉFAUT OBSERVÉ EN RECETTE (Vincent, 2026-07-21) : ouvrir un CR déjà corrigé
// relançait un chargement d'analyse et mettait l'ancienne synthèse devant le
// document. Ces tests interdisent le retour de ce comportement — ils comptent
// les APPELS, pas seulement ce qui s'affiche.

const analysisSpy = vi.fn()
const summarySpy = vi.fn()
vi.mock('@/app/(field)/m/visite/[reportId]/debrief-actions', () => ({
  getVisitDebriefFieldAction: (...a: unknown[]) => { analysisSpy(...a); return Promise.resolve({ ok: true, status: 'ready', loaded: { analysis: { summary: 'IA' } } }) },
  getVisitSummaryAction: (...a: unknown[]) => { summarySpy(...a); return Promise.resolve({ ok: false }) },
  promoteActionProposalAction: () => Promise.resolve({ ok: true }),
  dismissActionProposalAction: () => Promise.resolve({ ok: true }),
  trackDebriefNarrativeDisplayedAction: () => Promise.resolve({ ok: true }),
}))
vi.mock('@/app/(field)/m/visite/[reportId]/cr/cr-document-actions', () => ({
  saveCrSectionAction: () => Promise.resolve({ ok: true }),
  restoreCrSectionAction: () => Promise.resolve({ ok: true }),
}))

const { MemoriaRetained } = await import('@/app/(field)/m/visite/[reportId]/cr/MemoriaRetained')
const { CrDocumentSections } = await import('@/app/(field)/m/visite/[reportId]/cr/CrDocumentSections')

const SECTION_KEYS = ['resume', 'decisions', 'actions', 'vigilances', 'a_savoir', 'echeances', 'intervenants']
const corrige: ReportDocumentSection[] = SECTION_KEYS.map((key) => ({
  key,
  title: key,
  kind: 'generative',
  content: key === 'resume' ? 'CORRECTION GUILLAUME' : `proposition ${key}`,
  ai_content: `proposition ${key}`,
}))

beforeEach(() => {
  analysisSpy.mockClear()
  summarySpy.mockClear()
  cleanup()
})

describe('Branche 1 — un document existe : l’ouverture est une LECTURE', () => {
  it('n’appelle aucune fonction d’analyse au montage', () => {
    render(<MemoriaRetained reportId="r1" siteId="s1" transcriptions={[]} autoLoad={false} />)
    expect(analysisSpy).not.toHaveBeenCalled()
    expect(summarySpy).not.toHaveBeenCalled()
  })

  it('n’affiche aucun état d’attente — ni analyse, ni ouverture', () => {
    render(<MemoriaRetained reportId="r1" siteId="s1" transcriptions={[]} autoLoad={false} />)
    expect(screen.queryByText(/MemorIA analyse/)).toBeNull()
    expect(screen.queryByText(/Ouverture du compte-rendu/)).toBeNull()
    // Elle reste atteignable d'un geste, mais DISCRÈTE : elle ne concurrence
    // plus le document corrigé, elle explique d'où il vient.
    expect(screen.getByRole('button', { name: 'Voir l’analyse d’origine' })).toBeTruthy()
  })

  it('montre la correction humaine et son bouton Modifier, immédiatement', () => {
    render(<CrDocumentSections reportId="r1" sections={corrige} status="draft" />)
    expect(screen.getByText('CORRECTION GUILLAUME')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Modifier/ })).toHaveLength(7)
  })

  it('ne double NI les régions NI les boutons après un remontage complet', () => {
    const { unmount } = render(<CrDocumentSections reportId="r1" sections={corrige} status="draft" />)
    const before = screen.getAllByRole('button', { name: /Modifier/ }).length
    expect(document.querySelectorAll('[data-section]')).toHaveLength(7)
    unmount()
    render(<CrDocumentSections reportId="r1" sections={corrige} status="draft" />)
    expect(screen.getAllByRole('button', { name: /Modifier/ })).toHaveLength(before)
    expect(document.querySelectorAll('[data-section]')).toHaveLength(7)
    expect(screen.getByText('CORRECTION GUILLAUME')).toBeTruthy()
  })
})

describe('Branche 3 — ni document ni analyse : l’analyse initiale est légitime', () => {
  it('charge, et lui seul le fait', () => {
    render(<MemoriaRetained reportId="r1" siteId="s1" transcriptions={[]} />)
    expect(analysisSpy).toHaveBeenCalledTimes(1)
  })
})
