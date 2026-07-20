// La recherche doit rendre une RÉPONSE, pas une liste.
//
// Ce qu'on protège :
//   • un SUJET qui porte le mot cherché passe devant les faits — il contient
//     déjà l'histoire ;
//   • les faits se groupent par CHANTIER (« tout ce qu'on sait sur Discount ») ;
//   • un fait rattaché à un fil ouvre LE FIL, pas le fait isolé ;
//   • la fenêtre par défaut couvre TOUTE la mémoire — « on avait déjà vu ça il
//     y a deux ans ? » ne doit jamais recevoir un « non » faux.

import { describe, it, expect } from 'vitest'
import {
  groupSearchHits,
  applyFilters,
  splitHighlights,
  HIT_LABEL_FR,
  ALL_MEMORY_DAYS,
  PERIODS,
} from '@/lib/memory/search-grouping'
import { memoryHitHref, type MemoryHit, type MemoryHitType } from '@/lib/db/memory-search'

const NAMES = new Map([
  ['s1', 'Discount Poindimié'],
  ['s2', 'Mairie de Koné'],
])
const nameOf = (id: string) => NAMES.get(id)

const hit = (over: Partial<MemoryHit> = {}): MemoryHit => ({
  type: 'observation',
  id: 'h1',
  title: 'Fuite au plafond',
  snippet: 'il y a des fuites un peu partout sur le toit',
  occurredAt: '2026-07-10T08:00:00.000Z',
  siteId: 's1',
  contractId: null,
  rank: 0.2,
  subjectId: null,
  ...over,
})

