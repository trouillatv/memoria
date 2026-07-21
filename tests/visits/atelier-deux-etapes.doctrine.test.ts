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
const colonne = readFileSync(join(atelier, 'ColonneDocument.tsx'), 'utf8')
const cr = join(process.cwd(), 'app/(field)/m/visite/[reportId]/cr')
const concretisation = readFileSync(join(cr, 'CrConcretisation.tsx'), 'utf8')
const documentSections = readFileSync(join(cr, 'CrDocumentSections.tsx'), 'utf8')

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
    expect(sansCommentaires(colonne)).toMatch(/<CrConcretisation[\s\S]*?asStep/)
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

// ── UNE LISTE PÉRIMÉE LE DIT (Vincent, 2026-07-22) ─────────────────────────
//
// « Mettre à jour les propositions » disparaissait après le premier clic et ne
// revenait jamais. Or cette liste est DÉDUITE du texte du compte-rendu :
// corriger une section ensuite laissait à l'écran la description d'un texte qui
// n'existe plus — sans rien dire, et sans autre recours qu'un « Relire »
// discret que rien n'invitait à cliquer.

describe('corriger le compte-rendu périme ce qui en avait été déduit', () => {
  it('le document signale ses corrections à qui veut l’entendre', () => {
    // Un rappel OPTIONNEL : là où personne ne l'écoute, rien ne change.
    expect(documentSections).toMatch(/onEdited\?:/)
    // Posé sur `adopt`, donc déclenché par une correction ET par une
    // restauration — les deux changent le texte.
    expect(documentSections).toMatch(/setStatus\(doc\.status\)\s*\n\s*onEdited\?\.\(\)/)
  })

  it('la concrétisation compare la révision du texte à celle de son calcul', () => {
    expect(concretisation).toMatch(/documentRevision\s*=\s*0/)
    expect(concretisation).toMatch(/documentRevision !== prepareeALaRevision/)
  })

  it('elle remet « Mettre à jour les propositions » en avant, sans recalculer seule', () => {
    const rendu = sansCommentaires(concretisation)
    expect(rendu).toContain('Vous avez corrigé le compte-rendu depuis cette préparation.')
    // Ancré sur le repère du bloc, pas sur une distance en caractères : une
    // phrase reformulée ne doit pas casser un test de doctrine.
    expect(rendu).toMatch(/perimee &&[\s\S]*?data-slot="cr-concretisation-perimee"/)
    expect(rendu).toMatch(/data-slot="cr-concretisation-perimee"[\s\S]*?Mettre à jour les propositions/)
    // Aucun effet ne relance la préparation : MemorIA signale, l'humain
    // déclenche. Un recalcul automatique partirait pendant qu'on corrige.
    expect(rendu).not.toMatch(/useEffect/)
  })

  it('l’atelier relie les deux voisins — ailleurs, rien ne bouge', () => {
    expect(sansCommentaires(colonne)).toMatch(/onEdited=\{\(\) => setRevision/)
    expect(sansCommentaires(colonne)).toMatch(/documentRevision=\{revision\}/)
  })
})
