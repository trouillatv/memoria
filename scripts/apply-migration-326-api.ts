/**
 * Application de la migration 326 via l'API Management Supabase.
 * Utilisé car le port 5432 direct n'est pas accessible depuis ce réseau.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import * as fs from 'node:fs'

const PROJECT_REF = process.env.NEXT_PUBLIC_SUPABASE_URL!.match(/https:\/\/([^.]+)\.supabase\.co/)![1]
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!
const URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

async function query(q: string, label = ''): Promise<unknown> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} [${label}]: ${text}`)
  return JSON.parse(text)
}

const STMT_DROP_CHECK = `
ALTER TABLE canonical_subject_occurrence
  DROP CONSTRAINT IF EXISTS canonical_subject_occurrence_source_kind_check
`

const STMT_ADD_CHECK = `
ALTER TABLE canonical_subject_occurrence
  ADD CONSTRAINT canonical_subject_occurrence_source_kind_check
    CHECK (source_kind IN ('field_visit', 'meeting', 'historical_pdf', 'copilot'))
`

const STMT_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS cso_copilot_uniq
  ON canonical_subject_occurrence (canonical_subject_id, source_ref_id)
  WHERE source_kind = 'copilot'
`

async function main() {
  console.log(`Project: ${PROJECT_REF}`)
  console.log('Application de la migration 326 (3 parties)...\n')

  try {
    await query(STMT_DROP_CHECK, 'drop check')
    console.log('✓ Partie 1 : ancienne contrainte source_kind supprimée')
  } catch (err) {
    console.error('✗ Partie 1 :', err)
    process.exit(1)
  }

  try {
    await query(STMT_ADD_CHECK, 'add check')
    console.log("✓ Partie 2 : contrainte source_kind élargie à 'copilot'")
  } catch (err) {
    console.error('✗ Partie 2 :', err)
    process.exit(1)
  }

  try {
    await query(STMT_INDEX, 'index')
    console.log('✓ Partie 3 : index cso_copilot_uniq créé')
  } catch (err) {
    console.error('✗ Partie 3 :', err)
    process.exit(1)
  }

  const checkRes = await query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'canonical_subject_occurrence_source_kind_check'
  `) as Array<{ def: string }>
  console.log(`contrainte source_kind : ${checkRes[0]?.def ?? '✗ ABSENTE'}`)

  const idxRes = await query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'canonical_subject_occurrence'
      AND indexname = 'cso_copilot_uniq'
  `) as Array<{ indexname: string }>
  console.log(`index cso_copilot_uniq : ${idxRes.length > 0 ? '✓' : '✗ ABSENT'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
