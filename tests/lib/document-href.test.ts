import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { documentHref } from '@/lib/knowledge/document-href'

// ⚖️ UNE SEULE PORTE POUR UN DOCUMENT.
//
// Ce fichier existe parce que la même faute a été commise TROIS fois de suite,
// et qu'aucune des trois n'a été vue par le typecheck, le lint ou les 959 tests :
//
//   1. quatre listes repointées vers la fiche du graphe → les documents `litige`,
//      que la fiche refuse par doctrine, devenaient INATTEIGNABLES ;
//   2. la règle centralisée dans `document-href.ts` → une cinquième liste (la
//      fiche Sujet) l'a contournée, avec la même troncature de `document_type` ;
//   3. le correctif lui-même a introduit un sixième contournement, dans une
//      branche morte de `LinkedDocumentsList` — le piège reposé.
//
// La leçon : **une porte ne se déplace pas sans emporter les cas que l'ancienne
// servait**, et centraliser une règle ne sert à rien si un écran peut la
// réécrire à la main.
//
// D'où deux gardes : le comportement du module, et un TRIPWIRE qui interdit
// qu'on reconstruise l'adresse ailleurs.

describe('documentHref — la règle', () => {
  const doc = (type: string) => ({ id: 'doc-1', document_type: type })

  it('dans un chantier, un document ordinaire ouvre sa fiche du graphe', () => {
    expect(documentHref(doc('preuve'), 'site-1')).toBe('/sites/site-1/document/doc-1')
  })

  it('un LITIGE va toujours à la visionneuse, même dans un chantier', () => {
    // Il est exclu du graphe par doctrine. L'y envoyer ne le protège pas
    // davantage : ça le rend introuvable. Il n'est pas caché, il n'est pas MÉLANGÉ.
    expect(documentHref(doc('litige'), 'site-1')).toBe('/documents/doc-1')
  })

  it('hors chantier, la visionneuse — il n’y a pas de coquille où l’ouvrir', () => {
    expect(documentHref(doc('preuve'), null)).toBe('/documents/doc-1')
    expect(documentHref(doc('preuve'))).toBe('/documents/doc-1')
  })
})

describe('🔒 TRIPWIRE — personne ne reconstruit l’adresse à la main', () => {
  it('aucun écran ne construit `/sites/<id>/document/<id>` hors du module', () => {
    // On cherche le motif dans tout le code de production. Seuls le module et
    // les read models qui produisent une adresse de SORTIE ont le droit d'écrire
    // cette chaîne ; toute autre occurrence est un contournement de la règle.
    const AUTORISES = [
      'lib/knowledge/document-href.ts',
      // Seule exception, et elle est VÉRIFIÉE : la recherche exclut le litige à la
      // source, par un index partiel ET un filtre dans la RPC (mig 204). Aucune
      // autre surface n'a le droit d'être ici sans une garantie de ce niveau.
      //
      // `observation-fiche.ts` y figurait, à tort : sa vérification portait sur le
      // rattachement au chantier, jamais sur le TYPE. La liste blanche certifiait
      // donc sûre la seule surface qui ne l'était pas — c'est ce mécanisme qui a
      // produit les trois rejets. Elle en sort, le fichier est corrigé.
      'lib/memory/hit-href.ts',
    ]

    // ⚠️ `execFileSync` et NON `execSync` : sans shell, donc sans interprétation
    // du motif. La version précédente passait `"/document/${"` à `sh`, qui y voyait
    // une expansion de paramètre non fermée et refusait la commande — le garde ne
    // tournait donc JAMAIS sur CI (Linux), seulement sur Windows où `cmd` l'ignore.
    let sortie = ''
    try {
      sortie = execFileSync(
        'git',
        ['grep', '-l', '--fixed-strings', '/document/${', '--', '*.ts', '*.tsx', ':!tests/'],
        { cwd: process.cwd(), encoding: 'utf8' },
      )
    } catch (e) {
      // `git grep` sort en 1 quand il ne trouve RIEN : c'est le succès attendu.
      // Tout autre code signifie que la commande est cassée — et un garde qui
      // interprète sa propre panne comme une réussite n'est pas un garde.
      const code = (e as { status?: number }).status
      if (code !== 1) {
        throw new Error(
          `Le tripwire n'a pas pu s'exécuter (git grep code ${code}). ` +
            "Tant qu'il ne tourne pas, il ne protège rien.",
        )
      }
      sortie = ''
    }

    const fautifs = sortie
      .split('\n')
      .map((l) => l.trim().replace(/\\/g, '/'))
      .filter(Boolean)
      .filter((f) => !AUTORISES.includes(f))

    expect(
      fautifs,
      'Ces fichiers construisent l’adresse d’un document à la main.\n' +
        'Utilise `documentHref(doc, siteId)` : sinon un LITIGE part vers le graphe,\n' +
        'qui le refuse, et le lien mène à notFound().\n\n' +
        fautifs.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([])
  })

  it('le module reste la seule source de la règle du litige', () => {
    const src = readFileSync('lib/knowledge/document-href.ts', 'utf8')
    expect(src).toContain("doc.document_type === 'litige'")
    expect(src).toContain('/documents/${doc.id}')
  })
})
