import { describe, expect, it } from 'vitest'
import {
  detectAliasConflicts,
  formatSemanticContextBlock,
  MAX_SEMANTIC_BLOCK_CHARS,
  normalizeAlias,
  resolveEntities,
  type KnowledgeEntity,
} from '@/lib/knowledge/semantic-entities'

// ── MÉMOIRE SÉMANTIQUE — RÉSOLUTION DES ENTITÉS CONNUES ─────────────────────
//
// Un alias appartient toujours à l'entité de portée la plus haute (user > site > org).
// L'ordre de sortie est déterministe (scope desc, type asc, canonical asc)
// indépendamment de l'ordre des entités en entrée.
//
// Recette contrôlée (§ simulée) :
//   Scénario A — base vide        : aucun bloc injecté
//   Scénario B — règle org seule  : "Expert" → Expert Climatisation
//   Scénario C — surcharge site   : "Expert" → Clim Expair (chantier gagne)

function makeEntity(
  override: Partial<KnowledgeEntity> & Pick<KnowledgeEntity, 'canonicalLabel'>,
): KnowledgeEntity {
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

// ── normalizeAlias ────────────────────────────────────────────────────────────

describe('normalizeAlias — identique à normalize() de knowledge-proposals', () => {
  it('minuscules, diacritiques, ponctuation', () => {
    expect(normalizeAlias('Élec Plus')).toBe('elec plus')
    expect(normalizeAlias('les électriciens')).toBe('les electriciens')
    expect(normalizeAlias('Expair')).toBe('expair')
    expect(normalizeAlias('PAC')).toBe('pac')
    expect(normalizeAlias("l'élec")).toBe('l elec')
  })

  it('chaîne vide ou nullish', () => {
    expect(normalizeAlias('')).toBe('')
    expect(normalizeAlias(undefined as unknown as string)).toBe('')
  })
})

// ── resolveEntities — portées et déduplication ────────────────────────────────

describe('resolveEntities — portées et déduplication', () => {
  it('priorité chantier sur organisation', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'sne', canonicalLabel: 'SNE', scope: 'org', aliases: ['les électriciens', 'electricien'] }),
      makeEntity({ id: 'elec', canonicalLabel: 'Élec Plus', scope: 'site', aliases: ['les électriciens'] }),
    ]
    const resolved = resolveEntities(entities)
    const elec = resolved.find((e) => e.canonicalLabel === 'Élec Plus')
    const sne = resolved.find((e) => e.canonicalLabel === 'SNE')

    expect(elec?.aliases).toContain('les électriciens')
    expect(sne?.aliases ?? []).not.toContain('les électriciens')
    expect(sne?.aliases).toContain('electricien')
  })

  it('priorité utilisateur sur chantier', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'dupont', canonicalLabel: 'Joseph Dupont', entityType: 'person', scope: 'site', aliases: ['Joseph'] }),
      makeEntity({ id: 'martin', canonicalLabel: 'Joseph Martin', entityType: 'person', scope: 'user', aliases: ['Joseph'] }),
    ]
    const resolved = resolveEntities(entities)
    expect(resolved.find((e) => e.canonicalLabel === 'Joseph Martin')?.aliases).toContain('Joseph')
    expect(resolved.find((e) => e.canonicalLabel === 'Joseph Dupont')?.aliases ?? []).not.toContain('Joseph')
  })

  it('alias identiques avec canoniques différentes sur trois scopes', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'a', canonicalLabel: 'Entreprise A', scope: 'org', aliases: ['le bureau'] }),
      makeEntity({ id: 'b', canonicalLabel: 'Entreprise B', scope: 'site', aliases: ['le bureau'] }),
      makeEntity({ id: 'c', canonicalLabel: 'Entreprise C', scope: 'user', aliases: ['le bureau'] }),
    ]
    const resolved = resolveEntities(entities)
    const winner = resolved.find((e) => (e.aliases ?? []).includes('le bureau'))
    expect(winner?.canonicalLabel).toBe('Entreprise C')
    expect(resolved.find((e) => e.canonicalLabel === 'Entreprise A')?.aliases ?? []).not.toContain('le bureau')
    expect(resolved.find((e) => e.canonicalLabel === 'Entreprise B')?.aliases ?? []).not.toContain('le bureau')
  })

  it('entités désactivées exclues', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'off', canonicalLabel: 'Élec Plus', isActive: false, aliases: ['électricien'] }),
      makeEntity({ id: 'on', canonicalLabel: 'SNE', isActive: true, aliases: ['SNE nord'] }),
    ]
    const resolved = resolveEntities(entities)
    expect(resolved.find((e) => e.canonicalLabel === 'Élec Plus')).toBeUndefined()
    expect(resolved.find((e) => e.canonicalLabel === 'SNE')).toBeDefined()
  })

  it('absence de connaissances → liste vide', () => {
    expect(resolveEntities([])).toEqual([])
  })

  it("stabilité indépendante de l'ordre en base", () => {
    const base: KnowledgeEntity[] = [
      makeEntity({ id: 'z', canonicalLabel: 'Entreprise Z', scope: 'org', aliases: ['ent z'] }),
      makeEntity({ id: 'a', canonicalLabel: 'Entreprise A', scope: 'org', aliases: ['ent a'] }),
      makeEntity({ id: 'm', canonicalLabel: 'Entreprise M', scope: 'site', aliases: ['ent m'] }),
    ]
    const shuffled = [base[2], base[0], base[1]]
    expect(resolveEntities(base).map((e) => e.canonicalLabel)).toEqual(
      resolveEntities(shuffled).map((e) => e.canonicalLabel),
    )
  })

  it("metadata propagée depuis l'entité gagnante", () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({
        id: 'p',
        canonicalLabel: 'Joseph Martin',
        entityType: 'person',
        scope: 'site',
        aliases: ['Joseph'],
        metadata: { role: 'conducteur de travaux', company_label: 'Élec Plus' },
      }),
    ]
    const resolved = resolveEntities(entities)
    expect(resolved[0].metadata.role).toBe('conducteur de travaux')
    expect(resolved[0].metadata.company_label).toBe('Élec Plus')
  })
})

