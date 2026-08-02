import { readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = 'srixnofmaydxouhucawn'

  if (!accessToken) {
    console.error('SUPABASE_ACCESS_TOKEN manquant dans .env.local')
    process.exit(1)
  }

  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/273_fix_materialize_action_columns.sql'), 'utf-8')
  console.log('Applying 273_fix_materialize_action_columns.sql...')

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })

  if (!res.ok) {
    console.error('ERROR', res.status, await res.text())
    process.exit(1)
  }

  const result = await res.json()
  console.log('OK', JSON.stringify(result).slice(0, 200))
}

main()
