import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { MobileBottomNav } from '@/components/layout/MobileBottomNav'

describe('MobileBottomNav', () => {
  it('opens the account page from the Profil button', () => {
    render(<MobileBottomNav />)

    expect(screen.getByRole('link', { name: /profil/i })).toHaveAttribute('href', '/account')
  })
})
