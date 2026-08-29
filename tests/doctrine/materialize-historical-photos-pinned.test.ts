import { readFileSync } from 'node:fs'
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
})
