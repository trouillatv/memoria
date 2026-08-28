/** Application de la migration 366 (subject_relational_evidence) via RPC exec_sql. */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import * as fs from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'

async function run() {
  const db = createAdminClient()
  const sql = fs.readFileSync('supabase/migrations/366_subject_relational_evidence.sql', 'utf8')
  const { error } = await db.rpc('exec_sql', { sql })
  if (error) { console.error('ERREUR migration 366 :', error); process.exit(1) }
  // Vérif : table présente + colonnes clés
  const { error: check } = await db.from('subject_relational_evidence').select('id, subject_ids, evidence_hash').limit(1)
  if (check) { console.error('Table non interrogeable :', check.message); process.exit(1) }
  console.log('Migration 366 appliquée — subject_relational_evidence OK')
}
run()
