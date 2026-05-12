import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TenderMemoryEntry } from '@/app/(dashboard)/tenders/memoire/TenderMemoryEntry'
import type { TenderMemoryEntry as Entry } from '@/lib/db/tenders'

function fakeEntry(p: Partial<Entry>): Entry {
  return {
    id: p.id ?? '11111111-1111-1111-1111-111111111111',
    title: p.title ?? 'AO test',
    client_name: p.client_name ?? 'Client test',
    status: p.status ?? 'submitted',
    outcome: p.outcome ?? 'lost',
    outcome_at: p.outcome_at ?? '2026-03-14T16:07:00Z',
    outcome_reason: p.outcome_reason ?? null,
    outcome_tag: p.outcome_tag ?? null,
    created_at: p.created_at ?? '2025-12-22T10:00:00Z',
  }
}

// Wrapper <ul> car le composant rend un <li>.
function renderEntry(entry: Entry) {
  return render(
    <ul>
      <TenderMemoryEntry entry={entry} />
    </ul>,
  )
}

describe('TenderMemoryEntry — journal mémoire AO (MC-3)', () => {
  it('entry won → badge "Gagné", aucun tag affiché même si présent', () => {
    const { getByText, queryByTestId } = renderEntry(
      fakeEntry({
        outcome: 'won',
        outcome_tag: 'prix', // ne doit PAS s'afficher pour un won
      }),
    )
    expect(getByText('Gagné')).toBeInTheDocument()
    // Tag affiché uniquement pour outcome=lost (la raison commerciale)
    expect(queryByTestId('tender-memory-tag')).toBeNull()
  })

  it('entry lost avec tag prix → badge "Perdu" + tag "prix"', () => {
    const { getByText, getByTestId } = renderEntry(
      fakeEntry({
        outcome: 'lost',
        outcome_tag: 'prix',
      }),
    )
    expect(getByText('Perdu')).toBeInTheDocument()
    const tagEl = getByTestId('tender-memory-tag')
    expect(tagEl.textContent).toBe('prix')
  })

  it('entry avec outcome_reason → citation italique entre guillemets', () => {
    const { getByTestId, container } = renderEntry(
      fakeEntry({
        outcome: 'lost',
        outcome_reason: 'Concurrent métropolitain moins cher',
      }),
    )
    const reason = getByTestId('tender-memory-reason')
    expect(reason.textContent).toContain('Concurrent métropolitain moins cher')
    // Guillemets français présents (insécables ou normaux)
    expect(container.textContent).toMatch(/«[\s\S]*Concurrent[\s\S]*»/)
    // Italique stylé via classe italic
    expect(reason.className).toContain('italic')
  })

  it('entry sans outcome_reason → pas de bloc citation', () => {
    const { queryByTestId, container } = renderEntry(
      fakeEntry({
        outcome: 'won',
        outcome_reason: null,
      }),
    )
    expect(queryByTestId('tender-memory-reason')).toBeNull()
    // Pas de guillemets de citation dans le DOM.
    expect(container.textContent).not.toMatch(/«[^»]*»/)
  })

  it('date formatée en français (jour mois année)', () => {
    const { container } = renderEntry(
      fakeEntry({
        outcome: 'lost',
        outcome_at: '2026-03-14T16:07:00Z',
      }),
    )
    expect(container.textContent?.toLowerCase()).toContain('mars')
    expect(container.textContent).toContain('2026')
  })

  it('lien href correct vers /tenders/[id]', () => {
    const { container } = renderEntry(
      fakeEntry({ id: 'aaaa1111-1111-1111-1111-111111111111', outcome: 'won' }),
    )
    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe(
      '/tenders/aaaa1111-1111-1111-1111-111111111111',
    )
  })

  it('doctrine V5 — aucun mot interdit dans le DOM (verrou V1 + V4)', () => {
    const { container } = renderEntry(
      fakeEntry({
        outcome: 'lost',
        outcome_reason: 'Différentiel de prix de 8% avec le concurrent',
        outcome_tag: 'prix',
      }),
    )
    const text = container.textContent ?? ''

    // Verrou V1 : pas d'injonction commerciale.
    expect(text).not.toMatch(
      /conseil|recommand|devriez|baissez|augmentez|contactez|relancez|négociez|proposez/i,
    )
    // Verrou V4 : pas de formulation de contrôle.
    expect(text).not.toMatch(
      /pense à|n['’]oublie|cette fois|attention à|tu dois|prochaine fois|améliorer/i,
    )
    // Pas de KPI / analytics anxiogène.
    expect(text).not.toMatch(
      /taux|conversion|funnel|score|classement|tendance|hausse|baisse(?!.*libellé)|graphique|chart/i,
    )
    // Pas de pourcentage commercial calculé (genre "Gagné 28%")
    // Le seul "%" toléré ici serait dans la raison libre saisie par Patrick,
    // mais notre fixture n'en contient pas dans le wording système.
  })
})