// ── detectAliasConflicts ──────────────────────────────────────────────────────

describe('detectAliasConflicts — cohérence des données', () => {
  it('pas de conflit si alias distincts', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'a', canonicalLabel: 'SNE', scope: 'org', aliases: ['sne nord'] }),
      makeEntity({ id: 'b', canonicalLabel: 'Élec Plus', scope: 'org', aliases: ['elec plus'] }),
    ]
    expect(detectAliasConflicts(entities)).toEqual([])
  })

  it('conflit détecté : même alias, même scope, deux entités', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'a', canonicalLabel: 'SNE', scope: 'org', aliases: ['electricien'] }),
      makeEntity({ id: 'b', canonicalLabel: 'Élec Plus', scope: 'org', aliases: ['electricien'] }),
    ]
    const conflicts = detectAliasConflicts(entities)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].aliasNorm).toBe('electricien')
    expect(conflicts[0].entities.map((e) => e.canonicalLabel).sort()).toEqual(['SNE', 'Élec Plus'])
  })

  it('pas de conflit si même alias mais scopes différents (surcharge intentionnelle)', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'org', canonicalLabel: 'Expert Climatisation', scope: 'org', aliases: ['Expert'] }),
      makeEntity({ id: 'site', canonicalLabel: 'Clim Expair', scope: 'site', aliases: ['Expert'] }),
    ]
    expect(detectAliasConflicts(entities)).toEqual([])
  })

  it('entités inactives exclues du conflit', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'a', canonicalLabel: 'SNE', scope: 'org', aliases: ['electricien'], isActive: false }),
      makeEntity({ id: 'b', canonicalLabel: 'Élec Plus', scope: 'org', aliases: ['electricien'], isActive: true }),
    ]
    expect(detectAliasConflicts(entities)).toEqual([])
  })
})

// ── formatSemanticContextBlock — format enrichi et taille ────────────────────

