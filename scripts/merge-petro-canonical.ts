// Script de fusion des canonical_subject PETRO ATITI
// Applique les 3 corrections identifiées lors de l'audit du 2026-08-11 :
//
//   1. Installation cadenas → Accès sécurisé au chantier
//      (fragmentation : même histoire, deux canonical créés)
//
//   2. Mise à jour planning → Diffusion et complétude du planning
//      (fragmentation + misattribution : contenu 20/07 mal labellisé)
//
//   3. Retard général → Diffusion et complétude du planning
//      (dissolution : état transversal, pas un sujet autonome)
//
// Usage : npx tsx scripts/merge-petro-canonical.ts [--dry-run]

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const SITE = '75bd3d23-d515-46bd-8de8-254495a5bade'
const DRY_RUN = process.argv.includes('--dry-run')

if (DRY_RUN) console.log('\n⚠️  MODE DRY-RUN — aucune modification en base\n')

async function fetchSubjectId(label: string): Promise<string> {
  const { data, error } = await sb
    .from('canonical_subject')
    .select('id, label, status')
    .eq('site_id', SITE)
    .ilike('label', `%${label}%`)

  if (error) throw new Error(`Erreur fetch: ${error.message}`)
  if (!data || data.length === 0) throw new Error(`Sujet introuvable : "${label}"`)

  const active = (data as Array<{ id: string; label: string; status: string }>).filter((r) => r.status === 'active')
  if (active.length === 0) throw new Error(`Aucun sujet actif trouvant : "${label}" — ${JSON.stringify(data.map(r => r.label))}`)
  if (active.length > 1) {
    console.warn(`  ⚠️  Plusieurs sujets actifs trouvés pour "${label}" :`)
    for (const r of active) console.warn(`    - ${r.id} | ${r.label}`)
    throw new Error('Ambiguïté — préciser la recherche')
  }

  return active[0].id
}

async function mergeSubjectById(
  sourceId: string,
  sourceLabel: string,
  targetId: string,
  targetLabel: string,
  finalLabel: string,
) {
  console.log(`\n──────────────────────────────────`)
  console.log(`MERGE : "${sourceLabel}" → "${targetLabel}"`)
  console.log(`Label final : "${finalLabel}"`)
  console.log(`  source : ${sourceId}`)
  console.log(`  target : ${targetId}`)

  if (sourceId === targetId) throw new Error('source === target')

  // Compter ce qu'on va déplacer
  const [{ count: occCount }, { count: stiCount }, { count: propsCount }] = await Promise.all([
    sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', sourceId),
    sb.from('subject_thread_identity').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', sourceId),
    sb.from('site_knowledge_proposals').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', sourceId),
  ])
  console.log(`  À déplacer : ${occCount ?? 0} occurrences, ${stiCount ?? 0} threads, ${propsCount ?? 0} proposals`)

  if (DRY_RUN) {
    console.log('  [DRY-RUN] Aucune modification.')
    return
  }

  // 1. Occurrences
  const { error: occErr } = await sb
    .from('canonical_subject_occurrence')
    .update({ canonical_subject_id: targetId })
    .eq('canonical_subject_id', sourceId)
  if (occErr) throw new Error(`Erreur occurrences: ${occErr.message}`)

  // 2. Threads
  const { error: stiErr } = await sb
    .from('subject_thread_identity')
    .update({ canonical_subject_id: targetId })
    .eq('canonical_subject_id', sourceId)
  if (stiErr) throw new Error(`Erreur threads: ${stiErr.message}`)

  // 3. Proposals
  const { error: propsErr } = await sb
    .from('site_knowledge_proposals')
    .update({ canonical_subject_id: targetId })
    .eq('canonical_subject_id', sourceId)
  if (propsErr) throw new Error(`Erreur proposals: ${propsErr.message}`)

  // 4. Journal de fusion (table canonical_subject_merge si elle existe)
  try {
    const { data: loserData } = await sb.from('canonical_subject').select('label, aliases').eq('id', sourceId).maybeSingle()
    const { data: winnerData } = await sb.from('canonical_subject').select('label, aliases').eq('id', targetId).maybeSingle()
    if (loserData && winnerData) {
      const winner = winnerData as { label: string; aliases: string[] }
      const loser = loserData as { label: string; aliases: string[] }
      await sb.from('canonical_subject_merge').insert({
        winner_subject_id: targetId,
        loser_subject_id: sourceId,
        suggested_label: finalLabel !== winner.label ? finalLabel : null,
        resolution_source: 'manual',
        snapshot: {
          moved_thread_ids: [],
          moved_occurrence_ids: [],
          winner_label_before: winner.label,
          winner_aliases_before: winner.aliases ?? [],
          loser_label: loser.label,
          loser_aliases: loser.aliases ?? [],
          merge_context: 'petro-audit-2026-08-11',
        },
      })
    }
  } catch {
    // Journal optionnel — on continue même s'il échoue
    console.warn('  ⚠️  Journal canonical_subject_merge non écrit (table absente ou erreur)')
  }

  // 5. Mettre à jour le label et les aliases du winner
  const { data: winnerCurrent } = await sb
    .from('canonical_subject')
    .select('label, aliases')
    .eq('id', targetId)
    .maybeSingle()
  const { data: loserCurrent } = await sb
    .from('canonical_subject')
    .select('label, aliases')
    .eq('id', sourceId)
    .maybeSingle()

  if (winnerCurrent && loserCurrent) {
    const w = winnerCurrent as { label: string; aliases: string[] }
    const l = loserCurrent as { label: string; aliases: string[] }
    const combinedAliases = Array.from(new Set([
      ...(w.aliases ?? []),
      l.label,
      ...(l.aliases ?? []),
      ...(finalLabel !== w.label ? [w.label] : []),
    ])).filter((a) => a !== finalLabel)

    await sb.from('canonical_subject').update({ label: finalLabel, aliases: combinedAliases }).eq('id', targetId)
  }

  // 6. Marquer source comme fusionné
  const { error: mergedErr } = await sb
    .from('canonical_subject')
    .update({ status: 'merged', merged_into: targetId })
    .eq('id', sourceId)
  if (mergedErr) throw new Error(`Erreur marquage merged: ${mergedErr.message}`)

  console.log(`  ✅ Fusion effectuée`)
}

