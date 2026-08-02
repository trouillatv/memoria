/**
 * Matérialisation du run canonique PV001 : f0e874cb (48 propositions).
 * Appelle materialize_historical_visit() via l'API Management SQL.
 *
 * Idempotent : si le site_report existe déjà, la contrainte UNIQUE l'empêche de doubler.
 */

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
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) { console.error('SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }

  // Résoudre le run canonique et son contexte
  const runs = await sql(`
    SELECT
      r.id AS run_id,
      r.document_id,
      r.status,
      r.is_canonical,
      dl.target_id AS site_id,
      d.effective_date,
      d.filename,
      r.created_by AS user_id
    FROM document_extraction_run r
    JOIN documents d ON d.id = r.document_id
    JOIN document_links dl ON dl.document_id = d.id AND dl.target_type = 'site'
    WHERE r.id::text LIKE 'f0e874cb%'
      AND r.is_canonical = true
    LIMIT 1;
  `) as Array<{
    run_id: string; document_id: string; status: string; is_canonical: boolean
    site_id: string; effective_date: string; filename: string; user_id: string | null
  }>

  if (runs.length === 0) {
    console.error('[PV001] Run canonique f0e874cb introuvable ou non canonique')
    process.exit(1)
  }
  const run = runs[0]
  console.log('[PV001] Run canonique trouvé :')
  console.log(`  ID         : ${run.run_id}`)
  console.log(`  Document   : ${run.document_id}`)
  console.log(`  Statut     : ${run.status}`)
  console.log(`  Canonique  : ${run.is_canonical}`)
  console.log(`  Site       : ${run.site_id}`)
  console.log(`  Date PV    : ${run.effective_date}`)
  console.log(`  Fichier    : ${run.filename}`)

  // Vérifier si déjà matérialisé
  const existing = await sql(`
    SELECT id, origin, created_at
    FROM site_reports
    WHERE extraction_run_id = '${run.run_id}';
  `) as Array<{ id: string; origin: string; created_at: string }>

  if (existing.length > 0) {
    console.log('[PV001] Déjà matérialisé :')
    for (const r of existing) console.log(`  site_report ${r.id} (origin=${r.origin}, ${r.created_at.slice(0,19)})`)
    console.log('[PV001] Aucune action nécessaire — idempotence garantie.')
    return
  }

  // Résoudre un user_id admin si le run n'en a pas
  let userId = run.user_id
  if (!userId) {
    const admins = await sql(`
      SELECT id FROM auth.users
      ORDER BY created_at ASC
      LIMIT 1;
    `) as Array<{ id: string }>
    userId = admins[0]?.id ?? null
    if (!userId) { console.error('[PV001] Aucun utilisateur trouvé'); process.exit(1) }
    console.log(`  User (fallback admin) : ${userId}`)
  }

  console.log('\n[PV001] Appel de materialize_historical_visit()...')
  const result = await sql(`
    SELECT public.materialize_historical_visit(
      '${run.run_id}'::uuid,
      '${userId}'::uuid,
      '${run.site_id}'::uuid,
      '${run.effective_date}'::date,
      'PV 001 - OCEF Compostage'
    ) AS site_report_id;
  `) as Array<{ site_report_id: string }>

  const siteReportId = result[0]?.site_report_id
  if (!siteReportId) {
    console.error('[PV001] RPC sans résultat — vérifier les logs PostgreSQL')
    process.exit(1)
  }

  console.log(`[PV001] site_report créé : ${siteReportId}`)

  // Vérifications post-matérialisation
  console.log('\n[PV001] Vérifications post-matérialisation...')

  const report = await sql(`
    SELECT sr.id, sr.origin, sr.status, sr.visit_date,
      (SELECT COUNT(*) FROM site_report_proposals WHERE report_id = sr.id) AS nb_proposals,
      (SELECT COUNT(*) FROM document_proposal_materialization dpm
         JOIN document_extraction_proposal dep ON dep.id = dpm.proposal_id
         WHERE dep.extraction_run_id = '${run.run_id}') AS nb_mats
    FROM site_reports sr
    WHERE sr.id = '${siteReportId}';
  `) as Array<{ id: string; origin: string; status: string; visit_date: string; nb_proposals: string; nb_mats: string }>

  const r = report[0]
  console.log(`  site_report : ${r.id}`)
  console.log(`  origin      : ${r.origin}`)
  console.log(`  status      : ${r.status}`)
  console.log(`  visit_date  : ${r.visit_date}`)
  console.log(`  proposals   : ${r.nb_proposals}`)
  console.log(`  mats        : ${r.nb_mats}`)

  const runStatus = await sql(`
    SELECT status FROM document_extraction_run WHERE id = '${run.run_id}';
  `) as Array<{ status: string }>
  console.log(`  run status  : ${runStatus[0]?.status}`)

  const totalReports = await sql(`
    SELECT COUNT(*) AS n FROM site_reports
    WHERE source_document_id = '${run.document_id}'
      AND origin = 'import';
  `) as Array<{ n: string }>
  console.log(`\n  Visites historiques PV001 (origin=import) : ${totalReports[0]?.n} (attendu: 1)`)

  if (Number(totalReports[0]?.n) === 1) {
    console.log('\n[PV001] SUCCESS — 1 document, 1 run canonique, 1 visite historique.')
  } else {
    console.error('\n[PV001] ATTENTION — nombre de visites inattendu, vérifier manuellement.')
    process.exit(1)
  }
}

main().catch((err) => { console.error('[FATAL]', err); process.exit(1) })
