// Sprint 4 PC — Tests ChefEquipeCard.
//
// 5 specs :
//   1. Render initial : nom + blocs visibles
//   2. Téléphone manquant → bouton "Envoyer" disabled + lien "Saisir le numéro"
//   3. Téléphone OK → bouton "Envoyer" actif avec wa.me URL générée
//   4. Toggle bloc OFF → message construit sans ce bloc
//   5. Note 140 chars max → input limité

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  ChefEquipeCard,
  buildWhatsAppMessage,
} from '@/app/(dashboard)/preparation/ChefEquipeCard'
import type { ChefEquipePreparation } from '@/lib/db/chef-equipe-preparation'

function makePreparation(
  override: Partial<ChefEquipePreparation> = {},
): ChefEquipePreparation {
  return {
    userId: 'user-aaa-111',
    userFullName: 'Joseph Kanam',
    userPhone: '+687123456',
    forDate: '2026-05-14',
    blocks: {
      passages: [
        { time: '7h', siteName: 'CHT', missionShortLabel: 'bionettoyage' },
        { time: '14h', siteName: 'Lapérouse', missionShortLabel: 'tournée AM' },
      ],
      aSavoir: [
        'CHT : humidité signalée hier',
        'Lapérouse : code accès changé lundi',
      ],
      continuite: ['CHT : 23 passages consécutifs sans rupture'],
      accesInfos: [],
    },
    ...override,
  }
}

beforeEach(() => {
  // Clear localStorage entre tests (badge envoyé).
  if (typeof window !== 'undefined') window.localStorage.clear()
})

describe('ChefEquipeCard', () => {
  it('render initial : nom + blocs visibles', () => {
    render(<ChefEquipeCard preparation={makePreparation()} />)
    expect(screen.getByText('Joseph Kanam')).toBeInTheDocument()
    // Présence des labels de blocs
    expect(screen.getByText(/Passages \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/À savoir \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/Continuité/)).toBeInTheDocument()
    // Au moins une mention site (peut apparaître plusieurs fois : passages,
    // à savoir, continuité).
    expect(screen.getAllByText(/CHT/).length).toBeGreaterThanOrEqual(1)
  })

  it('téléphone manquant → bouton "Envoyer" disabled + lien "Saisir le numéro"', () => {
    render(
      <ChefEquipeCard
        preparation={makePreparation({ userPhone: null })}
      />,
    )
    const disabledBtn = screen.getByTestId('wa-send-disabled')
    expect(disabledBtn).toBeDisabled()
    const link = screen.getByTestId('missing-phone-link') as HTMLAnchorElement
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toBe('/admin/users')
    // Badge "Numéro manquant" présent (plusieurs occurrences possibles, on cible l'un d'eux)
    expect(screen.getAllByText(/numéro manquant/i).length).toBeGreaterThanOrEqual(1)
    // Aucun lien wa.me actif
    expect(screen.queryByTestId('wa-send-link')).toBeNull()
  })

  it('téléphone OK → bouton "Envoyer" actif avec wa.me URL générée', () => {
    render(<ChefEquipeCard preparation={makePreparation()} />)
    const link = screen.getByTestId('wa-send-link') as HTMLAnchorElement
    expect(link).toBeInTheDocument()
    const href = link.getAttribute('href') ?? ''
    // wa.me sans le `+` initial
    expect(href.startsWith('https://wa.me/687123456?text=')).toBe(true)
    // Le message encodé contient le prénom et la mention "Demain"
    const decoded = decodeURIComponent(href.split('?text=')[1] ?? '')
    expect(decoded).toMatch(/Salut Joseph/)
    expect(decoded).toMatch(/Demain/)
    expect(decoded).toMatch(/CHT/)
  })

  it('toggle bloc OFF → message construit sans ce bloc', () => {
    // On teste directement le builder pur — l'UI est testée par les autres specs.
    const prep = makePreparation()
    const allOn = buildWhatsAppMessage({
      preparation: prep,
      includePassages: true,
      includeASavoir: true,
      includeContinuite: true,
      includeAcces: true,
      freeNote: '',
    })
    const noASavoir = buildWhatsAppMessage({
      preparation: prep,
      includePassages: true,
      includeASavoir: false,
      includeContinuite: true,
      includeAcces: true,
      freeNote: '',
    })
    expect(allOn).toMatch(/À savoir/)
    expect(allOn).toMatch(/humidité signalée hier/)
    expect(noASavoir).not.toMatch(/À savoir/)
    expect(noASavoir).not.toMatch(/humidité signalée hier/)
    // Passages doivent toujours être là
    expect(noASavoir).toMatch(/CHT/)
  })

  it('note 140 chars max → input limité', () => {
    render(<ChefEquipeCard preparation={makePreparation()} />)
    const textarea = screen.getByLabelText(/note libre/i) as HTMLTextAreaElement
    // maxLength HTML
    expect(textarea.maxLength).toBe(140)
    // Tente d'injecter > 140 chars via change event — handler tronque à 140.
    const long = 'x'.repeat(200)
    fireEvent.change(textarea, { target: { value: long } })
    expect(textarea.value.length).toBe(140)
    // Compteur visible
    expect(screen.getByText(/140 \/ 140/)).toBeInTheDocument()
  })
})
