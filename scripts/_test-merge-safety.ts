// _test-merge-safety.ts
// P1-5A.1 — Validation de la sécurité du chemin de merge avec données synthétiques.
//
// Ce script crée des canonical_subject + canonical_subject_links synthétiques
// sur le site OCEF (site de référence), exécute des fusions via la fonction SQL
// merge_canonical_subjects() et valide les 6 scénarios du gate P1-5A.1 :
//
//   ✓ Scénario 0 — merge sans lien       : aucune erreur, 0 lien touché
//   ✓ Scénario 1 — lien sortant du loser  : rerouté vers winner
//   ✓ Scénario 2 — lien entrant vers loser : rerouté vers winner
//   ✓ Scénario 3 — self-link résultant     : supprimé
//   ✓ Scénario 4 — duplicate résultant     : supprimé (winner conservé)
//   ✓ Scénario 5 — second passage = no-op  : aucun nouveau merge
//   ✓ Gate journal                         : mergeWithJournal écrit tous les champs
//
// MODE DESTRUCTIF CONTRÔLÉ : crée puis supprime des enregistrements synthétiques.
// Tous les IDs sont générés aléatoirement. Le cleanup est inconditionnel en fin de run.
//
// Usage : npx tsx scripts/_test-merge-safety.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { mergeWithJournal } from '../lib/db/canonical-subject-merge'

const OCEF_SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'
const ENGINE_VERSION = 'merge-safety-test-v1'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// ── Helpers ───────────────────────────────────────────────────────────────────

let createdCsIds: string[] = []
let createdLinkIds: string[] = []
let createdMergeJournalIds: string[] = []

async function createCs(label: string): Promise<string> {
  const { data, error } = await sb
    .from('canonical_subject')
    .insert({ site_id: OCEF_SITE_ID, label, aliases: [], status: 'active' })
    .select('id')
    .single()
  if (error) throw new Error(`createCs(${label}): ${error.message}`)
  createdCsIds.push(data.id)
  return data.id
}

async function createLink(sourceId: string, targetId: string, relationType = 'requires'): Promise<string> {
  const { data, error } = await sb
    .from('canonical_subject_links')
    .insert({
      site_id: OCEF_SITE_ID,
      source_subject_id: sourceId,
      target_subject_id: targetId,
      relation_type: relationType,
      status: 'confirmed',
      justification: '_test-merge-safety synthetic link',
    })
    .select('id')
    .single()
  if (error) throw new Error(`createLink(${sourceId}→${targetId}): ${error.message}`)
  createdLinkIds.push(data.id)
  return data.id
}

async function getLink(id: string) {
  const { data } = await sb.from('canonical_subject_links').select('*').eq('id', id).maybeSingle()
  return data
}

async function getCsStatus(id: string): Promise<string | null> {
  const { data } = await sb.from('canonical_subject').select('status, merged_into').eq('id', id).maybeSingle()
  return data?.status ?? null
}

async function linkCount(subjectId: string): Promise<number> {
  const [{ count: c1 }, { count: c2 }] = await Promise.all([
    sb.from('canonical_subject_links').select('*', { count: 'exact', head: true }).eq('source_subject_id', subjectId),
    sb.from('canonical_subject_links').select('*', { count: 'exact', head: true }).eq('target_subject_id', subjectId),
  ])
  return (c1 ?? 0) + (c2 ?? 0)
}

function pass(msg: string) { console.log(`  ✓ ${msg}`) }
function fail(msg: string) { console.error(`  ✗ FAIL: ${msg}`); process.exitCode = 1 }
function assert(cond: boolean, msg: string) { cond ? pass(msg) : fail(msg) }

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('\n[cleanup] Suppression des données synthétiques...')
  // Les liens sont supprimés en CASCADE lors de la suppression des CS (via site_id CASCADE)
  // ou directement si les CS survivent
  if (createdLinkIds.length > 0) {
    await sb.from('canonical_subject_links').delete().in('id', createdLinkIds)
  }
  if (createdCsIds.length > 0) {
    // Réactiver d'abord les 'merged' pour pouvoir supprimer (contrainte FK sur merged_into)
    await sb.from('canonical_subject')
      .update({ status: 'active', merged_into: null })
      .in('id', createdCsIds)
    await sb.from('canonical_subject').delete().in('id', createdCsIds)
  }
  if (createdMergeJournalIds.length > 0) {
    await sb.from('canonical_subject_merge').delete().in('id', createdMergeJournalIds)
  }
  console.log('[cleanup] OK')
}

