import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CockpitNow } from '@/app/(dashboard)/dashboard/CockpitNow'
import type { NowCard } from '@/lib/situations/now/types'

const nowCard: NowCard = {
  id: 'signal-1',
  icon: 'document',
  tone: 'neutral',
  title: 'Annonce à confirmer',
  description: 'Aucune échéance structurée n’est disponible pour cette annonce.',
  siteLabel: 'CAFAT Centre-ville',
  organizationLabel: 'Demo Org',
  timingLabel: 'Aucune confirmation depuis 15 jours',
  sourceLabel: 'Visite du 21 juillet',
  primaryAction: { kind: 'open_source', label: 'Voir la source', href: '/visites/visit-1' },
  secondaryActions: [],
}

describe('CockpitNow', () => {
  it('rend les cartes Now sans afficher le message vide', () => {
    render(
      <CockpitNow
        signals={[]}
        nowCards={[nowCard]}
        summary={{ overdueActions: 1, imminentPassages: 0, weekDeadlines: 0 }}
        organizationMap={{ 'org-1': { id: 'org-1', name: 'Demo Org', slug: 'demo', logoPath: null, logoUrl: null, brandColor: null } }}
      />,
    )

    expect(screen.getByText('Situations avec geste direct')).toBeInTheDocument()
    expect(screen.getByText('Annonce à confirmer')).toBeInTheDocument()
    expect(screen.queryByText('Rien ne demande une intervention immédiate.')).not.toBeInTheDocument()
  })

  it('affiche le message vide uniquement quand il n’y a ni NowCard ni priorité existante', () => {
    render(
      <CockpitNow
        signals={[]}
        nowCards={[]}
        summary={{ overdueActions: 0, imminentPassages: 0, weekDeadlines: 0 }}
        organizationMap={{}}
      />,
    )

    expect(screen.getByText('Rien ne demande une intervention immédiate.')).toBeInTheDocument()
  })
})
