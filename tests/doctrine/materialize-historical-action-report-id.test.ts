import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/374_restore_historical_action_report_id.sql'),
  'utf8',
)
const installedActionBlock = migration.match(/new_action_block constant text := \$new\$([\s\S]*?)\$new\$/)?.[1] ?? ''

describe('contrat de provenance des actions historiques (report_id)', () => {
  it('rattache l’action au report_id de la visite qui la matérialise', () => {
    expect(installedActionBlock).toContain('site_id, organization_id, report_id')
    expect(installedActionBlock).toContain('p_site_id, v_org_id, v_report_id')
  })

  it('refuse silencieusement aucune dérive de la fonction SQL', () => {
    expect(migration).toContain("raise exception 'Bloc action materialize_historical_visit inattendu")
    expect(migration).toContain('pg_get_function_identity_arguments')
  })

  it('interdit une redéfinition complète ultérieure qui oublierait ce contrat', () => {
    // C'est exactement ce qui a manqué lors de l'incident 429 : une
    // redéfinition complète du corps de la fonction a silencieusement perdu
    // report_id sur la branche action, cassant en cascade la réparation
    // automatique de canonical_subject_id (filtrée sur report_id). 429 est
    // exclue ici comme exception historique DOCUMENTÉE (réparée par la
    // migration 430, patch ciblé qui ne matche pas ce regex) — pas un
    // assouplissement de la garde contre toute AUTRE redéfinition future.
    const KNOWN_REGRESSED_EXCEPTION = '429_materialize_visit_atomic_canonical_promotion.sql'
    const laterFullRedefinitions = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql') && name.localeCompare('374_') > 0)
      .filter((name) => name !== KNOWN_REGRESSED_EXCEPTION)
      .map((name) => readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8'))
      .filter((sql) => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.materialize_historical_visit/i.test(sql))

    for (const sql of laterFullRedefinitions) {
      expect(sql).toContain('site_id, organization_id, report_id')
      expect(sql).toContain('p_site_id, v_org_id, v_report_id')
    }
  })
})
