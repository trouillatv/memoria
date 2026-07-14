// UN CHANTIER PEUT EXISTER SANS CLIENT — et supprimer un client ne détruit plus
// ses chantiers (migration 210).
//
// Ce qu'on protège :
//
//   1. LA CASCADE DESTRUCTIVE NE REVIENT PAS. `ON DELETE CASCADE` sur
//      sites.client_id signifiait : supprimer un client SUPPRIME ses chantiers,
//      et avec eux visites, actions, réserves, photos, mémoire. C'est un bug de
//      sécurité, indépendant du caractère facultatif du client. Il ne doit
//      jamais réapparaître.
//
//   2. LE « SANS CLIENT » EST UN CHOIX. Un formulaire qu'on valide sans y penser
//      ne distingue plus l'oubli de la décision : le serveur REFUSE tant que
//      rien n'a été choisi explicitement.
//
//   3. AUCUN CLIENT FICTIF. L'ancien contournement créait un vrai client nommé
//      « Interne » pour satisfaire le NOT NULL. Il ne doit pas survivre.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf-8')

const MIGRATION = read('supabase/migrations/210_sites_client_optional.sql')
const ACTIONS = read('app/(dashboard)/sites/actions.ts')
const DIALOG = read('app/(dashboard)/sites/CreateSiteDialog.tsx')

describe('La migration 210', () => {
  it('rend le client facultatif', () => {
    expect(MIGRATION).toMatch(/ALTER COLUMN client_id DROP NOT NULL/i)
  })

  it('remplace la cascade destructive par SET NULL', () => {
    expect(MIGRATION).toMatch(/ON DELETE SET NULL/i)
    // La cascade ne doit pas être re-créée : la seule occurrence tolérée est
    // celle des commentaires qui expliquent pourquoi on s'en débarrasse.
    const code = MIGRATION.split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
    expect(code).not.toMatch(/ON DELETE CASCADE/i)
  })

  it('retrouve le nom RÉEL de la contrainte au lieu de le deviner', () => {
    // Un DROP CONSTRAINT sur un nom supposé ne ferait rien — en silence.
    expect(MIGRATION).toContain('pg_constraint')
    expect(MIGRATION).toMatch(/EXECUTE format\('ALTER TABLE public\.sites DROP CONSTRAINT/i)
  })

  it('dit ce que coûte le rollback', () => {
    // SET NOT NULL échouera dès qu'un chantier sans client existe : le plan de
    // retour doit être écrit AVANT, pas découvert le jour où on en a besoin.
    expect(MIGRATION).toMatch(/ROLLBACK/i)
    expect(MIGRATION).toMatch(/ÉCHOUERA|echouera/i)
  })
})

describe('La création', () => {
  it('refuse tant que le choix n’est pas explicite', () => {
    expect(ACTIONS).toContain("no_client")
    expect(ACTIONS).toMatch(/Continuer sans client/)
    // Le refus porte sur les TROIS possibilités absentes, pas sur un champ vide.
    expect(ACTIONS).toMatch(/!client_id && !client_name_new && no_client !== 'true'/)
  })

  it('accepte un chantier sans client quand la décision est prise', () => {
    expect(DIALOG).toContain("fd.set('no_client', 'true')")
    expect(DIALOG).toMatch(/Vous pourrez associer ce chantier à un client plus tard/)
  })

  it('ne crée plus le faux client « Interne »', () => {
    // L'ancien contournement du NOT NULL. La migration le rend inutile ; il ne
    // doit pas rester une porte dérobée qui pollue la base.
    expect(DIALOG).not.toContain("setClientNameNew('Interne')")
    expect(DIALOG).not.toContain('Sans client (interne)')
  })

  it('ne devine jamais un client', () => {
    // Un client naît d'un nom SAISI (client_name_new) ou d'un id CHOISI. Jamais
    // d'une déduction à partir du nom du chantier.
    expect(ACTIONS).toContain('client_name_new')
    expect(ACTIONS).not.toMatch(/guess|infer|deduce/i)
  })
})

describe('Le rattachement ultérieur', () => {
  it('existe — sinon « sans client » serait une impasse', () => {
    expect(ACTIONS).toContain('attachClientToSiteAction')
  })

  it('est filtré sur l’organisation (le service role contourne la RLS)', () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf('export async function attachClientToSiteAction'))
    expect(fn).toContain('organization_id')
  })
})
