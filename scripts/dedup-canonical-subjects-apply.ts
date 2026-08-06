/**
 * APPLY — Déduplication exacte des canonical_subjects.
 * Écrit en base. À lancer après validation du dry-run.
 *
 * Idempotent : un second run trouve 0 doublons actifs et ne modifie rien.
 *
 * Ordre d'opérations par groupe :
 *  1. Pré-validation (label normalisé identique + kind compatible)
 *  2. Repointer subject_thread_identity → survivor
 *  3. Repointer canonical_subject_occurrence → survivor
 *  4. Repointer visit_preparation_item → survivor
 *  5. Repointer canonical_subject_suggestion (candidate + previous) → survivor
 *  6. Union aliases (loser.label + loser.aliases) dans survivor
 *  7. Hériter operational_subject_id si survivor n'en a pas
 *  8. Passer les perdants en status='merged', merged_into=survivor.id
 *
 * Usage :
 *   npx tsx scripts/dedup-canonical-subjects-apply.ts [PATTERN_SITE]
 *   npx tsx scripts/dedup-canonical-subjects-apply.ts compost
 */
import { existsSync, readFileSync } from 'node:fs'
function loadEnv() {
  if (!existsSync('.env.local')) return
  for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('='); if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnv()

import { createAdminClient } from '../lib/supabase/admin'
const sb = createAdminClient()
const sitePattern = process.argv[2] ?? 'compost'

function normalizeLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/['']/g, "'").replace(/\s+/g, ' ')
}

const ACTOR_KINDS = new Set(['person', 'company'])
function kindsCompatible(kinds: (string | null)[]): boolean {
  const nonNull = kinds.filter(Boolean) as string[]
  if (nonNull.length <= 1) return true
  const hasActor = nonNull.some(k => ACTOR_KINDS.has(k))
  const hasNonActor = nonNull.some(k => !ACTOR_KINDS.has(k))
  return !(hasActor && hasNonActor)
}

interface CS {
  id: string; label: string; aliases: string[]
  status: string; created_at: string; operational_subject_id: string | null
}
interface ThreadRow { subject_thread_id: string; canonical_subject_id: string }
interface PropRow { subject_thread_id: string; extraction_run_id: string; proposal_family: string | null }
interface RunRow { id: string }