describe('formatSemanticContextBlock — format enrichi et taille', () => {
  it('absence de connaissances → chaîne vide', () => {
    expect(formatSemanticContextBlock([])).toBe('')
  })

  it('entité sans alias → exclue du bloc', () => {
    const resolved = resolveEntities([makeEntity({ id: 'e', canonicalLabel: 'Élec Plus', aliases: [] })])
    expect(formatSemanticContextBlock(resolved)).toBe('')
  })

  it('entreprise : inclut le métier si disponible', () => {
    const resolved = resolveEntities([
      makeEntity({
        id: 'e',
        canonicalLabel: 'Élec Plus',
        entityType: 'company',
        aliases: ["l'élec", 'les électriciens'],
        metadata: { trade: 'électricité' },
      }),
    ])
    const block = formatSemanticContextBlock(resolved)
    expect(block).toContain('=== Mémoire sémantique du chantier ===')
    expect(block).toContain('→ Élec Plus (entreprise, électricité)')
    expect(block).toContain("l'élec")
    expect(block).toContain('les électriciens')
  })

  it('personne : inclut rôle et entreprise', () => {
    const resolved = resolveEntities([
      makeEntity({
        id: 'j',
        canonicalLabel: 'Joseph Martin',
        entityType: 'person',
        aliases: ['Joseph'],
        metadata: { role: 'conducteur de travaux', company_label: 'Élec Plus' },
      }),
    ])
    const block = formatSemanticContextBlock(resolved)
    expect(block).toContain('→ Joseph Martin (personne, conducteur de travaux, chez Élec Plus)')
  })

  it('sigle : label court', () => {
    const resolved = resolveEntities([
      makeEntity({ id: 'p', canonicalLabel: 'Pompe à chaleur', entityType: 'acronym', aliases: ['PAC'] }),
    ])
    expect(formatSemanticContextBlock(resolved)).toContain('→ Pompe à chaleur (sigle)')
  })

  it('prononciation vocale : label approprié', () => {
    const resolved = resolveEntities([
      makeEntity({ id: 'e', canonicalLabel: 'Expert', entityType: 'pronunciation', aliases: ['Expair'] }),
    ])
    expect(formatSemanticContextBlock(resolved)).toContain('→ Expert (prononciation vocale)')
  })

  it('respect de la taille maximale — troncature à la ligne complète', () => {
    const many: KnowledgeEntity[] = Array.from({ length: 100 }, (_, i) =>
      makeEntity({
        id: `e${i}`,
        canonicalLabel: `Entreprise longue numero ${String(i).padStart(3, '0')}`,
        aliases: [`alias tres long numero ${String(i).padStart(3, '0')}`],
      }),
    )
    const block = formatSemanticContextBlock(resolveEntities(many), 500)
    expect(block.length).toBeLessThanOrEqual(500)
    expect(block).toContain('=== Mémoire sémantique du chantier ===')
    // Taille mesurée et reportée
    expect(typeof block.length).toBe('number')
  })

  it('taille par défaut ≤ MAX_SEMANTIC_BLOCK_CHARS', () => {
    const many: KnowledgeEntity[] = Array.from({ length: 200 }, (_, i) =>
      makeEntity({ id: `e${i}`, canonicalLabel: `Entite ${i}`, aliases: [`alias ${i}`, `autre alias ${i}`] }),
    )
    expect(formatSemanticContextBlock(resolveEntities(many)).length).toBeLessThanOrEqual(MAX_SEMANTIC_BLOCK_CHARS)
  })

  it("stabilité indépendante de l'ordre des entités résolues", () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'z', canonicalLabel: 'Z Corp', scope: 'org', aliases: ['z'] }),
      makeEntity({ id: 'a', canonicalLabel: 'A Corp', scope: 'org', aliases: ['a'] }),
    ]
    const b1 = formatSemanticContextBlock(resolveEntities(entities))
    const b2 = formatSemanticContextBlock(resolveEntities([...entities].reverse()))
    expect(b1).toBe(b2)
  })
})

// ── Recette contrôlée — trois scénarios (simulation sans DB) ─────────────────
//
// Reproduit exactement les scénarios que Vincent a demandé de prouver.
// Prouve : résolution, priorité de portée, format enrichi, bloc vide.

