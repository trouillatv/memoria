// Vincent 2026-05-22 — Helper partagé pour appliquer une migration SQL.
//
// Cascade de stratégies (du plus puissant au plus dégradé) :
//   1) Supabase Management API (`POST /v1/projects/{ref}/database/query`)
//      → nécessite SUPABASE_ACCESS_TOKEN (PAT) dans .env.local
//   2) RPC `exec_sql` côté Postgres (one-shot installé manuellement)
//      → nécessite la fonction `public.exec_sql(text)` créée préalablement
//   3) Affichage du SQL pour copier-coller dans Supabase SQL Editor
//      → toujours dispo, mais Vincent doit cliquer.
//
// Chaque migration de cette série appelle `applyMigration(number)`. Idempotent
// côté DB : nos migrations 077-079 utilisent CHECK + ADD COLUMN qui peuvent
// échouer si déjà appliquées — c'est OK, le runner remonte l'erreur claire.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// .env.local n'est pas auto-chargé par tsx — on le lit comme scripts/db-push.ts
const ENV_PATH = '.env.local'
if (existsSync(ENV_PATH)) {
  for (const rawLine of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const PAT = process.env.SUPABASE_ACCESS_TOKEN ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env.local')
  process.exit(1)
}

/** Extrait le project-ref depuis https://{ref}.supabase.co. */
function getProjectRef(): string | null {
  try {
    const u = new URL(SUPABASE_URL)
    const host = u.hostname // {ref}.supabase.co
    const ref = host.split('.')[0]
    return ref && ref !== 'supabase' ? ref : null
  } catch {
    return null
  }
}

/** Tentative 1 — Management API. */
async function tryManagementAPI(sql: string, label: string): Promise<boolean> {
  if (!PAT) return false
  const ref = getProjectRef()
  if (!ref) {
    console.warn(`⚠ Impossible d'extraire le project-ref depuis NEXT_PUBLIC_SUPABASE_URL`)
    return false
  }
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PAT}`,
      },
      body: JSON.stringify({ query: sql }),
    },
  )
  if (resp.ok) {
    console.log(`✓ ${label} appliquée via Management API`)
    return true
  }
  const body = await resp.text()
  console.error(`✗ Management API a refusé ${label} (HTTP ${resp.status}) :`)
  console.error(body)
  return false
}

/** Tentative 2 — RPC exec_sql via service_role. */
async function tryExecSqlRpc(sql: string, label: string): Promise<boolean> {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })
  try {
     
    const { error } = await (sb as any).rpc('exec_sql', { sql })
    if (!error) {
      console.log(`✓ ${label} appliquée via RPC exec_sql`)
      return true
    }
    console.warn(`⚠ RPC exec_sql a renvoyé une erreur :`, error.message)
  } catch (e) {
    console.warn(`⚠ RPC exec_sql indisponible :`, e instanceof Error ? e.message : e)
  }
  // Fallback REST direct
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ sql }),
  })
  if (resp.ok) {
    console.log(`✓ ${label} appliquée via REST /rpc/exec_sql`)
    return true
  }
  return false
}

/** Tentative 3 — affichage du SQL pour copier-coller. */
function fallbackPrintSql(sql: string, label: string, filePath: string): void {
  console.log('')
  console.log(`╔═══════════════════════════════════════════════════════════════════════════╗`)
  console.log(`║  Impossible d'appliquer ${label} automatiquement.`)
  console.log(`║`)
  console.log(`║  Solution : ouvre le Supabase SQL Editor et colle le contenu de`)
  console.log(`║  ${filePath}`)
  console.log(`║`)
  console.log(`║  Ou ajoute SUPABASE_ACCESS_TOKEN=sbp_... dans .env.local`)
  console.log(`║  (https://supabase.com/dashboard/account/tokens) pour autoriser`)
  console.log(`║  l'application automatique via la Management API.`)
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`)
  console.log('')
  console.log('--- SQL ---')
  console.log(sql)
  console.log('--- /SQL ---')
}

export interface ApplyResult {
  ok: boolean
  via: 'management-api' | 'exec-sql-rpc' | 'manual-fallback'
}

/** Applique une migration via la meilleure stratégie disponible. */
export async function applyMigration(migrationNumber: string): Promise<ApplyResult> {
  const filePath = join(
    process.cwd(),
    'supabase/migrations',
    findMigrationFile(migrationNumber),
  )
  const sql = readFileSync(filePath, 'utf-8')
  const label = `Migration ${migrationNumber}`

  // 1) Management API si PAT
  if (PAT) {
    const ok = await tryManagementAPI(sql, label)
    if (ok) return { ok: true, via: 'management-api' }
  } else {
    console.log(`(SUPABASE_ACCESS_TOKEN absent — saute Management API)`)
  }

  // 2) RPC exec_sql
  const ok = await tryExecSqlRpc(sql, label)
  if (ok) return { ok: true, via: 'exec-sql-rpc' }

  // 3) Fallback manuel
  fallbackPrintSql(sql, label, filePath)
  return { ok: false, via: 'manual-fallback' }
}

/** Trouve le fichier de migration dont le nom commence par {number}_. */
function findMigrationFile(number: string): string {
  const fs = require('fs') as typeof import('fs')
  const dir = join(process.cwd(), 'supabase/migrations')
  const entries = fs.readdirSync(dir)
  const match = entries.find((f) => f.startsWith(`${number}_`) && f.endsWith('.sql'))
  if (!match) {
    throw new Error(
      `Aucun fichier ${number}_*.sql dans supabase/migrations/ — vérifie le numéro.`,
    )
  }
  return match
}
