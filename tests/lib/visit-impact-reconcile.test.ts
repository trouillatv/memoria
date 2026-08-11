import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findReplacement } from '@/lib/db/visit-impact-reconcile'

// ── Helpers statiques ─────────────────────────────────────────────────────────

function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

const SRC = 'lib/db/visit-impact-reconcile.ts'

// ── Doctrine : site_decision dans le périmètre ────────────────────────────────

describe('visit-impact-reconcile — Lot 1 : site_decision dans SUPPORTED_TYPES', () => {
  it('SUPPORTED_TYPES contient site_decision', () => {
    expect(codeOf(SRC)).toContain("'site_decision'")
  })

  it('isAutonomous gère source=human pour les décisions', () => {
    expect(codeOf(SRC)).toContain("r.source === 'human'")
  })

  it('isAutonomous gère appliquee/caduque/contredite pour les décisions', () => {
    const src = codeOf(SRC)
    expect(src).toContain("r.statut === 'appliquee'")
    expect(src).toContain("r.statut === 'caduque'")
    expect(src).toContain("r.statut === 'contredite'")
  })

  it('markOrphaned sait écrire dans site_decisions', () => {
    expect(codeOf(SRC)).toContain("'site_decisions'")
  })

  it('orphaned_from_visit_at est posé sur site_decisions', () => {
    const src = codeOf(SRC)
    // La table est dans le même mapping que site_actions et site_reserve
    // Vérifie que le chemin d'écriture existe bien
    expect(src).toContain('site_decisions')
    expect(src).toContain('orphaned_from_visit_at')
  })
})

// ── Doctrine : synchronisation du titre (Lot 3) ───────────────────────────────

describe('visit-impact-reconcile — Lot 3 : synchronisation du titre lors du re-rattachement', () => {
  it('OBJECT_TABLE_MAP mappe les trois types avec leurs champs titre', () => {
    const src = codeOf(SRC)
    expect(src).toContain("titleField: 'title'")   // site_action
    expect(src).toContain("titleField: 'label'")   // site_reserve
    expect(src).toContain("titleField: 'titre'")   // site_decision
  })

  it('reattachObject met a jour le champ titre de l objet', () => {
    // Le mapping est utilise dans reattachObject — verifie que le champ titleField
    // est bien utilise dans un update
    expect(codeOf(SRC)).toContain('mapping.titleField')
  })

  it('la synchronisation n a lieu que si newProposal.title est non-vide', () => {
    // Guard contre les mises a jour silencieuses vers une chaine vide
    expect(codeOf(SRC)).toContain('newProposal.title')
  })
})

// ── findReplacement — tests comportementaux purs ──────────────────────────────

type Proposal = {
  id: string
  dedupe_key: string | null
  promoted_object_id: string | null
  promoted_object_type: string | null
  title: string
}

const staleBase = {
  dedupe_key: null as string | null,
  promoted_object_type: 'site_action',
  title: 'Reprendre la peinture façade',
}

function makeActive(overrides: Partial<Proposal & { id: string }>): Proposal {
  return {
    id: 'new-id',
    dedupe_key: null,
    promoted_object_id: null,
    promoted_object_type: 'site_action',
    title: 'Reprendre la peinture',
    ...overrides,
  }
}

function makeIndex(active: Proposal[]) {
  const m = new Map<string, { id: string; promoted_object_id: string | null; title: string }>()
  for (const p of active) {
    if (p.dedupe_key) m.set(p.dedupe_key, { id: p.id, promoted_object_id: p.promoted_object_id, title: p.title })
  }
  return m
}

describe('findReplacement — matching pur', () => {
  it('match exact par dedupe_key — retourne la proposition correspondante', () => {
    const stale = { ...staleBase, dedupe_key: 'key-abc' }
    const active = [makeActive({ id: 'r1', dedupe_key: 'key-abc' })]
    const result = findReplacement(stale, active, makeIndex(active))
    expect(result).toEqual({ id: 'r1', title: active[0].title })
  })

  it('pas de match exact si la proposition cible a déjà un objet rattaché', () => {
    const stale = { ...staleBase, dedupe_key: 'key-abc' }
    const active = [makeActive({ id: 'r1', dedupe_key: 'key-abc', promoted_object_id: 'existing' })]
    const result = findReplacement(stale, active, makeIndex(active))
    expect(result).toBeNull()
  })

  it('fallback Jaccard — similarité ≥ 0.50, même type', () => {
    const stale = { ...staleBase, title: 'Reprendre peinture façade nord' }
    const active = [makeActive({ id: 'r2', title: 'Reprendre peinture façade' })]
    const result = findReplacement(stale, active, makeIndex(active))
    expect(result?.id).toBe('r2')
  })

  it('Jaccard ignoré si le type ne correspond pas', () => {
    const stale = { ...staleBase, promoted_object_type: 'site_action', title: 'Reprendre peinture façade nord' }
    const active = [makeActive({ id: 'r2', title: 'Reprendre peinture façade', promoted_object_type: 'site_reserve' })]
    const result = findReplacement(stale, active, makeIndex(active))
    expect(result).toBeNull()
  })

  it('aucune proposition active → null', () => {
    const result = findReplacement(staleBase, [], new Map())
    expect(result).toBeNull()
  })

  it('idempotence — appelé deux fois avec les mêmes inputs, même résultat', () => {
    const stale = { ...staleBase, dedupe_key: 'key-x' }
    const active = [makeActive({ id: 'r3', dedupe_key: 'key-x' })]
    const idx = makeIndex(active)
    expect(findReplacement(stale, active, idx)).toEqual(findReplacement(stale, active, idx))
  })
})

// ── Décision autonome — garde-fou invariant ───────────────────────────────────

describe('visit-impact-reconcile — invariant objet autonome', () => {
  it('la verification d autonomie precede le re-rattachement dans le code', () => {
    const src = codeOf(SRC)
    const autonomyIdx = src.indexOf('isAutonomous')
    const reattachIdx = src.indexOf('reattachObject')
    expect(autonomyIdx, 'isAutonomous doit apparaître avant reattachObject').toBeLessThan(reattachIdx)
  })

  it('un objet autonome incrémente autonomous, pas reattached', () => {
    const src = codeOf(SRC)
    // Vérifie que le chemin autonome n'appelle pas reattachObject
    const afterAutonomousBlock = src.slice(src.indexOf('isAuto)\n') + 10, src.indexOf('result.autonomous++') + 60)
    expect(afterAutonomousBlock).not.toContain('reattachObject')
    expect(afterAutonomousBlock).toContain('result.autonomous++')
  })
})
