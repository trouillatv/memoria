// Fusion V4/V5 PETRO — 2026-08-13
// SOURCE (loser) : "Finalisation de la sécurisation du site (cadenas)"
// TARGET (winner): "Accès sécurisé au chantier (portail et cadenas à code)"
//
// Motif : sujet créé par V4/V5 comme évolution du sujet historique.
// Même fil métier : accès/cadenas, pas deux problèmes distincts.
//
// Usage : npx tsx scripts/merge-petro-cadenas-finalisation.ts [--dry-run]

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SITE    = '75bd3d23-d515-46bd-8de8-254495a5bade'
const DRY_RUN = process.argv.includes('--dry-run')

const SOURCE_LABEL = 'Finalisation de la sécurisation du site (cadenas)'
const TARGET_LABEL = 'Accès sécurisé au chantier (portail et cadenas à code)'

async function main() {
  if (DRY_RUN) console.log('\n⚠️  MODE DRY-RUN — aucune modification en base')

  // ── Résolution des IDs ──────────────────────────────────────────────────────
  const { data: csAll } = await sb
    .from('canonical_subject')
    .select('id, label, status, merged_into')
    .eq('site_id', SITE)
    .in('label', [SOURCE_LABEL, TARGET_LABEL])

  const source = (csAll ?? []).find((r: { label: string }) => r.label === SOURCE_LABEL) as
    { id: string; label: string; status: string; merged_into: string | null } | undefined
  const target = (csAll ?? []).find((r: { label: string }) => r.label === TARGET_LABEL) as
    { id: string; label: string; status: string; merged_into: string | null } | undefined

  if (!source) { console.error(`❌  Source introuvable : "${SOURCE_LABEL}"`); process.exit(1) }
  if (!target) { console.error(`❌  Target introuvable : "${TARGET_LABEL}"`); process.exit(1) }

  if (source.status === 'merged') {
    console.error(`❌  Source déjà fusionnée (merged_into: ${source.merged_into})`); process.exit(1)
  }

  console.log(`\n=== MERGE — Finalisation cadenas → Accès sécurisé chantier ===`)
  console.log(`  SOURCE : [${source.id}] "${source.label}"`)
  console.log(`  TARGET : [${target.id}] "${target.label}"`)

  // Compter ce qu'on déplace
  const [{ count: occCount }, { count: stiCount }, { count: propsCount }] = await Promise.all([
    sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', source.id),
    sb.from('subject_thread_identity').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', source.id),
    sb.from('site_knowledge_proposals').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', source.id),
  ])
  console.log(`  À déplacer : ${occCount ?? 0} occ · ${stiCount ?? 0} threads · ${propsCount ?? 0} proposals`)

  if (DRY_RUN) { console.log('  [DRY-RUN] Arrêt.\n'); process.exit(0) }

  // ── 1. Occurrences ──────────────────────────────────────────────────────────
  const { error: e1 } = await sb
    .from('canonical_subject_occurrence')
    .update({ canonical_subject_id: target.id })
    .eq('canonical_subject_id', source.id)
  if (e1) { console.error(`❌  occurrences : ${e1.message}`); process.exit(1) }

  // ── 2. Threads ──────────────────────────────────────────────────────────────
  const { error: e2 } = await sb
    .from('subject_thread_identity')
    .update({ canonical_subject_id: target.id })
    .eq('canonical_subject_id', source.id)
  if (e2) { console.error(`❌  threads : ${e2.message}`); process.exit(1) }

  // ── 3. Proposals ────────────────────────────────────────────────────────────
  const { error: e3 } = await sb
    .from('site_knowledge_proposals')
    .update({ canonical_subject_id: target.id })
    .eq('canonical_subject_id', source.id)
  if (e3) { console.error(`❌  proposals : ${e3.message}`); process.exit(1) }

  // ── 4. Journal ──────────────────────────────────────────────────────────────
  const [{ data: wSnap }, { data: lSnap }] = await Promise.all([
    sb.from('canonical_subject').select('label, aliases').eq('id', target.id).maybeSingle(),
    sb.from('canonical_subject').select('label, aliases').eq('id', source.id).maybeSingle(),
  ])
  if (wSnap && lSnap) {
    const w = wSnap as { label: string; aliases: string[] }
    const l = lSnap as { label: string; aliases: string[] }
    await sb.from('canonical_subject_merge').insert({
      winner_subject_id: target.id,
      loser_subject_id:  source.id,
      suggested_label:   null,
      resolution_source: 'manual',
      snapshot: {
        winner_label_before:  w.label,
        winner_aliases_before: w.aliases ?? [],
        loser_label:   l.label,
        loser_aliases: l.aliases ?? [],
        merge_context: 'petro-audit-v4v5-2026-08-13',
      },
    })
  }

  // ── 5. Alias du loser absorbé sur le winner ──────────────────────────────────
  if (wSnap && lSnap) {
    const w = wSnap as { label: string; aliases: string[] }
    const l = lSnap as { label: string; aliases: string[] }
    const merged = Array.from(new Set([
      ...(w.aliases ?? []),
      l.label,
      ...(l.aliases ?? []),
    ])).filter(a => a !== w.label)
    await sb.from('canonical_subject').update({ aliases: merged }).eq('id', target.id)
  }

  // ── 6. Marquer source merged ────────────────────────────────────────────────
  const { error: e6 } = await sb
    .from('canonical_subject')
    .update({ status: 'merged', merged_into: target.id })
    .eq('id', source.id)
  if (e6) { console.error(`❌  merged status : ${e6.message}`); process.exit(1) }

  console.log('\n  ✅ Fusion effectuée')

  // ── Post-check ──────────────────────────────────────────────────────────────
  const [{ count: occFinal }, { data: winnerFinal }] = await Promise.all([
    sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', target.id),
    sb.from('canonical_subject').select('label, status, aliases').eq('id', target.id).maybeSingle(),
  ])
  const wf = winnerFinal as { label: string; status: string; aliases: string[] } | null

  console.log(`\n  Winner après fusion :`)
  console.log(`    label   : ${wf?.label}`)
  console.log(`    status  : ${wf?.status}`)
  console.log(`    aliases : ${(wf?.aliases ?? []).join(' · ') || '(aucun)'}`)
  console.log(`    occurrences totales : ${occFinal ?? 0}`)

  // Résumé PETRO complet
  const { data: remaining } = await sb
    .from('canonical_subject')
    .select('id, label, status')
    .eq('site_id', SITE)
    .order('label')
  console.log(`\n  Sujets PETRO (${(remaining ?? []).filter((r: { status: string }) => r.status === 'active').length} actifs) :`)
  for (const r of remaining ?? []) {
    const row = r as { id: string; label: string; status: string }
    if (row.status === 'active') console.log(`    [actif]  ${row.label}`)
    else if (row.status === 'merged') console.log(`    [merged] ${row.label}`)
  }
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1) })