// ── Scénarios ─────────────────────────────────────────────────────────────────

async function scenario0_noLinks() {
  console.log('\nScénario 0 — merge sans lien')
  const A = await createCs('[TEST-S0] Sujet A')
  const B = await createCs('[TEST-S0] Sujet B')

  const { data, error } = await sb.rpc('merge_canonical_subjects', {
    p_source_id: A,
    p_target_id: B,
  })
  assert(!error, `merge sans erreur`)
  assert(data?.linksMoved === 0, `linksMoved = 0 (got ${data?.linksMoved})`)
  assert(data?.selfLinksDeleted === 0, `selfLinksDeleted = 0`)
  assert(data?.duplicateLinksDeleted === 0, `duplicateLinksDeleted = 0`)
  assert(await getCsStatus(A) === 'merged', `A marqué merged`)
  assert(await getCsStatus(B) === 'active', `B reste active (winner)`)
}

async function scenario1_outgoingLink() {
  console.log('\nScénario 1 — lien sortant du loser rerouté')
  const Loser = await createCs('[TEST-S1] Loser')
  const Winner = await createCs('[TEST-S1] Winner')
  const Third = await createCs('[TEST-S1] Third')

  // Loser → Third (lien sortant du loser)
  const linkId = await createLink(Loser, Third)

  const { data, error } = await sb.rpc('merge_canonical_subjects', {
    p_source_id: Loser,
    p_target_id: Winner,
  })
  assert(!error, `merge sans erreur`)
  assert(data?.linksMoved === 1, `linksMoved = 1 (got ${data?.linksMoved})`)

  const link = await getLink(linkId)
  assert(link !== null, `lien toujours présent`)
  assert(link?.source_subject_id === Winner, `source reroutée vers Winner`)
  assert(link?.target_subject_id === Third, `target (Third) inchangée`)
}

async function scenario2_incomingLink() {
  console.log('\nScénario 2 — lien entrant vers loser rerouté')
  const Loser = await createCs('[TEST-S2] Loser')
  const Winner = await createCs('[TEST-S2] Winner')
  const Third = await createCs('[TEST-S2] Third')

  // Third → Loser (lien entrant vers loser)
  const linkId = await createLink(Third, Loser)

  const { data, error } = await sb.rpc('merge_canonical_subjects', {
    p_source_id: Loser,
    p_target_id: Winner,
  })
  assert(!error, `merge sans erreur`)
  assert(data?.linksMoved === 1, `linksMoved = 1 (got ${data?.linksMoved})`)

  const link = await getLink(linkId)
  assert(link !== null, `lien toujours présent`)
  assert(link?.source_subject_id === Third, `source (Third) inchangée`)
  assert(link?.target_subject_id === Winner, `target reroutée vers Winner`)
}

async function scenario3_selfLink() {
  console.log('\nScénario 3 — self-link résultant supprimé')
  const Loser = await createCs('[TEST-S3] Loser')
  const Winner = await createCs('[TEST-S3] Winner')

  // Loser → Winner (deviendrait Winner → Winner = self-link)
  const linkId = await createLink(Loser, Winner)

  const { data, error } = await sb.rpc('merge_canonical_subjects', {
    p_source_id: Loser,
    p_target_id: Winner,
  })
  assert(!error, `merge sans erreur`)
  assert(data?.selfLinksDeleted === 1, `selfLinksDeleted = 1 (got ${data?.selfLinksDeleted})`)
  assert(data?.linksMoved === 0, `linksMoved = 0`)

  const link = await getLink(linkId)
  assert(link === null, `self-link supprimé`)
  // Retirer de la liste de cleanup (déjà supprimé)
  createdLinkIds = createdLinkIds.filter((id) => id !== linkId)
}

async function scenario4_duplicateLink() {
  console.log('\nScénario 4 — duplicate résultant supprimé (winner conservé)')
  const Loser = await createCs('[TEST-S4] Loser')
  const Winner = await createCs('[TEST-S4] Winner')
  const Third = await createCs('[TEST-S4] Third')

  // Winner → Third (lien existant du winner)
  const winnerLinkId = await createLink(Winner, Third)
  // Loser → Third (même paire non ordonnée → duplicate après merge)
  const loserLinkId = await createLink(Loser, Third)

  const { data, error } = await sb.rpc('merge_canonical_subjects', {
    p_source_id: Loser,
    p_target_id: Winner,
  })
  assert(!error, `merge sans erreur`)
  assert(data?.duplicateLinksDeleted === 1, `duplicateLinksDeleted = 1 (got ${data?.duplicateLinksDeleted})`)
  assert(data?.linksMoved === 0, `linksMoved = 0`)

  const winnerLink = await getLink(winnerLinkId)
  assert(winnerLink !== null, `lien winner toujours présent`)
  assert(winnerLink?.source_subject_id === Winner, `winner link source = Winner`)

  const loserLink = await getLink(loserLinkId)
  assert(loserLink === null, `lien loser (duplicate) supprimé`)
  createdLinkIds = createdLinkIds.filter((id) => id !== loserLinkId)

  // Vérifier que le winner n'a qu'un seul lien avec Third
  const totalLinks = await linkCount(Winner)
  assert(totalLinks === 1, `winner a exactement 1 lien post-merge (got ${totalLinks})`)
}

