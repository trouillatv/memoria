import { describe, expect, it } from 'vitest'
import {
  resolveRawText,
  resolveRawTexts,
  type EntityResolution,
} from '@/lib/knowledge/semantic-resolution'
import type { KnowledgeEntity } from '@/lib/knowledge/semantic-entities'

// ── RÉSOLUTION POST-LLM — Lot 1B ─────────────────────────────────────────────
//
// Invariants à couvrir :
//   - resolved   : alias exact ou canonical exact, scope-prioritized
//   - unknown    : aucune correspondance → needs_resolution=true
//   - déterminisme : même entrée → même sortie
//   - mémoire vide : tout est unknown, aucun impact
//   - source distinguée : 'semantic_memory' vs 'canonical_name'
//
// Les tests utilisent les mêmes données de recette que semantic-entities.test.ts
// pour garantir la cohérence entre l'injection pré-LLM et la résolution post-LLM.

function makeEntity(override: Partial<KnowledgeEntity> & Pick<KnowledgeEntity, 'canonicalLabel'>): KnowledgeEntity {
  return {
    id: override.id ?? override.canonicalLabel,
    entityType: 'company',
    scope: 'org',
    confidence: 1.0,
    isActive: true,
    aliases: [],
    metadata: {},
    ...override,
  }
}

const climExpairOrg = makeEntity({
  id: 'clim-org',
  canonicalLabel: 'Clim Expair',
  scope: 'org',
  aliases: ['Expert', 'Expair', 'clim'],
})

const climExpairSite = makeEntity({
  id: 'clim-site',
  canonicalLabel: 'Clim Expair Médipôle',
  scope: 'site',
  aliases: ['Expert', 'la clim du lot'],
})

const josephMartin = makeEntity({
  id: 'joseph-martin',
  canonicalLabel: 'Joseph Martin',
  entityType: 'person',
  scope: 'org',
  aliases: ['Joseph', 'Martin'],
  metadata: { role: 'conducteur de travaux', company_label: 'Clim Expair' },
})

const inactiveEntity = makeEntity({
  id: 'inactive',
  canonicalLabel: 'Ancien Prestataire',
  scope: 'org',
  aliases: ['les anciens'],
  isActive: false,
})

const allEntities = [climExpairOrg, climExpairSite, josephMartin, inactiveEntity]

// ── resolveRawText — cas unitaires ───────────────────────────────────────────

describe('resolveRawText — résolution unitaire', () => {
  it('alias exact → resolved (semantic_memory)', () => {
    const r = resolveRawText('Joseph', allEntities)
    expect(r.status).toBe('resolved')
    expect(r.source).toBe('semantic_memory')
    expect(r.canonical).toBe('Joseph Martin')
    expect(r.entityId).toBe('joseph-martin')
    expect(r.matchedAlias).toBe('Joseph')
    expect(r.needs_resolution).toBe(false)
  })

  it('alias avec diacritiques normalisés → resolved', () => {
    const entity = makeEntity({ id: 'elec', canonicalLabel: 'Élec Plus', aliases: ['les électriciens'] })
    const r = resolveRawText('les électriciens', [entity])
    expect(r.status).toBe('resolved')
    expect(r.canonical).toBe('Élec Plus')
  })

  it('alias en casse différente → resolved (normalisation)', () => {
    const r = resolveRawText('EXPERT', allEntities)
    expect(r.status).toBe('resolved')
  })

  it('canonical direct → resolved (canonical_name)', () => {
    const r = resolveRawText('Clim Expair', allEntities)
    expect(r.status).toBe('resolved')
    expect(r.source).toBe('canonical_name')
    expect(r.canonical).toBe('Clim Expair')
    expect(r.needs_resolution).toBe(false)
  })

  it('texte inconnu → unknown, needs_resolution=true', () => {
    const r = resolveRawText('le plombier', allEntities)
    expect(r.status).toBe('unknown')
    expect(r.source).toBe('llm_only')
    expect(r.needs_resolution).toBe(true)
    expect(r.entityId).toBeUndefined()
    expect(r.canonical).toBeUndefined()
  })

  it('texte vide → unknown, needs_resolution=false', () => {
    const r = resolveRawText('', allEntities)
    expect(r.status).toBe('unknown')
    expect(r.needs_resolution).toBe(false)
  })

  it('entité inactives exclues → texte alias inactif = unknown', () => {
    const r = resolveRawText('les anciens', allEntities)
    expect(r.status).toBe('unknown')
  })

  it('priorité scope : site > org — même alias "Expert"', () => {
    const r = resolveRawText('Expert', allEntities)
    expect(r.status).toBe('resolved')
    expect(r.canonical).toBe('Clim Expair Médipôle') // site gagne
    expect(r.entityId).toBe('clim-site')
  })

  it('alias de scope org résolu quand pas de surcharge site', () => {
    const r = resolveRawText('Expair', allEntities) // alias uniquement sur org
    expect(r.status).toBe('resolved')
    expect(r.canonical).toBe('Clim Expair')
    expect(r.entityId).toBe('clim-org')
  })

  it('mémoire vide → tout inconnu', () => {
    const r = resolveRawText('Joseph', [])
    expect(r.status).toBe('unknown')
    expect(r.needs_resolution).toBe(true)
  })
})

// ── resolveRawTexts — liste complète ─────────────────────────────────────────

