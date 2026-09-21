import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PointsDeltaView } from '@/components/knowledge/PointsDeltaView'
import type { PointListEntry } from '@/lib/knowledge/tracked-point-list'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const LAST_PV = '2026-09-20'

function entry(overrides: Partial<PointListEntry> = {}): PointListEntry {
  return {
    id: 'p1',
    siteId: 's1',
    label: 'Extincteurs hall A',
    derivedState: 'open',
    latestMeaningfulEventAt: '2026-01-01',
    ownerCanonicalSubjectId: 'subj-1',
    subjectLabel: 'Extincteurs',
    actorNames: [],
    needsYouCount: 0,
    needsYouQuestionId: null,
    reviewReasons: [],
    isLingering: false,
    isChangedSinceLastPv: false,
    firstDocumentaryMentionAt: null,
    lastDocumentaryMentionAt: null,
    mentionsCount: 1,
    openedAt: null,
    passagesSinceEvent: null,
    totalSiteVisits: 1,
    daysSinceLastEvent: null,
    reviewFingerprint: null,
    isReviewed: false,
    reviewedAt: null,
    actionCount: 0,
    correctiveActionCount: 0,
    reserveCount: 0,
    deadlineCount: 0,
    nextDeadlineDate: null,
    ...overrides,
  }
}

// GO Vincent 2026-09-22 — séparation occurrence/état. Partition mutuellement exclusive :
// un changement d'état prime toujours sur une mention documentaire, jamais l'inverse.
describe('PointsDeltaView — catégorisation mention/état (GO Vincent 2026-09-22)', () => {
  it('Première mention : firstDocumentaryMentionAt = dernier PV, état inchangé', () => {
    const points = [
      entry({ id: 'a', label: 'Point A — première mention', firstDocumentaryMentionAt: LAST_PV, lastDocumentaryMentionAt: LAST_PV }),
    ]
    render(<PointsDeltaView points={points} pointHrefPrefix="/sites/s1/point" lastPvDate={LAST_PV} />)
    expect(screen.getByText(/Première mention \(1\)/)).toBeInTheDocument()
    expect(screen.getByText('Point A — première mention')).toBeInTheDocument()
  })

  it('Mentionné sans évolution : lastDocumentaryMentionAt = dernier PV mais pas la première mention', () => {
    const points = [
      entry({
        id: 'b',
        label: 'Point B — mentionné sans évolution',
        firstDocumentaryMentionAt: '2026-01-01',
        lastDocumentaryMentionAt: LAST_PV,
      }),
    ]
    render(<PointsDeltaView points={points} pointHrefPrefix="/sites/s1/point" lastPvDate={LAST_PV} />)
    // Pas de section dédiée (compté dans le résumé), et jamais listé comme « Première mention ».
    expect(screen.queryByText(/Première mention/)).not.toBeInTheDocument()
    expect(screen.getByText(/1 mentionné sans évolution/)).toBeInTheDocument()
    expect(screen.queryByText('Point B — mentionné sans évolution')).not.toBeInTheDocument()
  })

  it('Non mentionné : ni première ni dernière mention au dernier PV', () => {
    const points = [
      entry({
        id: 'c',
        label: 'Point C — non mentionné',
        firstDocumentaryMentionAt: '2025-01-01',
        lastDocumentaryMentionAt: '2025-06-01',
      }),
    ]
    render(<PointsDeltaView points={points} pointHrefPrefix="/sites/s1/point" lastPvDate={LAST_PV} />)
    expect(screen.getByText(/1 non mentionné/)).toBeInTheDocument()
  })

  it('non-régression : Réouvert prime sur une mention au dernier PV (jamais classé Première mention)', () => {
    const points = [
      entry({
        id: 'd',
        label: 'Point D — réouvert',
        derivedState: 'reopened',
        isChangedSinceLastPv: true,
        latestMeaningfulEventAt: LAST_PV,
        firstDocumentaryMentionAt: LAST_PV,
        lastDocumentaryMentionAt: LAST_PV,
      }),
    ]
    render(<PointsDeltaView points={points} pointHrefPrefix="/sites/s1/point" lastPvDate={LAST_PV} />)
    expect(screen.getByText(/Réouverts \(1\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Première mention/)).not.toBeInTheDocument()
  })

  it('non-régression : Résolu prime sur une mention au dernier PV (jamais classé Première mention)', () => {
    const points = [
      entry({
        id: 'e',
        label: 'Point E — résolu',
        derivedState: 'resolved',
        isChangedSinceLastPv: true,
        latestMeaningfulEventAt: LAST_PV,
        firstDocumentaryMentionAt: LAST_PV,
        lastDocumentaryMentionAt: LAST_PV,
      }),
    ]
    render(<PointsDeltaView points={points} pointHrefPrefix="/sites/s1/point" lastPvDate={LAST_PV} />)
    expect(screen.getByText(/Résolus \(1\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Première mention/)).not.toBeInTheDocument()
  })

  it('un Point sans dernier PV connu (lastPvDate null) n’est jamais classé première mention', () => {
    const points = [entry({ id: 'f', firstDocumentaryMentionAt: '2026-01-01', lastDocumentaryMentionAt: '2026-01-01' })]
    render(<PointsDeltaView points={points} pointHrefPrefix="/sites/s1/point" lastPvDate={null} />)
    expect(screen.queryByText(/Première mention/)).not.toBeInTheDocument()
    expect(screen.getByText(/1 non mentionné/)).toBeInTheDocument()
  })
})
