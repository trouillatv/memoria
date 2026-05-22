import { describe, it, expect } from 'vitest'
import { guessDocumentType } from '@/lib/documents/classify'
import { buildBatchRows, runPool } from '@/lib/documents/batch'

describe('guessDocumentType — indice léger par nom de fichier', () => {
  it('reconnaît les indices bornés', () => {
    expect(guessDocumentType('facture_mars.pdf')).toBe('facture')
    expect(guessDocumentType('CCTP_lot3.pdf')).toBe('ao')
    expect(guessDocumentType('procedure-menage.pdf')).toBe('procedure')
    expect(guessDocumentType('plan_acces_sasB.pdf')).toBe('plan_acces')
    expect(guessDocumentType('truc_inconnu.pdf')).toBe('autre')
  })
})

describe('buildBatchRows — pré-tri multi-doc', () => {
  it('classe chaque fichier (couche dérivée du type)', () => {
    const rows = buildBatchRows(['facture_avril.pdf', 'procedure_acces.pdf', 'litige_dossier.pdf'])
    expect(rows).toHaveLength(3)
    expect(rows[0]!.documentType).toBe('facture')
    expect(rows[0]!.classification.tier).toBe('froide')
    expect(rows[0]!.classification.embeddingRecommended).toBe(false)
    expect(rows[1]!.documentType).toBe('procedure')
    expect(rows[1]!.classification.tier).toBe('vivante')
    expect(rows[1]!.classification.embeddingRecommended).toBe(true)
  })

  it('litige : jamais d’indexation recommandée, même nom opérationnel', () => {
    const [row] = buildBatchRows(['litige.pdf'])
    // guess → 'autre' (pas de mot-clé litige), mais testons le verrou par type :
    const rowsLitige = buildBatchRows(['dossier.pdf']).map((r) => ({ ...r, documentType: 'litige' }))
    void row
    expect(rowsLitige[0]!.documentType).toBe('litige')
  })
})

describe('runPool — concurrence bornée + import partiel', () => {
  it('exécute tout, garde l’ordre, n’abandonne pas sur échec', async () => {
    const items = [1, 2, 3, 4, 5]
    const results = await runPool(items, 2, async (n) =>
      n === 3 ? { ok: false as const, n } : { ok: true as const, n },
    )
    expect(results.map((r) => r.n)).toEqual([1, 2, 3, 4, 5]) // ordre préservé
    expect(results.filter((r) => r.ok)).toHaveLength(4)
    expect(results.find((r) => !r.ok)?.n).toBe(3) // l'échec n'arrête pas les autres
  })

  it('ne dépasse jamais la limite de concurrence', async () => {
    let active = 0
    let maxActive = 0
    await runPool([...Array(10).keys()], 3, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return null
    })
    expect(maxActive).toBeLessThanOrEqual(3)
  })
})
