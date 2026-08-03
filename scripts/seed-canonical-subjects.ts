/**
 * Seed 1:1 — canonical_subject + subject_thread_identity pour les threads orphelins
 *
 * Doctrine mig 279 Lot 1 : tout subject_thread_id doit avoir une identité canonique.
 * Ce script réalise le backfill global idempotent manquant à la migration.
 *
 * Périmètre : tous les subject_thread_id distincts présents dans
 *   document_extraction_proposal ou subject_thread_links
 *   qui n'ont PAS encore d'entrée dans subject_thread_identity.
 *
 * Invariants préservés :
 *   - Les threads déjà présents dans subject_thread_identity ne sont PAS touchés
 *     (notamment les 10 merges canoniques déjà validés).
 *   - Idempotent : une seconde exécution produit 0 insertion.
 *
 * Usage :
 *   DRY_RUN=true  npx tsx --env-file=.env.local scripts/seed-canonical-subjects.ts
 *   DRY_RUN=false npx tsx --env-file=.env.local scripts/seed-canonical-subjects.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const DRY_RUN     = process.env.DRY_RUN !== 'false'

if (!supabaseUrl || !serviceKey) {
  console.error('[FATAL] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
})

// ── Types ─────────────────────────────────────────────────────────────────────

type OrphanThread = {
  subject_thread_id: string
  site_id: string
  best_label: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function plural(n: number, singular: string, pluralForm?: string) {
  return `${n} ${n === 1 ? singular : (pluralForm ?? singular + 's')}`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== seed-canonical-subjects — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} ===\n`)

  // ── 1. Tous les threads connus, par source ──────────────────────────────────
  //
  // target_site_id est sur document_extraction_RUN (mig 259), pas sur la proposal.
  // La proposal porte extraction_run_id → on joint en deux requêtes.

  // Source A : runs → site
  const { data: runRows, error: runErr } = await supabase
    .from('document_extraction_run')
    .select('id, target_site_id')
    .not('target_site_id', 'is', null)

  if (runErr) { console.error('[FATAL] run query:', runErr.message); process.exit(1) }

  const runSiteMap = new Map<string, string>() // run_id → site_id
  for (const r of (runRows ?? []) as Array<{ id: string; target_site_id: string }>) {
    runSiteMap.set(r.id, r.target_site_id)
  }

  // Source A : proposals (thread_id + run_id pour résoudre le site + label pour le backfill)
  const { data: propThreads, error: propErr } = await supabase
    .from('document_extraction_proposal')
    .select('subject_thread_id, extraction_run_id, label, created_at')
    .not('subject_thread_id', 'is', null)
    .order('created_at', { ascending: false })

  if (propErr) { console.error('[FATAL] proposal query:', propErr.message); process.exit(1) }

  // Source B : subject_thread_links (from + to) — site_id NOT NULL garanti par schéma
  const { data: linkRows, error: linkErr } = await supabase
    .from('subject_thread_links')
    .select('from_thread_id, to_thread_id, site_id')

  if (linkErr) { console.error('[FATAL] links query:', linkErr.message); process.exit(1) }

  // Union — (thread_id, site_id) dédupliqué
  // Priorité : links d'abord (NOT NULL), puis proposals via run.
  const threadSiteMap = new Map<string, string>() // thread_id → site_id

  for (const r of (linkRows ?? []) as Array<{ from_thread_id: string; to_thread_id: string; site_id: string }>) {
    if (r.site_id) {
      threadSiteMap.set(r.from_thread_id, r.site_id)
      threadSiteMap.set(r.to_thread_id,   r.site_id)
    }
  }
  for (const r of (propThreads ?? []) as Array<{ subject_thread_id: string; extraction_run_id: string | null; label: string; created_at: string }>) {
    if (!threadSiteMap.has(r.subject_thread_id) && r.extraction_run_id) {
      const siteId = runSiteMap.get(r.extraction_run_id)
      if (siteId) threadSiteMap.set(r.subject_thread_id, siteId)
    }
  }

  const totalThreads = threadSiteMap.size
  console.log(`Threads connus (toutes sources) : ${totalThreads}`)

  // ── 2. Threads déjà identifiés ─────────────────────────────────────────────

  const { data: stiRows, error: stiErr } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id')

  if (stiErr) { console.error('[FATAL] STI query:', stiErr.message); process.exit(1) }

  const alreadyMapped = new Set<string>(
    ((stiRows ?? []) as Array<{ subject_thread_id: string }>).map((r) => r.subject_thread_id)
  )

  const alreadyCount = alreadyMapped.size
  console.log(`Threads déjà dans subject_thread_identity : ${alreadyCount}`)

  // ── 3. Threads orphelins ───────────────────────────────────────────────────

  const orphanIds: Array<{ threadId: string; siteId: string }> = []
  for (const [threadId, siteId] of threadSiteMap.entries()) {
    if (!alreadyMapped.has(threadId)) {
      orphanIds.push({ threadId, siteId })
    }
  }

  console.log(`Threads orphelins à seeder : ${orphanIds.length}`)

  if (orphanIds.length === 0) {
    console.log('\n✅ Aucun orphelin — backfill déjà complet.')
    return
  }

  // ── 4. Ventilation par site ────────────────────────────────────────────────

  const bySite = new Map<string, number>()
  for (const { siteId } of orphanIds) {
    bySite.set(siteId, (bySite.get(siteId) ?? 0) + 1)
  }

  // Résoudre les noms de sites pour l'affichage
  const siteIds = [...bySite.keys()]
  const { data: siteRows } = await supabase
    .from('sites')
    .select('id, name')
    .in('id', siteIds)

  const siteNames = new Map<string, string>(
    ((siteRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name])
  )

  console.log('\nVentilation par chantier :')
  for (const [siteId, count] of [...bySite.entries()].sort((a, b) => b[1] - a[1])) {
    const name = siteNames.get(siteId) ?? siteId
    console.log(`  ${count.toString().padStart(4)} orphelins — ${name}`)
  }

  // ── 5. Meilleur label par thread orphelin ──────────────────────────────────
  //
  // propThreads est déjà trié ORDER BY created_at DESC → premier match = plus récent.

  const orphanSet = new Set(orphanIds.map((o) => o.threadId))
  const labelMap = new Map<string, string>() // thread_id → best label

  for (const r of (propThreads ?? []) as Array<{ subject_thread_id: string; label: string; created_at: string }>) {
    if (orphanSet.has(r.subject_thread_id) && !labelMap.has(r.subject_thread_id)) {
      labelMap.set(r.subject_thread_id, r.label)
    }
  }

  // Threads dont aucune proposition n'existe (cas d'un lien vers un thread inconnu)
  let ghostCount = 0
  for (const { threadId } of orphanIds) {
    if (!labelMap.has(threadId)) {
      labelMap.set(threadId, `[thread inconnu ${threadId.slice(0, 8)}]`)
      ghostCount++
    }
  }

  if (ghostCount > 0) {
    console.log(`\n⚠️  ${ghostCount} thread(s) orphelins sans proposition — label générique utilisé.`)
    console.log('   Ces threads existent dans subject_thread_links mais pas dans document_extraction_proposal.')
  }

  // ── 6. Récapitulatif avant écriture ───────────────────────────────────────

  console.log(`\nDonnées prêtes :`)
  console.log(`  ${plural(orphanIds.length, 'canonical_subject')} à créer`)
  console.log(`  ${plural(orphanIds.length, 'subject_thread_identity')} à créer`)

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN — aucune écriture. Relancer avec DRY_RUN=false pour appliquer.')
    console.log('\nAperçu (10 premiers orphelins) :')
    for (const { threadId, siteId } of orphanIds.slice(0, 10)) {
      const label = labelMap.get(threadId) ?? '?'
      const site  = siteNames.get(siteId) ?? (siteId ? siteId.slice(0, 8) : 'site-inconnu')
      console.log(`  [${site}] ${threadId.slice(0, 8)}…  → "${label}"`)
    }
    return
  }

  // ── 7. Seed transactionnel par site ───────────────────────────────────────
  //
  // On traite site par site pour limiter la taille des transactions et faciliter
  // l'identification d'erreurs éventuelles.

  let canonicalInserted = 0
  let stiInserted = 0
  let errors = 0

  const groupedBySite = new Map<string, OrphanThread[]>()
  for (const { threadId, siteId } of orphanIds) {
    if (!groupedBySite.has(siteId)) groupedBySite.set(siteId, [])
    groupedBySite.get(siteId)!.push({
      subject_thread_id: threadId,
      site_id: siteId,
      best_label: labelMap.get(threadId) ?? `[thread ${threadId.slice(0, 8)}]`,
    })
  }

  for (const [siteId, threads] of groupedBySite.entries()) {
    const siteName = siteNames.get(siteId) ?? siteId.slice(0, 8)

    // 7a. Insérer canonical_subjects — récupérer les IDs générés
    const canonicalInserts = threads.map((t) => ({
      site_id: t.site_id,
      label: t.best_label,
      aliases: [] as string[],
      status: 'active',
    }))

    const { data: newCanonicals, error: csErr } = await supabase
      .from('canonical_subject')
      .insert(canonicalInserts)
      .select('id, label')

    if (csErr) {
      console.error(`  ❌ [${siteName}] canonical_subject insert:`, csErr.message)
      errors++
      continue
    }

    // 7b. Construire le mapping label → canonical_id pour ce site
    // (les labels peuvent ne pas être uniques — on utilise l'ordre d'insertion)
    const newCanonicalList = (newCanonicals ?? []) as Array<{ id: string; label: string }>
    if (newCanonicalList.length !== threads.length) {
      console.error(`  ❌ [${siteName}] mismatch insert count: ${newCanonicalList.length} vs ${threads.length}`)
      errors++
      continue
    }

    // 7c. Insérer subject_thread_identity en ordre correspondant
    const stiInserts = threads.map((t, idx) => ({
      subject_thread_id: t.subject_thread_id,
      site_id: t.site_id,
      canonical_subject_id: newCanonicalList[idx].id,
      confidence: 1.0,
      source: 'auto',
    }))

    const { error: stiErr } = await supabase
      .from('subject_thread_identity')
      .insert(stiInserts)

    if (stiErr) {
      console.error(`  ❌ [${siteName}] subject_thread_identity insert:`, stiErr.message)
      errors++
      continue
    }

    canonicalInserted += newCanonicalList.length
    stiInserted += stiInserts.length
    console.log(`  ✅ [${siteName}] ${threads.length} threads seedés`)
  }

  console.log(`\n=== Résultat ===`)
  console.log(`  canonical_subject insérés  : ${canonicalInserted}`)
  console.log(`  subject_thread_identity    : ${stiInserted}`)
  if (errors > 0) {
    console.log(`  ❌ Erreurs sur ${errors} site(s) — vérifier les logs ci-dessus.`)
    process.exit(1)
  } else {
    console.log('\n✅ Backfill terminé. Relancer avec DRY_RUN=true pour confirmer 0 orphelin.')
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1) })
