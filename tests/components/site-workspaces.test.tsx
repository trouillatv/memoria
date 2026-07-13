import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentsWorkspace } from '@/app/(dashboard)/sites/[id]/views/documents/DocumentsWorkspace'
import { MemoryWorkspace } from '@/app/(dashboard)/sites/[id]/views/memory/MemoryWorkspace'

describe('site workspaces', () => {
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
    expect(screen.getByText('Ici je peux retrouver ce que le chantier sait.')).toBeInTheDocument()
    expect(screen.getByRole('search')).toHaveTextContent('Question réelle')

    const knowledge = screen.getByRole('region', { name: 'Connaissances importantes' })
    expect(within(knowledge).getByText('1 décision jamais appliquée')).toBeInTheDocument()
    expect(within(knowledge).getByText('Changer le fournisseur')).toBeInTheDocument()

    const subjects = screen.getByRole('region', { name: 'Dossiers vivants' })
    expect(within(subjects).getByRole('link', { name: /Fuites d'eau/ })).toHaveAttribute(
      'href',
      '/sites/site-1/subjects/subject-1',
    )
    expect(within(subjects).getByText('3 actions')).toBeInTheDocument()
    expect(within(subjects).getByText('2 réserves')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: "Ouvrir l'atelier complet" })).toHaveAttribute('href', '/memoire/site-1')
    expect(screen.queryByRole('link', { name: "Ouvrir l'atelier mémoire" })).not.toBeInTheDocument()
  })

  it('makes documents a workspace for finding and receiving proofs without turning QR into a shortcut', () => {
    render(
      <DocumentsWorkspace
        siteId="site-1"
        canExport={false}
        documents={[]}
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
    expect(screen.getByText('Ici je peux retrouver ou recevoir une preuve.')).toBeInTheDocument()
    expect(screen.getByText('Aucun document pour le moment.')).toBeInTheDocument()
    expect(screen.getByText('Ajoutez un document, une photo, un plan ou un PV.')).toBeInTheDocument()

    const qr = screen.getByRole('region', { name: 'Recevoir des preuves' })
    expect(within(qr).getByText('QR de collecte externe')).toBeInTheDocument()
    expect(within(qr).getByAltText('QR de collecte externe - Chantier A')).toBeInTheDocument()
    expect(within(qr).getByRole('button', { name: 'Copier le lien' })).toBeInTheDocument()
    expect(within(qr).getByRole('link', { name: 'Télécharger' })).toHaveAttribute('download', 'qr-chantier-a.png')
    expect(within(qr).getByText('2 accès anonymes')).toBeInTheDocument()
    expect(within(qr).queryByText('Vincent')).not.toBeInTheDocument()
    expect(within(qr).queryByRole('link', { name: 'Ouvrir le QR Code' })).not.toBeInTheDocument()

    const proof = screen.getByRole('region', { name: 'Dossiers de preuves' })
    expect(within(proof).getByText('1 dossier actif')).toBeInTheDocument()
    expect(within(proof).getByText('1 preuve à vérifier')).toBeInTheDocument()
  })
})