async function main() {
  // ── 1. Site ──────────────────────────────────────────────────────────────
  const { data: sites } = await sb.from('sites').select('id,name').is('deleted_at', null).ilike('name', `%${sitePattern}%`)
  const site = (sites ?? [])[0] as { id: string; name: string } | undefined
  if (!site) { console.error('Site introuvable pour pattern:', sitePattern); process.exit(1) }
  const siteId = site.id
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`APPLY déduplication — ${site.name}`)
  console.log(`${'═'.repeat(60)}\n`)

  // ── 2. Snapshot initial ─────────────────────────────────────────────────
  const { data: csData, error: csErr } = await sb
    .from('canonical_subject')
    .select('id, label, aliases, status, created_at, operational_subject_id')
    .eq('site_id', siteId)
    .eq('status', 'active')
  if (csErr) { console.error('Erreur CS:', csErr); process.exit(1) }
  const subjects = (csData ?? []) as CS[]
  const initialActiveCount = subjects.length
  console.log(`CS actifs initiaux : ${initialActiveCount}`)

  // ── 3. Threads ───────────────────────────────────────────────────────────
  const { data: threadData } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
  const threads = (threadData ?? []) as ThreadRow[]
  const initialThreadCount = threads.length
  const csIdByThread = new Map(threads.map(t => [t.subject_thread_id, t.canonical_subject_id]))

  // ── 4. PV counts (pour choix survivor) ──────────────────────────────────
  const { data: runData } = await sb
    .from('document_extraction_run')
    .select('id')
    .eq('target_site_id', siteId)
    .eq('is_canonical', true)
  const runIds = new Set(((runData ?? []) as RunRow[]).map(r => r.id))
  const allThreadIds = threads.map(t => t.subject_thread_id)
  let pdfProps: PropRow[] = []
  for (let i = 0; i < allThreadIds.length; i += 300) {
    const chunk = allThreadIds.slice(i, i + 300)
    if (!chunk.length || !runIds.size) continue
    const { data } = await sb
      .from('document_extraction_proposal')
      .select('subject_thread_id, extraction_run_id, proposal_family')
      .in('subject_thread_id', chunk)
      .in('extraction_run_id', [...runIds])
    pdfProps.push(...((data ?? []) as PropRow[]))
  }
  const pvsByCs = new Map<string, Set<string>>()
  const kindVotesByCs = new Map<string, Map<string, number>>()
  for (const p of pdfProps) {
    const csId = csIdByThread.get(p.subject_thread_id)
    if (!csId) continue
    if (!pvsByCs.has(csId)) pvsByCs.set(csId, new Set())
    pvsByCs.get(csId)!.add(p.extraction_run_id)
    if (p.proposal_family) {
      if (!kindVotesByCs.has(csId)) kindVotesByCs.set(csId, new Map())
      const votes = kindVotesByCs.get(csId)!
      votes.set(p.proposal_family, (votes.get(p.proposal_family) ?? 0) + 1)
    }
  }
  function dominantKind(csId: string): string | null {
    const votes = kindVotesByCs.get(csId)
    if (!votes || votes.size === 0) return null
    let best: string | null = null, max = 0
    for (const [k, n] of votes) { if (n > max) { max = n; best = k } }
    return best
  }

  // ── 5. Groupement ────────────────────────────────────────────────────────
  const groups = new Map<string, CS[]>()
  for (const cs of subjects) {
    const key = normalizeLabel(cs.label)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(cs)
  }
  const dupGroups = [...groups.values()].filter(g => g.members ? g.members.length >= 2 : g.length >= 2)
    .map(g => g as CS[]).filter(g => g.length >= 2)

  if (dupGroups.length === 0) {
    console.log('\n✓ Aucun doublon actif — rien à merger (idempotent).\n')
    return
  }

  // ── 6. Application ────────────────────────────────────────────────────────
  let mergedCount = 0
  let threadsRepointed = 0
  let suggestionsRepointed = 0
  const errors: string[] = []

  for (const members of dupGroups) {
    // Pré-validation
    const kinds = members.map(cs => dominantKind(cs.id))
    if (!kindsCompatible(kinds)) {
      console.warn(`  SKIP conflit kind: "${members[0].label}" [${kinds.join(' / ')}]`)
      continue
    }
    const normLabels = new Set(members.map(cs => normalizeLabel(cs.label)))
    if (normLabels.size !== 1) {
      console.warn(`  SKIP label normalisé divergent: "${members[0].label}"`)
      continue
    }

    // Survivor
    const sorted = [...members].sort((a, b) => {
      const pa = pvsByCs.get(a.id)?.size ?? 0
      const pb = pvsByCs.get(b.id)?.size ?? 0
      if (pb !== pa) return pb - pa
      return a.created_at.localeCompare(b.created_at)
    })
    const survivor = sorted[0]
    const losers = sorted.slice(1)

    console.log(`\n  "${survivor.label.slice(0, 55)}" — survivor ${survivor.id.slice(0, 8)}… (${pvsByCs.get(survivor.id)?.size ?? 0} PV)`)

    for (const loser of losers) {
      // 2. subject_thread_identity
      const { count: stiCount, error: stiErr } = await sb
        .from('subject_thread_identity')
        .update({ canonical_subject_id: survivor.id })
        .eq('canonical_subject_id', loser.id)
        .select('subject_thread_id', { count: 'exact', head: false })
      if (stiErr) { errors.push(`STI ${loser.id}: ${stiErr.message}`); continue }
      threadsRepointed += stiCount ?? 0

      // 3. canonical_subject_occurrence
      await sb
        .from('canonical_subject_occurrence')
        .update({ canonical_subject_id: survivor.id })
        .eq('canonical_subject_id', loser.id)

      // 4. visit_preparation_item
      await sb
        .from('visit_preparation_item')
        .update({ canonical_subject_id: survivor.id })
        .eq('canonical_subject_id', loser.id)

      // 5. canonical_subject_suggestion (candidate + previous)
      const { count: suggCount1 } = await sb
        .from('canonical_subject_suggestion')
        .update({ candidate_canonical_subject_id: survivor.id })
        .eq('candidate_canonical_subject_id', loser.id)
        .select('id', { count: 'exact', head: false })
      suggestionsRepointed += suggCount1 ?? 0

      const { count: suggCount2 } = await sb
        .from('canonical_subject_suggestion')
        .update({ previous_canonical_subject_id: survivor.id })
        .eq('previous_canonical_subject_id', loser.id)
        .select('id', { count: 'exact', head: false })
      suggestionsRepointed += suggCount2 ?? 0

      // 6. Union aliases sur le survivor
      const survivorAliases = new Set(survivor.aliases ?? [])
      // Ajouter le label du perdant et ses aliases
      survivorAliases.add(loser.label)
      for (const a of loser.aliases ?? []) survivorAliases.add(a)
      // Retirer le label du survivor lui-même s'il y est
      survivorAliases.delete(survivor.label)
      const newAliases = [...survivorAliases]
      // Mise à jour en mémoire pour les prochains losers du même groupe
      survivor.aliases = newAliases
      await sb
        .from('canonical_subject')
        .update({ aliases: newAliases })
        .eq('id', survivor.id)

      // 7. Hériter operational_subject_id si survivor n'en a pas
      if (!survivor.operational_subject_id && loser.operational_subject_id) {
        survivor.operational_subject_id = loser.operational_subject_id
        await sb
          .from('canonical_subject')
          .update({ operational_subject_id: loser.operational_subject_id })
          .eq('id', survivor.id)
      }

      // 8. Marquer le perdant merged
      const { error: mergeErr } = await sb
        .from('canonical_subject')
        .update({ status: 'merged', merged_into: survivor.id })
        .eq('id', loser.id)
      if (mergeErr) { errors.push(`MERGE ${loser.id}: ${mergeErr.message}`); continue }

      mergedCount++
      console.log(`    → merged ${loser.id.slice(0, 8)}… (${pvsByCs.get(loser.id)?.size ?? 0} PV) [${dominantKind(loser.id) ?? 'null'}]`)
    }
  }

  // ── 7. Rapport final ─────────────────────────────────────────────────────
  // Recompter actifs réels
  const { count: finalActive } = await sb
    .from('canonical_subject')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('status', 'active')
  const { count: finalMerged } = await sb
    .from('canonical_subject')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('status', 'merged')

  // Threads orphelins (canonical_subject_id pointe vers un CS non actif)
  const { data: orphanThreadData } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
  const allCsIds = new Set(subjects.map(cs => cs.id))
  const orphanThreads = (orphanThreadData ?? []).filter(t => {
    // Un thread est orphelin si son CS n'est pas actif
    // On va vérifier via la DB
    return false // on vérifie ci-dessous
  })
  // Vérification propre : threads dont le CS est merged sans survivor actif
  const { data: activeCheck } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id, canonical_subject!inner(status)')
    .eq('site_id', siteId)
  const orphanCount = (activeCheck ?? []).filter((t: any) => t.canonical_subject?.status !== 'active').length

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`RAPPORT FINAL`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`  CS actifs avant  : ${initialActiveCount}`)
  console.log(`  CS actifs après  : ${finalActive ?? '?'}`)
  console.log(`  CS merged        : ${finalMerged ?? '?'}`)
  console.log(`  CS mergés ce run : ${mergedCount}`)
  console.log(`  Threads total    : ${initialThreadCount}`)
  console.log(`  Threads repointés: ${threadsRepointed}`)
  console.log(`  Suggestions repr.: ${suggestionsRepointed}`)
  console.log(`  Threads orphelins: ${orphanCount} (doit être 0)`)

  if (errors.length > 0) {
    console.error(`\n  ERREURS (${errors.length}):`)
    for (const e of errors) console.error(`    - ${e}`)
    process.exit(1)
  } else {
    console.log(`\n✓ Merge terminé sans erreur.`)
  }
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
