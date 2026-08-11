// Script de fusion des canonical_subject PETRO ATITI
// Applique une fusion à la fois. --merge est OBLIGATOIRE : pas de mode "all" implicite.
//
// Usage :
//   npx tsx scripts/merge-petro-canonical.ts --merge merge-1-cadenas-acces [--dry-run]
//   npx tsx scripts/merge-petro-canonical.ts --merge merge-2-planning       [--dry-run]
//   npx tsx scripts/merge-petro-canonical.ts --merge merge-3-retard-planning [--dry-run]
//
// Séquence recommandée :
//   1. merge-1 → contrôle UI (fiche Accès sécurisé : 10 occs, FIL MÉTIER complet)
//   2. merge-2 → contrôle UI (fiche Planning : 8 occs)
//   3. merge-3 → contrôle final (8 sujets actifs)
//
// Rollback ciblé :
//   npx tsx scripts/merge-petro-rollback.ts --merge merge-1-cadenas-acces

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const SITE = '75bd3d23-d515-46bd-8de8-254495a5bade'
const DRY_RUN = process.argv.includes('--dry-run')

// IDs hardcodés depuis le dry-run du 2026-08-11 — immuables jusqu'à rollback
const MERGE_CATALOG = {
  'merge-1-cadenas-acces': {
    sourceId:    'e00596a5-91f0-4f3a-ae97-a24db8db637d',
    sourceLabel: 'Installation et présentation cadenas à code',
    targetId:    '6801ce5c-17e9-4939-93c5-175754add1f5',
    targetLabel: 'Accès sécurisé au chantier (code portail/cadenas)',
    finalLabel:  'Accès sécurisé au chantier (portail et cadenas à code)',
  },
  'merge-2-planning': {
    sourceId:    'e3d61d65-4f3f-424e-bf04-a8ee80484f26',
    sourceLabel: 'Mise à jour du planning suite à l\'avancement de la dépose',
    targetId:    '14cd6eaa-926b-4262-90fa-9a323b49f35b',
    targetLabel: 'Diffusion et complétude du planning général',
    finalLabel:  'Diffusion et mise à jour du planning général',
  },
  'merge-3-retard-planning': {
    sourceId:    '56c705a4-168e-41dc-945e-3494bf748972',
    sourceLabel: 'Retard dans l\'avancement général du chantier',
    targetId:    '14cd6eaa-926b-4262-90fa-9a323b49f35b',
    targetLabel: 'Diffusion et complétude du planning général',
    // Note : au moment de merge-3, le target est déjà renommé par merge-2.
    // L'ID est stable ; le label ici est indicatif.
    finalLabel:  'Diffusion et mise à jour du planning général',
  },
} as const

type MergeKey = keyof typeof MERGE_CATALOG

// ── Argument --merge ──────────────────────────────────────────────────────────

const mergeArg = (() => {
  const idx = process.argv.indexOf('--merge')
  return idx !== -1 ? process.argv[idx + 1] : null
})()

if (!mergeArg) {
  console.error('❌  --merge est obligatoire. Valeurs acceptées :')
  for (const k of Object.keys(MERGE_CATALOG)) console.error(`     ${k}`)
  process.exit(1)
}

if (!(mergeArg in MERGE_CATALOG)) {
  console.error(`❌  Merge inconnu : "${mergeArg}". Valeurs acceptées :`)
  for (const k of Object.keys(MERGE_CATALOG)) console.error(`     ${k}`)
  process.exit(1)
}

const MERGE = MERGE_CATALOG[mergeArg as MergeKey]

