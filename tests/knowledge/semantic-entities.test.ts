import { describe, expect, it } from 'vitest'
import {
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
    ...override,
  }
}

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

describe('resolveEntities — portées et déduplication', () => {
  it('priorité chantier sur organisation', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'sne', canonicalLabel: 'SNE', scope: 'org', aliases: ['les électriciens', 'electricien'] }),
      makeEntity({ id: 'elec', canonicalLabel: 'Élec Plus', scope: 'site', aliases: ['les électriciens'] }),
    ]
    const resolved = resolveEntities(entities)
    const elec = resolved.find((e) => e.canonicalLabel === 'Élec Plus')
    const sne = resolved.find((e) => e.canonicalLabel === 'SNE')

    // Élec Plus gagne "les électriciens" car site > org
    expect(elec?.aliases).toContain('les électriciens')
    // SNE perd "les électriciens" mais garde "electricien" (non contesté)
    expect(sne?.aliases ?? []).not.toContain('les électriciens')
    expect(sne?.aliases).toContain('electricien')
  })

  it('priorité utilisateur sur chantier', () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'dupont', canonicalLabel: 'Joseph Dupont', entityType: 'person', scope: 'site', aliases: ['Joseph'] }),
      makeEntity({ id: 'martin', canonicalLabel: 'Joseph Martin', entityType: 'person', scope: 'user', aliases: ['Joseph'] }),
    ]
    const resolved = resolveEntities(entities)
    const martin = resolved.find((e) => e.canonicalLabel === 'Joseph Martin')
    const dupont = resolved.find((e) => e.canonicalLabel === 'Joseph Dupont')

    expect(martin?.aliases).toContain('Joseph')
    expect(dupont?.aliases ?? []).not.toContain('Joseph')
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

    const r1 = resolveEntities(base).map((e) => e.canonicalLabel)
    const r2 = resolveEntities(shuffled).map((e) => e.canonicalLabel)
    expect(r1).toEqual(r2)
  })
})

describe('formatSemanticContextBlock — format et taille', () => {
  it('absence de connaissances → chaîne vide', () => {
    expect(formatSemanticContextBlock([])).toBe('')
  })

  it('entité sans alias → exclue du bloc', () => {
    const resolved = resolveEntities([
      makeEntity({ id: 'e', canonicalLabel: 'Élec Plus', aliases: [] }),
    ])
    expect(formatSemanticContextBlock(resolved)).toBe('')
  })

  it('format attendu — aliases → canonical', () => {
    const resolved = resolveEntities([
      makeEntity({ id: 'e', canonicalLabel: 'Élec Plus', aliases: ["l'élec", 'les électriciens'] }),
    ])
    const block = formatSemanticContextBlock(resolved)
    expect(block).toContain('=== Mémoire sémantique du chantier ===')
    expect(block).toContain('→ Élec Plus')
    expect(block).toContain("l'élec")
    expect(block).toContain('les électriciens')
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
    // Termine sur une ligne complète (pas tronqué en milieu de texte)
    expect(block).not.toMatch(/→ Entreprise[^]*$\s*Entreprise/m)
    expect(block).toContain('=== Mémoire sémantique du chantier ===')
  })

  it('taille par défaut ≤ MAX_SEMANTIC_BLOCK_CHARS', () => {
    const many: KnowledgeEntity[] = Array.from({ length: 200 }, (_, i) =>
      makeEntity({
        id: `e${i}`,
        canonicalLabel: `Entite ${i}`,
        aliases: [`alias ${i}`, `autre alias ${i}`],
      }),
    )
    const block = formatSemanticContextBlock(resolveEntities(many))
    expect(block.length).toBeLessThanOrEqual(MAX_SEMANTIC_BLOCK_CHARS)
  })

  it("stabilité indépendante de l'ordre des entités résolues", () => {
    const entities: KnowledgeEntity[] = [
      makeEntity({ id: 'z', canonicalLabel: 'Z Corp', scope: 'org', aliases: ['z'] }),
      makeEntity({ id: 'a', canonicalLabel: 'A Corp', scope: 'org', aliases: ['a'] }),
    ]
    const shuffled = [...entities].reverse()
    const b1 = formatSemanticContextBlock(resolveEntities(entities))
    const b2 = formatSemanticContextBlock(resolveEntities(shuffled))
    expect(b1).toBe(b2)
  })
})
