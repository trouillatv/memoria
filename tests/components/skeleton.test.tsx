// Slice C.2 — tests primitive Skeleton + patterns.
//
// Doctrine : skeleton sobre + a11y (aria-busy/aria-live) + composabilité
// par className. On vérifie aussi que les patterns rendent bien le bon
// nombre d'enfants.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Skeleton } from '@/components/ui/skeleton'
import {
  SkeletonCardGrid,
  SkeletonFiltersBar,
  SkeletonList,
  SkeletonPageHeader,
  SkeletonPhotoGrid,
} from '@/components/ui/skeleton-patterns'

describe('Skeleton primitive', () => {
  it('renders data-slot + aria-busy + animate-pulse', () => {
    const { container } = render(<Skeleton />)
    const el = container.querySelector('[data-slot="skeleton"]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('aria-busy')).toBe('true')
    expect(el?.getAttribute('aria-live')).toBe('polite')
    expect(el?.className).toContain('animate-pulse')
    expect(el?.className).toContain('bg-muted/60')
  })

  it('merges className from caller (sizing classes applied)', () => {
    const { container } = render(<Skeleton className="h-10 w-32" />)
    const el = container.querySelector('[data-slot="skeleton"]')
    expect(el?.className).toContain('h-10')
    expect(el?.className).toContain('w-32')
    // primitive defaults still present
    expect(el?.className).toContain('animate-pulse')
  })
})

describe('Skeleton patterns', () => {
  it('SkeletonPageHeader renders 2 skeletons (title + subtitle)', () => {
    const { container } = render(<SkeletonPageHeader />)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBe(2)
  })

  it('SkeletonFiltersBar renders 4 skeletons (search + 3 selects)', () => {
    const { container } = render(<SkeletonFiltersBar />)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBe(4)
  })

  it('SkeletonList renders N li elements (count prop)', () => {
    const { container } = render(<SkeletonList count={3} />)
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(3)
  })

  it('SkeletonList defaults to count=5 when no prop', () => {
    const { container } = render(<SkeletonList />)
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(5)
  })

  it('SkeletonCardGrid renders N cards (count prop)', () => {
    const { container } = render(<SkeletonCardGrid count={2} />)
    const cards = container.querySelectorAll('[data-slot="card"]')
    expect(cards.length).toBe(2)
  })

  it('SkeletonPhotoGrid renders N square skeletons (count prop)', () => {
    const { container } = render(<SkeletonPhotoGrid count={6} />)
    // grid children = skeletons themselves
    const grid = container.firstElementChild
    expect(grid?.children.length).toBe(6)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBe(6)
  })
})
