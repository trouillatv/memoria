/**
 * Application de la migration 338 via la fonction RPC exec_sql(sql) déjà
 * présente sur ce projet Supabase (connexion PostgreSQL directe impossible
 * depuis ce réseau : db.<ref>.supabase.co ne résout qu'en AAAA, pas d'A record).
 *
 * Corrige les blocs WHEN 'deadline' (constraint_text/to_plan), WHEN
 * 'observation' (body/confirmed_by) et WHEN 'decision'
 * (titre/statut/date_decision) de materialize_historical_visit(), colonnes
 * vérifiées via information_schema sur la base de production.
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import * as fs from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'

async function run() {
  const db = createAdminClient()
  const migrationSQL = fs.readFileSync('supabase/migrations/338_fix_materialize_deadline_observation_columns.sql', 'utf8')

  const { error } = await db.rpc('exec_sql', { sql: migrationSQL })
  if (error) {
    console.error('ERREUR migration 338 :', error)
    process.exit(1)
  }
  console.log('Migration 338 appliquée')
}

run()
