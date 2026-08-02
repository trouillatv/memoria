import { existsSync, readFileSync } from 'node:fs'

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

async function sql(query: string): Promise<unknown[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const res = await fetch('https://api.supabase.com/v1/projects/srixnofmaydxouhucawn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function main() {
  const SITE = '6b19a3ae-74e5-400c-8ab9-2ee1c10a91b5'
  const DOC_PV001 = '64cf7623-872c-4e52-b216-42db3deefb2d'

  const reports = await sql(`
    SELECT sr.id, sr.origin, sr.status, sr.started_at, sr.extraction_run_id,
           sr.source_document_id, sr.created_at,
           (SELECT COUNT(*) FROM site_report_proposals WHERE report_id = sr.id) AS nb_props
    FROM site_reports sr
    WHERE sr.site_id = '${SITE}'
      AND sr.origin = 'import'
    ORDER BY sr.started_at ASC, sr.created_at ASC;
  `) as Array<{ id: string; origin: string; status: string; started_at: string | null; extraction_run_id: string | null; source_document_id: string | null; created_at: string; nb_props: string }>

  console.log(`site_reports origin=import pour OCEF : ${reports.length}`)
  for (const r of reports) {
    console.log(`  ${r.id} | started_at=${r.started_at?.slice(0, 10) ?? 'NULL'} | status=${r.status} | run=${r.extraction_run_id?.slice(0, 8)} | doc=${r.source_document_id?.slice(0, 8) ?? 'NULL'} | props=${r.nb_props}`)
  }

  const docState = await sql(`
    SELECT id, created_at, deleted_at FROM documents WHERE id = '${DOC_PV001}';
  `) as Array<{ id: string; created_at: string; deleted_at: string | null }>

  const d = docState[0]
  console.log(`\ndoc PV001 (64cf7623) :`)
  console.log(`  created_at : ${d?.created_at}`)
  console.log(`  deleted_at : ${d?.deleted_at ?? 'NULL (non supprime)'}`)
}

main().catch(err => { console.error(err); process.exit(1) })
