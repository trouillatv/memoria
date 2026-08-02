// Script pour appliquer la migration 272 en production
// Execute le SQL via la connection string DATABASE_URL

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const { Client } = pg

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!dbUrl) {
    console.error('❌ DATABASE_URL ou SUPABASE_DB_URL manquant dans .env.local')
    process.exit(1)
  }

  const migrationPath = join(process.cwd(), 'supabase/migrations/272_historical_visit_document_link.sql')
  const sql = readFileSync(migrationPath, 'utf-8')

  console.log('📄 Migration : 272_historical_visit_document_link.sql')
  console.log('🔗 Connexion : production Supabase')

  const client = new Client({ connectionString: dbUrl })

  try {
    await client.connect()
    console.log('✅ Connecté')

    console.log('⚙️  Exécution du SQL...')
    const result = await client.query(sql)
    console.log('✅ Migration appliquée')

    // Afficher les résultats des backfills
    if (Array.isArray(result)) {
      for (const [i, r] of result.entries()) {
        if (r.command === 'INSERT' && r.rowCount > 0) {
          console.log(`   → Backfill ${i + 1}: ${r.rowCount} ligne(s) insérée(s)`)
        } else if (r.command === 'UPDATE' && r.rowCount > 0) {
          console.log(`   → Backfill ${i + 1}: ${r.rowCount} ligne(s) mise(s) à jour`)
        }
      }
    }

    // Forcer le rechargement du schéma PostgREST
    console.log('🔄 Rechargement du schéma PostgREST...')
    await client.query("NOTIFY pgrst, 'reload schema'")
    console.log('✅ Schéma rechargé')

  } catch (err) {
    console.error('❌ Erreur:', err instanceof Error ? err.message : err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
