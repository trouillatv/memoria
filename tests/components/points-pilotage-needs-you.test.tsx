import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PointsPilotageView } from '@/components/knowledge/PointsPilotageView'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sites/site-1/points',
}))

describe('PointsPilotageView — NeedsYou chantier', () => {
  it('affiche la carte chantier même quand aucun Point n’est à revoir', () => {
    render(
      <PointsPilotageView
        points={[]}
        pointHrefPrefix="/sites/site-1/point"
        siteId="site-1"
        chantierNeedsYouCount={32}
      />,
    )

    expect(screen.getByText(/Aucun Point à revoir/)).toBeInTheDocument()
    expect(screen.getByText('MemorIA a besoin de toi — 32 questions')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Examiner les questions' })).toHaveAttribute('href', '/sites/site-1/besoin-de-toi')
  })
})
