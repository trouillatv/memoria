// Contrat consommateur de l'audit documentaire multipièces.
// « Une page inventée est pire que pas de page » : l'UI ne navigue que sur la
// provenance PERSISTÉE (document → page → état) — jamais sur source_ref.page,
// jamais par repli (récence, ordre, nom de fichier).

import { describe, expect, it } from 'vitest'
import {
  applyProvenanceSelection,
  initialAuditSelection,
  type AuditProvenance,
} from '@/app/(dashboard)/tenders/[id]/audit/audit-provenance'
import { deriveEngagementProvenanceReadRow } from '@/lib/tenders/engagement-provenance'

const DOC_A = { id: 'doc-a', filename: 'CCAP.pdf', url: 'https://signed/ccap' }
const DOC_B = { id: 'doc-b', filename: 'CCTP.pdf', url: 'https://signed/cctp' }

const exact: AuditProvenance = { state: 'exact', documentId: 'doc-b', pageNumber: 12, filename: 'CCTP.pdf' }
const documentOnly: AuditProvenance = { state: 'document_only', documentId: 'doc-b', pageNumber: null, filename: 'CCTP.pdf' }
const unavailable: AuditProvenance = { state: 'unavailable', documentId: null, pageNumber: null, filename: null }

describe('initialAuditSelection — cible de consultation, jamais une source', () => {
  it('ouvre sur la première pièce, sans page, sans prétention de provenance', () => {
    expect(initialAuditSelection([DOC_A, DOC_B])).toEqual({ documentId: 'doc-a', pageNumber: null })
  })

  it('dossier sans pièce → aucune sélection (état vide)', () => {
    expect(initialAuditSelection([])).toEqual({ documentId: null, pageNumber: null })
  })
})

describe('applyProvenanceSelection — les trois états, sans rien inventer', () => {
  const current = { documentId: 'doc-a', pageNumber: 3 }

  it('exact → sélectionne la pièce démontrée ET sa page vérifiée', () => {
    expect(applyProvenanceSelection(current, exact)).toEqual({ documentId: 'doc-b', pageNumber: 12 })
  })

  it('document_only → sélectionne la pièce démontrée SANS forcer de page', () => {
    expect(applyProvenanceSelection(current, documentOnly)).toEqual({ documentId: 'doc-b', pageNumber: null })
  })

  it('unavailable → le lecteur ne bouge pas (ni pièce ni page)', () => {
    expect(applyProvenanceSelection(current, unavailable)).toEqual(current)
  })

  it('unavailable ne choisit JAMAIS une pièce de repli, même depuis l\'état initial', () => {
    const initial = initialAuditSelection([DOC_A, DOC_B])
    expect(applyProvenanceSelection(initial, unavailable)).toEqual(initial)
  })
})

describe('source_ref.page seul ne promeut JAMAIS un engagement en source navigable', () => {
  it('read row hérité (source_ref.page sans document vérifié) → unavailable → aucune navigation', () => {
    // L'engagement historique n'a QUE source_ref.page = 99 : pas de
    // tender_document_id persisté. Le read model le classe unavailable.
    const row = deriveEngagementProvenanceReadRow({
      engagementId: 'e-legacy',
      tenderId: 't-1',
      sourceRef: { page: 99 },
      tenderDocumentId: null,
      pageNumber: null,
      document: null,
    })
    expect(row.state).toBe('unavailable')

    // Et l'audit ne bouge pas : la page 99 héritée n'ouvre rien.
    const current = { documentId: 'doc-a', pageNumber: null }
    const next = applyProvenanceSelection(current, {
      state: row.state, documentId: row.documentId, pageNumber: row.pageNumber, filename: row.filename,
    })
    expect(next).toEqual(current)
    expect(next.pageNumber).not.toBe(99)
  })
})

