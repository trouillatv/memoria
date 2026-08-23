import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reserveOpenSince } from '@/lib/db/attention'

// ── LA DATE DU FAIT, PAS LA DATE DE L'ENREGISTREMENT ────────────────────────
//
// `getAttentionDigest` (accueil, multi-chantier) lisait `site_reserve.created_at`
// là où `deriveSiteAttentionItems` (moteur de connaissance) lit `issued_on`.
// Les deux moteurs ont des rôles distincts et le restent ; mais quand ils
// parlent du MÊME objet, ils doivent parler de la même date.
//
// Audit Tranche 3 (2026-08-23, docs/architecture/tranche3-audit-verite.md) :
// 53 réserves ouvertes mesurées, 53/53 datées différemment par les deux moteurs,
// 53/53 classées de façon contradictoire. Écart jusqu'à +124 j en régime import
// PV, +3 j seulement en saisie terrain — d'où l'invisibilité du défaut jusqu'ici.
// Cas réel : l'accueil annonçait « la plus ancienne depuis 5 j » sur une réserve
// émise 129 jours plus tôt. Exact, et sémantiquement faux.
//
// Même logique côté actions : `describeOverdueAction()` porte depuis LOT4 la
// distinction entre une échéance CONFIRMÉE et une date DÉDUITE par l'IA. Cet
// accueil était la dernière surface à afficher « en retard » sans elle.

const SRC = readFileSync(join(process.cwd(), 'lib/db/attention.ts'), 'utf8')

describe('reserveOpenSince — quelle date décrit l’ouverture d’une réserve', () => {
  it('préfère la date d’émission du fait', () => {
    expect(reserveOpenSince({ issued_on: '2026-04-16', created_at: '2026-08-18T09:00:00Z' }))
      .toEqual({ at: '2026-04-16', kind: 'issued' })
  })

  it('ne retombe sur la date d’enregistrement qu’à défaut, et le signale', () => {
    expect(reserveOpenSince({ issued_on: null, created_at: '2026-08-18T09:00:00Z' }))
      .toEqual({ at: '2026-08-18T09:00:00Z', kind: 'recorded' })
    // `kind` existe pour que l'affichage puisse DIRE « enregistrée » plutôt que
    // laisser croire à une date d'émission. Un repli silencieux reproduirait le
    // défaut d'origine sous une autre forme.
    expect(reserveOpenSince({ created_at: '2026-08-18T09:00:00Z' }).kind).toBe('recorded')
  })
})

describe('getAttentionDigest — garde-fou de source', () => {
  it('charge bien issued_on depuis site_reserve', () => {
    expect(SRC).toMatch(/from\('site_reserve'\)\.select\([^)]*issued_on/)
  })

  it('ne lit jamais created_at directement pour l’âge d’une réserve', () => {
    // Le repli est légitime — mais il passe par reserveOpenSince, qui le nomme.
    const reserveBlock = SRC.slice(
      SRC.indexOf('// Réserves ouvertes →'),
      SRC.indexOf('// 🟠 Actions anciennes'),
    )
    expect(reserveBlock.length, 'bloc réserves introuvable').toBeGreaterThan(200)
    expect(reserveBlock).toMatch(/reserveOpenSince/)
    expect(reserveBlock).not.toMatch(/\.created_at/)
  })

  it('applique describeOverdueAction avant d’affirmer « en retard »', () => {
    expect(SRC).toMatch(/import \{ describeOverdueAction \}/)
    expect(SRC).toMatch(/describeOverdueAction\(a\.title, a\.due_date, a\.due_date_status, today\)/)
    // Une date non confirmée ne monte pas en rouge : elle devient une question.
    expect(SRC).toMatch(/info\.confirmed \? get\(a\.site_id\)\.overdue : get\(a\.site_id\)\.toVerify/)
  })
})
