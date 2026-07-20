// 🎯 TOUTE DESTINATION DE RECHERCHE MÈNE À UNE ROUTE QUI EXISTE.
//
// Ce fichier ferme une classe entière de défauts, découverte en recette : **une
// adresse peut être parfaitement typée et ne mener nulle part**. Le typecheck
// valide la forme d'une chaîne, jamais l'existence de sa cible ; deux bugs de ce
// genre ont échappé aux tests et n'ont été vus qu'en production
// (`/decision/x/decision/y`, et des portes qui éjectaient hors du graphe).
//
// La preuve est faite en DEUX temps, et c'est le second qui compte :
//
//   1. `memoryHitHref` est une fonction pure — on connaît déjà sa sortie ;
//   2. mais rien ne garantissait qu'un fichier de route réponde à cette sortie.
//      Ici on confronte l'adresse produite au SYSTÈME DE FICHIERS.
//
// Ajouter un type au corpus de recherche sans lui donner de route fait donc
// tomber ce test — c'est exactement le moment où l'erreur doit être vue.

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { memoryHitHref } from '@/lib/memory/hit-href'
import { HIT_LABEL_FR } from '@/lib/memory/search-grouping'
import type { MemoryHitType } from '@/lib/db/memory-search'

const RACINE = join(__dirname, '..', '..')
const SITE = 'site-1'
const ID = 'objet-1'

/** Une adresse `/sites/<id>/<segment>/<id>` a-t-elle un fichier de route ? */
function routeExiste(href: string): { ok: boolean; attendu: string } {
  const chemin = href.split('?')[0]

  const segment = /^\/sites\/[^/]+\/([^/]+)\/[^/]+$/.exec(chemin)?.[1]
  if (segment) {
    // Le nom du paramètre dynamique varie (`[actionId]`, `[reportId]`…) : on
    // vérifie le DOSSIER du segment, pas le nom du fichier feuille.
    const attendu = join(RACINE, 'app', '(dashboard)', 'sites', '[id]', segment)
    return { ok: existsSync(attendu), attendu: `app/(dashboard)/sites/[id]/${segment}/` }
  }

  // Les destinations hors chantier : page de chantier, liste, visionneuse.
  const horsChantier: Record<string, string> = {
    '/sites': join(RACINE, 'app', '(dashboard)', 'sites', 'page.tsx'),
    [`/sites/${SITE}`]: join(RACINE, 'app', '(dashboard)', 'sites', '[id]', 'page.tsx'),
    [`/documents/${ID}`]: join(RACINE, 'app', '(dashboard)', 'documents', '[id]', 'page.tsx'),
  }
  const attendu = horsChantier[chemin]
  if (!attendu) return { ok: false, attendu: `AUCUNE règle connue pour ${chemin}` }
  return { ok: existsSync(attendu), attendu: chemin }
}

/** Tous les types que la recherche peut rendre — la source est le dictionnaire
 *  de libellés, qui est exhaustif par construction (`Record<MemoryHitType, …>`). */
const TOUS_LES_TYPES = Object.keys(HIT_LABEL_FR) as MemoryHitType[]

const hit = (type: MemoryHitType, over: Record<string, unknown> = {}) => ({
  type, id: ID, siteId: SITE, subjectId: null, ...over,
})

describe('🎯 Chaque type de résultat mène à une route qui existe', () => {
  it('le corpus n’est pas vide (sinon ce test ne prouverait rien)', () => {
    expect(TOUS_LES_TYPES.length).toBeGreaterThan(10)
  })

  it.each(TOUS_LES_TYPES)('« %s » ouvre une destination réelle', (type) => {
    const href = memoryHitHref(hit(type))
    const { ok, attendu } = routeExiste(href)
    expect(ok, `le type « ${type} » mène à ${href}, mais ${attendu} n'existe pas`).toBe(true)
  })

  it('un résultat SANS chantier ne fabrique jamais une adresse de chantier', () => {
    for (const type of TOUS_LES_TYPES) {
      const href = memoryHitHref(hit(type, { siteId: null }))
      expect(href).not.toMatch(/^\/sites\/[^/]+\//)
      expect(routeExiste(href).ok, `${type} sans chantier → ${href}`).toBe(true)
    }
  })

  it('un résultat rattaché à un FIL mène aussi quelque part', () => {
    // La règle du fil ne s'applique qu'aux types sans adresse propre, mais elle
    // doit rester une destination valide.
    for (const type of TOUS_LES_TYPES) {
      const href = memoryHitHref(hit(type, { subjectId: 'sujet-9' }))
      const chemin = href.split('?')[0]
      if (chemin.includes('/subjects/')) {
        expect(existsSync(join(RACINE, 'app', '(dashboard)', 'sites', '[id]', 'subjects'))).toBe(true)
      } else {
        expect(routeExiste(href).ok, `${type} avec fil → ${href}`).toBe(true)
      }
    }
  })
})

describe('🎯 Les objets adressables ont leurs DEUX rendus', () => {
  // Une adresse canonique rend un PANNEAU quand on navigue dans l'application
  // (route interceptée) et une PAGE COMPLÈTE en accès direct. L'une sans l'autre
  // casse soit le parcours, soit le partage de lien.
  const SEGMENTS = ['action', 'decision', 'reunion', 'document', 'reserve', 'observation', 'intervenant']

  it.each(SEGMENTS)('« %s » a sa page directe ET sa route interceptée', (segment) => {
    const page = join(RACINE, 'app', '(dashboard)', 'sites', '[id]', segment)
    const intercept = join(RACINE, 'app', '(dashboard)', 'sites', '[id]', '@fiche', `(.)${segment}`)
    expect(existsSync(page), `page directe manquante : sites/[id]/${segment}/`).toBe(true)
    expect(existsSync(intercept), `route interceptée manquante : @fiche/(.)${segment}/`).toBe(true)
  })
})
