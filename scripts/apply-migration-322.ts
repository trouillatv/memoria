// Application de la migration 322 (dismiss_kind) via l'API Supabase Management.

import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

config({ path: '.env.local' })

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF = 'srixnofmaydxouhucawn'

async function main() {
  if (!ACCESS_TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/322_dismiss_kind.sql'), 'utf-8')
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql + "\nselect column_name from information_schema.columns where table_name='site_knowledge_proposals' and column_name='dismiss_kind';" }),
    }
  )
  const text = await response.text()
  if (response.ok && text.includes('dismiss_kind')) console.log('✅ Migration 322 appliquée — dismiss_kind présent')
  else { console.error('❌', text); process.exit(1) }
}

main()
