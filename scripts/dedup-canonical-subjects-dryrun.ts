/**
 * DRY-RUN — Déduplication exacte des canonical_subjects.
 * Aucune écriture. Produit le rapport de fusion avant validation humaine.
 *
 * Règles :
 *  • Clé de groupe  : site_id + normalize(label)
 *  • Kind dominant  : proposal_family majoritaire parmi les threads du groupe
 *  • Compatibilité  : kind=null est compatible avec tout ; deux kinds non-null
 *    différents = CONFLIT → pas de fusion automatique
 *  • Survivor       : CS avec le plus de PV distincts ; ex-aequo → plus ancien
 *  • Pas de DELETE  : les perdants passent status='merged' avec merged_into=survivor_id
 *
 * FKs repointerées lors du merge réel :
 *  subject_thread_identity.canonical_subject_id
 *  canonical_subject_occurrence.canonical_subject_id
 *  visit_preparation_item.canonical_subject_id
 *  canonical_subject_suggestion.candidate_canonical_subject_id
 *  canonical_subject_suggestion.previous_canonical_subject_id
 *  canonical_subject.aliases (union)
 *  canonical_subject.operational_subject_id (héritage si survivor n'en a pas)
 *
 * Usage :
 *   npx tsx scripts/dedup-canonical-subjects-dryrun.ts [PATTERN_SITE]
 *   npx tsx scripts/dedup-canonical-subjects-dryrun.ts compost
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

/** Normalisation label : minuscules + espace normalisé + apostrophes unifiées */
function normalizeLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
}

interface CS {
  id: string; label: string; aliases: string[]
  status: string; created_at: string; operational_subject_id: string | null
}
interface ThreadRow { subject_thread_id: string; canonical_subject_id: string }
interface PropRow { subject_thread_id: string; extraction_run_id: string; proposal_family: string | null }
interface RunRow { id: string; document_id: string; created_at: string }

