import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── UN NUMÉRO DE MIGRATION = UN FICHIER ──────────────────────────────────────
// Deux sessions ont un jour choisi le même numéro 226 (`226_ai_capability_...`
// et `226_shared_calendars_global.sql`). Supabase applique par NOM complet, donc
// les deux ont bien tourné et sont indépendantes — mais un préfixe partagé
// perturbe la lecture chronologique humaine, les scripts qui supposent un numéro
// unique, les revues, et la prochaine génération automatique de numéro.
//
// Ce garde-fou empêche que la collision se reproduise, SANS toucher aux
// migrations déjà appliquées : les deux 226 historiques sont une exception
// explicitement documentée. Le prochain numéro doit repartir du maximum réel
// suivant (227), jamais « réparer » l'historique en renommant un fichier appliqué.

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

// Exception GELÉE : collision historique, migrations déjà appliquées en prod.
// N'AJOUTER À CETTE LISTE aucun nouveau numéro — c'est précisément ce que le
// test protège. Une nouvelle collision doit échouer, pas être tolérée ici.
const COLLISIONS_HISTORIQUES = new Set(['226'])

function prefixOf(file: string): string | null {
  const m = file.match(/^(\d+)_/)
  return m ? m[1] : null
}

describe('Numérotation des migrations', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
  const byPrefix = new Map<string, string[]>()
  for (const f of files) {
    const p = prefixOf(f)
    if (!p) continue
    byPrefix.set(p, [...(byPrefix.get(p) ?? []), f])
  }

  it('aucun préfixe numérique n’est réutilisé (hors collision historique gelée)', () => {
    const collisions = [...byPrefix.entries()].filter(([, fs]) => fs.length > 1)
    const nouvelles = collisions.filter(([p]) => !COLLISIONS_HISTORIQUES.has(p))
    expect(
      nouvelles,
      `Préfixe(s) de migration réutilisé(s) : ${nouvelles
        .map(([p, fs]) => `${p} → ${fs.join(', ')}`)
        .join(' ; ')}. Repartir du maximum réel suivant.`,
    ).toEqual([])
  })

  it('les seules collisions tolérées sont celles, gelées, de l’historique', () => {
    // Si une collision historique disparaît (fichiers renommés/supprimés), il faut
    // RETIRER son numéro de la liste — sinon l'exception protège du vide.
    const collisions = new Set(
      [...byPrefix.entries()].filter(([, fs]) => fs.length > 1).map(([p]) => p),
    )
    for (const gelee of COLLISIONS_HISTORIQUES) {
      expect(collisions.has(gelee), `La collision gelée ${gelee} n'existe plus : retirer de la liste.`).toBe(true)
    }
  })
})
