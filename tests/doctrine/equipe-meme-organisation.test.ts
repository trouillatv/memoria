import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * UNE ÉQUIPE NE TRAVAILLE QUE POUR SON ORGANISATION.
 *
 * Le cas métier : Guillaume travaille pour AGP et pour Servinor. Une équipe
 * Servinor ne doit jamais pouvoir être affectée à un chantier AGP.
 *
 * Le piège technique : `assigned_team_id` est une simple clé étrangère, sans
 * contrainte d'organisation en base, et TOUTES les écritures passent par le
 * service role — qui contourne la RLS. Le contrôle ne peut donc vivre QUE dans
 * le code. Deux actions l'avaient oublié :
 *
 *   - createInterventionFromWeekAction : la mission était gardée, pas l'équipe ;
 *   - claimInterventionTeamAction (mobile) : ni l'une ni l'autre.
 *
 * L'écran ne propose jamais l'équipe d'un autre tenant — mais `teamId` arrive du
 * client. Une protection qui n'existe que dans l'UI n'est pas une protection.
 *
 * Ce test lit tout fichier de server actions qui ÉCRIT `assigned_team_id` et
 * exige qu'il garde l'équipe. Garder la mission ou l'intervention ne suffit pas :
 * il faut garder les DEUX bouts du lien.
 */

const APP = join(process.cwd(), 'app')

/** Écriture de l'affectation : `assigned_team_id:` dans un update/insert. */
const WRITES_ASSIGNMENT = /assigned_team_id\s*:/

/** Le contrôle d'appartenance de l'ÉQUIPE, sous ses formes réelles. */
const GUARDS_TEAM = [
  /guardOwned\([^)]*['"]teams['"]/,
  /requireOwned\([^)]*['"]teams['"]/,
  /tenantOwns\([^)]*['"]teams['"]/,
  // Comparaison explicite des orgs — y compris à travers un cast TypeScript,
  // comme dans /m/ponctuel-actions.ts : `(team as {...}).organization_id !== orgId`.
  /team[^\n]*\.organization_id\s*!==/,
]

/**
 * Fichiers où l'équipe n'est PAS choisie par l'appelant : elle est héritée d'un
 * objet déjà gardé (mission, template de roulement). Rien à valider — mais il
 * faut le dire.
 */
const TEAM_IS_DERIVED: Record<string, string> = {
  'lib/db/intervention-templates.ts':
    "L'équipe est héritée de la mission ou du template, jamais fournie par l'appelant.",
  'app/(dashboard)/(planning)/semaine/occurrence-actions.ts':
    "Revert d'occurrence : l'équipe est relue depuis le template de l'intervention, elle-même gardée par requireOwned('interventions'). L'appelant ne choisit aucune équipe.",
}

function listActionFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listActionFiles(full))
    else if (/actions?\.ts$/.test(entry)) out.push(full)
  }
  return out
}

describe("L'affectation d'une équipe", () => {
  const files = listActionFiles(APP).filter((f) => WRITES_ASSIGNMENT.test(readFileSync(f, 'utf8')))

  it('concerne bien des fichiers (le test parcourt quelque chose)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it("vérifie TOUJOURS que l'équipe est de la même organisation", () => {
    const unguarded: string[] = []

    for (const file of files) {
      const key = relative(process.cwd(), file).split(sep).join('/')
      if (key in TEAM_IS_DERIVED) continue

      const src = readFileSync(file, 'utf8')
      if (!GUARDS_TEAM.some((re) => re.test(src))) unguarded.push(key)
    }

    expect(
      unguarded,
      `Ces actions écrivent assigned_team_id SANS vérifier que l'équipe appartient à l'organisation de l'appelant.\n` +
        `Le service role contourne la RLS et teamId vient du client : une équipe d'un autre tenant peut être affectée.\n` +
        `Ajoute requireOwned(role, 'teams', teamId) — garder la mission ne suffit pas.\n\n` +
        unguarded.map((p) => `  - ${p}`).join('\n'),
    ).toEqual([])
  })
})
