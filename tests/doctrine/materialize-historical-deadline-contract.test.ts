import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/368_restore_historical_deadline_materialization.sql'),
  'utf8',
)
const installedDeadlineBlock = migration.match(/new_deadline_block constant text := \$new\$([\s\S]*?)\$new\$/)?.[1] ?? ''

describe('contrat de matérialisation des échéances historiques', () => {
  it('accepte les deux conventions de date et ne fabrique aucun J+7', () => {
    expect(installedDeadlineBlock).toContain("rec.source_payload->>'dueDate'")
    expect(installedDeadlineBlock).toContain("rec.source_payload->>'due_date'")
    expect(installedDeadlineBlock).toContain("~ '^\\d{4}-\\d{2}-\\d{2}$'")
    expect(installedDeadlineBlock).not.toContain("p_visit_date + interval '7 days'")
  })

  it('conserve la provenance et rattache la visite source', () => {
    expect(installedDeadlineBlock).toContain('site_id, organization_id, report_id')
    expect(installedDeadlineBlock).toContain('p_site_id, v_org_id, v_report_id')
    expect(installedDeadlineBlock).toContain("'historical_import', p_user_id")
  })

  it('distingue une date explicite d’une échéance à planifier', () => {
    expect(installedDeadlineBlock).toContain("CASE WHEN v_due_date IS NOT NULL THEN 'planned' ELSE 'to_plan' END")
  })

  it('échoue si une future définition ne contient plus le bloc attendu', () => {
    expect(migration).toContain("raise exception 'Bloc deadline materialize_historical_visit inattendu")
    expect(migration).toContain('pg_get_function_identity_arguments')
  })

  it('interdit une redéfinition complète ultérieure qui oublierait ce contrat', () => {
    const laterFullRedefinitions = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql') && name.localeCompare('368_') > 0)
      .map((name) => readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8'))
      .filter((sql) => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.materialize_historical_visit/i.test(sql))

    for (const sql of laterFullRedefinitions) {
      expect(sql).toContain("rec.source_payload->>'dueDate'")
      expect(sql).toContain("rec.source_payload->>'due_date'")
      expect(sql).toContain('created_from, created_by')
      expect(sql).toContain("CASE WHEN v_due_date IS NOT NULL THEN 'planned' ELSE 'to_plan' END")
      expect(sql).not.toContain("v_due_date := p_visit_date + interval '7 days'")
    }
  })
})