async function main() {
  console.log('\n=== FUSION CANONICAL SUBJECTS — PETRO ATITI ===')

  // Pré-résoudre tous les IDs avant la première modification
  // (évite que le renommage du merge 2 casse la recherche du merge 3)
  const [idAcces, idCadenas, idPlanningMaj, idPlanningDiff, idRetard] = await Promise.all([
    fetchSubjectId('Accès sécurisé'),
    fetchSubjectId('Installation et présentation cadenas'),
    fetchSubjectId('Mise à jour du planning'),
    fetchSubjectId('Diffusion et complétude'),
    fetchSubjectId('Retard dans l\'avancement général'),
  ])
  console.log('\nIDs résolus :')
  console.log(`  Accès sécurisé      : ${idAcces}`)
  console.log(`  Installation cadenas: ${idCadenas}`)
  console.log(`  Mise à jour planning: ${idPlanningMaj}`)
  console.log(`  Diffusion planning  : ${idPlanningDiff}`)
  console.log(`  Retard général      : ${idRetard}`)

  // Merge 1 : Installation cadenas → Accès sécurisé
  await mergeSubjectById(
    idCadenas, 'Installation et présentation cadenas à code',
    idAcces,   'Accès sécurisé au chantier (code portail/cadenas)',
    'Accès sécurisé au chantier (portail et cadenas à code)',
  )

  // Merge 2 : Mise à jour planning → Diffusion/complétude planning
  await mergeSubjectById(
    idPlanningMaj, 'Mise à jour du planning suite à l\'avancement de la dépose',
    idPlanningDiff, 'Diffusion et complétude du planning général',
    'Diffusion et mise à jour du planning général',
  )

  // Merge 3 : Retard général → Planning (dissolution)
  await mergeSubjectById(
    idRetard, 'Retard dans l\'avancement général du chantier',
    idPlanningDiff, 'Diffusion et mise à jour du planning général',
    'Diffusion et mise à jour du planning général',
  )

  console.log('\n=== TERMINÉ ===\n')

  // Vérification finale
  const { data: remaining } = await sb
    .from('canonical_subject')
    .select('id, label, status')
    .eq('site_id', SITE)
    .order('label')
  console.log('Sujets PETRO après fusion :')
  for (const r of remaining ?? []) {
    const row = r as { id: string; label: string; status: string }
    console.log(`  [${row.status}] ${row.label}`)
  }
}

main().catch((e) => {
  console.error('\n❌ ERREUR :', e.message)
  process.exit(1)
})
