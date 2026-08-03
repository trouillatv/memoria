/**
 * Merges manuels OCEF — consolidation des canonical_subjects fragmentés.
 *
 * Règles :
 *   - Ne jamais merger entre sites (Compostage ≠ OCEF6).
 *   - G3 → deux sous-sujets distincts : purge complémentaire / essais dalle.
 *   - Lagunage → deux sous-sujets distincts : busage / raccordement.
 *   - Couche de forme → pas de merge (test négatif préservé).
 *   - Débourbeur → un seul sujet (FT + mise en place = continuité du même équipement).
 *   - R4 → un seul sujet par site.
 *
 * Mécanique :
 *   1. subject_thread_identity : remapper tous les threads des perdants → gagnant.
 *   2. canonical_subject perdants : status='merged', merged_into=winner_id.
 *   3. canonical_subject gagnant : nouveau label + anciens labels ajoutés aux aliases.
 *
 * Passer DRY_RUN=false pour exécuter réellement.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const DRY_RUN = process.argv.includes('--execute') ? false : true

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const COMPOSTAGE = '2c939e67-e986-4635-86a0-638cda870480'
const OCEF6     = '655edb00-032d-4379-b76d-d598c2c7c254'

interface MergeGroup {
  note: string
  siteId: string
  winnerId: string
  newLabel: string
  loserIds: string[]
}

const MERGE_PLAN: MergeGroup[] = [
  // ── OCEF Compostage ───────────────────────────────────────────────────────
  {
    note: 'R4 Compostage : même regard, même défaut, même résolution',
    siteId: COMPOSTAGE,
    winnerId: '4fb967c3-4432-4bc2-9e47-e626fcd6fa84',
    newLabel: 'Regard R4',
    loserIds: [
      'bba40ef0-3192-4aae-ac63-f95be8790926', // Reprise du réseau … prévue fin de semaine 28
      '024dab7e-16d9-4927-bedc-f92c5ac89a64', // Prévision : Reprise … y compris le weekend
      'd8861786-2f44-461c-bf57-e873336ac9ea', // Regard R4 chute manquante repris
      '858a9f11-3190-49e6-ad06-584fb0027b15', // Problème regard R4 manque Chute
    ],
  },
  {
    note: 'Débourbeur Compostage : FT + mise en place = continuité du même équipement',
    siteId: COMPOSTAGE,
    winnerId: 'ce73b108-c4f1-486b-b421-338d44e0943c',
    newLabel: 'Débourbeur déshuileur',
    loserIds: [
      '7c9b287a-979e-4dd8-a1f6-7c8ddc9bb8b3', // FT à retransmettre (non conforme)
      '27384e81-bbd2-4138-bc4a-653170e479b0', // FT transmise non conforme
      '0e8a3996-0610-421d-898c-199af6536684', // FT retransmis le 27.04 conforme
      '966af6f5-9fae-4a9b-8bcb-89983f87ed71', // Fiche technique conforme
      'deeff5d1-0b80-4d30-8527-64e62eff4e23', // Mise en place Débourbeur déshuileur
    ],
  },
  {
    note: 'Lagunage Compostage – Busage : non-conformité de largeur, même réserve physique',
    siteId: COMPOSTAGE,
    winnerId: 'f74148ab-d783-4dee-9022-65d218e5ac8b',
    newLabel: 'Busage plateforme-lagunage',
    loserIds: [
      '00666bca-81da-4778-9cad-11e694376ec2', // Zone de largeur non conforme (réserve)
      '541b54fa-b6a9-47b2-91a5-7884f9bdb8eb', // Zone de largeur non conforme (réserve doublée)
    ],
  },
  {
    note: 'Lagunage Compostage – Raccordement : validation MOA/MOE, même sujet',
    siteId: COMPOSTAGE,
    winnerId: '2bff30b9-8298-4363-89db-45f12eb8c0bd',
    newLabel: 'Raccordement sur le lagunage',
    loserIds: [
      '4d43c82d-3ba1-4310-b609-7eca698f095c', // fera l'objet d'une validation MOA/MOE
      '185865b3-351a-49a0-92af-c0c61bd2652e', // Raccordement sur le lagunage (générique)
      'b93fafd9-dd27-48bb-babb-094c33e23f53', // Validation raccordement lagunage (short)
    ],
  },
  {
    note: 'G3 Compostage – Purge complémentaire : même rapport, même demande répétée',
    siteId: COMPOSTAGE,
    winnerId: '00f7763e-5050-4f35-8936-6ff312400b9e',
    newLabel: 'Rapport G3 — purge complémentaire',
    loserIds: [
      'e8833650-3446-45fe-a213-10579f9df3b3', // Rapport G3 de purge complémentaire en attente
      'a3a9af08-6e50-4cfe-a87c-dbe791d8ef28', // Transmission photos et rapport G3 purge
      'd1d85bd7-cad9-4ade-80ac-b6cccc98acbf', // Transmission (RAPPELx6)
      '53b45bc9-d877-4cc5-ae4b-b0a47b44f232', // Purge complémentaire réalisée, rapport en attente
    ],
  },
  {
    note: 'G3 Compostage – Essais dalle : même avis, formulations légèrement différentes',
    siteId: COMPOSTAGE,
    winnerId: '714cf080-6970-40bc-87a8-a6777e90c8a5',
    newLabel: 'Avis G3 — essais plateforme support de dalle',
    loserIds: [
      '81909038-8a08-48e9-833f-821c766645cc', // Avis G3 sur les essais (action)
      '0b28e520-6935-49cc-9958-ed083a218a86', // Avis G3 sur les essais (action, bis)
    ],
  },

  // ── OCEF6 ─────────────────────────────────────────────────────────────────
  {
    note: 'R4 OCEF6 : reprise + relevé = même regard résolu',
    siteId: OCEF6,
    winnerId: '21cc0968-a5b9-42b5-a165-d3b6464b0c0d',
    newLabel: 'Regard R4',
    loserIds: [
      '45d109fe-569b-45b6-a4fc-8aee71ef6eaf', // Relevé Assainissement R4
    ],
  },
  {
    note: 'Débourbeur OCEF6 : FT en cours → conforme, même équipement',
    siteId: OCEF6,
    winnerId: '7324ef60-12c3-4b02-89bb-906325c0de21',
    newLabel: 'Débourbeur déshuileur',
    loserIds: [
      '8510ce66-63eb-4180-bd4a-d55577742962', // FT Débourbeur déshuileur (in_progress)
    ],
  },
  {
    note: 'G3 OCEF6 – Purge : mêmes transmissions, même rapport en attente',
    siteId: OCEF6,
    winnerId: 'addb4427-6c48-41ed-885a-f1501e06107c',
    newLabel: 'Rapport G3 — purge complémentaire',
    loserIds: [
      '7ce0f89e-8caa-482c-80df-68e1dce0d494', // Rapport G3 pour purge en attente
      '9e63f9df-7a93-4fc3-9f6b-daa134f32a7d', // Purge complémentaire et rapport G3
    ],
  },
  {
    note: 'Lagunage OCEF6 – Raccordement : validation = continuation du raccordement',
    siteId: OCEF6,
    winnerId: '5b79d36a-a7d7-45b1-82e9-23cd3fad31f0',
    newLabel: 'Raccordement sur le lagunage',
    loserIds: [
      '503777da-a2a9-417b-b45a-49aeb2684e49', // Validation raccordement lagunage
    ],
  },
  // Couche de forme : AUCUN MERGE (test négatif préservé)
  // 6130211c "Avis G3 — essais dalle OCEF6" : isolé, pas de doublon
  // 04ca824f "Busage plateforme-lagunage OCEF6" : isolé, pas de doublon
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function applyMerge(group: MergeGroup) {
  console.log(`\n  → ${group.note}`)

  // Récupérer les labels des perdants (pour les aliases)
  const { data: loserRows } = await sb
    .from('canonical_subject')
    .select('id, label, aliases')
    .in('id', group.loserIds)

  const { data: winnerRow } = await sb
    .from('canonical_subject')
    .select('id, label, aliases')
    .eq('id', group.winnerId)
    .maybeSingle()

  if (!winnerRow) { console.log('    ✗ winner introuvable, skip'); return }

  const winner = winnerRow as { id: string; label: string; aliases: string[] }
  const losers = (loserRows ?? []) as Array<{ id: string; label: string; aliases: string[] }>

  // Construire le set d'aliases : anciens labels + anciens aliases de tous
  const allAliases = new Set<string>([
    ...(winner.aliases ?? []),
    winner.label, // l'ancien label du winner devient alias
    ...losers.flatMap((l) => [l.label, ...(l.aliases ?? [])]),
  ])
  allAliases.delete(group.newLabel) // le nouveau label principal ne doit pas être dans les aliases

  const newAliases = [...allAliases].filter((a) => a !== group.newLabel)

  console.log(`    winner  : ${winner.label} → "${group.newLabel}"`)
  for (const l of losers) console.log(`    perdant : ${l.label}`)
  console.log(`    aliases : ${newAliases.length} entrées`)

  if (DRY_RUN) { console.log('    [DRY_RUN] Aucune écriture.'); return }

  // 1. Remapper les threads des perdants → winner
  const { error: stiError } = await sb
    .from('subject_thread_identity')
    .update({ canonical_subject_id: group.winnerId, source: 'manual' })
    .in('canonical_subject_id', group.loserIds)
  if (stiError) { console.log(`    ✗ STI update : ${stiError.message}`); return }

  // 2. Marquer les perdants comme merged
  const { error: loserError } = await sb
    .from('canonical_subject')
    .update({ status: 'merged', merged_into: group.winnerId })
    .in('id', group.loserIds)
  if (loserError) { console.log(`    ✗ Loser update : ${loserError.message}`); return }

  // 3. Mettre à jour le winner (nouveau label + aliases)
  const { error: winnerError } = await sb
    .from('canonical_subject')
    .update({ label: group.newLabel, aliases: newAliases })
    .eq('id', group.winnerId)
  if (winnerError) { console.log(`    ✗ Winner update : ${winnerError.message}`); return }

  console.log('    ✓ ok')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mode = DRY_RUN ? 'DRY-RUN (passer --execute pour écrire)' : 'EXÉCUTION RÉELLE'
  console.log(`\n══ Merges OCEF — ${mode} ══`)
  console.log(`${MERGE_PLAN.length} groupes à traiter\n`)

  // Vérifier que tous les IDs existent et appartiennent aux bons sites
  console.log('Vérification des IDs...')
  const allIds = MERGE_PLAN.flatMap((g) => [g.winnerId, ...g.loserIds])
  const { data: csCheck } = await sb
    .from('canonical_subject')
    .select('id, label, status, site_id')
    .in('id', allIds)

  const csMap = new Map(
    ((csCheck ?? []) as Array<{ id: string; label: string; status: string; site_id: string }>)
      .map((r) => [r.id, r]),
  )

  let valid = true
  for (const group of MERGE_PLAN) {
    for (const id of [group.winnerId, ...group.loserIds]) {
      const cs = csMap.get(id)
      if (!cs) { console.log(`  ✗ ID inconnu : ${id}`); valid = false; continue }
      if (cs.site_id !== group.siteId) { console.log(`  ✗ Mauvais site pour ${id} (${cs.label})`); valid = false }
      if (cs.status === 'merged') { console.log(`  ⚠ Déjà mergé : ${id} (${cs.label})`) }
    }
  }

  if (!valid) { console.log('\n✗ Validation échouée — arrêt.'); process.exit(1) }
  console.log('  ✓ Tous les IDs valides\n')

  for (const group of MERGE_PLAN) {
    await applyMerge(group)
  }

  console.log('\n══ Terminé ══')

  if (!DRY_RUN) {
    // Vérification post-merge : compter les actifs restants par sujet
    console.log('\nVérification post-merge (canonical_subjects actifs sur OCEF) :')
    const { data: active } = await sb
      .from('canonical_subject')
      .select('id, label, site_id')
      .in('site_id', [COMPOSTAGE, OCEF6])
      .eq('status', 'active')
    console.log(`  Actifs restants : ${active?.length ?? 0}`)
  }
}

main().catch(console.error)
