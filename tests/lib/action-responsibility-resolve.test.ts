// Lot 2B.1 — résolution d'une responsabilité d'action (entreprise et/ou personne).
// Décision PURE : appartenance au chantier + cohérence contact↔entreprise, sans
// jamais inventer de personne ni bloquer définitivement une relation atypique.

import { describe, expect, it } from 'vitest'
import { resolveActionResponsibility } from '@/lib/knowledge/action-responsible-candidates'

const companies = new Set(['etv', 'sotrap'])
const contacts = new Set(['jean', 'paul'])

describe('resolveActionResponsibility', () => {
  it('entreprise seule (candidate) → acceptée, sans personne', () => {
    const r = resolveActionResponsibility({ companyId: 'etv', contactId: null, candidateCompanyIds: companies, candidateContactIds: contacts })
    expect(r).toEqual({ ok: true, assignedCompanyId: 'etv', assignedContactId: null })
  })

  it('personne seule (candidate) → acceptée, sans entreprise', () => {
    const r = resolveActionResponsibility({ companyId: null, contactId: 'paul', candidateCompanyIds: companies, candidateContactIds: contacts })
    expect(r).toEqual({ ok: true, assignedCompanyId: null, assignedContactId: 'paul' })
  })

  it('aucun responsable → valide (état métier accepté)', () => {
    const r = resolveActionResponsibility({ companyId: null, contactId: null, candidateCompanyIds: companies, candidateContactIds: contacts })
    expect(r).toEqual({ ok: true, assignedCompanyId: null, assignedContactId: null })
  })

  it('entreprise hors chantier → refus', () => {
    const r = resolveActionResponsibility({ companyId: 'inconnue', contactId: null, candidateCompanyIds: companies, candidateContactIds: contacts })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/n.intervient pas/)
  })

  it('personne hors responsables possibles → refus', () => {
    const r = resolveActionResponsibility({ companyId: null, contactId: 'inconnu', candidateCompanyIds: companies, candidateContactIds: contacts })
    expect(r.ok).toBe(false)
  })

  it('entreprise + contact COHÉRENTS (même entreprise) → accepté', () => {
    const r = resolveActionResponsibility({ companyId: 'etv', contactId: 'jean', candidateCompanyIds: companies, candidateContactIds: contacts, contactCompanyId: 'etv' })
    expect(r).toEqual({ ok: true, assignedCompanyId: 'etv', assignedContactId: 'jean' })
  })

  it('entreprise + contact SANS entreprise connue → accepté (suggestion côté UI, pas de modif auto)', () => {
    const r = resolveActionResponsibility({ companyId: 'etv', contactId: 'jean', candidateCompanyIds: companies, candidateContactIds: contacts, contactCompanyId: null })
    expect(r.ok).toBe(true)
  })

  it('entreprise + contact D’UNE AUTRE entreprise → confirmation requise (jamais bloqué sec)', () => {
    const r = resolveActionResponsibility({ companyId: 'etv', contactId: 'jean', candidateCompanyIds: companies, candidateContactIds: contacts, contactCompanyId: 'sotrap' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.requiresConfirmation).toBe(true)
  })

  it('incohérence CONFIRMÉE → acceptée (Jean représente exceptionnellement l’entreprise)', () => {
    const r = resolveActionResponsibility({ companyId: 'etv', contactId: 'jean', candidateCompanyIds: companies, candidateContactIds: contacts, contactCompanyId: 'sotrap', confirmMismatch: true })
    expect(r).toEqual({ ok: true, assignedCompanyId: 'etv', assignedContactId: 'jean' })
  })
})
