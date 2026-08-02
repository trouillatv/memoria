/**
 * DIAGNOSTIC UNIQUEMENT — aucune modification.
 * Trace exactement ce que ChronologyWorkspace afficherait pour le chantier OCEF
 * et explique l'origine des 5 cartes PV001.
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

const PROJECT = 'srixnofmaydxouhucawn'
const SITE_ID = '6b19a3ae-74e5-400c-8ab9-2ee1c10a91b5'  // OCEF

async function sql(query: string): Promise<unknown[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
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

  // ── 1. Tous les documents historical_visit_report liés au chantier OCEF ──────
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('1. Documents historical_visit_report liés au chantier OCEF')
  console.log('═══════════════════════════════════════════════════════')
  const docs = await sql(`
    SELECT
      d.id,
      d.filename,
      d.effective_date,
      d.content_hash,
      d.created_at,
      d.deleted_at,
      d.document_type,
      COUNT(dl.id) AS nb_links,
      COUNT(r.id) AS nb_runs,
      MAX(CASE WHEN r.is_canonical THEN r.id::text ELSE NULL END) AS canonical_run_id
    FROM documents d
    JOIN document_links dl ON dl.document_id = d.id
      AND dl.target_type = 'site'
      AND dl.target_id = '${SITE_ID}'
    LEFT JOIN document_extraction_run r ON r.document_id = d.id
    WHERE d.document_type = 'historical_visit_report'
    GROUP BY d.id, d.filename, d.effective_date, d.content_hash, d.created_at, d.deleted_at, d.document_type
    ORDER BY d.effective_date ASC, d.created_at ASC;
  `) as Array<{
    id: string; filename: string; effective_date: string | null; content_hash: string | null
    created_at: string; deleted_at: string | null; document_type: string
    nb_links: string; nb_runs: string; canonical_run_id: string | null
  }>

  for (const d of docs) {
    const deleted = d.deleted_at ? `  [SUPPRIMÉ: ${d.deleted_at.slice(0,10)}]` : ''
    console.log(`\n  doc.id        : ${d.id}${deleted}`)
    console.log(`  filename      : ${d.filename}`)
    console.log(`  effective_date: ${d.effective_date ?? 'NULL'}`)
    console.log(`  created_at    : ${d.created_at.slice(0,19)}`)
    console.log(`  content_hash  : ${d.content_hash ?? 'NULL'}`)
    console.log(`  nb_links      : ${d.nb_links}`)
    console.log(`  nb_runs       : ${d.nb_runs}`)
    console.log(`  canonical_run : ${d.canonical_run_id ?? 'aucun'}`)
  }

  const activeNonDeleted = docs.filter(d => !d.deleted_at)
  console.log(`\n  TOTAL         : ${docs.length} documents (${activeNonDeleted.length} non supprimés, ${docs.filter(d => d.deleted_at).length} supprimés)`)

  // ── 2. Focus sur PV001 : filename LIKE '%2026%02%12%' ou '%PV%001%' ─────────
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('2. Documents PV001 — filename contenant "PV 001" ou date 2026-02-12')
  console.log('═══════════════════════════════════════════════════════')
  const pv001docs = docs.filter(d =>
    d.filename.includes('PV 001') || d.filename.includes('2026-02-12') ||
    (d.effective_date ?? '').includes('2026-02-12') || (d.effective_date ?? '').startsWith('2026-02-12')
  )
  console.log(`  Occurrences PV001 non supprimées : ${pv001docs.filter(d => !d.deleted_at).length}`)
  console.log(`  Occurrences PV001 supprimées     : ${pv001docs.filter(d =>  d.deleted_at).length}`)
  for (const d of pv001docs) {
    console.log(`  → ${d.id} | deleted=${!!d.deleted_at} | ${d.filename}`)
  }

  // ── 3. Simuler exactement listDocumentsForTarget (source de ChronologyWorkspace) ──
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('3. Simulation exacte de listDocumentsForTarget (ChronologyWorkspace)')
  console.log('═══════════════════════════════════════════════════════')
  const chronoQuery = await sql(`
    SELECT
      d.id,
      d.filename,
      d.effective_date,
      d.document_type,
      d.created_at,
      d.deleted_at,
      dl.id AS link_id,
      dl.target_type,
      dl.target_id
    FROM documents d
    JOIN document_links dl ON dl.document_id = d.id
      AND dl.target_type = 'site'
      AND dl.target_id = '${SITE_ID}'
    WHERE d.deleted_at IS NULL
      AND d.document_type = 'historical_visit_report'
    ORDER BY d.effective_date ASC, d.created_at ASC;
  `) as Array<{
    id: string; filename: string; effective_date: string | null; document_type: string
    created_at: string; deleted_at: string | null
    link_id: string; target_type: string; target_id: string
  }>

  console.log(`  → ${chronoQuery.length} cartes affichées par ChronologyWorkspace`)
  for (const r of chronoQuery) {
    console.log(`\n  carte | doc.id=${r.id} | link.id=${r.link_id}`)
    console.log(`         filename=${r.filename}`)
    console.log(`         effective_date=${r.effective_date ?? 'NULL'}`)
  }

  // ── 4. Vérifier les document_links pour PV001 IDs ──────────────────────────
  if (pv001docs.length > 0) {
    const ids = pv001docs.map(d => `'${d.id}'`).join(', ')
    console.log('\n═══════════════════════════════════════════════════════')
    console.log('4. Tous les document_links pour les docs PV001 (toutes targets)')
    console.log('═══════════════════════════════════════════════════════')
    const links = await sql(`
      SELECT dl.id, dl.document_id, dl.target_type, dl.target_id, dl.created_at
      FROM document_links dl
      WHERE dl.document_id IN (${ids})
      ORDER BY dl.document_id, dl.target_type;
    `) as Array<{ id: string; document_id: string; target_type: string; target_id: string; created_at: string }>
    for (const l of links) {
      console.log(`  link ${l.id.slice(0,8)} | doc=${l.document_id.slice(0,8)} | ${l.target_type}=${l.target_id.slice(0,8)}`)
    }
  }

  // ── 5. Vérifier les runs pour tous les docs PV001 ──────────────────────────
  if (pv001docs.length > 0) {
    const ids = pv001docs.map(d => `'${d.id}'`).join(', ')
    console.log('\n═══════════════════════════════════════════════════════')
    console.log('5. Extraction runs pour tous les docs PV001')
    console.log('═══════════════════════════════════════════════════════')
    const runs = await sql(`
      SELECT r.id, r.document_id, r.status, r.is_canonical, r.created_at,
             COUNT(p.id) AS nb_proposals
      FROM document_extraction_run r
      LEFT JOIN document_extraction_proposal p ON p.extraction_run_id = r.id
      WHERE r.document_id IN (${ids})
      GROUP BY r.id, r.document_id, r.status, r.is_canonical, r.created_at
      ORDER BY r.document_id, r.created_at;
    `) as Array<{ id: string; document_id: string; status: string; is_canonical: boolean; created_at: string; nb_proposals: string }>
    for (const r of runs) {
      console.log(`  run ${r.id.slice(0,8)} | doc=${r.document_id.slice(0,8)} | canonical=${r.is_canonical} | status=${r.status} | proposals=${r.nb_proposals}`)
    }
  }

  // ── 6. site_reports liés au chantier OCEF ────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('6. site_reports liés au chantier OCEF (origin=import)')
  console.log('═══════════════════════════════════════════════════════')
  const reports = await sql(`
    SELECT sr.id, sr.origin, sr.status, sr.visit_date, sr.extraction_run_id,
           sr.source_document_id, sr.created_at,
           (SELECT COUNT(*) FROM site_report_proposals WHERE report_id = sr.id) AS nb_props
    FROM site_reports sr
    WHERE sr.site_id = '${SITE_ID}'
      AND sr.origin = 'import'
    ORDER BY sr.visit_date ASC, sr.created_at ASC;
  `) as Array<{
    id: string; origin: string; status: string; visit_date: string | null
    extraction_run_id: string | null; source_document_id: string | null
    created_at: string; nb_props: string
  }>
  console.log(`  ${reports.length} site_report(s) origin=import pour OCEF`)
  for (const r of reports) {
    console.log(`\n  report ${r.id.slice(0,8)} | visit_date=${r.visit_date ?? 'NULL'} | status=${r.status}`)
    console.log(`           run=${r.extraction_run_id?.slice(0,8) ?? 'NULL'} | doc=${r.source_document_id?.slice(0,8) ?? 'NULL'} | props=${r.nb_props}`)
  }

  // ── 7. content_hash — détecter les doublons ────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('7. Doublons de content_hash parmi les docs PV001 non supprimés')
  console.log('═══════════════════════════════════════════════════════')
  const hashes = pv001docs.filter(d => !d.deleted_at).map(d => d.content_hash)
  const uniqueHashes = new Set(hashes.filter(Boolean))
  console.log(`  content_hash distincts : ${uniqueHashes.size}`)
  for (const h of uniqueHashes) {
    const count = hashes.filter(hh => hh === h).length
    console.log(`  ${h?.slice(0,16)}... × ${count}`)
  }
  if (hashes.some(h => !h)) {
    console.log(`  ${hashes.filter(h => !h).length} document(s) sans content_hash`)
  }

  console.log('\n═══════════════════════════════════════════════════════')
  console.log('DIAGNOSTIC TERMINÉ — aucune modification effectuée')
  console.log('═══════════════════════════════════════════════════════\n')
}

main().catch((err) => { console.error('[FATAL]', err); process.exit(1) })