// ── Exécution ─────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log('\n⚠️  MODE DRY-RUN — aucune modification en base')

  console.log(`\n=== MERGE : ${mergeArg} ===`)
  console.log(`  "${MERGE.sourceLabel}"`)
  console.log(`  → "${MERGE.targetLabel}"`)
  console.log(`  Label final : "${MERGE.finalLabel}"`)
  console.log(`  source : ${MERGE.sourceId}`)
  console.log(`  target : ${MERGE.targetId}`)

  // Vérifier l'état courant avant de toucher quoi que ce soit
  const [{ data: srcCheck }, { data: tgtCheck }] = await Promise.all([
    sb.from('canonical_subject').select('label, status, merged_into').eq('id', MERGE.sourceId).maybeSingle(),
    sb.from('canonical_subject').select('label, status').eq('id', MERGE.targetId).maybeSingle(),
  ])

  if (!srcCheck) { console.error('❌  Source introuvable en base'); process.exit(1) }
  if (!tgtCheck) { console.error('❌  Target introuvable en base'); process.exit(1) }

  const src = srcCheck as { label: string; status: string; merged_into: string | null }
  const tgt = tgtCheck as { label: string; status: string }

  if (src.status === 'merged') {
    console.error(`❌  Source déjà fusionnée (merged_into: ${src.merged_into}) — rollback nécessaire ou merge déjà appliqué`)
    process.exit(1)
  }
  if (tgt.status === 'merged') {
    console.error('❌  Target est elle-même fusionnée — état incohérent, vérifier manuellement')
    process.exit(1)
  }

  // Compter ce qu'on va déplacer
  const [{ count: occCount }, { count: stiCount }, { count: propsCount }] = await Promise.all([
    sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', MERGE.sourceId),
    sb.from('subject_thread_identity').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', MERGE.sourceId),
    sb.from('site_knowledge_proposals').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', MERGE.sourceId),
  ])
  console.log(`\n  À déplacer : ${occCount ?? 0} occurrences, ${stiCount ?? 0} threads, ${propsCount ?? 0} proposals`)

  if (DRY_RUN) {
    console.log('  [DRY-RUN] Arrêt ici — aucune modification.\n')
    process.exit(0)
  }

  // 1. Occurrences
  const { error: occErr } = await sb
    .from('canonical_subject_occurrence')
    .update({ canonical_subject_id: MERGE.targetId })
    .eq('canonical_subject_id', MERGE.sourceId)
  if (occErr) { console.error(`❌  Erreur occurrences : ${occErr.message}`); process.exit(1) }

  // 2. Threads
  const { error: stiErr } = await sb
    .from('subject_thread_identity')
    .update({ canonical_subject_id: MERGE.targetId })
    .eq('canonical_subject_id', MERGE.sourceId)
  if (stiErr) { console.error(`❌  Erreur threads : ${stiErr.message}`); process.exit(1) }

  // 3. Proposals
  const { error: propsErr } = await sb
    .from('site_knowledge_proposals')
    .update({ canonical_subject_id: MERGE.targetId })
    .eq('canonical_subject_id', MERGE.sourceId)
  if (propsErr) { console.error(`❌  Erreur proposals : ${propsErr.message}`); process.exit(1) }

  // 4. Journal de fusion
  try {
    const [{ data: wData }, { data: lData }] = await Promise.all([
      sb.from('canonical_subject').select('label, aliases').eq('id', MERGE.targetId).maybeSingle(),
      sb.from('canonical_subject').select('label, aliases').eq('id', MERGE.sourceId).maybeSingle(),
    ])
    if (wData && lData) {
      const w = wData as { label: string; aliases: string[] }
      const l = lData as { label: string; aliases: string[] }
      await sb.from('canonical_subject_merge').insert({
        winner_subject_id: MERGE.targetId,
        loser_subject_id:  MERGE.sourceId,
        suggested_label:   MERGE.finalLabel !== w.label ? MERGE.finalLabel : null,
        resolution_source: 'manual',
        snapshot: {
          winner_label_before: w.label,
          winner_aliases_before: w.aliases ?? [],
          loser_label: l.label,
          loser_aliases: l.aliases ?? [],
          merge_context: `petro-audit-2026-08-11-${mergeArg}`,
        },
      })
    }
  } catch {
    console.warn('  ⚠️  Journal canonical_subject_merge non écrit (table absente ou erreur)')
  }

  // 5. Label et aliases fusionnés sur le target
  const [{ data: wCurr }, { data: lCurr }] = await Promise.all([
    sb.from('canonical_subject').select('label, aliases').eq('id', MERGE.targetId).maybeSingle(),
    sb.from('canonical_subject').select('label, aliases').eq('id', MERGE.sourceId).maybeSingle(),
  ])
  if (wCurr && lCurr) {
    const w = wCurr as { label: string; aliases: string[] }
    const l = lCurr as { label: string; aliases: string[] }
    const combinedAliases = Array.from(new Set([
      ...(w.aliases ?? []),
      l.label,
      ...(l.aliases ?? []),
      ...(MERGE.finalLabel !== w.label ? [w.label] : []),
    ])).filter((a) => a !== MERGE.finalLabel)
    const { error: wErr } = await sb
      .from('canonical_subject')
      .update({ label: MERGE.finalLabel, aliases: combinedAliases })
      .eq('id', MERGE.targetId)
    if (wErr) { console.error(`❌  Erreur label target : ${wErr.message}`); process.exit(1) }
  }

  // 6. Marquer source comme fusionné
  const { error: mergedErr } = await sb
    .from('canonical_subject')
    .update({ status: 'merged', merged_into: MERGE.targetId })
    .eq('id', MERGE.sourceId)
  if (mergedErr) { console.error(`❌  Erreur marquage merged : ${mergedErr.message}`); process.exit(1) }

  console.log('\n  ✅ Fusion effectuée')

  // Résumé post-merge
  const { data: remaining } = await sb
    .from('canonical_subject')
    .select('label, status')
    .eq('site_id', SITE)
    .order('label')
  console.log('\nSujets PETRO après cette fusion :')
  for (const r of remaining ?? []) {
    const row = r as { label: string; status: string }
    console.log(`  [${row.status}] ${row.label}`)
  }
}

main().catch((e) => {
  console.error('\n❌ ERREUR :', e.message)
  process.exit(1)
})
