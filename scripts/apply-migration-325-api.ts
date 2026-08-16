/**
 * Application de la migration 325 via l'API Management Supabase.
 * Utilisé car le port 5432 direct n'est pas accessible depuis ce réseau.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

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

const STMT_DROP_CAUSE_CHECK = `
ALTER TABLE public.copilot_interactions
  DROP CONSTRAINT IF EXISTS copilot_interactions_cause_diagnostic_check
`

const STMT_NEW_CAUSE_CHECK = `
ALTER TABLE public.copilot_interactions
  ADD CONSTRAINT copilot_interactions_cause_diagnostic_check
    CHECK (cause_diagnostic IS NULL OR cause_diagnostic IN (
      'stt_error', 'normalization_error', 'routing_error', 'retrieval_gap',
      'missing_relation', 'missing_entity', 'missing_data', 'conflicting_data',
      'answer_generation_error', 'other'
    ))
`

const STMT_DROP_FEEDBACK_RATING = `
ALTER TABLE public.copilot_interactions
  DROP CONSTRAINT IF EXISTS copilot_interactions_feedback_rating_check
`

const STMT_DROP_FEEDBACK_RATING_COL = `
ALTER TABLE public.copilot_interactions
  DROP COLUMN IF EXISTS feedback_rating
`

const STMT_NEW_COLUMNS = `
ALTER TABLE public.copilot_interactions
  ADD COLUMN IF NOT EXISTS answer_quality            text,
  ADD COLUMN IF NOT EXISTS stt_route                 text,
  ADD COLUMN IF NOT EXISTS transcription_abstentions integer,
  ADD COLUMN IF NOT EXISTS routing_diag              jsonb
`

const STMT_CHECK_QUALITY = `
ALTER TABLE public.copilot_interactions
  ADD CONSTRAINT copilot_interactions_answer_quality_check
    CHECK (answer_quality IS NULL OR answer_quality IN ('correct', 'incomplete', 'incorrect'))
`

const STMT_CHECK_ROUTE = `
ALTER TABLE public.copilot_interactions
  ADD CONSTRAINT copilot_interactions_stt_route_check
    CHECK (stt_route IS NULL OR stt_route IN ('client_live', 'server_stt', 'typed'))
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
  console.log('Application de la migration 325...\n')

  await query(STMT_DROP_CAUSE_CHECK, 'drop_cause_check')
  await query(STMT_NEW_CAUSE_CHECK, 'new_cause_check')
  console.log('✓ cause_diagnostic : nouvelle taxonomie (10 valeurs)')

  await query(STMT_DROP_FEEDBACK_RATING, 'drop_feedback_rating_check')
  await query(STMT_DROP_FEEDBACK_RATING_COL, 'drop_feedback_rating_col')
  console.log('✓ feedback_rating (pouce haut/bas, jamais câblé côté UI) supprimé')

  await query(STMT_NEW_COLUMNS, 'new_columns')
  console.log('✓ colonnes ajoutées : answer_quality, stt_route, transcription_abstentions, routing_diag')

  await addConstraintIfMissing('copilot_interactions_answer_quality_check', STMT_CHECK_QUALITY, 'check_quality')
  await addConstraintIfMissing('copilot_interactions_stt_route_check', STMT_CHECK_ROUTE, 'check_route')

  const colRes = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'copilot_interactions'
      AND column_name IN ('answer_quality', 'stt_route', 'transcription_abstentions', 'routing_diag', 'feedback_rating')
    ORDER BY column_name
  `) as Array<{ column_name: string }>
  console.log(`\ncolonnes présentes : ${colRes.map((r) => r.column_name).join(', ')}`)
  console.log('(feedback_rating ne doit PAS apparaître — supprimée)')

  const chkRes = await query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'copilot_interactions'::regclass
      AND conname IN (
        'copilot_interactions_cause_diagnostic_check',
        'copilot_interactions_answer_quality_check',
        'copilot_interactions_stt_route_check'
      )
    ORDER BY conname
  `) as Array<{ conname: string }>
  console.log(`contraintes CHECK : ${chkRes.map((r) => r.conname).join(', ')} (${chkRes.length}/3)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