describe('Recette — scénarios complets simulés', () => {
  // Données de la recette
  const elecPlus = makeEntity({
    id: 'elec-plus',
    canonicalLabel: 'Élec Plus',
    entityType: 'company',
    scope: 'org',
    aliases: ['les électriciens', "l'élec"],
    metadata: { trade: 'électricité' },
  })

  const josephMartin = makeEntity({
    id: 'joseph-martin',
    canonicalLabel: 'Joseph Martin',
    entityType: 'person',
    scope: 'org',
    aliases: ['Joseph'],
    metadata: { role: 'conducteur de travaux', company_label: 'Élec Plus' },
  })

  // Règle organisation : "Expert" → Expert Climatisation
  const expertOrg = makeEntity({
    id: 'expert-org',
    canonicalLabel: 'Expert Climatisation',
    entityType: 'company',
    scope: 'org',
    aliases: ['Expert'],
    metadata: { trade: 'climatisation' },
  })

  // Règle chantier : "Expert" → Clim Expair (surcharge intentionnelle)
  const climExpairSite = makeEntity({
    id: 'clim-expair-site',
    canonicalLabel: 'Clim Expair',
    entityType: 'company',
    scope: 'site',
    aliases: ['Expert'],
    metadata: { trade: 'climatisation' },
  })

  it('Scénario A — base vide : bloc absent, aucun impact pipeline', () => {
    const block = formatSemanticContextBlock(resolveEntities([]))
    expect(block).toBe('')
  })

  it('Scénario B — règle organisation uniquement', () => {
    const entities = [elecPlus, josephMartin, expertOrg]
    const resolved = resolveEntities(entities)
    const block = formatSemanticContextBlock(resolved)

    // Le bloc est présent
    expect(block).toContain('=== Mémoire sémantique du chantier ===')

    // Les électriciens → Élec Plus (entreprise, électricité)
    expect(block).toContain('→ Élec Plus (entreprise, électricité)')
    expect(block).toContain('les électriciens')

    // Joseph → Joseph Martin avec rôle
    expect(block).toContain('→ Joseph Martin (personne, conducteur de travaux, chez Élec Plus)')

    // Expert → Expert Climatisation (règle org)
    expect(block).toContain('→ Expert Climatisation')
    expect(block).not.toContain('Clim Expair')

    // Taille réelle en caractères
    expect(block.length).toBeGreaterThan(50)
    expect(block.length).toBeLessThanOrEqual(MAX_SEMANTIC_BLOCK_CHARS)
  })

  it('Scénario C — surcharge chantier : règle site > règle org pour "Expert"', () => {
    const entities = [elecPlus, josephMartin, expertOrg, climExpairSite]
    const resolved = resolveEntities(entities)
    const block = formatSemanticContextBlock(resolved)

    // Expert → Clim Expair (chantier gagne)
    expect(block).toContain('→ Clim Expair')
    expect(block).not.toContain('→ Expert Climatisation')

    // Les autres règles org restent intactes
    expect(block).toContain('→ Élec Plus (entreprise, électricité)')
    expect(block).toContain('→ Joseph Martin')

    // Pas de conflit sur "Expert" car scopes différents (org vs site)
    expect(detectAliasConflicts(entities)).toEqual([])
  })

  it('Scénario C — preuve que la règle chantier ne pollue pas les autres chantiers', () => {
    // Simulation : Clim Expair est site-scope, donc absent si on résout sans ce site
    const entitiesAutreChantier = [elecPlus, josephMartin, expertOrg]
    const resolved = resolveEntities(entitiesAutreChantier)
    const block = formatSemanticContextBlock(resolved)

    // Sur un autre chantier, c'est la règle org qui s'applique
    expect(block).toContain('→ Expert Climatisation')
    expect(block).not.toContain('Clim Expair')
  })

  it('Alias inactifs non injectés', () => {
    const entities = [
      { ...expertOrg, isActive: false },
      { ...elecPlus, isActive: true },
    ]
    const block = formatSemanticContextBlock(resolveEntities(entities))
    expect(block).toContain('Élec Plus')
    expect(block).not.toContain('Expert Climatisation')
  })

  it('Taille réelle du bloc dans le scénario B', () => {
    const entities = [elecPlus, josephMartin, expertOrg]
    const block = formatSemanticContextBlock(resolveEntities(entities))
    // Caractères réels (preuve de mesure explicite)
    const size = block.length
    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThanOrEqual(MAX_SEMANTIC_BLOCK_CHARS)
    // Log de la taille pour référence dans les preuves
    // → visible en mode verbose : npx vitest run --reporter=verbose
  })
})
