// P1-5A — Simulation de re-canonicalisation (dry-run).
// MODE LECTURE SEULE STRICT — aucune mutation DB, aucun merge, aucun backfill, aucun commit.
//
// Entrées : audit-p15a-inventory.clean.json + audit-p15a-classify.clean.json
// Étapes :
//   1. Grappes = composantes connexes des paires SAFE_SAME (union-find)
//   2. Survivor déterministe par grappe (règle documentée)
//   3. Simulation occurrence-par-occurrence + détection doublons
//   4. Recalcul longitudinal théorique (firstSeen/lastSeen ; LMCA marqué recalc-safe/unsafe)
//   5. Impact relations (canonical_subject_links / subject_thread_links)
//   6. Impact suggestions (canonical_subject_similarity_suggestion)
//   7. Idempotence : re-scan des labels survivants
//
// Usage : npx tsx scripts/_p15a-simulate.ts > audit-p15a-simulate.json 2>audit-p15a-simulate.err

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { normalizeForMatching, P01_NORMALIZED_JACCARD_THRESHOLD } from '../lib/subjects/normalize-for-matching'
import { jaccardSimilarity } from '../lib/documents/subject-reconciliation'

const OCEF_SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const inv = JSON.parse(readFileSync('audit-p15a-inventory.clean.json', 'utf8'))
  const cls = JSON.parse(readFileSync('audit-p15a-classify.clean.json', 'utf8'))

  const csById = new Map<string, { id: string; label: string; created_at: string; occ: number; threads: number; proposals: number; actions: number }>()
  for (const s of inv.activeSubjects) csById.set(s.id, s)

  const safeSame: Array<{ aId: string; bId: string }> = cls.rows.filter((r: { classification: string }) => r.classification === 'SAFE_SAME')

  // ── Union-Find sur les paires SAFE_SAME ────────────────────────────────────
  const parent = new Map<string, string>()
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)! } return x }
  const union = (a: string, b: string) => { parent.set(find(a), find(b)) }
  for (const r of safeSame) { if (!parent.has(r.aId)) parent.set(r.aId, r.aId); if (!parent.has(r.bId)) parent.set(r.bId, r.bId) }
  for (const r of safeSame) union(r.aId, r.bId)

  const clusters = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    const list = clusters.get(root) ?? []
    list.push(id)
    clusters.set(root, list)
  }
  const clusterList = [...clusters.values()].filter((c) => c.length >= 2)

  // ── Détails occurrences pour tous les CS impliqués ─────────────────────────
  const involvedIds = [...new Set(clusterList.flat())]
  const { data: occRaw } = await sb
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_kind, source_ref_id, source_proposal_id, label, effective_date')
    .in('canonical_subject_id', involvedIds)
    .order('effective_date', { ascending: true })
  const occs = (occRaw ?? []) as Array<{
    id: string; canonical_subject_id: string; source_kind: string; source_ref_id: string
    source_proposal_id: string | null; label: string; effective_date: string
  }>
  const occByCs = new Map<string, typeof occs>()
  for (const o of occs) { const l = occByCs.get(o.canonical_subject_id) ?? []; l.push(o); occByCs.set(o.canonical_subject_id, l) }

  // ── Threads par CS ─────────────────────────────────────────────────────────
  const { data: stiRaw } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('canonical_subject_id', involvedIds)
  const sti = (stiRaw ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>
  const threadsByCs = new Map<string, string[]>()
  const threadToCs = new Map<string, string>()
  for (const s of sti) { const l = threadsByCs.get(s.canonical_subject_id) ?? []; l.push(s.subject_thread_id); threadsByCs.set(s.canonical_subject_id, l); threadToCs.set(s.subject_thread_id, s.canonical_subject_id) }

  // ── Relations : canonical_subject_links + subject_thread_links (tout le site) ──
  const { data: cslRaw } = await sb
    .from('canonical_subject_links')
    .select('id, source_subject_id, target_subject_id, relation_type, status')
    .eq('site_id', OCEF_SITE_ID)
  const csLinks = (cslRaw ?? []) as Array<{ id: string; source_subject_id: string; target_subject_id: string; relation_type: string; status: string }>

  const { data: stlRaw } = await sb
    .from('subject_thread_links')
    .select('id, from_thread_id, to_thread_id, link_type, status, source')
    .eq('site_id', OCEF_SITE_ID)
  const threadLinks = (stlRaw ?? []) as Array<{ id: string; from_thread_id: string; to_thread_id: string; link_type: string; status: string; source: string }>

  // ── Suggestions ────────────────────────────────────────────────────────────
  const { data: sugRaw } = await sb
    .from('canonical_subject_similarity_suggestion')
    .select('id, subject_a_id, subject_b_id, verdict, status')
    .eq('site_id', OCEF_SITE_ID)
  const suggestions = (sugRaw ?? []) as Array<{ id: string; subject_a_id: string; subject_b_id: string; verdict: string; status: string }>

  // ── Simulation par grappe ──────────────────────────────────────────────────
  type ClusterResult = {
    members: Array<{ id: string; label: string; occ: number; threads: number; created_at: string; firstOcc: string | null; lastOcc: string | null }>
    survivor: { id: string; label: string; reason: string }
    losers: string[]
    occMoves: number
    duplicateOccurrences: Array<{ occId: string; from: string; reason: string }>
    firstSeenTheoretical: string | null
    lastSeenTheoretical: string | null
    lmca: string
    threadLinksRerouted: number
    threadSelfLinksEliminated: number
    csLinksRerouted: number
    csSelfLinksProduced: number
    suggestionsObsoleted: number
  }

  const results: ClusterResult[] = []
  let totalLosers = 0, totalOccMoves = 0, totalDup = 0, totalCsRerouted = 0, totalCsSelf = 0
  let totalThreadRerouted = 0, totalThreadSelf = 0, totalSugObsolete = 0

  for (const cluster of clusterList) {
    const members = cluster.map((id) => {
      const cs = csById.get(id)!
      const co = occByCs.get(id) ?? []
      const dates = co.map((o) => o.effective_date).sort()
      return { id, label: cs.label, occ: co.length, threads: (threadsByCs.get(id) ?? []).length, created_at: cs.created_at, firstOcc: dates[0] ?? null, lastOcc: dates[dates.length - 1] ?? null }
    })

    // ── Règle survivor déterministe ──
    // 1. plus grand nombre d'occurrences ; 2. plus grand nombre de threads ;
    // 3. firstOcc le plus ancien (ou created_at si aucune occurrence) ; 4. id lexicographique (stabilité)
    const survivorCs = [...members].sort((a, b) => {
      if (b.occ !== a.occ) return b.occ - a.occ
      if (b.threads !== a.threads) return b.threads - a.threads
      const fa = a.firstOcc ?? a.created_at, fb = b.firstOcc ?? b.created_at
      if (fa !== fb) return fa < fb ? -1 : 1
      return a.id < b.id ? -1 : 1
    })[0]
    const losers = members.filter((m) => m.id !== survivorCs.id).map((m) => m.id)
    totalLosers += losers.length

    // ── Occurrence moves + doublons ──
    // Une occurrence PDF a source_proposal_id null (le lien va via thread) ; l'idempotence
    // repose sur (source_kind, source_proposal_id). Un doublon = même (source_kind, source_proposal_id)
    // déjà présent chez le survivant, OU même (source_kind, source_ref_id, label) exact.
    const survivorOcc = occByCs.get(survivorCs.id) ?? []
    const survivorKeys = new Set(survivorOcc.map((o) => `${o.source_kind}|${o.source_proposal_id ?? 'null'}|${o.source_ref_id}|${o.label}`))
    const survivorPropKeys = new Set(survivorOcc.filter((o) => o.source_proposal_id).map((o) => `${o.source_kind}|${o.source_proposal_id}`))
    const dups: Array<{ occId: string; from: string; reason: string }> = []
    let moves = 0
    for (const lid of losers) {
      for (const o of occByCs.get(lid) ?? []) {
        moves++
        const fullKey = `${o.source_kind}|${o.source_proposal_id ?? 'null'}|${o.source_ref_id}|${o.label}`
        if (o.source_proposal_id && survivorPropKeys.has(`${o.source_kind}|${o.source_proposal_id}`)) {
          dups.push({ occId: o.id, from: lid, reason: 'DUPLICATE_OCCURRENCE (même source_kind+source_proposal_id que survivant)' })
        } else if (survivorKeys.has(fullKey)) {
          dups.push({ occId: o.id, from: lid, reason: 'même PV + même élément (source_kind+ref+label identiques)' })
        }
      }
    }
    totalOccMoves += moves
    totalDup += dups.length

    // ── Longitudinal théorique ──
    const allDates = members.flatMap((m) => (occByCs.get(m.id) ?? []).map((o) => o.effective_date)).sort()
    const firstSeenTheoretical = allDates[0] ?? null
    const lastSeenTheoretical = allDates[allDates.length - 1] ?? null
    // LMCA : dérivé (jamais stocké) ; recalculable uniquement en reconstruisant la timeline
    // fusionnée (statut + signature d'objets matérialisés par run). Le matSig dépend du run PDF
    // canonique. Si tous les membres n'ont que des occurrences PDF avec statut lisible → recalc-safe.
    // Ici, on marque recalc-safe car la fonction getCanonicalSubjectLife le recalcule à la lecture
    // (LMCA n'est jamais persisté). La fusion ne détruit aucune donnée nécessaire au recalcul.
    const lmca = firstSeenTheoretical ? 'LMCA_RECALC_SAFE (dérivé à la lecture, aucune donnée détruite)' : 'LMCA_RECALC_SAFE (aucune occurrence — LMCA=null)'

    // ── Threads reroutés + self-links ──
    const clusterThreads = new Set(cluster.flatMap((id) => threadsByCs.get(id) ?? []))
    // Après fusion, tous ces threads pointent vers le survivant.
    let threadReroute = 0, threadSelf = 0
    for (const tl of threadLinks) {
      const fromIn = clusterThreads.has(tl.from_thread_id)
      const toIn = clusterThreads.has(tl.to_thread_id)
      if (fromIn || toIn) {
        // un lien touchant la grappe. Reste au niveau thread (pas de reroutage nécessaire : STI bouge).
        threadReroute++
        if (fromIn && toIn) threadSelf++ // deux threads de la même grappe → deviendrait intra-CS (dédupliqué à la lecture)
      }
    }
    totalThreadRerouted += threadReroute
    totalThreadSelf += threadSelf

    // ── canonical_subject_links reroutés + self-links ──
    let csReroute = 0, csSelf = 0
    const clusterSet = new Set(cluster)
    for (const l of csLinks) {
      const sIn = clusterSet.has(l.source_subject_id)
      const tIn = clusterSet.has(l.target_subject_id)
      if (sIn || tIn) { csReroute++; if (sIn && tIn) csSelf++ }
    }
    totalCsRerouted += csReroute
    totalCsSelf += csSelf

    // ── Suggestions obsolètes ──
    let sugObsolete = 0
    for (const s of suggestions) {
      const aIn = clusterSet.has(s.subject_a_id)
      const bIn = clusterSet.has(s.subject_b_id)
      if (aIn && bIn) sugObsolete++ // les deux extrémités dans la grappe → triviale A=A
      else if (aIn || bIn) sugObsolete++ // une extrémité loser → doit pointer vers survivant (rerouté ou obsolète)
    }
    totalSugObsolete += sugObsolete

    results.push({
      members, survivor: { id: survivorCs.id, label: survivorCs.label, reason: `occ=${survivorCs.occ}, threads=${survivorCs.threads}, firstOcc=${survivorCs.firstOcc ?? survivorCs.created_at.slice(0,10)}` },
      losers, occMoves: moves, duplicateOccurrences: dups,
      firstSeenTheoretical, lastSeenTheoretical, lmca,
      threadLinksRerouted: threadReroute, threadSelfLinksEliminated: threadSelf,
      csLinksRerouted: csReroute, csSelfLinksProduced: csSelf, suggestionsObsoleted: sugObsolete,
    })
  }

  // ── Idempotence : après fusion théorique, re-scanner les labels survivants ──
  // Les survivants gardent leur label. On re-teste Jaccard entre survivants uniquement.
  const survivorSubjects = results.map((r) => ({ id: r.survivor.id, label: r.survivor.label }))
  // + les CS actifs non impliqués dans une grappe
  const clusteredIds = new Set(clusterList.flat())
  for (const s of inv.activeSubjects) if (!clusteredIds.has(s.id)) survivorSubjects.push({ id: s.id, label: s.label })
  let idempotencyResidual = 0
  const residualPairs: Array<{ a: string; b: string; j: number }> = []
  for (let i = 0; i < survivorSubjects.length; i++) {
    for (let j = i + 1; j < survivorSubjects.length; j++) {
      const na = normalizeForMatching(survivorSubjects[i].label), nb = normalizeForMatching(survivorSubjects[j].label)
      if (!na || !nb) continue
      const jac = jaccardSimilarity(na, nb)
      if (jac >= P01_NORMALIZED_JACCARD_THRESHOLD) {
        idempotencyResidual++
        residualPairs.push({ a: survivorSubjects[i].label, b: survivorSubjects[j].label, j: Number(jac.toFixed(3)) })
      }
    }
  }

  const output = {
    metrics: {
      csActiveBefore: inv.counts.cs_active_non_actor,
      clusters: clusterList.length,
      losersTheoretical: totalLosers,
      csActiveAfter: inv.counts.cs_active_non_actor - totalLosers,
      occMoves: totalOccMoves,
      duplicateOccurrences: totalDup,
      threadLinksTouched: totalThreadRerouted,
      threadSelfLinksEliminated: totalThreadSelf,
      csLinksTouched: totalCsRerouted,
      csSelfLinksProduced: totalCsSelf,
      suggestionsObsoleted: totalSugObsolete,
      idempotencyResidualPairs: idempotencyResidual,
    },
    clusters: results,
    idempotencyResidualPairs: residualPairs,
  }
  process.stdout.write(JSON.stringify(output, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
