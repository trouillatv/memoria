/**
 * Applique les fusions identifiées par dedup-intra-topic.ts — session 2026-08-10
 *
 * Fusionne chaque paire en réutilisant la logique de mergeCanonicalSubjectsAction :
 * - winner = sujet avec le plus de subject_thread_identity
 * - STI + occurrences reroutés vers le winner
 * - loser marqué status='merged', journal canonical_subject_merge créé
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/apply-dedup-merges.ts [--dry-run]
 */

import { createClient } from '@supabase/supabase-js'

const DRY_RUN = process.argv.includes('--dry-run')
const SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

function sep(label: string) {
  console.log(`\n${'─'.repeat(60)}\n${label}\n${'─'.repeat(60)}`)
}

// ── Logique de fusion (portage de merge-actions.ts) ───────────────────────────

async function merge(
  aId: string,
  bId: string,
  suggestedLabel: string,
): Promise<{ winnerId?: string; loserId?: string; error?: string }> {
  // 1. Thread counts
  const [{ count: cA }, { count: cB }] = await Promise.all([
    sb.from('subject_thread_identity').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', aId),
    sb.from('subject_thread_identity').select('*', { count: 'exact', head: true }).eq('canonical_subject_id', bId),
  ])

  const winnerId = (cA ?? 0) >= (cB ?? 0) ? aId : bId
  const loserId = winnerId === aId ? bId : aId

  // 2. Données courantes
  const [{ data: winnerData }, { data: loserData }] = await Promise.all([
    sb.from('canonical_subject').select('label, aliases, status').eq('id', winnerId).maybeSingle(),
    sb.from('canonical_subject').select('label, aliases, status').eq('id', loserId).maybeSingle(),
  ])

  if (!winnerData || !loserData) return { error: 'Sujet introuvable' }
  const w = winnerData as { label: string; aliases: string[]; status: string }
  const l = loserData as { label: string; aliases: string[]; status: string }

  if (l.status === 'merged') return { error: `Loser "${l.label}" déjà fusionné` }
  if (w.status === 'merged') return { error: `Winner "${w.label}" déjà fusionné` }

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] winner="${w.label}" ← loser="${l.label}" → label final="${suggestedLabel || w.label}"`)
    return { winnerId, loserId }
  }

  // 3. IDs entités à déplacer
  const [{ data: stiRows }, { data: occRows }] = await Promise.all([
    sb.from('subject_thread_identity').select('subject_thread_id').eq('canonical_subject_id', loserId),
    sb.from('canonical_subject_occurrence').select('id').eq('canonical_subject_id', loserId),
  ])
  const movedThreadIds = ((stiRows ?? []) as Array<{ subject_thread_id: string }>).map((r) => r.subject_thread_id)
  const movedOccurrenceIds = ((occRows ?? []) as Array<{ id: string }>).map((r) => r.id)

  // 4. Reroutage STI
  if (movedThreadIds.length > 0) {
    const { error } = await sb.from('subject_thread_identity').update({ canonical_subject_id: winnerId }).eq('canonical_subject_id', loserId)
    if (error) return { error: `STI: ${error.message}` }
  }

  // 5. Reroutage occurrences
  if (movedOccurrenceIds.length > 0) {
    const { error } = await sb.from('canonical_subject_occurrence').update({ canonical_subject_id: winnerId }).eq('canonical_subject_id', loserId)
    if (error) return { error: `Occ: ${error.message}` }
  }

  // 6. Marquer loser
  const { error: loserErr } = await sb.from('canonical_subject').update({ status: 'merged', merged_into: winnerId }).eq('id', loserId)
  if (loserErr) return { error: `Loser: ${loserErr.message}` }

  // 7. Retirer loser du topic
  await sb.from('canonical_topic_subject').delete().eq('canonical_subject_id', loserId)

  // 8. Journal
  const finalLabel = suggestedLabel.trim() || w.label
  const snapshot = {
    moved_thread_ids: movedThreadIds,
    moved_occurrence_ids: movedOccurrenceIds,
    winner_label_before: w.label,
    winner_aliases_before: w.aliases ?? [],
    loser_label: l.label,
    loser_aliases: l.aliases ?? [],
  }
  const { error: journalErr } = await sb.from('canonical_subject_merge').insert({
    winner_subject_id: winnerId,
    loser_subject_id: loserId,
    suggested_label: finalLabel !== w.label ? finalLabel : null,
    resolution_source: 'manual',
    snapshot,
  })
  if (journalErr) return { error: `Journal: ${journalErr.message}` }

  // 9. Mise à jour winner
  const combinedAliases = Array.from(new Set([
    ...(w.aliases ?? []),
    l.label,
    ...(l.aliases ?? []),
    ...(finalLabel !== w.label ? [w.label] : []),
  ])).filter((a) => a !== finalLabel)

  const { error: winnerErr } = await sb.from('canonical_subject').update({ label: finalLabel, aliases: combinedAliases }).eq('id', winnerId)
  if (winnerErr) return { error: `Winner: ${winnerErr.message}` }

  return { winnerId, loserId }
}

// ── Paires à fusionner ────────────────────────────────────────────────────────

// Note : les ID dynamiques (issus d'un merge précédent) sont résolus à l'exécution.
// Pour les clusters de 3+, on enchaîne avec le winnerId retourné.

async function main() {
  if (DRY_RUN) console.log('\n⚡ DRY-RUN — aucune écriture en base\n')

  let ok = 0
  let skip = 0

  async function applyMerge(
    label: string,
    aId: string,
    bId: string,
    suggestedLabel = '',
  ): Promise<string | null> {
    console.log(`\n▸ ${label}`)
    const result = await merge(aId, bId, suggestedLabel)
    if (result.error) {
      console.log(`  SKIP : ${result.error}`)
      skip++
      return null
    }
    console.log(`  ✓ winner=${result.winnerId?.slice(0, 8)} loser=${result.loserId?.slice(0, 8)}`)
    ok++
    return result.winnerId ?? null
  }

  sep('Essais béton (3 sujets → 1)')
  const essaisW1 = await applyMerge(
    '[98%] Essais béton éprouvette à prévoir ↔ Prévoir essais béton',
    '76bb60a9-25aa-45dd-bcd9-688e8072a452',
    '6b47bbb2-b573-4193-8b7a-8ffc30163c14',
    'Essais béton (éprouvette ou carottage)',
  )
  if (essaisW1) {
    await applyMerge(
      '[90%] Essais sur les bétons à faire ↔ Essais béton éprouvette',
      '20c990b9-639e-42b2-adb1-7363ca025a7e',
      essaisW1,
      'Essais béton (éprouvette ou carottage)',
    )
  }

  sep('Reprise nivellement VISA')
  await applyMerge(
    '[95%] Reprise nivellement VISA 01.004 ↔ Reprise nivellement VISA',
    'cf50330e-1245-46db-ac9f-f4967f80fe78',
    'dcb3219c-47f0-4017-b5b4-83500f7d3c40',
    'Reprise du nivellement suivant plan annexé au VISA 01.004',
  )

  sep('Reprise nivellement zone hors tolérance')
  await applyMerge(
    '[90%] Reprise nivellement zone HT (versions longue/courte)',
    '887f3a40-dca5-4ac0-b42f-be3aff0a6e7f',
    'b766e7a2-caf8-49e1-9369-e2a7fe47aea3',
    'Reprise du nivellement – zone hors tolérance',
  )

  sep('Coordination réseaux sous-dalle')
  await applyMerge(
    '[95%] Prévision Coordination réseaux sous-dalle ↔ Coordination LOT01/LOT02',
    'a79264a0-aa3e-4a79-ab1d-1de7d4c5533c',
    '3b344221-0042-4bf1-a8bb-46a50154539f',
    'Coordination réseaux sous-dalle (LOT01 & LOT02)',
  )

  sep('Transmission FT')
  await applyMerge(
    '[90%] Transmission FT éléments assainissement ↔ Transmission FT Matériaux & Équipements',
    'a86a6d9b-1a39-4573-98d5-9955bc229c35',
    '9e7bc5cb-0ee2-4eed-a8f5-2a9d1f47f593',
    'Transmission FT Matériaux & Équipements',
  )

  sep('Nettoyage accès / Propreté abords')
  await applyMerge(
    '[90%] Nettoyage et entretien des accès ↔ Propreté générale des abords',
    '5ca1a7d2-c6d4-4115-8028-068bf0fe784f',
    'ea243617-cca2-4e78-9d83-915260c7e91b',
    'Nettoyage et entretien des accès',
  )

  sep('Déshuileur')
  await applyMerge(
    '[90%] Débourbeur déshuileur ↔ Zone déshuileur (largeur, contrôle caméra)',
    'ce73b108-c4f1-486b-b421-338d44e0943c',
    '53c64ebf-0087-4bbc-9686-413023fae68b',
    'Zone déshuileur',
  )

  sep('Fiches techniques cluster (4 sujets → 1)')
  const ftW1 = await applyMerge(
    '[95%] Demande FT plans global ↔ Fiche Technique Dégrilleur',
    '99c2ed5e-c79e-4711-8192-f106a9e20b00',
    '12fa1b0e-e7cb-47dd-9a13-870e04f97e00',
    'Demande de FT et plans – Débitmètre, Dégrilleur, Regards',
  )
  let ftW2 = ftW1
  if (ftW1) {
    ftW2 = await applyMerge(
      '[95%] + Fiche Technique Débitmètre',
      ftW1,
      '14b655b0-e0e7-4a49-b82c-d70dc3a968b2',
    ) ?? ftW1
  }
  if (ftW2) {
    await applyMerge(
      '[90%] + Plans de Détail Dégrilleur & Débitmètre',
      ftW2,
      '34973091-1a19-47f0-a08d-e49de94cd2c6',
    )
  }

  sep('Délai de réalisation')
  await applyMerge(
    '[95%] Délai de 8 mois ↔ Délai de réalisation du marché',
    '3a7ae2e0-a4fc-4b27-9fe2-f442b764166f',
    '002b013b-f469-49f3-ac6c-b35bf137c154',
    'Délai de réalisation du marché',
  )

  sep('Mise en place couche de forme')
  await applyMerge(
    '[95%] Mise en place GNT Plateforme ↔ Mise en place Couche de Forme',
    'a8cc5730-d0b9-4f2a-80ed-36593024607c',
    'd9bb24b2-d51a-41db-a270-c934d3d4cec4',
    'Mise en place couche de forme (GNT)',
  )

  sep('Résumé')
  console.log(`${ok} fusion(s) appliquée(s), ${skip} ignorée(s)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
