// Non-régression P0-G.1 — 2026-08-13
// Vérifie que getSiteKnowledgeGraph() après le fix 8f2dc21 :
//   1. restitue TOUTES les arêtes legacy (subject_thread_links confirmés) — corpus OCEF/PDF ;
//   2. ajoute les arêtes canonical (canonical_subject_links confirmés) — corpus terrain ;
//   3. ne duplique aucune arête (clé from:to:type unique).
//
// Usage : npx tsx scripts/verify-p0g1-nonregression.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteKnowledgeGraph } from '@/lib/documents/site-synthesis'
import { listConfirmedLinksForSite } from '@/lib/db/subject-thread-links'

async function main() {
  const db = createAdminClient()

  // Tous les sites qui ont au moins un lien (legacy ou canonical)
  const [legacyRes, canonicalRes] = await Promise.all([
    db.from('subject_thread_links').select('site_id').eq('status', 'confirmed'),
    db.from('canonical_subject_links').select('site_id').eq('status', 'confirmed'),
  ])
  if (legacyRes.error) console.error('⚠ legacy query:', legacyRes.error.message)
  if (canonicalRes.error) console.error('⚠ canonical query:', canonicalRes.error.message)
  const legacyLinks = legacyRes.data
  const canonicalLinks = canonicalRes.data

  const siteIds = [...new Set([
    ...((legacyLinks ?? []) as Array<{ site_id: string }>).map((r) => r.site_id),
    ...((canonicalLinks ?? []) as Array<{ site_id: string }>).map((r) => r.site_id),
  ])]

  if (siteIds.length === 0) {
    console.log('Aucun site avec des liens confirmés — rien à vérifier.')
    return
  }

  const { data: sites } = await db
    .from('sites')
    .select('id, name')
    .in('id', siteIds)
  const siteName = new Map(
    ((sites ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
  )

  let failures = 0

  for (const siteId of siteIds) {
    console.log(`\n=== ${siteName.get(siteId) ?? siteId} ===`)

    // ── Attendu côté legacy : liens confirmés résolus via STI, dédupliqués ──
    const rawLegacy = await listConfirmedLinksForSite(siteId)
    const threadIds = [...new Set([
      ...rawLegacy.map((l) => l.fromThreadId),
      ...rawLegacy.map((l) => l.toThreadId),
    ])]
    const { data: sti } = threadIds.length > 0
      ? await db
          .from('subject_thread_identity')
          .select('subject_thread_id, canonical_subject_id')
          .in('subject_thread_id', threadIds)
      : { data: [] }
    const threadToCS = new Map(
      ((sti ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)
        .map((r) => [r.subject_thread_id, r.canonical_subject_id]),
    )
    const expectedLegacy = new Set<string>()
    for (const l of rawLegacy) {
      const from = threadToCS.get(l.fromThreadId)
      const to = threadToCS.get(l.toThreadId)
      if (!from || !to || from === to) continue
      expectedLegacy.add(`${from}:${to}:${l.linkType}`)
    }

    // ── Attendu côté canonical : liens confirmés entre CS du site ──────────
    const { data: rawCanonical } = await db
      .from('canonical_subject_links')
      .select('source_subject_id, target_subject_id, relation_type')
      .eq('site_id', siteId)
      .eq('status', 'confirmed')
    const expectedCanonical = new Set<string>()
    for (const c of (rawCanonical ?? []) as Array<{
      source_subject_id: string; target_subject_id: string; relation_type: string
    }>) {
      if (c.source_subject_id === c.target_subject_id) continue
      expectedCanonical.add(`${c.source_subject_id}:${c.target_subject_id}:${c.relation_type}`)
    }

    // ── Obtenu : le graphe réel ─────────────────────────────────────────────
    const graph = await getSiteKnowledgeGraph(siteId)
    const semanticKeys = graph.edges
      .filter((e) => e.edgeType === 'semantic')
      .map((e) => `${e.from}:${e.to}:${'linkType' in e ? e.linkType : '?'}`)
    const gotKeys = new Set(semanticKeys)

    // 1. Toutes les arêtes legacy présentes ?
    const missingLegacy = [...expectedLegacy].filter((k) => !gotKeys.has(k))
    // 2. Toutes les arêtes canonical présentes ? (celles dont les 2 CS sont sur le site)
    const missingCanonical = [...expectedCanonical].filter((k) => !gotKeys.has(k))
    // 3. Doublons ?
    const dupes = semanticKeys.length - gotKeys.size

    console.log(`  legacy attendues    : ${expectedLegacy.size} — manquantes : ${missingLegacy.length}`)
    console.log(`  canonical attendues : ${expectedCanonical.size} — manquantes : ${missingCanonical.length}`)
    console.log(`  arêtes sémantiques dans le graphe : ${semanticKeys.length} — doublons : ${dupes}`)

    if (missingLegacy.length > 0) {
      failures++
      console.log(`  ❌ LEGACY MANQUANTES :`)
      for (const k of missingLegacy) console.log(`     ${k}`)
    }
    if (missingCanonical.length > 0) {
      failures++
      console.log(`  ❌ CANONICAL MANQUANTES :`)
      for (const k of missingCanonical) console.log(`     ${k}`)
    }
    if (dupes > 0) {
      failures++
      console.log(`  ❌ ${dupes} DOUBLON(S)`)
    }
    if (missingLegacy.length === 0 && missingCanonical.length === 0 && dupes === 0) {
      console.log(`  ✅ OK`)
    }
  }

  console.log(`\n${failures === 0 ? '✅ NON-RÉGRESSION VALIDÉE — tous les sites passent' : `❌ ${failures} échec(s)`}`)
  if (failures > 0) process.exit(1)
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1) })
