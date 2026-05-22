import { describe, it, expect } from 'vitest'
import { classifyDocument } from '@/lib/documents/classify'

describe('classifyDocument — cerveau du tri d’ingestion', () => {
  it('mémoire opérationnelle → vivante + embedding conseillé', () => {
    for (const t of ['procedure', 'protocole', 'plan_acces', 'securite', 'memoire_technique']) {
      const c = classifyDocument({ documentType: t })
      expect(c.tier).toBe('vivante')
      expect(c.embeddingRecommended).toBe(true)
    }
  })

  it('contractuel / AO → consultable + embedding', () => {
    for (const t of ['contrat', 'avenant', 'ao']) {
      const c = classifyDocument({ documentType: t })
      expect(c.tier).toBe('consultable')
      expect(c.embeddingRecommended).toBe(true)
    }
  })

  it('facture / preuve → archive froide, pas d’embedding', () => {
    for (const t of ['facture', 'preuve']) {
      const c = classifyDocument({ documentType: t })
      expect(c.tier).toBe('froide')
      expect(c.embeddingRecommended).toBe(false)
    }
  })

  it('litige → JAMAIS d’embedding auto, même avec un nom de fichier opérationnel', () => {
    const c = classifyDocument({ documentType: 'litige', filename: 'procedure-acces-litige.pdf' })
    expect(c.embeddingRecommended).toBe(false)
  })

  it('type « autre » : affiné par le nom de fichier (administratif → froide)', () => {
    const c = classifyDocument({ documentType: 'autre', filename: 'facture_mars_2026.pdf' })
    expect(c.tier).toBe('froide')
    expect(c.embeddingRecommended).toBe(false)
  })

  it('type « autre » : affiné par le nom de fichier (opérationnel → vivante)', () => {
    const c = classifyDocument({ documentType: 'autre', filename: 'consigne_acces_sas_B.pdf' })
    expect(c.tier).toBe('vivante')
    expect(c.embeddingRecommended).toBe(true)
  })

  it('déterministe : mêmes entrées ⇒ même classification', () => {
    const a = classifyDocument({ documentType: 'procedure', filename: 'x.pdf' })
    const b = classifyDocument({ documentType: 'procedure', filename: 'x.pdf' })
    expect(a).toEqual(b)
  })
})
