// scripts/dev/cleanup-resonance-test.ts
//
// Nettoie les artefacts de test résonance (B1/B2) qui pourraient pointer
// vers des sites soft-deleted (cf. incident 2026-05-20 : on a écrit dans
// le site "CHT bloc A" qui était deleted_at non null depuis 4 jours).
//
// Trois gestes conservateurs :
//
//  1. document_links pointant vers des sites soft-deleted → DELETE.
//     (Un lien vers un site mort ne sert plus à rien et fait passer les
//     filtres AMONT de B1/B2 alors qu'aucune lecture site n'est rendue.)
//
//  2. site_reading_candidates sur sites soft-deleted, algo b%_doc_%,
//     status='active' → status='stale'. (Préserve l'historique de ce qui
//     a été produit, ne re-render plus.)
//
//  3. site_notes sur sites soft-deleted dont le body matche nos
//     signatures de test ('Test résonance%' OU 'Nettoyage locaux du
//     couloir%') ET non encore deleted → soft-delete (deleted_at=now()).
//     Strictement conservateur : on ne touche PAS les autres notes
//     présentes sur ces sites morts (elles peuvent venir d'autres tests).
//
// Idempotent : ré-exécution sans effet si rien à nettoyer.
//
// Usage : npx tsx scripts/dev/cleanup-resonance-test.ts

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'

async function main() {
  const supabase = createAdminClient()

  // Liste des sites soft-deleted
  const { data: deadSites } = await supabase
    .from('sites')
    .select('id, name')
    .not('deleted_at', 'is', null)
  const deadIds = (deadSites ?? []).map((s) => (s as { id: string }).id)
  if (deadIds.length === 0) {
    console.log('Aucun site soft-deleted. Rien à nettoyer.')
    return
  }
  console.log(`Sites soft-deleted détectés : ${deadIds.length}`)
  for (const s of deadSites ?? []) {
    const r = s as { id: string; name: string }
    console.log(`  · ${r.id} → ${r.name}`)
  }

  // 1. document_links pointant vers ces sites → DELETE
  const { data: linksToDelete } = await supabase
    .from('document_links')
    .select('document_id, target_id')
    .eq('target_type', 'site')
    .in('target_id', deadIds)
  const nLinks = (linksToDelete ?? []).length
  if (nLinks > 0) {
    await supabase
      .from('document_links')
      .delete()
      .eq('target_type', 'site')
      .in('target_id', deadIds)
    console.log(`\n[1] document_links supprimés : ${nLinks}`)
  } else {
    console.log('\n[1] document_links : rien à nettoyer.')
  }

  // 2. résonances actives B1/B2 sur sites morts → 'stale'
  const { data: candidates } = await supabase
    .from('site_reading_candidates')
    .select('id')
    .in('site_id', deadIds)
    .like('algorithm_version', 'b%_doc_%')
    .eq('status', 'active')
  const candidateIds = (candidates ?? []).map((c) => (c as { id: string }).id)
  if (candidateIds.length > 0) {
    await supabase
      .from('site_reading_candidates')
      .update({ status: 'stale' })
      .in('id', candidateIds)
    console.log(`[2] résonances B1/B2 actives → 'stale' : ${candidateIds.length}`)
  } else {
    console.log(`[2] résonances B1/B2 : rien à staler.`)
  }

  // 3. notes test sur sites morts → soft-delete
  const { data: testNotes } = await supabase
    .from('site_notes')
    .select('id, body')
    .in('site_id', deadIds)
    .is('deleted_at', null)
  const noteIdsToDelete = (testNotes ?? [])
    .filter((n) => {
      const body = (n as { body: string }).body
      return body.startsWith('Test résonance') || body.startsWith('Nettoyage locaux du couloir')
    })
    .map((n) => (n as { id: string }).id)
  if (noteIdsToDelete.length > 0) {
    await supabase
      .from('site_notes')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', noteIdsToDelete)
    console.log(`[3] notes test soft-deleted : ${noteIdsToDelete.length}`)
  } else {
    console.log(`[3] notes test : rien à nettoyer.`)
  }

  console.log('\n✓ Cleanup terminé.')
}

main().catch((e) => {
  console.error('[cleanup-resonance-test] erreur:', e)
  process.exit(1)
})
