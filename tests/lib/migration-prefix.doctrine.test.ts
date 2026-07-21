import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// ── UN NUMÉRO DE MIGRATION = UN FICHIER ──────────────────────────────────────
// Sur ce dépôt PARTAGÉ entre sessions, le disque contient souvent des migrations
// NON COMMITÉES d'une autre session (ex. `226_shared_calendars_global.sql`,
// appliquée en base mais jamais commitée). L'invariant ne porte donc PAS sur le
// disque mais sur le DÉPÔT : deux migrations SUIVIES ne doivent jamais partager
// le même préfixe numérique.
//
// Pourquoi : un préfixe partagé perturbe la lecture chronologique humaine, les
// scripts qui supposent un numéro unique, les revues, et la prochaine génération
// automatique de numéro. Quand une session s'apprête à commiter une migration
// dont le numéro est déjà pris (cas latent du 226 non commité vs le 226 commité
// ici), ce test échoue AVANT le merge et force à repartir du maximum réel suivant
// — sans jamais renommer une migration déjà commitée et appliquée.

function trackedMigrationFiles(): string[] {
  // `git ls-files` = fichiers SUIVIS uniquement : exclut le bruit non commité du
  // disque partagé, et rend le test déterministe entre local et CI.
  return execSync('git ls-files supabase/migrations', { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => p.split('/').pop() as string)
}

function prefixOf(file: string): string | null {
  const m = file.match(/^(\d+)_/)
  return m ? m[1] : null
}

describe('Numérotation des migrations', () => {
  it('aucun préfixe numérique n’est réutilisé par deux migrations suivies', () => {
    const byPrefix = new Map<string, string[]>()
    for (const f of trackedMigrationFiles()) {
      const p = prefixOf(f)
      if (!p) continue
      byPrefix.set(p, [...(byPrefix.get(p) ?? []), f])
    }
    const collisions = [...byPrefix.entries()].filter(([, files]) => files.length > 1)
    expect(
      collisions,
      `Préfixe(s) de migration réutilisé(s) : ${collisions
        .map(([p, files]) => `${p} → ${files.join(', ')}`)
        .join(' ; ')}. Repartir du maximum réel suivant, sans renommer une migration déjà appliquée.`,
    ).toEqual([])
  })
})
