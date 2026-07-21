import { describe, expect, it } from 'vitest'
import { pdfFooterLabel } from '@/lib/pdf/visit-cr'

// ── QUI SIGNE LE COMPTE-RENDU ? ─────────────────────────────────────────────
//
// Un brouillon vient de MemorIA et attend d'être corrigé : le dire est honnête.
// Un compte-rendu FINALISÉ a été relu, corrigé et signé par un conducteur, et il
// part chez un client. Continuer d'y écrire « généré par MemorIA » attribuerait
// à la machine un texte devenu celui d'un humain — et affaiblirait un document
// qui engage.

describe('Le pied de page du PDF', () => {
  const base = { siteName: 'Lycée PETRO ATTITI', exportDate: '21 juillet 2026' }

  it('dit « généré par MemorIA » tant que le compte-rendu est un brouillon', () => {
    expect(pdfFooterLabel({ ...base, finalized: false })).toContain('généré par MemorIA')
  })

  it('ne le dit PLUS une fois le compte-rendu finalisé', () => {
    expect(pdfFooterLabel({ ...base, finalized: true })).not.toMatch(/MemorIA/)
  })

  it('nomme alors le chantier et la date — un document, pas une sortie de machine', () => {
    const finalise = pdfFooterLabel({ ...base, finalized: true })
    expect(finalise).toContain('Lycée PETRO ATTITI')
    expect(finalise).toContain('21 juillet 2026')
  })
})
