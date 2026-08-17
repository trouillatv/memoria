/**
 * Application de la migration 340 (cr_tier, statut éditorial Photo clé/Reportage)
 * via l'API Management Supabase — même mécanisme que 335/339.
 */
import { config } from 'dotenv'
import { readFileSync } from 'fs'
config({ path: '.env.local' })

const PROJECT_REF = process.env.NEXT_PUBLIC_SUPABASE_URL!.match(/https:\/\/([^.]+)\.supabase\.co/)![1]
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!
const URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

async function query(q: string, label = ''): Promise<unknown> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} [${label}]: ${text}`)
  return JSON.parse(text)
}

async function main() {
  console.log(`Project: ${PROJECT_REF}`)
  console.log('Application de la migration 340...\n')

  const sql = readFileSync('supabase/migrations/340_visit_capture_cr_tier.sql', 'utf-8')
  try {
    await query(sql, '340')
    console.log('✓ migration 340 appliquée')
  } catch (err) {
    console.error('✗', err)
    process.exit(1)
  }

  const check = await query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'visit_capture' AND column_name = 'cr_tier'
  `) as Array<{ column_name: string; data_type: string }>
  console.log(`colonne cr_tier : ${check.length > 0 ? '✓ ' + check[0].data_type : '✗ ABSENTE'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
