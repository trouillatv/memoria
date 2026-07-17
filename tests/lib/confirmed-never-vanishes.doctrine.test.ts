import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── CONFIRMER NE DOIT JAMAIS FAIRE DISPARAÎTRE ───────────────────────────────
// C'est arrivé deux fois, pour la même raison.
//
// `proposedOnly(p)` renvoyait `{ proposed: …, confirmed: [] }` : la section
// n'affichait QUE le proposé. Tant qu'aucun objet n'existait pour ce type, elle
// était honnête. Le jour où l'objet est né (mig 215 pour les échéances, 217 pour
// les vigilances), confirmer un fait le faisait QUITTER « à confirmer » sans
// jamais rejoindre « validé » — le conducteur voyait son information s'évaporer
// parce qu'il l'avait validée.
//
// Le correctif avait été fait pour les échéances, puis NON RÉPLIQUÉ pour les
// vigilances quand la table est arrivée. La fonction n'existe plus ; rien
// n'empêchait de la réécrire. Ce test l'interdit.
//
// Méthode (règle du projet) : écrire le test, casser le code, vérifier qu'il
// échoue, et seulement alors lui faire confiance.

const OVERVIEW = 'lib/knowledge/site-overview.ts'

function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('Un fait confirmé ne disparaît jamais de l’Aperçu', () => {
  const src = codeOf(OVERVIEW)

  it('la fonction qui a causé l’évaporation n’existe plus', () => {
    // `proposedOnly` a fait le coup DEUX FOIS : échéances (mig 215), puis
    // vigilances (mig 217) parce que le correctif n'avait pas été répliqué.
    //
    // On ne cherche PAS « confirmed: [] » : `emptySiteOverview` en contient
    // légitimement — une section vide quand tout est vide n'est pas une
    // évaporation. C'est le fallback sûr, pas le bug. (Mon premier test les
    // confondait et échouait sur du code sain.)
    expect(src).not.toContain('proposedOnly')
  })

  it.each(['watchpoints', 'knowledge', 'stakeholders', 'deadlines', 'decisions'])(
    'la section « %s » expose son validé',
    (section) => {
      // Chacune de ces sections a un objet métier réel derrière : site_watchpoints,
      // site_knowledge_entries, site_intervenants, site_deadlines, site_decisions.
      // Aucune n'a d'excuse pour n'afficher que du proposé.
      expect(src, `« ${section} » doit passer par proposedAndConfirmed`)
        .toMatch(new RegExp(`${section}:\\s*proposedAndConfirmed\\(`))
    },
  )

  it('les décisions sont dans l’Aperçu, comme dans la Mémoire mobile', () => {
    // L'objet le plus durable du produit était absent de la vue qui prétend
    // résumer le chantier. La projection le portait déjà ; personne ne l'exposait.
    expect(src).toContain('listDecisionsBySite')
    const tab = codeOf('app/(dashboard)/sites/[id]/views/apercu/SiteOverviewTab.tsx')
    expect(tab, 'un read model que l’écran n’affiche pas est un îlot').toContain('decisions.confirmed')
  })

  it('l’Aperçu et la Mémoire mobile lisent la MÊME source pour chaque objet partagé', () => {
    // Le vrai risque de divergence : deux read models décrivent la connaissance
    // du chantier. Tant qu'ils ne partagent pas de noyau, seul l'accord des
    // sources garantit qu'ils ne se contrediront pas.
    const memoire = codeOf('lib/knowledge/memory-review.ts')
    for (const source of ['listKnowledgeEntries', 'listWatchpoints', 'listSiteIntervenants', 'listDecisionsBySite']) {
      expect(memoire, `la Mémoire mobile doit lire ${source}`).toContain(source)
      expect(src, `l’Aperçu doit lire ${source} — la même source, pas une copie`).toContain(source)
    }
  })
})
