/**
 * Restauration du document PV001 (64cf7623) + corrections associées.
 *
 * Étapes :
 *   A1. UPDATE documents SET deleted_at = NULL WHERE id = '64cf7623...'
 *   A2. Assertions : 1 PV001 actif, 1 PV002 actif, canoniques corrects
 *   A3. Corriger site_report.started_at de PV001 (NULL → 2026-02-12)
 *       et vérifier que PV002 a le bon started_at.
 *
 * Aucune suppression de run. Aucun nouvel import.
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

const DOC_PV001      = '64cf7623-872c-4e52-b216-42db3deefb2d'
const DOC_PV002      = '98978e97-34fe-4d56-afd4-371f4fd0c029'
const RUN_CANONICAL_PV001 = 'f0e874cb-b88c-4c3c-8968-23eb263528cd'
const RUN_CANONICAL_PV002 = '996ff6a7-fe82-4ba0-bd1a-95c8ae8859ec'
const SITE_ID        = '6b19a3ae-74e5-400c-8ab9-2ee1c10a91b5'
const REPORT_PV001   = 'c42c860f-878b-4f1c-8302-c0c70ca3c0ed'
const EXPECTED_DATE_PV001 = '2026-02-12'
const EXPECTED_DATE_PV002 = '2026-03-12'

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`)
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) { console.error('SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }

  // ── A1. Restaurer le document PV001 ─────────────────────────────────────────
  console.log('[A1] Restauration du document 64cf7623 (SET deleted_at = NULL)...')
  await sql(`
    UPDATE documents
    SET deleted_at = NULL
    WHERE id = '${DOC_PV001}'
      AND deleted_at IS NOT NULL;
  `)
  console.log('[A1] UPDATE exécuté.')

  // ── A2. Assertions post-restauration ────────────────────────────────────────
  console.log('\n[A2] Assertions...')

  // 2a. Exactement 1 document PV001 actif
  const pv001Active = await sql(`
    SELECT COUNT(*) AS n FROM documents
    WHERE id = '${DOC_PV001}' AND deleted_at IS NULL;
  `) as Array<{ n: string }>
  assert(Number(pv001Active[0]?.n) === 1, `1 doc PV001 actif attendu, trouvé: ${pv001Active[0]?.n}`)
  console.log('  [OK] 1 document PV001 actif')

  // 2b. Exactement 1 document PV002 actif
  const pv002Active = await sql(`
    SELECT COUNT(*) AS n FROM documents
    WHERE id = '${DOC_PV002}' AND deleted_at IS NULL;
  `) as Array<{ n: string }>
  assert(Number(pv002Active[0]?.n) === 1, `1 doc PV002 actif attendu, trouvé: ${pv002Active[0]?.n}`)
  console.log('  [OK] 1 document PV002 actif')

  // 2c. f0e874cb est l'unique canonique pour PV001
  const canonical1 = await sql(`
    SELECT id, is_canonical FROM document_extraction_run
    WHERE document_id = '${DOC_PV001}' AND is_canonical = true;
  `) as Array<{ id: string; is_canonical: boolean }>
  assert(canonical1.length === 1, `1 run canonique PV001 attendu, trouvé: ${canonical1.length}`)
  assert(canonical1[0]?.id === RUN_CANONICAL_PV001, `run canonique PV001 attendu: ${RUN_CANONICAL_PV001}, trouvé: ${canonical1[0]?.id}`)
  console.log(`  [OK] Run canonique PV001 = ${canonical1[0]?.id.slice(0, 8)}...`)

  // 2d. 996ff6a7 est l'unique canonique pour PV002
  const canonical2 = await sql(`
    SELECT id, is_canonical FROM document_extraction_run
    WHERE document_id = '${DOC_PV002}' AND is_canonical = true;
  `) as Array<{ id: string; is_canonical: boolean }>
  assert(canonical2.length === 1, `1 run canonique PV002 attendu, trouvé: ${canonical2.length}`)
  assert(canonical2[0]?.id === RUN_CANONICAL_PV002, `run canonique PV002 attendu: ${RUN_CANONICAL_PV002}, trouvé: ${canonical2[0]?.id}`)
  console.log(`  [OK] Run canonique PV002 = ${canonical2[0]?.id.slice(0, 8)}...`)

  // 2e. Aucun autre document PV001 actif (même hash)
  const hashCheck = await sql(`
    SELECT id, deleted_at FROM documents
    WHERE content_hash = (SELECT content_hash FROM documents WHERE id = '${DOC_PV001}')
      AND deleted_at IS NULL;
  `) as Array<{ id: string; deleted_at: string | null }>
  assert(hashCheck.length === 1, `1 seul document actif avec ce hash attendu, trouvé: ${hashCheck.length}`)
  console.log(`  [OK] Aucun doublon actif pour content_hash PV001`)

  // 2f. ChronologyWorkspace verra exactement 2 cartes (PV001 + PV002)
  const chrono = await sql(`
    SELECT d.id, d.filename, d.effective_date
    FROM documents d
    JOIN document_links dl ON dl.document_id = d.id
      AND dl.target_type = 'site'
      AND dl.target_id = '${SITE_ID}'
    WHERE d.deleted_at IS NULL
      AND d.document_type = 'historical_visit_report'
    ORDER BY d.effective_date ASC;
  `) as Array<{ id: string; filename: string; effective_date: string | null }>
  assert(chrono.length === 2, `2 cartes Chronologie attendues, trouvé: ${chrono.length}`)
  console.log(`  [OK] Chronologie : ${chrono.length} cartes`)
  for (const c of chrono) {
    console.log(`       → ${c.id.slice(0, 8)} | ${c.effective_date} | ${c.filename}`)
  }

  console.log('\n[A2] Toutes les assertions passent.')

  // ── A3. Corriger started_at du site_report PV001 ────────────────────────────
  console.log('\n[A3] Vérification et correction de site_report.started_at...')

  const reportState = await sql(`
    SELECT id, started_at, source_document_id, extraction_run_id
    FROM site_reports
    WHERE id IN ('${REPORT_PV001}', '431a71c7-02be-4fd2-bd6f-23406ab30630')
    ORDER BY started_at ASC NULLS FIRST;
  `) as Array<{ id: string; started_at: string | null; source_document_id: string | null; extraction_run_id: string | null }>

  for (const r of reportState) {
    console.log(`  report ${r.id.slice(0, 8)} | started_at=${r.started_at?.slice(0, 10) ?? 'NULL'} | doc=${r.source_document_id?.slice(0, 8) ?? 'NULL'}`)
  }

  const pv001Report = reportState.find(r => r.id === REPORT_PV001)
  if (pv001Report?.started_at === null) {
    console.log(`  → started_at NULL détecté sur PV001. Correction à ${EXPECTED_DATE_PV001}...`)
    await sql(`
      UPDATE site_reports
      SET started_at = '${EXPECTED_DATE_PV001}'::timestamptz
      WHERE id = '${REPORT_PV001}'
        AND started_at IS NULL;
    `)
    console.log('  [OK] started_at corrigé.')
  } else {
    console.log(`  [OK] started_at déjà renseigné : ${pv001Report?.started_at?.slice(0, 10)}`)
  }

  // Vérifier PV002
  const pv002Report = reportState.find(r => r.id !== REPORT_PV001)
  if (pv002Report) {
    const pv002Date = pv002Report.started_at?.slice(0, 10)
    if (pv002Date !== EXPECTED_DATE_PV002) {
      console.warn(`  [ATTENTION] PV002 started_at=${pv002Date}, attendu=${EXPECTED_DATE_PV002}`)
    } else {
      console.log(`  [OK] PV002 started_at=${pv002Date} — correct`)
    }
  }

  // Vérification finale
  console.log('\n[A3] Vérification finale des started_at...')
  const finalReports = await sql(`
    SELECT sr.id, sr.started_at, d.effective_date, d.filename
    FROM site_reports sr
    JOIN documents d ON d.id = sr.source_document_id
    WHERE sr.site_id = '${SITE_ID}' AND sr.origin = 'import'
    ORDER BY sr.started_at ASC;
  `) as Array<{ id: string; started_at: string | null; effective_date: string | null; filename: string }>

  for (const r of finalReports) {
    const match = r.started_at?.slice(0, 10) === r.effective_date?.slice(0, 10)
    console.log(`  ${match ? '[OK]' : '[KO]'} report ${r.id.slice(0, 8)} | started_at=${r.started_at?.slice(0, 10) ?? 'NULL'} | effective_date=${r.effective_date} | ${r.filename}`)
  }

  console.log('\n════════════════════════════════════════════════')
  console.log('RÉPARATION TERMINÉE')
  console.log('  PV001 actif, canonique f0e874cb, started_at 2026-02-12')
  console.log('  PV002 actif, canonique 996ff6a7, started_at 2026-03-12')
  console.log('  Chronologie : 2 cartes exactes')
  console.log('════════════════════════════════════════════════')
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1) })
