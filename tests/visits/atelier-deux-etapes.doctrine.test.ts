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
const colonne = readFileSync(join(atelier, 'AtelierColonnes.tsx'), 'utf8')
const cr = join(process.cwd(), 'app/(field)/m/visite/[reportId]/cr')
const concretisation = readFileSync(join(cr, 'CrConcretisation.tsx'), 'utf8')
const documentSections = readFileSync(join(cr, 'CrDocumentSections.tsx'), 'utf8')

/** Ce que le fichier AFFICHE : les en-têtes racontent justement ce qui a été
 *  retiré, et ces phrases-là ne sont pas à l'écran. */
const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('le panneau montre le travail restant, pas un résumé chiffré', () => {
  const rendu = sansCommentaires(panneau)

  it('s’intitule « Travail restant »', () => {
    expect(rendu).toContain('Travail restant')
    expect(rendu).not.toContain('propositions à regarder')
  })

  it('ne porte AUCUN total en tête', () => {
    // Un nombre global serait aussitôt rapproché de celui de la concrétisation,
    // à gauche — et c'est précisément ce rapprochement qui n'a pas de sens.
    // « 0 arbitrée sur 17 » se lisait en plus comme une note à remplir.
    expect(rendu).not.toMatch(/arbitrée?s? sur/)
    expect(rendu).not.toMatch(/décisions? à prendre/)
    expect(rendu).not.toMatch(/style=\{\{\s*width:/)
  })

  it('garde à l’écran les familles terminées — c’est la preuve du travail fait', () => {
    // La ligne cochée est ce qui donne le sentiment d'avancer. La retirer
    // effaçait le travail accompli, et le panneau semblait ne jamais bouger.
    expect(rendu).toMatch(/const traitée = items\.length === 0/)
    expect(rendu).not.toMatch(/filter\(\(g\) => g\.restants\.length > 0\)/)
  })

  it('mais n’en invente pas une pour ce qui n’a jamais rien eu à trancher', () => {
    // N'avoir rien à faire n'est pas avoir fini : pas de « ✓ » gratuit.
    expect(rendu).toMatch(/g\.restants\.length \+ g\.arbitrés > 0/)
  })

  it('se referme sur « Atelier terminé »', () => {
    expect(rendu).toContain('Atelier terminé')
  })

  it('se relit quand des objets viennent d’être créés par l’autre porte', () => {
    // Créer depuis le compte-rendu referme les propositions satisfaites : sans
    // cette dépendance, le panneau afficherait le même nombre après le clic.
    expect(rendu).toMatch(/useEffect\(\(\) => \{ void relire\(\) \}, \[relire, rechargerA\]\)/)
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
    expect(sansCommentaires(colonne)).toMatch(/onEdited=\{\(\) => setRevisionTexte/)
    expect(sansCommentaires(colonne)).toMatch(/documentRevision=\{revisionTexte\}/)
  })
})

// ── LA BOUCLE SE REFERME (Vincent, 2026-07-22) ─────────────────────────────
//
// Deux portes mènent au chantier : arbitrer une proposition, ou concrétiser le
// compte-rendu corrigé. Le journal empêchait déjà le doublon d'OBJET. Restait
// un mensonge d'ÉCRAN — créer quatre actions laissait leurs propositions en
// 'proposed', et le travail restant n'avait pas bougé d'un cran.
//
// « Je ne supprimerais pas la ligne, je changerais son état : l'historique
// reste intact, la provenance reste démontrable, et le panneau ne les compte
// plus. » (mig 231)

describe('une proposition satisfaite cesse d’être du travail', () => {
  const proposals = readFileSync(join(process.cwd(), 'lib/db/knowledge-proposals.ts'), 'utf8')
  const creation = readFileSync(join(cr, 'cr-concretisation-actions.ts'), 'utf8')
  const migration = readFileSync(
    join(process.cwd(), 'supabase/migrations/231_proposals_fulfilled.sql'),
    'utf8',
  )

  it('l’état existe, et n’efface rien', () => {
    expect(migration).toMatch(/'fulfilled'/)
    expect(proposals).toMatch(/export type ProposalStatus[^\n]*'fulfilled'/)
    // Un état, pas une suppression : aucune ligne ne disparaît.
    expect(proposals).not.toMatch(/\.delete\(\)[\s\S]{0,80}site_knowledge_proposals/)
  })

  it('« satisfaite » ne se confond pas avec « arbitrée par un humain »', () => {
    // 'confirmed' pose `reviewed_by` : la décision a un auteur. 'fulfilled' n'en
    // a pas — s'en inventer un ferait dire au système qu'un arbitrage a eu lieu.
    const fn = proposals.split('fulfillProposalsFromConcretisation')[1] ?? ''
    expect(fn).toMatch(/status: 'fulfilled'/)
    expect(fn).not.toMatch(/reviewed_by:/)
  })

  it('ne referme que ce qui était encore à trancher', () => {
    // Garde anti-concurrence : si un arbitrage a confirmé la proposition entre
    // la lecture et l'écriture, on ne réécrit pas sa décision.
    const fn = proposals.split('fulfillProposalsFromConcretisation')[1] ?? ''
    expect(fn).toMatch(/\.eq\('status', 'proposed'\)/)
  })

  it('la création referme, APRÈS avoir écrit, et jamais à son détriment', () => {
    expect(creation).toMatch(/fulfillProposalsFromConcretisation/)
    // Best-effort : les objets existent déjà quand on arrive là.
    expect(creation).toMatch(/try \{[\s\S]{0,200}fulfillProposalsFromConcretisation[\s\S]{0,200}catch/)
  })

  it('l’élargissement de l’énumération n’efface rien ailleurs', () => {
    // Un statut de plus change le sens de TOUS les filtres existants. Les deux
    // lectures qui parlent d'objets produits doivent inclure 'fulfilled', sans
    // quoi des liens réels disparaîtraient du graphe et du récit.
    const graphe = readFileSync(join(process.cwd(), 'lib/knowledge/site-graph.ts'), 'utf8')
    const recit = readFileSync(join(process.cwd(), 'lib/db/visit-narrative.ts'), 'utf8')
    expect(graphe).toMatch(/\['proposed', 'confirmed', 'fulfilled'\]/)
    expect(recit).toMatch(/status === 'confirmed' \|\| p\.status === 'fulfilled'/)
  })
})

// ── « YANN » N'EST PAS UNE ENTREPRISE (Vincent, 2026-07-22) ────────────────
//
// MemorIA lit des chaînes nues : « Clim Expert », « Électricien », « Yann ».
// Une société, un métier, un homme — et rien dans le texte ne dit lequel. La
// première version de la ligne compacte n'offrait qu'un champ, traité comme
// l'entreprise : confirmer « Yann » aurait créé une ENTREPRISE nommée Yann.
// C'est le bug que `mig 137` avait fermé (« tout contact vit sous une
// entreprise ») et que le serveur refuse toujours — mais un refus après coup se
// lit comme une panne, pas comme une question qu'on avait oublié de poser.

describe('un acteur se QUALIFIE avant de se confirmer', () => {
  const rendu = sansCommentaires(panneau)

  it('la famille ne s’appelle plus « Intervenants » — le mot mêlait deux natures', () => {
    expect(rendu).toContain("titre: 'Acteurs'")
  })

  it('le type est un choix explicite, jamais une déduction', () => {
    expect(rendu).toMatch(/Personne.*:.*'Entreprise'|\{personneChoisie \? 'Personne' : 'Entreprise'\}/)
    expect(rendu).toMatch(/estPersonne/)
  })

  it('une personne part avec son nom dans le champ personne, pas dans l’entreprise', () => {
    // Basculer doit DÉPLACER le nom lu, sinon il faut le retaper puis vider
    // l'autre champ — et l'entreprise garderait « Yann ».
    expect(rendu).toMatch(/setPersonne\(entreprise\.trim\(\) \|\| item\.title\)/)
    expect(rendu).toMatch(/setEntreprise\(''\)/)
  })

  it('et son entreprise est exigée AVANT l’envoi', () => {
    expect(rendu).toMatch(/estPersonne && !entreprise\.trim\(\)/)
    expect(rendu).toContain('Une personne se rattache à une entreprise')
  })

  it('`person_name` n’est transmis que si c’en est une', () => {
    expect(rendu).toMatch(/person_name: estPersonne \? personne\.trim\(\) \|\| undefined : undefined/)
  })

  it('les entreprises proposées aident sans enfermer', () => {
    // `list` = suggestion, le champ reste libre : refuser un nom absent
    // obligerait à créer la fiche entreprise avant de pouvoir arbitrer.
    expect(rendu).toMatch(/list=\{`entreprises-\$\{pid\}`\}/)
    expect(rendu).toMatch(/<datalist id=\{`entreprises-\$\{pid\}`\}>/)
  })
})