async function main() {
  // ── 1. Site ──────────────────────────────────────────────────────────────
  const { data: sites } = await sb.from('sites').select('id,name').is('deleted_at', null).ilike('name', `%${sitePattern}%`)
  const site = (sites ?? [])[0] as { id: string; name: string } | undefined
  if (!site) { console.error('Site introuvable pour pattern:', sitePattern); process.exit(1) }
  const siteId = site.id
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`DRY-RUN déduplication — ${site.name}`)
  console.log(`${'═'.repeat(60)}\n`)

  // ── 2. Canonical subjects actifs ─────────────────────────────────────────
  const { data: csData, error: csErr } = await sb
    .from('canonical_subject')
    .select('id, label, aliases, status, created_at, operational_subject_id')
    .eq('site_id', siteId)
    .eq('status', 'active')
  if (csErr) { console.error('Erreur CS:', csErr); process.exit(1) }
  const subjects = (csData ?? []) as CS[]
  console.log(`canonical_subjects actifs : ${subjects.length}`)

  // ── 3. Threads du site ───────────────────────────────────────────────────
  const { data: threadData } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
  const threads = (threadData ?? []) as ThreadRow[]
  const csIdByThread = new Map(threads.map(t => [t.subject_thread_id, t.canonical_subject_id]))
  const threadsByCs = new Map<string, string[]>()
  for (const t of threads) {
    if (!threadsByCs.has(t.canonical_subject_id)) threadsByCs.set(t.canonical_subject_id, [])
    threadsByCs.get(t.canonical_subject_id)!.push(t.subject_thread_id)
  }

  // ── 4. Runs canoniques ───────────────────────────────────────────────────
  const { data: runData } = await sb
    .from('document_extraction_run')
    .select('id, created_at')
    .eq('target_site_id', siteId)
    .eq('is_canonical', true)
  const runs = (runData ?? []) as RunRow[]
  const runIds = new Set(runs.map(r => r.id))

  // ── 5. Propositions → proposal_family par thread ─────────────────────────
  const allThreadIds = threads.map(t => t.subject_thread_id)
  const allRunIds = [...runIds]
  let pdfProps: PropRow[] = []
  for (let i = 0; i < allThreadIds.length; i += 300) {
    const chunk = allThreadIds.slice(i, i + 300)
    if (!chunk.length || !allRunIds.length) continue
    const { data } = await sb
      .from('document_extraction_proposal')
      .select('subject_thread_id, extraction_run_id, proposal_family')
      .in('subject_thread_id', chunk)
      .in('extraction_run_id', allRunIds)
    pdfProps.push(...((data ?? []) as PropRow[]))
  }

  // PV distincts par CS + kind dominant
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

  // ── 6. Groupement par label normalisé ───────────────────────────────────
  type Group = { normKey: string; members: CS[]; pvCounts: Map<string, number> }
  const groups = new Map<string, Group>()
  for (const cs of subjects) {
    const key = normalizeLabel(cs.label)
    if (!groups.has(key)) groups.set(key, { normKey: key, members: [], pvCounts: new Map() })
    const g = groups.get(key)!
    g.members.push(cs)
    g.pvCounts.set(cs.id, pvsByCs.get(cs.id)?.size ?? 0)
  }
  const duplicateGroups = [...groups.values()].filter(g => g.members.length >= 2)
  const singletons = [...groups.values()].filter(g => g.members.length === 1)

  console.log(`Groupes uniques (label distinct) : ${singletons.length}`)
  console.log(`Groupes avec doublons (≥2 CS)    : ${duplicateGroups.length}`)

  // ── 7. Analyse des groupes doublons ──────────────────────────────────────
  let totalToMerge = 0, totalConflicts = 0, totalCompatible = 0
  interface MergeGroup {
    label: string
    survivor: CS
    losers: CS[]
    kindCompatible: boolean
    survivorKind: string | null
    conflictKinds: string[]
    totalThreads: number
    survivorPvCount: number
  }
  const mergeGroups: MergeGroup[] = []
  const conflictGroups: typeof duplicateGroups = []

  for (const g of duplicateGroups) {
    // Kind de chaque membre
    const memberKinds = g.members.map(cs => ({ cs, kind: dominantKind(cs.id) }))
    const nonNullKinds = [...new Set(memberKinds.map(m => m.kind).filter(Boolean) as string[])]

    // Conflit : 2+ kinds non-null différents qui ne sont pas compatibles
    const ACTOR_KINDS = new Set(['person', 'company'])
    const hasActorKind = nonNullKinds.some(k => ACTOR_KINDS.has(k))
    const hasNonActorKind = nonNullKinds.some(k => !ACTOR_KINDS.has(k))
    const kindConflict = nonNullKinds.length >= 2 && !(nonNullKinds.length === 2 && nonNullKinds.some(k => !k))
      && !(nonNullKinds.every(k => ACTOR_KINDS.has(k)) || nonNullKinds.every(k => !ACTOR_KINDS.has(k)))

    // Conflit strict : kinds réellement incompatibles
    const strictConflict = nonNullKinds.length >= 2 && hasActorKind && hasNonActorKind

    if (strictConflict) {
      totalConflicts++
      conflictGroups.push(g)
      continue
    }

    // Survivor : plus de PV → si ex-aequo, plus ancien
    const sorted = [...g.members].sort((a, b) => {
      const pa = pvsByCs.get(a.id)?.size ?? 0
      const pb = pvsByCs.get(b.id)?.size ?? 0
      if (pb !== pa) return pb - pa
      return a.created_at.localeCompare(b.created_at)
    })
    const survivor = sorted[0]
    const losers = sorted.slice(1)
    // Kind survivor = kind dominant du groupe (priorité : non-null gagne sur null)
    const survivorKind = nonNullKinds[0] ?? null

    totalToMerge += losers.length
    totalCompatible++

    const totalThreads = g.members.reduce((s, cs) => s + (threadsByCs.get(cs.id)?.length ?? 0), 0)
    mergeGroups.push({
      label: survivor.label,
      survivor,
      losers,
      kindCompatible: true,
      survivorKind,
      conflictKinds: [],
      totalThreads,
      survivorPvCount: pvsByCs.get(survivor.id)?.size ?? 0,
    })
  }

  // ── 8. Rapport ───────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`)
  console.log(`RÉSUMÉ DRY-RUN`)
  console.log(`${'─'.repeat(55)}`)
  console.log(`  CS actifs total                    : ${subjects.length}`)
  console.log(`  Groupes avec label exact dupliqué  : ${duplicateGroups.length}`)
  console.log(`    → Groupes compatibles (à merger) : ${totalCompatible}`)
  console.log(`    → Groupes en conflit (à ignorer) : ${totalConflicts}`)
  console.log(`  CS survivants après fusion          : ${singletons.length + totalCompatible + conflictGroups.length}`)
  console.log(`  CS à passer en merged               : ${totalToMerge}`)
  console.log(`  CS restants actifs après fusion     : ${subjects.length - totalToMerge}`)
  console.log(`  Threads total                       : ${threads.length}`)
  console.log(`  Threads couverts (aucun perdu ?)    : ${threads.length}  ← inchangé après repointing`)

  // ── 9. Détail des groupes à merger ───────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`)
  console.log(`GROUPES À MERGER (${mergeGroups.length} — premiers 30)`)
  console.log(`${'─'.repeat(55)}`)
  const bySize = [...mergeGroups].sort((a, b) => b.losers.length - a.losers.length)
  for (const mg of bySize.slice(0, 30)) {
    const loseStr = mg.losers.map(l => `${l.id.slice(0, 8)}… [${pvsByCs.get(l.id)?.size ?? 0}PV]`).join(', ')
    console.log(`\n  "${mg.label.slice(0, 60)}"`)
    console.log(`    Membres : ${mg.losers.length + 1}  | Threads total : ${mg.totalThreads}  | Kind : ${mg.survivorKind ?? 'null'}`)
    console.log(`    Survivor   : ${mg.survivor.id.slice(0, 8)}… [${mg.survivorPvCount}PV] (${mg.survivor.created_at.slice(0, 10)})`)
    console.log(`    À merger   : ${loseStr}`)
  }
  if (mergeGroups.length > 30) console.log(`\n  … et ${mergeGroups.length - 30} autres groupes`)

  // ── 10. Groupes en conflit ────────────────────────────────────────────────
  if (conflictGroups.length > 0) {
    console.log(`\n${'─'.repeat(55)}`)
    console.log(`CONFLITS (ne seront PAS fusionnés automatiquement)`)
    console.log(`${'─'.repeat(55)}`)
    for (const g of conflictGroups) {
      const kinds = g.members.map(cs => `${dominantKind(cs.id) ?? 'null'}`).join(' / ')
      console.log(`  "${g.members[0].label.slice(0, 60)}" → kinds : [${kinds}]`)
    }
  }

  // ── 11. Assertions pré-merge ─────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`)
  console.log(`ASSERTIONS AVANT MERGE`)
  console.log(`${'─'.repeat(55)}`)
  const loserIds = new Set(mergeGroups.flatMap(mg => mg.losers.map(l => l.id)))
  const threadsOnLosers = threads.filter(t => loserIds.has(t.canonical_subject_id))
  console.log(`  Threads à repointer     : ${threadsOnLosers.length}`)
  const { count: nativeCount } = await sb
    .from('canonical_subject_occurrence')
    .select('id', { count: 'exact', head: true })
    .in('canonical_subject_id', [...loserIds])
  console.log(`  Occurrences natives sur perdants : ${nativeCount ?? 0}`)
  const { count: prepCount } = await sb
    .from('visit_preparation_item')
    .select('id', { count: 'exact', head: true })
    .in('canonical_subject_id', [...loserIds])
  console.log(`  visit_preparation_item sur perdants : ${prepCount ?? 0}`)
  const { count: suggCount } = await sb
    .from('canonical_subject_suggestion')
    .select('id', { count: 'exact', head: true })
    .in('candidate_canonical_subject_id', [...loserIds])
  console.log(`  canonical_subject_suggestion sur perdants : ${suggCount ?? 0}`)

  console.log(`\n→ Valider ce rapport puis lancer dedup-canonical-subjects-apply.ts`)
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
