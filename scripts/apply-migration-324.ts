/**
 * Application de la migration 324 via client PostgreSQL natif.
 * - copilot_interactions : transcription_raw, transcription_corrections,
 *   feedback_rating, feedback_comment, cause_diagnostic.
 *
 * Brique 2 (mandat Vincent 2026-08-17) : extension du journal Copilote
 * existant, pas de nouveau système.
 */
import { Client } from 'pg'
import * as fs from 'node:fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  for (const rawLine of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)![1]
const connectionString = `postgresql://postgres:${process.env.SUPABASE_DB_PASSWORD}@db.${projectRef}.supabase.co:5432/postgres`

const migrationSQL = fs.readFileSync('supabase/migrations/324_copilot_journal_extended.sql', 'utf8')

async function run() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
    console.log('Connecté à PostgreSQL')

    await client.query(migrationSQL)
    console.log('Migration 324 appliquée')

    const colCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'copilot_interactions'
        AND column_name IN ('transcription_raw', 'transcription_corrections', 'feedback_rating', 'feedback_comment', 'cause_diagnostic')
      ORDER BY column_name
    `)
    console.log(`colonnes ajoutées : ${colCheck.rows.map((r) => r.column_name).join(', ')} (${colCheck.rows.length}/5)`)

    const chkCheck = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'copilot_interactions'::regclass
        AND conname IN ('copilot_interactions_feedback_rating_check', 'copilot_interactions_cause_diagnostic_check')
      ORDER BY conname
    `)
    console.log(`contraintes CHECK : ${chkCheck.rows.map((r) => r.conname).join(', ')} (${chkCheck.rows.length}/2)`)
  } catch (err) {
    console.error('ERREUR :', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
