#!/usr/bin/env npx tsx
/** Usage: npx tsx scripts/run-migration.ts <path-to-migration.sql> */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as https from 'node:https'

function loadEnv() {
  const f = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(f)) return
  for (const line of fs.readFileSync(f, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
  }
}
loadEnv()

const PROJECT_REF = 'srixnofmaydxouhucawn'
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!

function runSql(query: string): Promise<unknown> {
  const body = JSON.stringify({ query })
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.supabase.com',
        path: `/v1/projects/${PROJECT_REF}/database/query`,
        method: 'POST',
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(raw) }) }
          catch { resolve({ status: res.statusCode, data: raw }) }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

const migrationFile = process.argv[2]
if (!migrationFile) { console.error('Usage: npx tsx scripts/run-migration.ts <file.sql>'); process.exit(1) }

const sql = fs.readFileSync(migrationFile, 'utf-8')
console.log(`Applying ${path.basename(migrationFile)}…`)
runSql(sql).then((result) => {
  const r = result as { status: number; data: unknown }
  if (r.status === 200 || r.status === 201) {
    console.log('✅ OK')
  } else {
    console.error('❌ Error', r.status, JSON.stringify(r.data))
    process.exit(1)
  }
}).catch((e) => { console.error(e); process.exit(1) })
