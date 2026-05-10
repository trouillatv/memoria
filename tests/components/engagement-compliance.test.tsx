import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EngagementCompliance } from '@/app/(dashboard)/contracts/[id]/engagement-compliance'
import type { EngagementComplianceRatios } from '@/types/db'

const FULL: EngagementComplianceRatios = { promised: true, planned: 1, executed: 1, proven: 1, validated: 1 }
const PARTIAL: EngagementComplianceRatios = { promised: true, planned: 1, executed: 1, proven: 0.76, validated: 1 }
const RED: EngagementComplianceRatios = { promised: true, planned: 1, executed: 0.4, proven: 0.4, validated: 0.4 }
const EMPTY: EngagementComplianceRatios = { promised: false, planned: 0, executed: 0, proven: 0, validated: 0 }
const PHASE1_PROMISED_ONLY: EngagementComplianceRatios = { promised: true, planned: 0, executed: 0, proven: 0, validated: 0 }

describe('EngagementCompliance — compact mode', () => {
  it('renders 5 dots with status data attributes', () => {
    render(<EngagementCompliance ratios={FULL} size="compact" />)
    expect(screen.getByTestId('compliance-dot-promis')).toBeInTheDocument()
    expect(screen.getByTestId('compliance-dot-planifié')).toBeInTheDocument()
    expect(screen.getByTestId('compliance-dot-exécuté')).toBeInTheDocument()
    expect(screen.getByTestId('compliance-dot-prouvé')).toBeInTheDocument()
    expect(screen.getByTestId('compliance-dot-validé')).toBeInTheDocument()
  })

  it('compact mode does not render percentage text', () => {
    render(<EngagementCompliance ratios={PARTIAL} size="compact" />)
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument()
  })
})

describe('EngagementCompliance — medium mode (default)', () => {
  it('renders 5 segment labels', () => {
    render(<EngagementCompliance ratios={FULL} size="medium" />)
    expect(screen.getByText('PROMIS')).toBeInTheDocument()
    expect(screen.getByText('PLANIFIÉ')).toBeInTheDocument()
    expect(screen.getByText('EXÉCUTÉ')).toBeInTheDocument()
    expect(screen.getByText('PROUVÉ')).toBeInTheDocument()
    expect(screen.getByText('VALIDÉ')).toBeInTheDocument()
  })

  it('renders correct percentage values', () => {
    render(<EngagementCompliance ratios={PARTIAL} size="medium" />)
    // 4 × 100% + 1 × 76%
    const hundreds = screen.getAllByText('100%')
    expect(hundreds.length).toBe(4)
    expect(screen.getByText('76%')).toBeInTheDocument()
  })

  it('phase 1 only PROMIS=100%, others 0%', () => {
    render(<EngagementCompliance ratios={PHASE1_PROMISED_ONLY} size="medium" />)
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getAllByText('0%').length).toBe(4)
  })
})

describe('EngagementCompliance — detail mode', () => {
  it('shows weakest link message when partial', () => {
    render(<EngagementCompliance ratios={PARTIAL} size="detail" />)
    expect(screen.getByText(/maillon faible/i)).toBeInTheDocument()
    expect(screen.getByText(/preuves/i)).toBeInTheDocument()
  })

  it('shows reassuring message when fully green', () => {
    render(<EngagementCompliance ratios={FULL} size="detail" />)
    expect(screen.getByText(/bonne progression/i)).toBeInTheDocument()
  })

  it('shows urgent message when weakest < 50%', () => {
    render(<EngagementCompliance ratios={RED} size="detail" />)
    expect(screen.getByText(/à reprendre cette semaine/i)).toBeInTheDocument()
  })

  it('shows "non activé" when promised=false', () => {
    render(<EngagementCompliance ratios={EMPTY} size="detail" />)
    expect(screen.getByText(/non encore activé/i)).toBeInTheDocument()
  })
})
