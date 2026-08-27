// Ferme le trou « bascule de fond → export PDF immédiat » (Vincent, 2026-08-27) :
// la route PDF garantit un instantané frais correspondant au fond choisi AVANT de
// charger l'image. Ces tests exercent resolveCrMapSnapshotForPdf avec des ensure/load
// injectés modélisant l'état DB — aucun accès réseau/DB. On ne teste NI le garde
// anti-substitution ni le renderer eux-mêmes (couverts ailleurs), seulement le
// séquencement ensure→load et ses 5 cas.

import { describe, it, expect } from 'vitest'
import { resolveCrMapSnapshotForPdf } from '@/lib/pdf/cr-map-snapshot'

const CURRENT = 3

type State = { chosen: 'plan' | 'satellite'; snapshotLayer: 'plan' | 'satellite' | null; version: number | null; hasImage: boolean; failEnsure?: boolean }

function makeDeps(initial: State) {
  const s: State = { ...initial }
  const calls: string[] = []
  let regenCount = 0
  const ensure = async (): Promise<string | null> => {
    calls.push('ensure')
    const fresh = s.hasImage && s.snapshotLayer === s.chosen && s.version === CURRENT
    if (fresh) return `path-${s.snapshotLayer}` // cache-hit, aucune régénération
    if (s.failEnsure) return null // échec : on conserve l'état (dernier snapshot valide)
    regenCount++
    s.snapshotLayer = s.chosen
    s.version = CURRENT
    s.hasImage = true
    return `path-${s.chosen}`
  }
  const load = async (): Promise<string | null> => {
    calls.push('load')
    // Garde anti-substitution (même règle que loadCrMapSnapshotDataUri) :
    if (s.hasImage && s.snapshotLayer === s.chosen) return `data:image/png;base64,IMG-${s.snapshotLayer}`
    return null
  }
  return { deps: { ensure, load }, s, calls, regen: () => regenCount }
}

describe('resolveCrMapSnapshotForPdf — ferme le trou bascule → export immédiat', () => {
  it('1. chosen=satellite, snapshot=plan → régénère puis sert le satellite', async () => {
    const { deps, s, calls, regen } = makeDeps({ chosen: 'satellite', snapshotLayer: 'plan', version: CURRENT, hasImage: true })
    const uri = await resolveCrMapSnapshotForPdf('r', deps)
    expect(uri).toBe('data:image/png;base64,IMG-satellite')
    expect(s.snapshotLayer).toBe('satellite')
    expect(regen()).toBe(1)
    expect(calls).toEqual(['ensure', 'load']) // ensure AVANT load
  })

  it('2. chosen=plan, snapshot=satellite → régénère puis sert le plan', async () => {
    const { deps, s, regen } = makeDeps({ chosen: 'plan', snapshotLayer: 'satellite', version: CURRENT, hasImage: true })
    const uri = await resolveCrMapSnapshotForPdf('r', deps)
    expect(uri).toBe('data:image/png;base64,IMG-plan')
    expect(s.snapshotLayer).toBe('plan')
    expect(regen()).toBe(1)
  })

  it('3. snapshot déjà frais → cache-hit, aucune régénération', async () => {
    const { deps, regen } = makeDeps({ chosen: 'satellite', snapshotLayer: 'satellite', version: CURRENT, hasImage: true })
    const uri = await resolveCrMapSnapshotForPdf('r', deps)
    expect(uri).toBe('data:image/png;base64,IMG-satellite')
    expect(regen()).toBe(0)
  })

  it('4. régénération échoue → aucun snapshot incompatible utilisé, fallback schématique (null)', async () => {
    const { deps } = makeDeps({ chosen: 'satellite', snapshotLayer: 'plan', version: CURRENT, hasImage: true, failEnsure: true })
    const uri = await resolveCrMapSnapshotForPdf('r', deps)
    expect(uri).toBeNull()
  })

  it('5. échec de génération → l\'ancien snapshot valide reste référencé physiquement (état inchangé)', async () => {
    const { deps, s } = makeDeps({ chosen: 'satellite', snapshotLayer: 'plan', version: CURRENT, hasImage: true, failEnsure: true })
    await resolveCrMapSnapshotForPdf('r', deps)
    expect(s.snapshotLayer).toBe('plan') // non écrasé
    expect(s.hasImage).toBe(true)        // toujours présent en storage
  })

  it('une panne de ensure ne fait jamais échouer l\'export (catch interne)', async () => {
    const deps = {
      ensure: async () => { throw new Error('boom réseau') },
      load: async () => 'data:image/png;base64,IMG-plan',
    }
    await expect(resolveCrMapSnapshotForPdf('r', deps)).resolves.toBe('data:image/png;base64,IMG-plan')
  })
})
