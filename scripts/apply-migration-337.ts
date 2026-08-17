/**
 * Application de la migration 337 via la fonction RPC exec_sql(sql) déjà
 * présente sur ce projet Supabase (connexion PostgreSQL directe impossible
 * depuis ce réseau : db.<ref>.supabase.co ne résout qu'en AAAA, pas d'A record).
 *
 * Corrige les 5 INSERT INTO document_proposal_materialization de
 * materialize_historical_visit() (materialized_at/materialized_by inexistants
 * → status/created_by), régression présente depuis la migration 272.
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import * as fs from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'

async function run() {
  const db = createAdminClient()
  const migrationSQL = fs.readFileSync('supabase/migrations/337_fix_materialize_proposal_materialization_columns.sql', 'utf8')

  const { error } = await db.rpc('exec_sql', { sql: migrationSQL })
  if (error) {
    console.error('ERREUR migration 337 :', error)
    process.exit(1)
  }
  console.log('Migration 337 appliquée')
}

run()
