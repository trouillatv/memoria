/** Application de la migration 364 (state_status) via RPC exec_sql — même pattern que 354. */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import * as fs from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'

async function run() {
  const db = createAdminClient()
  const migrationSQL = fs.readFileSync('supabase/migrations/364_occurrence_state_status.sql', 'utf8')
  const { error } = await db.rpc('exec_sql', { sql: migrationSQL })
  if (error) { console.error('ERREUR migration 364 :', error); process.exit(1) }
  console.log('Migration 364 appliquée')
}
run()
