// Application de la migration 344 via Supabase Management API (HTTPS)
// Usage : npx tsx scripts/_apply-migration-344.ts

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

async function query(projectRef: string, token: string, sql: string): Promise<unknown> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = 'srixnofmaydxouhucawn'
  if (!token) { console.error('SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }

  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/344_merge_safety_p15a1.sql'), 'utf-8')

  console.log('[344] Applying merge safety migration via Supabase Management API...')
  try {
    await query(projectRef, token, sql)
    console.log('[344] Migration applied')

    // Vérification 1 : colonnes engine_version sur canonical_subject_merge
    const cols = await query(projectRef, token, `
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'canonical_subject_merge'
        AND column_name IN ('engine_version', 'p01_jaccard', 'p02_confidence')
      ORDER BY column_name;
    `) as Array<{ column_name: string }>
    console.log(`[344] Colonnes ajoutées : ${cols.map((r) => r.column_name).join(', ')}`)

    // Vérification 2 : contrainte resolution_source étendue
    const constraint = await query(projectRef, token, `
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.canonical_subject_merge'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%resolution_source%';
    `) as Array<{ def: string }>
    const hasAutomatic = constraint[0]?.def?.includes('automatic') ?? false
    console.log(`[344] Contrainte resolution_source : ${hasAutomatic ? 'OK (automatic inclus)' : 'FAIL — automatic absent'}`)

    // Vérification 3 : fonction merge_canonical_subjects retourne linksMoved
    const fnSig = await query(projectRef, token, `
      SELECT pg_get_functiondef(oid)::text AS def
      FROM pg_proc
      WHERE proname = 'merge_canonical_subjects'
        AND pronamespace = 'public'::regnamespace;
    `) as Array<{ def: string }>
    const hasLinks = fnSig[0]?.def?.includes('linksMoved') ?? false
    console.log(`[344] Fonction merge_canonical_subjects : ${hasLinks ? 'OK (linksMoved présent)' : 'FAIL — linksMoved absent'}`)

    await query(projectRef, token, "NOTIFY pgrst, 'reload schema';")
    console.log('[344] Schema reloaded')

    if (!hasAutomatic || !hasLinks || cols.length < 3) {
      console.error('[344] FAIL — vérifications incomplètes')
      process.exit(1)
    }
    console.log('[344] SUCCESS')
  } catch (err) {
    console.error('[344] FAILED:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
