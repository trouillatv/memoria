// Script pour appliquer la migration 272 via l'API Supabase Management (HTTPS)
// Contourne les problèmes de connectivité PostgreSQL directe

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = 'srixnofmaydxouhucawn' // extrait de l'URL Supabase

  if (!accessToken) {
    console.error('❌ SUPABASE_ACCESS_TOKEN manquant dans .env.local')
    process.exit(1)
  }

  const migrationPath = join(process.cwd(), 'supabase/migrations/272_historical_visit_document_link.sql')
  const sql = readFileSync(migrationPath, 'utf-8')

  console.log('📄 Migration : 272_historical_visit_document_link.sql')
  console.log('🔗 Connexion : Supabase Management API (HTTPS)')

  try {
    console.log('⚙️  Exécution du SQL via API...')

    const response = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Erreur API:', response.status, response.statusText)
      console.error('Détails:', errorText)
      process.exit(1)
    }

    const result = await response.json()
    console.log('✅ Migration appliquée')

    // Afficher les résultats
    if (Array.isArray(result)) {
      console.log(`   → ${result.length} opération(s) réussie(s)`)
    }

    // Recharger le schéma PostgREST via une seconde requête
    console.log('🔄 Rechargement du schéma PostgREST...')
    const reloadResponse = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: "NOTIFY pgrst, 'reload schema';" }),
      }
    )

    if (reloadResponse.ok) {
      console.log('✅ Schéma rechargé')
    } else {
      console.warn('⚠️  Rechargement schéma : statut', reloadResponse.status)
    }

  } catch (err) {
    console.error('❌ Erreur:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