describe('resolveRawTexts — registre complet', () => {
  it("résout les intervenants d'un débrief typique", () => {
    const texts = ['Expert', 'Joseph', 'le peintre']
    const { resolutions, new_candidates } = resolveRawTexts(texts, allEntities)

    expect(resolutions['Expert'].status).toBe('resolved')
    expect(resolutions['Expert'].canonical).toBe('Clim Expair Médipôle')

    expect(resolutions['Joseph'].status).toBe('resolved')
    expect(resolutions['Joseph'].canonical).toBe('Joseph Martin')

    expect(resolutions['le peintre'].status).toBe('unknown')
    expect(resolutions['le peintre'].needs_resolution).toBe(true)

    expect(new_candidates).toContain('le peintre')
    expect(new_candidates).not.toContain('Expert')
    expect(new_candidates).not.toContain('Joseph')
  })

  it('déduplique les textes identiques', () => {
    const texts = ['Joseph', 'Joseph', 'Joseph']
    const { resolutions } = resolveRawTexts(texts, allEntities)
    expect(Object.keys(resolutions)).toHaveLength(1)
  })

  it('ignore les textes vides ou espaces', () => {
    const texts = ['', '  ', 'Joseph']
    const { resolutions } = resolveRawTexts(texts, allEntities)
    expect(Object.keys(resolutions)).toHaveLength(1)
    expect(resolutions['Joseph']).toBeDefined()
  })

  it('liste vide → mémoire vide, aucun candidat', () => {
    const { resolutions, new_candidates } = resolveRawTexts([], allEntities)
    expect(Object.keys(resolutions)).toHaveLength(0)
    expect(new_candidates).toHaveLength(0)
  })

  it('mémoire vide → tous unknown, tous candidats', () => {
    const texts = ['Expert', 'Joseph']
    const { resolutions, new_candidates } = resolveRawTexts(texts, [])
    expect(resolutions['Expert'].status).toBe('unknown')
    expect(resolutions['Joseph'].status).toBe('unknown')
    expect(new_candidates).toHaveLength(2)
  })

  it('résolution déterministe : même entrée → même sortie', () => {
    const texts = ['Expert', 'Joseph', 'Expair', 'le peintre']
    const r1 = resolveRawTexts(texts, allEntities)
    const r2 = resolveRawTexts(texts, allEntities)
    expect(r1).toEqual(r2)
  })

  it('new_candidates contient uniquement les non-résolus', () => {
    const texts = ['Joseph', 'Martin', 'inconnu-a', 'inconnu-b']
    const { new_candidates } = resolveRawTexts(texts, allEntities)
    expect(new_candidates).toContain('inconnu-a')
    expect(new_candidates).toContain('inconnu-b')
    expect(new_candidates).not.toContain('Joseph')
    expect(new_candidates).not.toContain('Martin')
  })
})

// ── Recette Lot 1B — scénarios complets ──────────────────────────────────────

describe('Recette Lot 1B — scénarios complets', () => {
  it('Scénario A — mémoire vide : tous les textes sont inconnus', () => {
    const texts = ['Expert', 'Joseph', 'la réunion', 'le responsable']
    const { resolutions, new_candidates } = resolveRawTexts(texts, [])

    for (const r of Object.values(resolutions)) {
      expect(r.status).toBe('unknown')
      expect(r.source).toBe('llm_only')
    }
    expect(new_candidates).toHaveLength(4)
  })

  it("Scénario B — règle org : 'Expert' résolu via org quand pas de surcharge site", () => {
    const texts = ['Expert', 'Joseph', 'l\'inconnu']
    const entitiesOrgOnly = [climExpairOrg, josephMartin]
    const { resolutions, new_candidates } = resolveRawTexts(texts, entitiesOrgOnly)

    expect(resolutions['Expert'].status).toBe('resolved')
    expect(resolutions['Expert'].canonical).toBe('Clim Expair')
    expect(resolutions['Expert'].source).toBe('semantic_memory')

    expect(resolutions['Joseph'].status).toBe('resolved')
    expect(resolutions['Joseph'].canonical).toBe('Joseph Martin')

    expect(resolutions["l'inconnu"].status).toBe('unknown')
    expect(new_candidates).toEqual(["l'inconnu"])
  })

  it("Scénario C — surcharge chantier : 'Expert' résolu via site (prime sur org)", () => {
    const texts = ['Expert', 'Expair']
    const { resolutions } = resolveRawTexts(texts, allEntities)

    // Site gagne pour 'Expert'
    expect(resolutions['Expert'].canonical).toBe('Clim Expair Médipôle')
    expect(resolutions['Expert'].entityId).toBe('clim-site')

    // Org seule pour 'Expair' (alias uniquement côté org)
    expect(resolutions['Expair'].canonical).toBe('Clim Expair')
    expect(resolutions['Expair'].entityId).toBe('clim-org')
  })

  it('entityId défini sur toutes les résolutions réussies', () => {
    const texts = ['Expert', 'Joseph', 'Martin']
    const { resolutions } = resolveRawTexts(texts, allEntities)
    for (const [, r] of Object.entries(resolutions)) {
      if (r.status === 'resolved') {
        expect(r.entityId).toBeDefined()
        expect(r.canonical).toBeDefined()
        expect(r.matchedAlias).toBeDefined()
      }
    }
  })
})
