// LE MOT VISIBLE EST « CHANTIER ». « Site » est le mot de la base.
//
// Guillaume ne dit jamais « j'ouvre le site n°42 ». Il dit « je vais à
// Discount ». L'objet technique s'appelle `sites` et continuera de s'appeler
// ainsi — la table, les routes, le code. Mais l'ÉCRAN, lui, ne doit plus
// exposer le mot du développeur : partout où l'utilisateur lit, c'est un
// chantier.
//
// Ce test protège le vocabulaire, pas le modèle. Il ne dit rien de la table.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NAV } from '@/components/layout/nav-items'

const REPO_ROOT = join(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf-8')
}

describe('Le vocabulaire visible — « chantier », jamais « site »', () => {
  it('le menu conduit aux Chantiers', () => {
    const item = NAV.find((i) => i.href === '/sites')
    // La route reste /sites : aucun lien ne casse, aucun favori ne meurt.
    expect(item?.label).toBe('Chantiers')
    expect(NAV.some((i) => i.label === 'Sites')).toBe(false)
  })

  it('la liste et la création parlent de chantiers', () => {
    const list = read('app/(dashboard)/sites/page.tsx')
    expect(list).toContain('Chantiers')
    expect(list).toContain('Nouveau chantier')

    const dialog = read('app/(dashboard)/sites/CreateSiteDialog.tsx')
    expect(dialog).toContain('Nouveau chantier')
    expect(dialog).toContain('Nom du chantier')
  })

  it("le client reste un choix explicite : aucun client n'est deviné", () => {
    const actions = read('app/(dashboard)/sites/actions.ts')
    // Un client ne naît que d'un nom SAISI et confirmé (client_name_new), jamais
    // d'une déduction : trois « Discount » en base coûteraient plus cher que le
    // clic qu'on économise.
    expect(actions).toContain('client_name_new')
  })
})
