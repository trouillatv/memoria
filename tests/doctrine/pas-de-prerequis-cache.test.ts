import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ON NE DÉCOUVRE PAS SES PRÉREQUIS UN PAR UN.
 *
 * Guillaume voulait planifier une intervention. Il a découvert qu'il lui manquait
 * une mission. Puis une équipe. Puis une personne. À chaque fois, un mur.
 *
 * Le premier mur est tombé : on crée une mission sans quitter le planificateur, et
 * elle est SÉLECTIONNÉE au retour (`setMissionId(r.missionId)`). Le pattern était
 * écrit, éprouvé — et jamais répliqué.
 *
 * Les deux autres restaient :
 *   - sans équipe, le select masquait simplement son groupe : un choix vide, sans
 *     un mot. Aucun « + Nouvelle équipe » nulle part dans le planificateur.
 *   - « Aucune personne disponible. Créez d'abord un compte depuis la page
 *     Intervenants ou Administration. » — un message qui NOMME le manque et
 *     n'offre AUCUN geste. Pas même un lien.
 *
 * Nommer un manque sans offrir le geste qui le comble, c'est une impasse.
 */

const DIALOG = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', '(planning)', 'semaine', 'CreateInterventionDialog.tsx'),
  'utf8',
)
const MEMBERS = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', 'equipes', 'EditTeamMembersDialog.tsx'),
  'utf8',
)

describe('Le planificateur', () => {
  it('crée une mission sans quitter l’écran, et la sélectionne', () => {
    expect(DIALOG).toContain('createMissionAction')
    expect(DIALOG).toMatch(/setMissionId\(r\.missionId\)/)
  })

  it('crée une ÉQUIPE sans quitter l’écran, et la sélectionne', () => {
    expect(DIALOG).toContain('createTeamAction')
    expect(DIALOG).toMatch(/setTeamChoice\(teamId\)/)
    expect(DIALOG).toContain('+ Nouvelle équipe')
  })

  it("dit quoi faire quand il n'y a AUCUNE équipe, au lieu de masquer le choix", () => {
    // Avant : `sortedTeams.length > 0 && <optgroup>` — et rien d'autre. L'absence
    // d'équipe était silencieuse.
    expect(DIALOG).toMatch(/sortedTeams\.length === 0/)
    expect(DIALOG).toContain("Aucune équipe pour l'instant")
  })
})

describe("L'ajout d'un membre à une équipe", () => {
  it("n'est jamais une impasse : le manque de personne offre un geste", () => {
    expect(MEMBERS).toMatch(/href="\/intervenants"/)
    expect(MEMBERS).toContain('Créer une personne')
  })

  it('ne renvoie plus vers une page à trouver soi-même', () => {
    // L'ancien texte nommait deux pages et ne liait ni l'une ni l'autre.
    expect(MEMBERS).not.toContain('page Intervenants ou Administration')
  })
})
