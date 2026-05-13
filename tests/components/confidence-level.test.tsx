// Sprint 3 — UX-8 Mode litige express : tests ConfidenceLevel.
//
// Doctrine V5 — Verrou V1 + Verrou V4 (strict) :
//   - AUCUN score numérique
//   - AUCUN %
//   - AUCUN classement
//   - Wording strictement passif descriptif.
//
// Wording INTERDIT (regex doctrinale) :
//   « Excellent », « Faible », « Mauvais », « Risque », « Score », « % »,
//   « note.*sur », « performance », « classement ».

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ConfidenceLevel,
  isDossierComplete,
} from '@/app/(dashboard)/litige/ConfidenceLevel'

describe('ConfidenceLevel — seuils & affirmations passives', () => {
  it('interventionsCount=0 → aucune affirmation "Interventions documentées"', () => {
    const { container } = render(
      <ConfidenceLevel
        interventionsCount={0}
        photosCount={5}
        anomaliesCount={0}
        validationsCount={0}
      />,
    )
    expect(container.textContent ?? '').not.toMatch(/Interventions documentées/i)
    // En revanche "Photos suffisantes" reste possible si photosCount >= 3.
    expect(container.textContent ?? '').toMatch(/Photos suffisantes/i)
  })

  it('photosCount < 3 et > 0 → "Peu de photos disponibles" en ambre', () => {
    render(
      <ConfidenceLevel
        interventionsCount={1}
        photosCount={2}
        anomaliesCount={0}
        validationsCount={0}
      />,
    )
    const li = screen.getByText(/Peu de photos disponibles/i).closest('li')
    expect(li).not.toBeNull()
    expect(li?.getAttribute('data-ok')).toBe('false')
    // Pas de "Photos suffisantes" dans ce cas.
    expect(screen.queryByText(/Photos suffisantes/i)).toBeNull()
  })

  it('photosCount >= 3 → "Photos suffisantes" en emerald', () => {
    render(
      <ConfidenceLevel
        interventionsCount={1}
        photosCount={5}
        anomaliesCount={0}
        validationsCount={0}
      />,
    )
    const li = screen.getByText(/Photos suffisantes/i).closest('li')
    expect(li).not.toBeNull()
    expect(li?.getAttribute('data-ok')).toBe('true')
  })

  it('dossier complet → affiche "Dossier complet · Preuves cohérentes"', () => {
    render(
      <ConfidenceLevel
        interventionsCount={3}
        photosCount={10}
        anomaliesCount={0}
        validationsCount={1}
      />,
    )
    expect(screen.getByTestId('confidence-complete')).toHaveTextContent(
      /Dossier complet · Preuves cohérentes/i,
    )
  })

  it('isDossierComplete() retourne false si photos < 3', () => {
    expect(
      isDossierComplete({
        interventionsCount: 5,
        photosCount: 2,
        anomaliesCount: 0,
        validationsCount: 5,
      }),
    ).toBe(false)
  })
})

describe('ConfidenceLevel — doctrine V5 (wording strict)', () => {
  // Mots strictement interdits par la doctrine V5.
  const FORBIDDEN =
    /(Excellent|Faible|Mauvais|Risque|Score|note\s+sur|performance|classement|%)/i

  it('rendu (cas complet) : aucun mot interdit dans le DOM', () => {
    const { container } = render(
      <ConfidenceLevel
        interventionsCount={5}
        photosCount={10}
        anomaliesCount={0}
        validationsCount={2}
      />,
    )
    expect(container.textContent ?? '').not.toMatch(FORBIDDEN)
  })

  it('rendu (cas avec peu de photos) : aucun mot interdit', () => {
    const { container } = render(
      <ConfidenceLevel
        interventionsCount={1}
        photosCount={1}
        anomaliesCount={2}
        validationsCount={0}
      />,
    )
    expect(container.textContent ?? '').not.toMatch(FORBIDDEN)
  })

  it('rendu (cas vide) : aucun mot interdit + message neutre', () => {
    const { container } = render(
      <ConfidenceLevel
        interventionsCount={0}
        photosCount={0}
        anomaliesCount={1}
        validationsCount={0}
      />,
    )
    expect(container.textContent ?? '').not.toMatch(FORBIDDEN)
  })
})
