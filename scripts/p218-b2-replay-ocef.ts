/**
 * #218 — Replay B2 READ-ONLY sur un document RÉEL OCEF non réparé (PV 010 Compostage 2026-07-16).
 *
 * Aucune écriture. Compare : propositions actuelles en base (AVANT) vs ré-extraction du TEXTE SOURCE RÉEL
 * (documents.extracted_text) avec le contrat d'atomicité B2 (APRÈS). Groupe l'APRÈS par sourceExcerpt pour
 * révéler les SPLITS (un même extrait → plusieurs propositions) et permettre de juger split/non-split.
 *
 * Usage : npx tsx --env-file=.env.local scripts/p218-b2-replay-ocef.ts
 */
import { createClient } from '@supabase/supabase-js'
import { extractHistoricalPvProposals } from '../lib/documents/historical-visit-extractor'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const METIER = (f: string) => !['person', 'company'].includes(f)
const sep = (l: string) => console.log(`\n${'═'.repeat(78)}\n${l}\n${'═'.repeat(78)}`)

async function main() {
  // 1. Document source réel : PV 010 OCEF Compostage 2026-07-16.
  const { data: docs } = await sb.from('documents')
    .select('id, filename, extracted_text, effective_date')
    .ilike('filename', '%PV 010%OCEF Compostage%')
  const doc = (docs ?? []).find((d) => (d as { extracted_text: string | null }).extracted_text) as
    { id: string; filename: string; extracted_text: string; effective_date: string | null } | undefined
  if (!doc) { console.log('Document introuvable'); return }
  console.log(`Document : ${doc.filename} [${doc.id.slice(0, 8)}] date=${doc.effective_date} — ${doc.extracted_text.length} c`)

  // 2. Run le plus riche sur ce document (AVANT = propositions actuelles en base).
  const { data: runs } = await sb.from('document_extraction_run').select('id, target_site_id').eq('document_id', doc.id)
  let bestRun = '', bestCount = -1
  for (const r of ((runs ?? []) as Array<{ id: string }>)) {
    const { count } = await sb.from('document_extraction_proposal').select('*', { count: 'exact', head: true }).eq('extraction_run_id', r.id).not('proposal_family', 'in', '("person","company")')
    if ((count ?? 0) > bestCount) { bestCount = count ?? 0; bestRun = r.id }
  }
  const { data: beforeRaw } = await sb.from('document_extraction_proposal')
    .select('label, proposal_family, source_page, source_excerpt')
    .eq('extraction_run_id', bestRun).order('source_page', { ascending: true })
  const before = (beforeRaw ?? []).filter((p) => METIER(p.proposal_family)) as Array<{ label: string; proposal_family: string; source_page: number | null; source_excerpt: string | null }>

  sep(`AVANT — ${before.length} propositions métier en base (run ${bestRun.slice(0, 8)})`)
  for (const p of before) console.log(`  [${p.proposal_family.padEnd(14)}] p.${p.source_page ?? '?'} ${p.label}`)

  // 3. Replay B2 sur le TEXTE SOURCE RÉEL (aucune écriture).
  const pageMarkers = (doc.extracted_text.match(/\[\[page \d+\]\]/g) ?? []).length
  const pageCount = pageMarkers > 0 ? pageMarkers : Math.max(1, Math.ceil(doc.extracted_text.length / 2200))
  sep(`REPLAY B2 (dry-run) — pageCount=${pageCount} — appel extracteur…`)
  const res = await extractHistoricalPvProposals(doc.extracted_text, pageCount)
  const after = res.proposals.filter((p) => METIER(p.family)) as Array<{ family: string; label: string; sourcePage?: number | null; sourceExcerpt?: string | null }>
  console.log(`APRÈS — ${after.length} propositions métier ré-extraites`)
  for (const p of after) console.log(`  [${p.family.padEnd(14)}] p.${p.sourcePage ?? '?'} ${p.label}`)

  // 4. SPLITS : grouper l'APRÈS par sourceExcerpt normalisé → extraits ayant produit ≥2 propositions.
  sep('SPLITS — extraits source ayant produit PLUSIEURS propositions (candidats éclatement)')
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const byExcerpt = new Map<string, typeof after>()
  for (const p of after) {
    const k = norm(p.sourceExcerpt) || `__nolabel__${norm(p.label)}`
    if (!byExcerpt.has(k)) byExcerpt.set(k, [])
    byExcerpt.get(k)!.push(p)
  }
  const splits = [...byExcerpt.entries()].filter(([, ps]) => ps.length >= 2).sort((a, b) => b[1].length - a[1].length)
  console.log(`Nombre d'extraits éclatés en ≥2 propositions : ${splits.length}`)
  for (const [k, ps] of splits) {
    console.log(`\n  ── extrait (${ps.length} props) : « ${(ps[0].sourceExcerpt ?? k).slice(0, 160)} »`)
    for (const p of ps) console.log(`       → [${p.family}] ${p.label}`)
  }

  console.log('\n(READ-ONLY — aucune écriture. Classification split/non-split dans le rapport.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
