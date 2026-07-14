import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UNE VISITE NE MEURT JAMAIS PAR LA PORTE DES RÉUNIONS.
 *
 * `site_reports` porte DEUX objets : la réunion (`origin IS NULL`) et la visite
 * terrain (`origin` non nul). SEIZE tables cascadent sur elle (ON DELETE CASCADE)
 * — dont `visit_capture` : les PHOTOS et les VOCAUX du terrain.
 *
 * `deleteMeetingAction` fait un HARD DELETE. Elle ne lisait même pas `origin`.
 *
 * Le nettoyage en masse, lui, porte le garde — et son commentaire dit exactement
 * pourquoi il a fallu l'ajouter : « les visites fuyaient ici et un clic aurait
 * détruit des captures ». Ce garde n'avait jamais été reporté sur la suppression
 * unitaire. Seule la liste à l'écran (qui filtre `origin is null`) empêchait le
 * drame.
 *
 * Une protection qui n'existe que dans l'interface n'est pas une protection.
 */

const ACTIONS = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', 'meetings', 'actions.ts'),
  'utf8',
)

/** Le corps de deleteMeetingAction, isolé du nettoyage en masse. */
function deleteMeetingBody(): string {
  const start = ACTIONS.indexOf('export async function deleteMeetingAction')
  expect(start, 'deleteMeetingAction introuvable').toBeGreaterThan(-1)
  const next = ACTIONS.indexOf('export async function', start + 10)
  return ACTIONS.slice(start, next === -1 ? undefined : next)
}

describe('Supprimer une réunion', () => {
  const body = deleteMeetingBody()

  it("REFUSE si l'objet est une visite terrain", () => {
    expect(body).toMatch(/origin/)
    expect(body).toMatch(/report\.origin !== null/)
    expect(body).toContain("Ce n'est pas une réunion")
  })

  it('dit ce que la suppression détruirait, et où aller à la place', () => {
    expect(body).toContain('photos')
    expect(body).toContain('Passez par la visite elle-même')
  })

  it('REFUSE si des captures terrain pendent au rapport', () => {
    // Une réunion ne devrait porter aucune capture. S'il y en a, on ne détruit
    // pas une preuve « au cas où » : on refuse et on le dit.
    expect(body).toContain('visit_capture')
    expect(body).toMatch(/captureCount/)
  })

  it('est TRACÉE — la suppression la plus destructive ne peut pas rester muette', () => {
    expect(body).toContain('logAuditEvent')
    expect(body).toMatch(/hard_delete: true/)
  })
})

describe('Le nettoyage en masse', () => {
  it('garde son propre verrou (il ne doit jamais le perdre non plus)', () => {
    const start = ACTIONS.indexOf('export async function cleanupDraftMeetingsAction')
    const body = ACTIONS.slice(start)
    expect(body).toMatch(/\.is\('origin', null\)/)
  })
})
