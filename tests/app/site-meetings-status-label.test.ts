import { describe, it, expect } from 'vitest'
import { statusLabel } from '@/app/(dashboard)/sites/[id]/meetings/page'

// Mandat Vincent 2026-10-02 : les libellés affichés sur l'onglet « Réunions » du
// chantier doivent coller aux VRAIES valeurs de l'enum SiteReportStatus — jamais
// un statut inventé. Ce test protège la correspondance exacte demandée.

describe('statusLabel — onglet Réunions du chantier', () => {
  it('failed → badge d’échec explicite', () => {
    expect(statusLabel('failed').label).toBe("Échec d'analyse")
  })

  it('proposed → à valider', () => {
    expect(statusLabel('proposed').label).toBe('À valider')
  })

  it('curated/archived (finalisée) → même libellé', () => {
    expect(statusLabel('curated').label).toBe('Finalisée')
    expect(statusLabel('archived').label).toBe('Finalisée')
  })

  it('draft/transcribing/ready/analyzing → en préparation / à analyser', () => {
    expect(statusLabel('draft').label).toBe('En préparation / À analyser')
    expect(statusLabel('transcribing').label).toBe('En préparation / À analyser')
    expect(statusLabel('ready').label).toBe('En préparation / À analyser')
    expect(statusLabel('analyzing').label).toBe('En préparation / À analyser')
  })
})
