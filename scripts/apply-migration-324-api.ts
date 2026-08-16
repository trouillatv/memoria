/**
 * Application de la migration 324 via l'API Management Supabase.
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

const STMT_COLUMNS = `
ALTER TABLE public.copilot_interactions
  ADD COLUMN IF NOT EXISTS transcription_raw          text,
  ADD COLUMN IF NOT EXISTS transcription_corrections  jsonb,
  ADD COLUMN IF NOT EXISTS feedback_rating            text,
  ADD COLUMN IF NOT EXISTS feedback_comment           text,
  ADD COLUMN IF NOT EXISTS cause_diagnostic           text
`

const STMT_CHECK_RATING = `
ALTER TABLE public.copilot_interactions
  ADD CONSTRAINT copilot_interactions_feedback_rating_check
    CHECK (feedback_rating IS NULL OR feedback_rating IN ('up', 'down'))
`

const STMT_CHECK_CAUSE = `
ALTER TABLE public.copilot_interactions
  ADD CONSTRAINT copilot_interactions_cause_diagnostic_check
    CHECK (cause_diagnostic IS NULL OR cause_diagnostic IN (
      'correct', 'incomplete', 'bad_data', 'missing_relation',
      'bad_routing', 'missing_knowledge', 'other'
    ))
`

async function addConstraintIfMissing(name: string, stmt: string, label: string) {
  const existing = await query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'copilot_interactions'::regclass AND conname = '${name}'
  `) as Array<{ conname: string }>
  if (existing.length > 0) {
    console.log(`= contrainte ${name} déjà présente, ignorée`)
    return
  }
  await query(stmt, label)
  console.log(`✓ contrainte ${name} ajoutée`)
}

async function main() {
  console.log(`Project: ${PROJECT_REF}`)
  console.log('Application de la migration 324...\n')

  await query(STMT_COLUMNS, 'colonnes')
  console.log('✓ Partie 1 : colonnes ajoutées')

  await addConstraintIfMissing('copilot_interactions_feedback_rating_check', STMT_CHECK_RATING, 'check_rating')
  await addConstraintIfMissing('copilot_interactions_cause_diagnostic_check', STMT_CHECK_CAUSE, 'check_cause')

  const colRes = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'copilot_interactions'
      AND column_name IN ('transcription_raw', 'transcription_corrections', 'feedback_rating', 'feedback_comment', 'cause_diagnostic')
    ORDER BY column_name
  `) as Array<{ column_name: string }>
  console.log(`\ncolonnes présentes : ${colRes.map((r) => r.column_name).join(', ')} (${colRes.length}/5)`)

  const chkRes = await query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'copilot_interactions'::regclass
      AND conname IN ('copilot_interactions_feedback_rating_check', 'copilot_interactions_cause_diagnostic_check')
    ORDER BY conname
  `) as Array<{ conname: string }>
  console.log(`contraintes CHECK : ${chkRes.map((r) => r.conname).join(', ')} (${chkRes.length}/2)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
