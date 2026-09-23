import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// BUG UX BLOQUANT (Vincent 2026-09-23) — Import documentaire / création de
// collection : un utilisateur multi-organisation (ex. vient de créer un
// chantier AGP) atterrissait sur « Sélectionnez une organisation » sans AUCUN
// sélecteur exploitable, car NewCollectionForm n'avait aucun champ
// organization_id. Ces tests protègent le contrat cible :
//   - une seule organisation accessible (ou site déjà contextualisé) →
//     présélection silencieuse, jamais de sélecteur affiché ;
//   - plusieurs organisations accessibles → un vrai <select> est rendu.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/app/(dashboard)/documents/actions', () => ({
  createDocumentCollectionAction: vi.fn(async () => ({ ok: true, collectionId: 'c1' })),
}))

const { NewCollectionForm } = await import('@/app/(dashboard)/documents/NewCollectionForm')

const AGP = '33333333-3333-3333-3333-333333333333'
const CAPSE = '44444444-4444-4444-4444-444444444444'

describe('NewCollectionForm — organisation jamais bloquante', () => {
  it('une seule organisation accessible → présélection silencieuse, aucun sélecteur visible', () => {
    render(<NewCollectionForm orgs={[{ id: AGP, label: 'AGP' }]} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText(/Sélectionnez une organisation/i)).toBeNull()
  })

  it('plusieurs organisations accessibles → un vrai sélecteur est proposé', () => {
    render(
      <NewCollectionForm
        orgs={[
          { id: AGP, label: 'AGP' },
          { id: CAPSE, label: 'CAPSE NC' },
        ]}
      />,
    )
    const select = screen.getByRole('combobox')
    expect(select).toBeTruthy()
    expect(screen.getByText('AGP')).toBeTruthy()
    expect(screen.getByText('CAPSE NC')).toBeTruthy()
  })

  it('jamais d’état « sélectionnez une organisation » sans moyen de la sélectionner (0 org = aucun champ, pas un texte muet)', () => {
    render(<NewCollectionForm />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText(/Sélectionnez une organisation/i)).toBeNull()
  })
})
