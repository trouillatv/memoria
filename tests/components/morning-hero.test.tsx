// LE MATIN — hero de l'Accueil alimenté par la Nuit (mig 191).
// Doctrine testée : voix narrative FACTUELLE (nombres réels), provenance
// toujours visible, max 2 chantiers en focus, CTA de transition
// (« Commencer ma journée » → premier chantier en focus, sinon /aujourdhui),
// silence vert compact.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MorningHero } from '@/app/(dashboard)/dashboard/MorningHero'
import type { OrgMorningDigest, SiteMorningDigestRow } from '@/lib/db/morning-digest'
import type { MemorySignal, SignalKind } from '@/lib/db/site-memory-signals'

function signal(kind: SignalKind, itemCount = 1): MemorySignal {
  return {
    kind,
    title: `${itemCount} signal ${kind}`,
    items: Array.from({ length: itemCount }, (_, i) => ({
      id: `${kind}-${i}`,
      label: `élément ${kind} ${i}`,
      context: [`Ouvert depuis ${10 + i} j`],
    })),
    source: 'test',
  }
}

function siteRow(siteId: string, name: string, signals: MemorySignal[]): SiteMorningDigestRow {
  return {
    siteId,
    siteName: name,
    digestDate: '2026-07-09',
    signals,
    signalCount: signals.reduce((n, s) => n + s.items.length, 0),
    computedAt: '2026-07-08T18:17:00.000Z', // 05h17 Nouméa le 09/07
  }
}

function digest(sites: SiteMorningDigestRow[]): OrgMorningDigest {
  return {
    date: '2026-07-09',
    sites,
    totalSignals: sites.reduce((n, s) => n + s.signalCount, 0),
    computedAt: sites[0]?.computedAt ?? null,
  }
}

describe('MorningHero — état signaux', () => {
  const d = digest([
    siteRow('a', 'Lycée de Païta', [signal('action_overdue', 3), signal('reserve_open', 1)]),
    siteRow('b', 'Extension Médipôle', [signal('decision_unapplied', 1)]),
    siteRow('c', 'Anse Vata', []),
    siteRow('d', 'Port Autonome', []),
  ])

  it('voix narrative factuelle : chantiers relus + attention', () => {
    render(<MorningHero digest={d} />)
    expect(screen.getByText(/Cette nuit, MemorIA a relu tes 4 chantiers\. Deux réclament ton attention\./)).toBeInTheDocument()
  })

  it('provenance toujours visible : heure Nouméa + volume + zéro IA', () => {
    render(<MorningHero digest={d} />)
    expect(screen.getByText(/Relu cette nuit à 05h17 · 4 chantiers · zéro IA/)).toBeInTheDocument()
  })

  it('CTA intelligent : le libellé porte la destination (premier focus)', () => {
    render(<MorningHero digest={d} />)
    const cta = screen.getByRole('link', { name: /commencer ma journée — Lycée de Païta/i })
    expect(cta.getAttribute('href')).toBe('/sites/a')
  })

  it('le chantier le plus pressant (actions en retard) passe en premier', () => {
    render(<MorningHero digest={d} />)
    const links = screen.getAllByRole('link', { name: /Lycée de Païta|Extension Médipôle/ })
    expect(links[0]).toHaveTextContent('Lycée de Païta')
  })

  it('les chantiers silencieux sont comptés, jamais détaillés', () => {
    render(<MorningHero digest={d} />)
    expect(screen.getByText(/2 .*n'ont rien signalé cette nuit/)).toBeInTheDocument()
    expect(screen.queryByText('Anse Vata')).toBeNull()
  })

  it('au plus 2 chantiers en focus, même si 3 ont signalé', () => {
    const d3 = digest([
      siteRow('a', 'Site A', [signal('action_overdue', 2)]),
      siteRow('b', 'Site B', [signal('reserve_open', 1)]),
      siteRow('c', 'Site C', [signal('decision_unapplied', 1)]),
    ])
    render(<MorningHero digest={d3} />)
    // 2 focus détaillés + 1 « a aussi signalé »
    expect(screen.getByText(/1 autre chantier a aussi signalé/)).toBeInTheDocument()
  })
})

describe('MorningHero — silence vert compact', () => {
  const quiet = digest([siteRow('a', 'Site A', []), siteRow('b', 'Site B', [])])

  it('« rien n’a été oublié » — prouvé, pas absent', () => {
    render(<MorningHero digest={quiet} />)
    expect(screen.getByText(/Cette nuit, MemorIA a relu tes 2 chantiers\. Rien n'a été oublié\./)).toBeInTheDocument()
    expect(screen.getByText(/Relu cette nuit à 05h17/)).toBeInTheDocument()
  })

  it('CTA de transition → /aujourdhui quand aucun focus (libellé adapté)', () => {
    render(<MorningHero digest={quiet} />)
    const cta = screen.getByRole('link', { name: /voir ma journée/i })
    expect(cta.getAttribute('href')).toBe('/aujourdhui')
  })
})