describe('Le FIL passe devant les faits', () => {
  it('un sujet trouvé est sorti du lot des faits', () => {
    const g = groupSearchHits(
      [
        hit({ id: 'f1', rank: 0.3 }),
        hit({ id: 'sub1', type: 'subject', title: 'Fuite toiture', rank: 0.8 }),
      ],
      nameOf,
    )
    expect(g.threads.map((t) => t.id)).toEqual(['sub1'])
    expect(g.factCount).toBe(1)
    expect(g.sites[0].hits.map((h) => h.id)).toEqual(['f1'])
  })

  it('plusieurs fils sont classés par pertinence', () => {
    const g = groupSearchHits(
      [
        hit({ id: 'a', type: 'subject', rank: 0.5 }),
        hit({ id: 'b', type: 'subject', rank: 0.9 }),
      ],
      nameOf,
    )
    expect(g.threads.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('Les faits se groupent par CHANTIER', () => {
  it('« tout ce qu’on sait sur Discount Poindimié » — un bloc par chantier, nommé', () => {
    const g = groupSearchHits(
      [
        hit({ id: 'a', siteId: 's1', rank: 0.2 }),
        hit({ id: 'b', siteId: 's2', rank: 0.9 }),
        hit({ id: 'c', siteId: 's1', rank: 0.4 }),
      ],
      nameOf,
    )
    // Le chantier au meilleur résultat d'abord.
    expect(g.sites.map((s) => s.siteName)).toEqual(['Mairie de Koné', 'Discount Poindimié'])
    expect(g.sites[1].hits.map((h) => h.id)).toEqual(['c', 'a']) // le plus pertinent d'abord
    expect(g.factCount).toBe(3)
  })

  it('à pertinence égale, le plus RÉCENT prime', () => {
    const g = groupSearchHits(
      [
        hit({ id: 'vieux', rank: 0.5, occurredAt: '2024-01-01T00:00:00.000Z' }),
        hit({ id: 'recent', rank: 0.5, occurredAt: '2026-07-01T00:00:00.000Z' }),
      ],
      nameOf,
    )
    expect(g.sites[0].hits.map((h) => h.id)).toEqual(['recent', 'vieux'])
  })

  it('un chantier inconnu ne casse rien', () => {
    const g = groupSearchHits([hit({ siteId: 'inconnu' })], nameOf)
    expect(g.sites[0].siteName).toBe('Chantier')
  })

  it('compte ce qu’on a trouvé, par nature', () => {
    const g = groupSearchHits(
      [
        hit({ id: 'a', type: 'observation' }),
        hit({ id: 'b', type: 'observation' }),
        hit({ id: 'c', type: 'site_action' }),
      ],
      nameOf,
    )
    expect(g.countsByType).toEqual([
      { type: 'observation', count: 2 },
      { type: 'site_action', count: 1 },
    ])
  })
})

describe('Le clic mène à l’HISTOIRE, pas au fait isolé', () => {
  it('un fait rattaché à un fil ouvre le fil', () => {
    expect(memoryHitHref(hit({ subjectId: 'sub-9' }))).toBe('/sites/s1/subjects/sub-9')
  })

  it('un sujet ouvre son propre fil', () => {
    expect(memoryHitHref(hit({ type: 'subject', id: 'sub-9' }))).toBe('/sites/s1/subjects/sub-9')
  })

  it('un fait sans fil ouvre la fiche chantier', () => {
    expect(memoryHitHref(hit())).toBe('/sites/s1')
  })

  it('un fait sans chantier ne mène nulle part de faux', () => {
    expect(memoryHitHref(hit({ siteId: null }))).toBe('/sites')
  })
})

describe('Un objet qui a une adresse s’ouvre LUI-MÊME', () => {
  // Le défaut corrigé : on cherchait une Décision, on la trouvait, et on
  // atterrissait sur l'accueil du chantier — l'objet perdu au moment de
  // l'ouvrir.
  it('une décision ouvre la décision', () => {
    expect(memoryHitHref(hit({ type: 'site_decision', id: 'dec-1' })))
      .toBe('/sites/s1/decision/dec-1')
  })

  it('une action ouvre l’action', () => {
    expect(memoryHitHref(hit({ type: 'site_action', id: 'act-1' })))
      .toBe('/sites/s1/action/act-1')
  })

  it('une réunion ouvre la réunion, pas le chantier qui la contient', () => {
    // Lot 4. Application directe de la règle de modélisation : un conteneur est
    // un contexte, jamais un écran de substitution.
    expect(memoryHitHref(hit({ type: 'meeting', id: 'rep-1' })))
      .toBe('/sites/s1/reunion/rep-1')
  })

  it('l’objet prime sur son fil : la fiche porte déjà le sien', () => {
    // C'est le changement de règle. Une décision rattachée à un sujet ouvre la
    // décision, plus le sujet : on a cherché une décision, pas son sujet.
    expect(memoryHitHref(hit({ type: 'site_decision', id: 'dec-1', subjectId: 'sub-9' })))
      .toBe('/sites/s1/decision/dec-1')
  })

  it('sans chantier, aucune adresse d’objet n’est fabriquée', () => {
    expect(memoryHitHref(hit({ type: 'site_decision', id: 'dec-1', siteId: null })))
      .toBe('/sites')
  })

  it('les types sans modèle de navigation gardent leur repli', () => {
    // Volontaire : ne pas généraliser des URL qui n'existent pas. Le retour au
    // chantier reste honnête tant que ces objets n'ont pas de fiche.
    for (const type of ['anomaly', 'observation', 'site_reserve', 'obligation'] as const) {
      expect(memoryHitHref(hit({ type, id: 'x' }))).toBe('/sites/s1')
    }
  })
})

describe('Toute la mémoire, pas l’année en cours', () => {
  it('la fenêtre par défaut dépasse largement deux ans', () => {
    // « On avait déjà vu cette fuite il y a deux ans ? » — une fenêtre d'un an
    // répondrait « non » à tort. C'est le pire mensonge possible pour une mémoire.
    expect(ALL_MEMORY_DAYS).toBeGreaterThan(2 * 365)
  })
})

describe('Chaque nature de trace porte un nom de chantier, pas un nom de table', () => {
  it('tous les types sont nommés en français', () => {
    const types: MemoryHitType[] = [
      'observation', 'anomaly', 'site_note', 'intervention', 'photo',
      'site_action', 'site_decision', 'meeting_decision', 'site_reserve',
      'report_document', 'knowledge', 'blocage', 'obligation', 'subject', 'document',
    ]
    for (const t of types) {
      expect(HIT_LABEL_FR[t]).toBeTruthy()
      expect(HIT_LABEL_FR[t]).not.toMatch(/_/) // jamais « site_action » à l'écran
    }
  })
})


describe('RM4 — les filtres RÉDUISENT, ils ne cherchent pas', () => {
  const jeu = [
    hit({ id: 'a', type: 'observation', siteId: 's1' }),
    hit({ id: 'b', type: 'site_action', siteId: 's1' }),
    hit({ id: 'c', type: 'observation', siteId: 's2' }),
  ]

  it('sans filtre, rien ne bouge', () => {
    expect(applyFilters(jeu, {})).toHaveLength(3)
  })

  it('QUOI — une seule nature', () => {
    expect(applyFilters(jeu, { type: 'observation' }).map((h) => h.id)).toEqual(['a', 'c'])
  })

  it('OÙ — un seul chantier', () => {
    expect(applyFilters(jeu, { siteId: 's1' }).map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('les deux se combinent', () => {
    expect(applyFilters(jeu, { siteId: 's1', type: 'observation' }).map((h) => h.id)).toEqual(['a'])
  })

  it('un filtre qui ne garde rien rend une liste vide — pas une erreur', () => {
    expect(applyFilters(jeu, { siteId: 's2', type: 'site_action' })).toEqual([])
  })

  it('QUAND — « Toute la mémoire » est le DÉFAUT, en tête', () => {
    // Une fenêtre d'un an par défaut répondrait « non » à « on avait déjà vu ça
    // il y a deux ans ? ». Le pire mensonge possible pour une mémoire.
    expect(PERIODS[0].days).toBe(ALL_MEMORY_DAYS)
    expect(PERIODS[0].label).toBe('Toute la mémoire')
  })
})


describe('L’extrait d’un document met le mot en évidence — sans charabia', () => {
  it('les marqueurs de Postgres ne sont JAMAIS affichés tels quels', () => {
    const parts = splitHighlights('la fermeture pendant les <<vacances>> <<scolaires>> du site')
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['vacances', 'scolaires'])
    // Recollé, le texte est propre : plus aucun « << » ne subsiste.
    expect(parts.map((p) => p.text).join('')).toBe(
      'la fermeture pendant les vacances scolaires du site',
    )
  })

  it('un extrait sans marqueur reste intact', () => {
    expect(splitHighlights('texte simple')).toEqual([{ text: 'texte simple', hit: false }])
  })

  it('un extrait vide ne casse rien', () => {
    expect(splitHighlights('')).toEqual([])
  })

  it('un document se lit DANS SA FICHE — jamais réduit à son extrait', () => {
    expect(memoryHitHref(hit({ type: 'document', id: 'doc-1' }))).toBe('/documents/doc-1')
  })
})
