import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SiteChronologyComposition } from '@/app/(dashboard)/sites/[id]/SiteViewComposition'

describe('site view composition', () => {
  it('positions narrative reading as a chronology mode without exposing a fake timeline tab', () => {
    render(<SiteChronologyComposition siteId="site-1" />)

    expect(screen.getByRole('link', { name: 'Flux' })).toHaveAttribute('href', '/sites/site-1?tab=chronologie')
    expect(screen.getByRole('link', { name: 'Lire le récit' })).toHaveAttribute('href', '/sites/site-1/recit')
    expect(screen.queryByRole('link', { name: 'Frise' })).not.toBeInTheDocument()
  })
})
