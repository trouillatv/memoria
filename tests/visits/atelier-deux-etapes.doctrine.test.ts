import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── DEUX ÉTAPES, PAS DEUX COMPTEURS CONCURRENTS (Vincent, 2026-07-22) ───────
//
// L'atelier a montré, côte à côte, « 19 éléments proposés · 15 seront créés »
// (concrétisation) et « 17 propositions à regarder » (arbitrage). Deux totaux
// de la MÊME visite qui ne tombaient pas juste — et rien n'expliquait pourquoi,
// donc on cherchait l'erreur.
//
// Il n'y en avait pas : ils ne mesurent pas la même chose.
//   · le panneau        → « qu'est-ce que MemorIA me demande encore de DÉCIDER ? »
//   · la concrétisation → « si je valide, qu'est-ce qui SERA CRÉÉ ? »
//
// Ce sont deux marches d'un même parcours : je corrige, je termine mes
// arbitrages, je vois ce qui sera créé. Elles n'ont donc plus le même poids —
// et c'est CE choix que ce fichier protège. Il est facile à défaire sans le
// vouloir : remettre un total « pour informer », rétablir une barre « pour
// motiver », et les deux compteurs redeviennent comparables.

const atelier = join(process.cwd(), 'app/(dashboard)/sites/[id]/visites/[visitId]/compte-rendu/atelier')
const panneau = readFileSync(join(atelier, 'PanneauArbitrage.tsx'), 'utf8')
const page = readFileSync(join(atelier, 'page.tsx'), 'utf8')
const concretisation = readFileSync(
  join(process.cwd(), 'app/(field)/m/visite/[reportId]/cr/CrConcretisation.tsx'),
  'utf8',
)

/** Ce que le fichier AFFICHE : les en-têtes racontent justement ce qui a été
 *  retiré, et ces phrases-là ne sont pas à l'écran. */
const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('le panneau d’arbitrage compte des décisions, pas des objets', () => {
  const rendu = sansCommentaires(panneau)

  it('s’intitule « Arbitrages restants »', () => {
    expect(rendu).toContain('Arbitrages restants')
  })

  it('parle de décisions à prendre, jamais de propositions à regarder', () => {
    expect(rendu).toContain('décisions à prendre')
    expect(rendu).not.toContain('propositions à regarder')
  })

  it('n’affiche ni barre de progression ni ratio — c’est une liste, pas un score', () => {
    // « 0 arbitrée sur 17 » se lit comme une note à remplir, et invite à
    // comparer avec le total d'à côté.
    expect(rendu).not.toMatch(/arbitrée?s? sur/)
    expect(rendu).not.toMatch(/style=\{\{\s*width:/)
  })

  it('n’affiche que les familles qui ont encore quelque chose à trancher', () => {
    // Une famille entièrement arbitrée disparaît : sinon la liste de tâches
    // redevient un tableau de bord.
    expect(rendu).toMatch(/filter\(\(g\) => g\.restants\.length > 0\)/)
  })
})

describe('la concrétisation est une étape du parcours, sans total global', () => {
  it('l’atelier la monte en mode étape', () => {
    expect(sansCommentaires(page)).toMatch(/<CrConcretisation[^>]*asStep/)
  })

  it('le total global n’existe que hors flux — le mobile ne change pas', () => {
    // `asStep` est OPTIONNEL et faux par défaut : la page mobile et l'ancienne
    // page de bureau gardent leur affichage. Si ce défaut basculait, elles
    // muteraient sans que personne l'ait demandé.
    expect(concretisation).toMatch(/asStep\s*=\s*false/)
    expect(concretisation).toMatch(/asStep\s*\?/)
  })

  it('personne ne travaille avec « 19 » : le mode étape ne compte pas les éléments', () => {
    // La BRANCHE étape, et elle seule : `{asStep ? (` ouvre le bloc JSX, là où
    // le ternaire du titre s'écrit `{asStep ? '`. Le total vit dans l'autre
    // branche, après `) : (`.
    const [, apres = ''] = concretisation.split('{asStep ? (')
    const etape = apres.split(') : (')[0] ?? ''
    expect(etape).toContain('Votre compte-rendu est prêt.')
    expect(etape).not.toMatch(/items\.length/)
    expect(etape).not.toMatch(/creables\.length/)
    // …et le total reste bien disponible hors flux, pour le mobile.
    expect(concretisation).toMatch(/items\.length\} élément/)
  })
})
