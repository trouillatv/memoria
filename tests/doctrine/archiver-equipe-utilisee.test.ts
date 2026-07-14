import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ON N'ARCHIVE PAS UNE ÉQUIPE QUI TRAVAILLE ENCORE — ET SI ON LE FAIT, ON LE DIT.
 *
 * Guillaume : « éviter de supprimer une équipe encore utilisée ».
 * Ce n'était pas une précaution théorique. Archiver une équipe :
 *
 *   1. désaffectait TOUTES ses interventions planifiées à venir — celles de
 *      demain, du mois prochain — sans décompte et sans un mot ;
 *   2. les rendait INDÉMARRABLES (contrainte chk_active_intervention_requires_team)
 *      tant qu'un humain ne les réaffectait pas une par une ;
 *   3. laissait les cases du ROULEMENT pointer sur elle. Comme la génération
 *      hérite de `intervention_templates.assigned_team_id`, la génération
 *      suivante RECRÉAIT des interventions futures affectées à une équipe
 *      archivée — invisible dans les sélecteurs, donc incorrigible depuis
 *      l'écran ;
 *   4. et le dialogue de confirmation annonçait seulement « désaffecte les
 *      missions planifiées ». Il taisait le principal.
 *
 * Une cascade ne doit jamais être silencieuse.
 */

const TEAMS_DB = readFileSync(join(process.cwd(), 'lib', 'db', 'teams.ts'), 'utf8')
const ACTIONS = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', 'equipes', 'actions.ts'),
  'utf8',
)
const BUTTON = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', 'equipes', 'ArchiveTeamButton.tsx'),
  'utf8',
)

describe("Ce qu'une équipe tient encore", () => {
  it('se compte avant de l’archiver', () => {
    expect(TEAMS_DB).toContain('export async function getTeamDependencies')
    expect(TEAMS_DB).toMatch(/futureInterventions/)
    expect(TEAMS_DB).toMatch(/rotationSlots/)
  })

  it('ne compte QUE les interventions à venir (le passé est une preuve)', () => {
    // On ne réécrit jamais le passé : les interventions déjà faites gardent leur
    // équipe. Seules celles à venir deviendraient orphelines.
    expect(TEAMS_DB).toMatch(/\.eq\('status', 'planned'\)[\s\S]{0,80}\.gte\('scheduled_for'/)
  })
})

describe("L'archivage d'une équipe", () => {
  it('REFUSE si elle tient un roulement, et dit où aller', () => {
    expect(ACTIONS).toMatch(/deps\.rotationSlots > 0/)
    expect(ACTIONS).toContain('Remplacez-la dans le roulement')
  })

  it('nomme les chantiers concernés — un refus sans lieu est inutile', () => {
    expect(ACTIONS).toContain('rotationSiteNames')
  })

  it('coupe le lien avec les modèles de génération', () => {
    // Sans ça, la génération suivante recrée des interventions affectées à une
    // équipe archivée, et le nettoyage des interventions ne sert à rien.
    expect(TEAMS_DB).toMatch(
      /from\('intervention_templates'\)[\s\S]{0,120}assigned_team_id: null/,
    )
  })
})

describe('Le dialogue de confirmation', () => {
  it('annonce les interventions à venir qui deviendront orphelines', () => {
    expect(BUTTON).toContain('futureInterventions')
    expect(BUTTON).toContain('Non-affecté')
    expect(BUTTON).toContain('plus être démarrées')
  })

  it('ne se contente plus de parler des missions', () => {
    // L'ancien texte : « Cette action désaffecte les missions planifiées de cette
    // équipe mais conserve l'historique. » — vrai, et gravement incomplet.
    expect(BUTTON).not.toContain('désaffecte les missions planifiées de cette')
  })
})
