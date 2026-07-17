import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentsWorkspace } from '@/app/(dashboard)/sites/[id]/views/documents/DocumentsWorkspace'
import { MemoryWorkspace } from '@/app/(dashboard)/sites/[id]/views/memory/MemoryWorkspace'
import { WorkWorkspace } from '@/app/(dashboard)/sites/[id]/views/work/WorkWorkspace'
import { ChronologyWorkspace } from '@/app/(dashboard)/sites/[id]/views/chronology/ChronologyWorkspace'
import { PlanningWorkspace } from '@/app/(dashboard)/sites/[id]/views/planning/PlanningWorkspace'

// Mémoire porte désormais la passation, donc un composant client (useRouter).
vi.mock('@/app/(dashboard)/handovers/actions', () => ({
  createTeamTakesSiteBriefAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

describe('site workspaces', () => {
  // ── LA MÉMOIRE DESKTOP MONTRE LA CONNAISSANCE, PAS SEULEMENT LES DÉTECTEURS ──
  // Elle ne lisait QUE `signals` (actions en retard, décisions sans suite). Un
  // chantier avec deux informations à confirmer affichait « aucune information
  // n'a encore été marquée comme durable » — et l'Aperçu, lui, annonçait
  // « 3 à confirmer » en pointant ICI. Deux écrans, deux vérités.
  it('shows what the site knows and what awaits a human, not just detectors', () => {
    render(
      <MemoryWorkspace
        siteId="site-1"
        questionSlot={<div role="search">Question réelle</div>}
        signals={[]}
        subjects={[]}
        review={{
          confirmed: [
            { id: 'k-1', group: 'Décisions', title: 'Les accès seront communiqués ultérieurement', nature: null },
          ],
          toReview: [
            {
              id: 'p-1',
              kind: 'knowledge',
              title: 'Les électriciens vont vérifier les consignations',
              body: null,
              createdAt: '2026-07-15T02:07:00.000Z',
              capability: {
                available: true,
                label: 'Ajouter à la mémoire',
                requiredInputs: ['nature'],
                explanation: null,
              },
              provenance: { reportId: 'r-1', visitedAt: '2026-07-15T02:07:00.000Z', photos: 4, vocals: 2 },
            },
          ],
        }}
      />,
    )

    const knows = screen.getByRole('region', { name: 'Ce que le chantier sait' })
    expect(within(knows).getByText('Les accès seront communiqués ultérieurement')).toBeInTheDocument()
    expect(within(knows).getByText('Les électriciens vont vérifier les consignations')).toBeInTheDocument()
    // Le verbe vient du contrat (`capability.label`), jamais du JSX.
    expect(within(knows).getByRole('button', { name: /Ajouter à la mémoire/ })).toBeInTheDocument()
    // Le mensonge d'origine ne doit plus pouvoir s'afficher quand le savoir existe.
    expect(screen.queryByText(/marquée comme durable/)).not.toBeInTheDocument()
  })

  it('makes memory a workspace for retrieving what the site knows', () => {
    render(
      <MemoryWorkspace
        siteId="site-1"
        questionSlot={<div role="search">Question réelle</div>}
        signals={[
          {
            kind: 'decision_unapplied',
            title: '1 décision jamais appliquée',
            source: 'Décisions actées',
            items: [{ id: 'd-1', label: 'Changer le fournisseur', meta: 'Menuiserie' }],
          },
        ]}
        subjects={[
          {
            id: 'subject-1',
            name: "Fuites d'eau",
            status: 'open',
            scopeId: null,
            openActions: 3,
            lateActions: 1,
            openReserves: 2,
            decisions: 1,
            documents: 5,
            lastActivity: '2026-07-13T08:00:00.000Z',
            criticality: 'haute',
          },
        ]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Mémoire' })).toBeInTheDocument()
    expect(screen.getByText('Ici, je peux retrouver ce que le chantier sait.')).toBeInTheDocument()
    expect(screen.getByRole('search')).toHaveTextContent('Question réelle')

    // Les détecteurs disent ce qui TRAÎNE — ils ne sont pas la connaissance du
    // chantier, qui vit désormais dans « Ce que le chantier sait ».
    const knowledge = screen.getByRole('region', { name: 'Ce qui demande une suite' })
    expect(within(knowledge).getByText('1 décision sans suite identifiée')).toBeInTheDocument()
    expect(within(knowledge).queryByText('1 décision jamais appliquée')).not.toBeInTheDocument()
    expect(within(knowledge).getByText('Changer le fournisseur')).toBeInTheDocument()

    const subjects = screen.getByRole('region', { name: 'Dossiers vivants' })
    expect(within(subjects).getByRole('link', { name: /Fuites d'eau/ })).toHaveAttribute(
      'href',
      '/sites/site-1/subjects/subject-1',
    )
    expect(within(subjects).getByText('3 actions')).toBeInTheDocument()
    expect(within(subjects).getByText('2 réserves')).toBeInTheDocument()

    // L'atelier n'apparaît qu'une fois : c'est le bloc « Poser une question » en haut.
    expect(screen.queryByRole('link', { name: "Ouvrir l'atelier complet" })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: "Ouvrir l'atelier mémoire" })).not.toBeInTheDocument()
  })

  it('makes documents a workspace for finding and receiving proofs without turning QR into a shortcut', () => {
    render(
      <DocumentsWorkspace
        siteId="site-1"
        canExport={false}
        documents={[
          { id: 'doc-1', filename: 'Plan toiture.pdf', document_type: 'plan', created_at: '2026-07-13T10:00:00.000Z' },
          { id: 'doc-2', filename: 'photo-fuite-local-technique.jpg', document_type: 'photo', created_at: '2026-07-14T10:00:00.000Z' },
        ]}
        proofDossiers={[
          {
            actionId: 'action-1',
            actionTitle: 'Nettoyer la réserve',
            corpsEtat: 'Nettoyage',
            requestedPhoto: true,
            recipientLabel: 'Entreprise Martin',
            declaredStatus: 'done',
            declaredComment: null,
            declaredPhotoPath: '/proofs/photo.jpg',
            declaredAt: '2026-07-13T10:00:00.000Z',
            submittedByName: 'Vincent',
            signatureDataUrl: null,
            moeValidated: false,
            moeValidatedAt: null,
            moeComment: null,
          },
        ]}
        qr={{
          siteName: 'Chantier A',
          status: 'active',
          publicUrl: 'https://example.test/qr/token',
          qrDataUrl: 'data:image/png;base64,abc',
          accessCount: 2,
          generatedAt: '2026-07-14T08:00:00.000Z',
          lastAccessedAt: '2026-07-14T09:00:00.000Z',
          history: [
            { type: 'scanned', at: '2026-07-14T09:00:00.000Z', tokenSuffix: 'abcdef', userAgent: 'Mozilla/5.0' },
          ],
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Documents & preuves' })).toBeInTheDocument()
    expect(screen.getByText('Ici, je peux retrouver ou recevoir une preuve.')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Plan toiture.pdf/ })).toHaveAttribute('href', '/documents/doc-1')
    expect(screen.getByRole('link', { name: /photo-fuite-local-technique.jpg/ })).toHaveAttribute('href', '/documents/doc-2')
    fireEvent.click(screen.getByRole('button', { name: 'Photos' }))
    expect(screen.queryByRole('link', { name: /Plan toiture.pdf/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /photo-fuite-local-technique.jpg/ })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Rechercher une photo, un plan, un PV...'), { target: { value: 'toiture' } })
    expect(screen.getByText('Aucun document ne correspond à cette recherche.')).toBeInTheDocument()

    const qr = screen.getByRole('region', { name: 'Recevoir des preuves' })
    expect(within(qr).getByText('QR de collecte externe')).toBeInTheDocument()
    expect(within(qr).getByText('Accès en lecture seule.')).toBeInTheDocument()
    expect(within(qr).getByAltText('QR de collecte externe - Chantier A')).toBeInTheDocument()
    expect(within(qr).getByRole('button', { name: 'Copier le lien' })).toBeInTheDocument()
    expect(within(qr).getByRole('link', { name: 'Télécharger' })).toHaveAttribute('download', 'qr-chantier-a.png')
    expect(within(qr).getByText(/2 accès anonymes/)).toBeInTheDocument()
    expect(within(qr).getByText('1 accès anonyme · aucun contributeur identifié.')).toBeInTheDocument()
    expect(within(qr).queryByText('Vincent')).not.toBeInTheDocument()
    expect(within(qr).queryByRole('link', { name: 'Ouvrir le QR Code' })).not.toBeInTheDocument()

    const proof = screen.getByRole('region', { name: 'Dossiers de preuves' })
    expect(within(proof).getByText('1 dossier actif')).toBeInTheDocument()
    expect(within(proof).getByText('1 preuve à vérifier')).toBeInTheDocument()
  })
})
