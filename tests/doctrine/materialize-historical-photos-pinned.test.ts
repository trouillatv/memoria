import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/367_materialize_only_pinned_historical_photos.sql'),
  'utf8',
)

describe('matérialisation des photos historiques', () => {
  it('matérialise uniquement les preuves explicitement sélectionnées', () => {
    expect(migration).toContain('AND dee.pinned_for_visit = true')
    expect(migration).toContain("AND dee.evidence_type IN (''image'', ''page_snapshot'')")
  })

  it('refuse silencieusement aucune dérive de la fonction SQL', () => {
    expect(migration).toContain("raise exception 'Bloc visuel materialize_historical_visit inattendu")
    expect(migration).toContain('pg_get_function_identity_arguments')
  })

  it('interdit une redéfinition complète ultérieure qui oublierait ce contrat', () => {
    // Cette garde a manqué à l'appel lors de l'incident 429 : une redéfinition
    // complète du corps de la fonction a silencieusement perdu le filtre
    // pinned_for_visit sans qu'aucun test ne le détecte. 429 est exclue ici
    // comme exception historique DOCUMENTÉE (réparée par la migration 430,
    // patch ciblé qui ne matche pas ce regex) — pas un assouplissement de la
    // garde contre toute AUTRE redéfinition complète future.
    const KNOWN_REGRESSED_EXCEPTION = '429_materialize_visit_atomic_canonical_promotion.sql'
    const laterFullRedefinitions = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql') && name.localeCompare('367_') > 0)
      .filter((name) => name !== KNOWN_REGRESSED_EXCEPTION)
      .map((name) => readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8'))
      .filter((sql) => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.materialize_historical_visit/i.test(sql))

    for (const sql of laterFullRedefinitions) {
      expect(sql).toContain('AND dee.pinned_for_visit = true')
    }
  })
})
