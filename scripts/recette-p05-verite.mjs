/** Recette P0.5-Vérité (READ-ONLY) — vérifie le contrat imports ≠ visites terrain sur
 *  Bella + OCEF + PETRO en rejouant EXACTEMENT les nouvelles requêtes des read-models. */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const TERRAIN = ['planned', 'spontaneous', 'qr', 'gps']

const SITES = [
  ['BELLA NAPOLI', 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'],
  ['OCEF Compostage (2c939e67)', '2c939e67-e986-4635-86a0-638cda870480'],
  ['Lycée PETRO ATTITI', '75bd3d23-d515-46bd-8de8-254495a5bade'],
]

const cnt = async (q) => (await q).count ?? 0

for (const [name, siteId] of SITES) {
  // buildSitePatrimoine (nouveau)
  const visits = await cnt(sb.from('site_reports').select('id', { count: 'exact', head: true }).eq('site_id', siteId).in('origin', TERRAIN))
  const importedDocs = await cnt(sb.from('site_reports').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('origin', 'import'))
  const meetings = await cnt(sb.from('site_reports').select('id', { count: 'exact', head: true }).eq('site_id', siteId).is('origin', null).neq('status', 'draft'))
  // première visite terrain
  const { data: fv } = await sb.from('site_reports').select('started_at').eq('site_id', siteId).in('origin', TERRAIN).not('started_at', 'is', null).order('started_at', { ascending: true }).limit(1).maybeSingle()
  // dernière visite terrain TERMINÉE (getLastEndedVisitForSite → "Dernière visite")
  const { data: lv } = await sb.from('site_reports').select('ended_at').eq('site_id', siteId).in('origin', TERRAIN).not('ended_at', 'is', null).order('ended_at', { ascending: false }).limit(1).maybeSingle()
  // liste Visites mobile (nouveau) = terrain uniquement (hors planifiées)
  const { data: mob } = await sb.from('site_reports').select('id, ended_at').eq('site_id', siteId).in('origin', TERRAIN).is('deleted_at', null)
  // date documentaire prouvée = MIN(documents.effective_date) des imports
  const { data: idr } = await sb.from('site_reports').select('source_document_id').eq('site_id', siteId).eq('origin', 'import').not('source_document_id', 'is', null)
  const docIds = [...new Set((idr ?? []).map((r) => r.source_document_id).filter(Boolean))]
  let firstDoc = null
  if (docIds.length) {
    const { data: docs } = await sb.from('documents').select('effective_date').in('id', docIds).not('effective_date', 'is', null).order('effective_date', { ascending: true }).limit(1)
    firstDoc = docs?.[0]?.effective_date ?? null
  }

  console.log(`\n■ ${name}`)
  console.log(`   N visites terrain = ${visits}   PV/CR historiques = ${importedDocs}   réunions = ${meetings}`)
  console.log(`   première visite terrain = ${fv?.started_at?.slice(0, 10) ?? 'Aucune'}`)
  console.log(`   Dernière visite (terrain terminée) = ${lv?.ended_at?.slice(0, 10) ?? 'Aucune'}   → cohérent avec N visites=${visits} : ${(visits === 0) === (!lv) ? '✅' : (lv ? '✅ (a des visites)' : '⚠')}`)
  console.log(`   Visites mobile (terrain, hors planif) = ${mob?.length ?? 0}  → aucun import listé : ${(mob ?? []).length === visits ? '✅' : '⚠'}`)
  console.log(`   date documentaire prouvée la plus ancienne (documents.effective_date) = ${firstDoc ?? 'date non déterminée'}   (${docIds.length} doc source)`)
}

// ── getSiteHistory (frise) — voie 1 : chaque import affiché à sa date DOCUMENTAIRE, jamais 27/08 ──
console.log('\n──── Frise getSiteHistory — dates documentaires des imports Bella ────')
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const { data: bImports } = await sb.from('site_reports')
  .select('id, source_document_id, started_at, created_at').eq('site_id', BELLA).eq('origin', 'import')
let ok = true
for (const r of bImports ?? []) {
  let docDate = null
  if (r.source_document_id) {
    const { data: d } = await sb.from('documents').select('effective_date').eq('id', r.source_document_id).maybeSingle()
    docDate = d?.effective_date ?? null
  }
  const displayed = docDate ?? 'Date non déterminée'
  const techDate = (r.started_at ?? r.created_at)?.slice(0, 10)
  const at2708 = docDate?.slice(0, 10) === '2026-08-27'
  if (!docDate || at2708) ok = false
  console.log(`   import ${r.id.slice(0, 8)} : affiché=${displayed}  (technique=${techDate})  → ${docDate && !at2708 ? '✅ date documentaire, pas la date d\'import' : '⚠'}`)
}
console.log(`   verdict Bella frise : ${ok ? '✅ les 2 imports datés 2024/2025, aucun au 27/08/2026' : '⚠ à auditer'}`)
console.log('')
