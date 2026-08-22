// Application de la migration 345 via Supabase Management API
// Usage : npx tsx scripts/_apply-migration-345.ts

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

  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/345_merge_occurrence_dedup.sql'), 'utf-8')

  console.log('[345] Applying occurrence dedup migration via Supabase Management API...')
  try {
    await query(projectRef, token, sql)
    console.log('[345] Migration applied')

    // Vérification : la fonction retourne duplicateOccurrencesDeleted
    const fnSig = await query(projectRef, token, `
      SELECT pg_get_functiondef(oid)::text AS def
      FROM pg_proc
      WHERE proname = 'merge_canonical_subjects'
        AND pronamespace = 'public'::regnamespace;
    `) as Array<{ def: string }>
    const hasDupOcc = fnSig[0]?.def?.includes('duplicateOccurrencesDeleted') ?? false
    const hasDupOccDelete = fnSig[0]?.def?.includes('v_dup_occ_del') ?? false
    console.log(`[345] duplicateOccurrencesDeleted dans JSONB : ${hasDupOcc ? 'OK' : 'FAIL'}`)
    console.log(`[345] Step 4b (DELETE duplicate occurrences) : ${hasDupOccDelete ? 'OK' : 'FAIL'}`)

    await query(projectRef, token, "NOTIFY pgrst, 'reload schema';")
    console.log('[345] Schema reloaded')

    if (!hasDupOcc || !hasDupOccDelete) {
      console.error('[345] FAIL — vérifications incomplètes')
      process.exit(1)
    }
    console.log('[345] SUCCESS')
  } catch (err) {
    console.error('[345] FAILED:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
