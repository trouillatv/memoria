import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PointsPilotageView } from '@/components/knowledge/PointsPilotageView'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sites/site-1/points',
}))

describe('PointsPilotageView — NeedsYou chantier', () => {
  it('affiche les questions chantier avant l’état vide des Points', () => {
    render(
      <PointsPilotageView
        points={[]}
        pointHrefPrefix="/sites/site-1/point"
        siteId="site-1"
        chantierNeedsYouCount={32}
      />,
    )

    expect(screen.queryByText(/aucune question MemorIA en attente/i)).not.toBeInTheDocument()
    expect(screen.getByText('MemorIA a besoin de toi — 32 questions')).toBeInTheDocument()
    expect(screen.getByText('Points à revoir : 0')).toBeInTheDocument()
    expect(screen.getByText('Aucun Point ne nécessite de décision immédiate.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Examiner les questions' })).toHaveAttribute('href', '/sites/site-1/besoin-de-toi')
    expect(screen.getByRole('link', { name: 'Voir les sujets' })).toHaveAttribute('href', '/sites/site-1/points?tab=subject')
    expect(screen.getByRole('link', { name: 'Voir tous les Points' })).toHaveAttribute('href', '/sites/site-1/points?tab=all')

    const needsYou = screen.getByText('MemorIA a besoin de toi — 32 questions')
    const pointDecision = screen.getByText('Points à revoir : 0')
    expect(needsYou.compareDocumentPosition(pointDecision) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
