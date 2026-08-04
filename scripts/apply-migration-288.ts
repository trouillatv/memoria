// Applique la migration 288 : backfill report_id + subject_thread_id sur site_actions

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = 'srixnofmaydxouhucawn'

  if (!accessToken) {
    console.error('❌ SUPABASE_ACCESS_TOKEN manquant dans .env.local')
    process.exit(1)
  }

  const migrationPath = join(process.cwd(), 'supabase/migrations/288_site_actions_thread_backfill.sql')
  const sql = readFileSync(migrationPath, 'utf-8')

  console.log('📄 Migration : 288_site_actions_thread_backfill.sql')
  console.log('🔗 Connexion : Supabase Management API')

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
  console.log('✅ Migration appliquée')
  if (Array.isArray(result)) console.log(`   → ${result.length} opération(s)`)

  const reloadResponse = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: "NOTIFY pgrst, 'reload schema';" }),
    },
  )

  if (reloadResponse.ok) {
    console.log('✅ Schéma PostgREST rechargé')
  } else {
    console.warn('⚠️  Rechargement schéma :', reloadResponse.status)
  }
}

main().catch(console.error)
