// Script pour appliquer la migration 271 via l'API Supabase Management (HTTPS)
// Backfill document_status depuis source_payload.statusAtDocumentDate (sans unaccent)

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = 'srixnofmaydxouhucawn'

  if (!accessToken) {
    console.error('❌ SUPABASE_ACCESS_TOKEN manquant dans .env.local')
    process.exit(1)
  }

  const migrationPath = join(process.cwd(), 'supabase/migrations/271_fix_unaccent_dependency.sql')
  const sql = readFileSync(migrationPath, 'utf-8')

  console.log('📄 Migration : 271_fix_unaccent_dependency.sql')
  console.log('🔗 Connexion : Supabase Management API (HTTPS)')

  try {
    console.log('⚙️  Exécution du SQL via API...')

    const response = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Erreur API:', response.status, response.statusText)
      console.error('Détails:', errorText)
      process.exit(1)
    }

    const result = await response.json()
    console.log('✅ Migration 271 appliquée')

    if (Array.isArray(result) && result.length > 0) {
      console.log(`   → ${result[0]?.rowCount ?? 0} ligne(s) mise(s) à jour`)
    } else if (result && typeof result === 'object' && 'rowCount' in result) {
      console.log(`   → ${result.rowCount} ligne(s) mise(s) à jour`)
    }
  } catch (err) {
    console.error('❌ Erreur:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
