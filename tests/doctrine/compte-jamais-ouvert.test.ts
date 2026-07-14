import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * « Voir les invitations en attente » n'avait pas besoin d'une table.
 *
 * Le fait était déjà en base : `must_change_password` est posé à la création du
 * compte et ne retombe qu'au premier login réussi. Tant qu'il est vrai, la
 * personne n'a jamais ouvert MemorIA. Il manquait seulement de le DIRE.
 *
 * Ce test protège deux choses :
 *   1. le signal reste branché sur ce fait, et pas sur une inférence ;
 *   2. il reste un fait ADMINISTRATIF (le compte n'est pas arrivé) et ne dérive
 *      jamais vers une mesure d'activité de la personne — la ligne rouge du
 *      produit (refus de l'ERP RH).
 */

const DB = readFileSync(join(process.cwd(), 'lib', 'db', 'intervenants.ts'), 'utf8')
const PAGE = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', 'intervenants', 'page.tsx'),
  'utf8',
)

describe('Le compte jamais ouvert', () => {
  it('se lit sur must_change_password, le fait déjà stocké', () => {
    expect(DB).toContain('must_change_password')
    expect(DB).toMatch(/neverOpened:\s*\(u as[^)]*\)\.must_change_password === true/)
  })

  it('est exposé à la liste des intervenants', () => {
    expect(DB).toMatch(/neverOpened:\s*boolean/)
    expect(PAGE).toContain('i.neverOpened')
  })

  it("se dit à l'écran, et dit quoi faire", () => {
    // L'apostrophe est échappée en JSX (&apos;) — on accepte les deux formes.
    expect(PAGE).toMatch(/N(&apos;|')a jamais ouvert MemorIA/)
    expect(PAGE).toMatch(/n(&apos;|')(ont|a) jamais ouvert MemorIA/)
    // Un constat sans geste possible est une impasse : on donne la sortie.
    expect(PAGE).toContain('mot de passe temporaire')
  })

  it("ne mesure JAMAIS l'activité de la personne", () => {
    // Le jour où ce signal deviendrait « dernière connexion il y a N jours »,
    // il changerait de nature : de l'administration à la surveillance.
    for (const forbidden of [
      /derni[èe]re connexion/i,
      /inactif depuis/i,
      /ne se connecte plus/i,
      /temps de connexion/i,
    ]) {
      expect(forbidden.test(PAGE), `L'écran /intervenants ne doit pas mesurer l'activité (${forbidden})`).toBe(false)
    }
  })
})
