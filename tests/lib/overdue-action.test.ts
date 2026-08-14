import { describe, expect, it } from 'vitest'
import { describeOverdueAction } from '@/lib/knowledge/overdue-action'

// due_date_status distingue une date CONFIRMÉE par un humain d'une date DÉDUITE
// par l'IA. Fonction PARTAGÉE par site-attention-items.ts et canonical-attention.ts
// (retour Guillaume 2026-08-14, LOT4) : la testant une fois, on prouve que les
// deux moteurs calculent exactement la même vérité pour ce cas.

const TODAY = '2026-08-15'

describe('describeOverdueAction', () => {
  it('date explicite dépassée → confirmed=true, « en retard de N j »', () => {
    const r = describeOverdueAction('Installation des toilettes', '2026-08-01', 'explicit', TODAY)
    expect(r.confirmed).toBe(true)
    expect(r.overdueDays).toBe(14)
    expect(r.reason).toBe('Action « Installation des toilettes » en retard de 14 j')
  })

  it('date estimée (IA) dépassée → jamais confirmée, jamais « en retard »', () => {
    const r = describeOverdueAction('Installation des toilettes', '2026-08-01', 'estimated', TODAY)
    expect(r.confirmed).toBe(false)
    expect(r.reason).toBe('Prévu le 2026-08-01 · réalisation non confirmée')
    expect(r.reason).not.toContain('retard')
  })

  it('due_date_status null (jamais renseigné) → même traitement que estimated', () => {
    const r = describeOverdueAction('Installation des toilettes', '2026-08-01', null, TODAY)
    expect(r.confirmed).toBe(false)
    expect(r.reason).toBe('Prévu le 2026-08-01 · réalisation non confirmée')
  })

  it('overdueDays est calculé même pour une date non confirmée (usage interne au tri, pas au wording)', () => {
    const r = describeOverdueAction('X', '2026-08-10', 'estimated', TODAY)
    expect(r.overdueDays).toBe(5)
    expect(r.reason).not.toContain('5')
  })

  it('échéance explicite aujourd’hui → 0 jour, toujours « en retard » au sens du calcul (le caller décide de l’affichage)', () => {
    const r = describeOverdueAction('X', TODAY, 'explicit', TODAY)
    expect(r.confirmed).toBe(true)
    expect(r.overdueDays).toBe(0)
  })
})