async function scenario5_secondPassNoOp() {
  console.log('\nScénario 5 — second passage = no-op (merge déjà merged → erreur attendue)')
  const A = await createCs('[TEST-S5] A')
  const B = await createCs('[TEST-S5] B')

  await sb.rpc('merge_canonical_subjects', { p_source_id: A, p_target_id: B })

  // Second passage sur le même source → doit lever une erreur
  const { error } = await sb.rpc('merge_canonical_subjects', { p_source_id: A, p_target_id: B })
  assert(!!error, `second passage refuse de fusionner (erreur attendue) — got: ${error?.message ?? 'aucune erreur'}`)
  assert(
    error?.message?.includes('déjà fusionné') ?? false,
    `message d'erreur contient "déjà fusionné"`,
  )
}

async function scenarioJournal() {
  console.log('\nScénario journal — mergeWithJournal écrit tous les champs structurés')
  const Loser = await createCs('[TEST-J] Loser')
  const Winner = await createCs('[TEST-J] Winner')
  const Third = await createCs('[TEST-J] Third')
  const linkId = await createLink(Loser, Third)

  const res = await mergeWithJournal({
    sourceId: Loser,
    targetId: Winner,
    siteId: OCEF_SITE_ID,
    engineVersion: ENGINE_VERSION,
    p01Jaccard: 0.75,
    p02Confidence: 95,
    suggestedLabel: '[TEST-J] Winner fusionné',
  })
  assert(res.ok, `mergeWithJournal réussi (${res.ok ? '' : ('error' in res ? res.error : '')} )`)

  if (res.ok) {
    assert(res.result.linksMoved === 1, `linksMoved = 1`)

    // Vérifier le journal
    const { data: journal } = await sb
      .from('canonical_subject_merge')
      .select('*')
      .eq('loser_subject_id', Loser)
      .maybeSingle()

    if (journal) {
      createdMergeJournalIds.push(journal.id)
    }

    assert(!!journal, `journal créé`)
    assert(journal?.resolution_source === 'automatic', `resolution_source = 'automatic' (got ${journal?.resolution_source})`)
    assert(journal?.engine_version === ENGINE_VERSION, `engine_version présent`)
    assert(journal?.p01_jaccard !== null, `p01_jaccard présent (got ${journal?.p01_jaccard})`)
    assert(journal?.p02_confidence === 95, `p02_confidence = 95 (got ${journal?.p02_confidence})`)
    assert(Array.isArray(journal?.snapshot?.moved_link_ids), `snapshot.moved_link_ids présent`)
    assert(Array.isArray(journal?.snapshot?.links_snapshot_before), `snapshot.links_snapshot_before présent`)
    assert(journal?.snapshot?.links_snapshot_before?.length === 1, `links_snapshot_before contient 1 entrée`)
  }

  // Retirer le lien du cleanup si déplacé (rerouté vers winner, pas supprimé)
  // Le lien existe toujours, juste avec source = Winner
  const link = await getLink(linkId)
  assert(link?.source_subject_id === Winner, `lien rerouté vers Winner dans le journal test`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== P1-5A.1 — Gate merge safety ===')
  console.log(`  Site OCEF : ${OCEF_SITE_ID}`)
  console.log('  MODE : création + suppression de données synthétiques')
  console.log()

  try {
    await scenario0_noLinks()
    await scenario1_outgoingLink()
    await scenario2_incomingLink()
    await scenario3_selfLink()
    await scenario4_duplicateLink()
    await scenario5_secondPassNoOp()
    await scenarioJournal()
  } finally {
    await cleanup()
  }

  console.log()
  if (process.exitCode === 1) {
    console.error('=== GATE FAIL — au moins un scénario a échoué ===')
  } else {
    console.log('=== GATE PASS — tous les scénarios validés ===')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
