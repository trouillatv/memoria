/** Application de la migration 365 (source_page + thematic_category) via RPC exec_sql. */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import * as fs from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'

async function run() {
  const db = createAdminClient()
  const sql = fs.readFileSync('supabase/migrations/365_occurrence_source_page_thematic.sql', 'utf8')
  const { error } = await db.rpc('exec_sql', { sql })
  if (error) { console.error('ERREUR migration 365 :', error); process.exit(1) }
  console.log('Migration 365 appliquée')
}
run()
