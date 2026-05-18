// Garde-fou doctrinal — Preuve d'accès site (migration 070).
//
// Le module accès est une PREUVE D'ACCÈS, PAS un registre de détention.
// Interdits gravés (arbitrage Vincent 2026-05-18) :
//   - aucune notion de "détenteur / porteur / qui détient" ;
//   - created_by reste en base (audit) mais N'EST JAMAIS exposé par le helper
//     ni rendu en UI (pas de surveillance individuelle) ;
//   - pas de GPS / NFC / QR / inventaire de clés.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf-8')

const MIGRATION = 'supabase/migrations/070_intervention_access_events.sql'
const HELPER = 'lib/db/intervention-access-events.ts'
const SURFACE_FILES = [
  HELPER,
  'app/(field)/m/intervention/[id]/AccessSection.tsx',
  'app/(field)/m/intervention/[id]/access-actions.ts',
  'app/(dashboard)/interventions/[id]/access-panel.tsx',
]

// Notions de détention/surveillance individuelle interdites comme NOM DE
// COLONNE ou champ exposé. On vise les identifiants techniques, pas le texte.
const FORBIDDEN_IDENTIFIERS = [
  /\b(holder|key_holder|held_by|carried_by|carrier|detenteur|porteur|possessed_by)\b/i,
  /\b(gps|latitude|longitude|nfc|rfid|qr_?code|barcode)\b/i,
  /\bkey_inventory\b|\binventaire_cle/i,
]

describe('Doctrine — preuve d’accès, pas registre de détention', () => {
  it('la migration 070 ne déclare aucune colonne de détention/surveillance', () => {
    const sql = read(MIGRATION)
    // On ne scanne que les lignes de définition de colonnes/contraintes,
    // pas les commentaires doctrinaux qui citent volontairement ces mots.
    const codeLines = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
    for (const re of FORBIDDEN_IDENTIFIERS) {
      expect(re.test(codeLines), `Identifiant interdit dans ${MIGRATION}: ${re}`).toBe(false)
    }
  })

  it('le helper n’expose jamais created_by (audit interne uniquement)', () => {
    const src = read(HELPER)
    // L'interface publique et la projection SELECT ne doivent pas porter created_by.
    expect(src).not.toMatch(/PUBLIC_COLUMNS\s*=\s*['"][^'"]*created_by/)
    const ifaceMatch = src.match(/export interface DbInterventionAccessEvent \{([\s\S]*?)\}/)
    expect(ifaceMatch, 'interface DbInterventionAccessEvent introuvable').toBeTruthy()
    expect(ifaceMatch![1]).not.toMatch(/created_by/)
  })

  it('aucune surface accès ne référence GPS / NFC / QR / inventaire', () => {
    const violations: string[] = []
    for (const f of SURFACE_FILES) {
      const code = read(f)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n')
      if (/\b(gps|nfc|rfid|qr_?code|barcode|inventaire)\b/i.test(code)) {
        violations.push(f)
      }
    }
    expect(violations).toEqual([])
  })
})
