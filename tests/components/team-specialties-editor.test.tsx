import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TeamSpecialtiesEditor } from '@/components/ui/team-specialties'
import { INDUSTRY_TEMPLATES } from '@/lib/catalog/industry-templates'

// S2-D : le picker de spécialités d'équipe est piloté par le catalogue métier.
// On prouve le MODÈLE (pas juste le mécanisme) : la MÊME surface affiche le
// vocabulaire propreté OU BTP selon les options du catalogue de l'org.

function optionsFor(template: 'cleaning' | 'construction') {
  return (INDUSTRY_TEMPLATES[template].team_specialty ?? []).map((e) => ({
    key: e.key,
    label: e.label,
  }))
}

describe('TeamSpecialtiesEditor (piloté par le catalogue)', () => {
  it('cleaning : affiche le vocabulaire propreté historique', () => {
    render(<TeamSpecialtiesEditor value={[]} onChange={() => {}} options={optionsFor('cleaning')} />)
    for (const label of ['Bio-nettoyage', 'Désinfection', 'Hospitalier', 'Vitres en hauteur', 'Conciergerie']) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
    // Aucun vocabulaire BTP ne fuit dans une org propreté.
    expect(screen.queryByRole('button', { name: /Gros œuvre/i })).not.toBeInTheDocument()
  })

  it('construction : la même surface affiche un vocabulaire BTP / corps d’état crédible', () => {
    render(<TeamSpecialtiesEditor value={[]} onChange={() => {}} options={optionsFor('construction')} />)
    for (const label of ['Gros œuvre', 'VRD', 'Électricité', 'Plomberie', 'CVC', 'Étanchéité']) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
    // Le vocabulaire propreté n'apparaît pas dans une org BTP.
    expect(screen.queryByRole('button', { name: /Bio-nettoyage/i })).not.toBeInTheDocument()
  })

  it('clés construction conformes au CHECK SQL (^[a-z0-9-]+$, ≤32)', () => {
    for (const e of INDUSTRY_TEMPLATES.construction.team_specialty ?? []) {
      expect(e.key).toMatch(/^[a-z0-9-]+$/)
      expect(e.key.length).toBeLessThanOrEqual(32)
    }
  })
})
