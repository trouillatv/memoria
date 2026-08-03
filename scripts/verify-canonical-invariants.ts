/**
 * Vérification des invariants canoniques post-backfill mig 279
 *
 * Contrôles :
 *   1. R4 — 1 seul canonical "regard R4" / "réseau R4", N threads
 *   2. G3 — purge et dalle doivent rester dans des canonicals distincts
 *   3. Lagunage — busage et raccordement distincts
 *   4. Couche de forme — non mergée (1 thread = 1 canonical)
 *   5. Vue d'ensemble OCEF — tous les canonicals créés lors du seed 1:1
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/verify-canonical-invariants.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceKey) {
  console.error('[FATAL] env manquant')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

type CanonicalRow = {
  canonical_subject_id: string
  cs_label: string
  nb_threads: number
  site_name: string
}

async function canonicalsByLabel(siteId: string, pattern: string): Promise<CanonicalRow[]> {
  // Cherche les canonical_subject dont le label ou un des alias contient le pattern,
  // ET qui ont au moins un thread relié via subject_thread_identity sur ce site.
  const { data, error } = await supabase
    .from('subject_thread_identity')
    .select(`
      canonical_subject_id,
      canonical_subject!inner(label, site_id),
      subject_thread_id
    `)
    .eq('site_id', siteId)

  if (error) throw new Error(error.message)

  type STIRow = {
    canonical_subject_id: string
    canonical_subject: { label: string; site_id: string }
    subject_thread_id: string
  }

  const rows = (data ?? []) as STIRow[]

  // Filtre et agrège
  const agg = new Map<string, { label: string; threads: Set<string> }>()
  for (const r of rows) {
    if (!r.canonical_subject.label.toLowerCase().includes(pattern.toLowerCase())) continue
    if (!agg.has(r.canonical_subject_id)) {
      agg.set(r.canonical_subject_id, { label: r.canonical_subject.label, threads: new Set() })
    }
    agg.get(r.canonical_subject_id)!.threads.add(r.subject_thread_id)
  }

  return [...agg.entries()].map(([id, v]) => ({
    canonical_subject_id: id,
    cs_label: v.label,
    nb_threads: v.threads.size,
    site_name: '',
  }))
}

async function getOcefSiteId(): Promise<string | null> {
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .ilike('name', '%OCEF%')
    .limit(10)

  const sites = (data ?? []) as Array<{ id: string; name: string }>
  if (sites.length === 0) return null

  // Audit des canonicals par site OCEF
  const counts: Array<{ id: string; name: string; cs: number }> = []
  for (const s of sites) {
    const { count } = await supabase
      .from('canonical_subject')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', s.id)
    counts.push({ id: s.id, name: s.name, cs: count ?? 0 })
  }

  console.log('Chantiers OCEF trouvés :')
  for (const c of counts) console.log(`  ${c.id.slice(0, 8)}… — "${c.name}" — ${c.cs} canonicals`)

  // Prend le site avec le plus de canonicals (le backfill cible le bon)
  const best = counts.sort((a, b) => b.cs - a.cs)[0]
  if (best.cs === 0) {
    console.log('  ⚠️  Aucun site OCEF avec des canonical_subjects — backfill non appliqué ?')
    return null
  }
  console.log(`\n  → Site retenu : "${best.name}" (${best.id.slice(0, 8)})`)
  return best.id
}

async function main() {
  console.log('\n=== verify-canonical-invariants ===\n')

  const siteId = await getOcefSiteId()
  if (!siteId) {
    console.error('[FATAL] Aucun chantier OCEF trouvé.')
    process.exit(1)
  }
  console.log()

  // ── Invariant 1 — Regard R4 ──────────────────────────────────────────────────
  console.log('── Invariant 1 : Regard R4 ──')
  const r4 = await canonicalsByLabel(siteId, 'r4')
  if (r4.length === 0) {
    console.log('  ⚠️  Aucun canonical contenant "r4" — vérifier les labels.')
  } else {
    for (const c of r4) {
      console.log(`  [${c.nb_threads} thread(s)] ${c.canonical_subject_id.slice(0, 8)}… — "${c.cs_label}"`)
    }
    // Vérifier unicité : idéalement 1 seul canonical avec plusieurs threads (merge)
    const r4Canonicals = new Set(r4.map((c) => c.canonical_subject_id))
    if (r4Canonicals.size === 1 && r4[0].nb_threads > 1) {
      console.log(`  ✅ R4 : 1 canonical, ${r4[0].nb_threads} thread(s) — merge validé.`)
    } else if (r4Canonicals.size > 1) {
      console.log(`  ℹ️  R4 : ${r4Canonicals.size} canonicals distincts (pas encore mergés ou séparation voulue).`)
    } else {
      console.log(`  ℹ️  R4 : 1 canonical, 1 thread (seed 1:1 standard).`)
    }
  }

  // ── Invariant 2 — G3 : purge et dalle séparés ────────────────────────────────
  console.log('\n── Invariant 2 : G3 (purge vs dalle) ──')
  const g3 = await canonicalsByLabel(siteId, 'g3')
  if (g3.length === 0) {
    console.log('  ⚠️  Aucun canonical contenant "g3".')
  } else {
    for (const c of g3) {
      console.log(`  [${c.nb_threads} thread(s)] ${c.canonical_subject_id.slice(0, 8)}… — "${c.cs_label}"`)
    }
    const hasPurge = g3.some((c) => c.cs_label.toLowerCase().includes('purge'))
    const hasDalle = g3.some((c) => c.cs_label.toLowerCase().includes('dalle'))
    if (hasPurge && hasDalle) {
      const purgeId = g3.find((c) => c.cs_label.toLowerCase().includes('purge'))?.canonical_subject_id
      const dalleId = g3.find((c) => c.cs_label.toLowerCase().includes('dalle'))?.canonical_subject_id
      if (purgeId !== dalleId) {
        console.log('  ✅ G3 purge et G3 dalle dans des canonicals distincts.')
      } else {
        console.log('  ❌ G3 purge et G3 dalle dans le MÊME canonical — régression de merge.')
      }
    } else {
      console.log('  ℹ️  Labels G3 visibles ci-dessus (purge/dalle non détectés dans les labels).')
    }
  }

  // ── Invariant 3 — Lagunage : busage et raccordement ─────────────────────────
  console.log('\n── Invariant 3 : Lagunage ──')
  const lagunage = await canonicalsByLabel(siteId, 'lagunage')
  if (lagunage.length === 0) {
    console.log('  ⚠️  Aucun canonical contenant "lagunage".')
  } else {
    for (const c of lagunage) {
      console.log(`  [${c.nb_threads} thread(s)] ${c.canonical_subject_id.slice(0, 8)}… — "${c.cs_label}"`)
    }
  }

  // ── Invariant 4 — Couche de forme : non mergée ───────────────────────────────
  console.log('\n── Invariant 4 : Couche de forme ──')
  const couche = await canonicalsByLabel(siteId, 'couche de forme')
  if (couche.length === 0) {
    console.log('  ⚠️  Aucun canonical contenant "couche de forme".')
  } else {
    for (const c of couche) {
      const merged = c.nb_threads > 1 ? ' ⚠️  MERGÉ' : ' ✅ 1:1'
      console.log(`  [${c.nb_threads} thread(s)]${merged} ${c.canonical_subject_id.slice(0, 8)}… — "${c.cs_label}"`)
    }
  }

  // ── Vue d'ensemble OCEF ──────────────────────────────────────────────────────
  console.log('\n── Vue d\'ensemble canonicals OCEF (tous) ──')
  const { data: allSti, error: allErr } = await supabase
    .from('subject_thread_identity')
    .select('canonical_subject_id, source, canonical_subject!inner(label)')
    .eq('site_id', siteId)

  if (allErr) throw new Error(allErr.message)

  type AllRow = {
    canonical_subject_id: string
    source: string
    canonical_subject: { label: string }
  }

  const allRows = (allSti ?? []) as AllRow[]
  const byCanonical = new Map<string, { label: string; sources: Set<string>; count: number }>()
  for (const r of allRows) {
    if (!byCanonical.has(r.canonical_subject_id)) {
      byCanonical.set(r.canonical_subject_id, { label: r.canonical_subject.label, sources: new Set(), count: 0 })
    }
    const entry = byCanonical.get(r.canonical_subject_id)!
    entry.sources.add(r.source)
    entry.count++
  }

  const merged   = [...byCanonical.values()].filter((v) => v.count > 1)
  const auto1to1 = [...byCanonical.values()].filter((v) => v.count === 1 && v.sources.has('auto'))
  const manual   = [...byCanonical.values()].filter((v) => v.sources.has('manual'))

  console.log(`  Total canonicals OCEF : ${byCanonical.size}`)
  console.log(`  Merges (N threads)     : ${merged.length}`)
  console.log(`  Seeds 1:1 (auto)       : ${auto1to1.length}`)
  console.log(`  Merges manuels         : ${manual.length}`)

  if (merged.length > 0) {
    console.log('\n  Canonicals avec plusieurs threads (merges) :')
    for (const [id, v] of byCanonical.entries()) {
      if (v.count > 1) {
        console.log(`    [${v.count} threads] ${id.slice(0, 8)}… — "${v.label}"`)
      }
    }
  }

  // ── Liens OCEF — pipeline confirmed → mapped → edges ────────────────────────
  console.log('\n── Pipeline getSiteDependencyGraph OCEF ──')
  const { data: confirmedLinks, error: clErr } = await supabase
    .from('subject_thread_links')
    .select('id, from_thread_id, to_thread_id, link_type')
    .eq('site_id', siteId)
    .eq('status', 'confirmed')

  if (clErr) throw new Error(clErr.message)

  const linkRows = (confirmedLinks ?? []) as Array<{ id: string; from_thread_id: string; to_thread_id: string; link_type: string }>
  console.log(`  confirmed links      : ${linkRows.length}`)

  // Charger STI pour les threads impliqués
  const allThreadIds = [...new Set([...linkRows.map((l) => l.from_thread_id), ...linkRows.map((l) => l.to_thread_id)])]
  const { data: stiData } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('subject_thread_id', allThreadIds)

  type StiRow = { subject_thread_id: string; canonical_subject_id: string }
  const threadToCanonical = new Map<string, string>()
  for (const r of (stiData ?? []) as StiRow[]) {
    threadToCanonical.set(r.subject_thread_id, r.canonical_subject_id)
  }

  const mappedThreads = allThreadIds.filter((t) => threadToCanonical.has(t)).length
  console.log(`  thread IDs dans STI  : ${mappedThreads} / ${allThreadIds.length}`)

  const seen = new Set<string>()
  let selfLoops = 0
  let finalEdges = 0
  for (const l of linkRows) {
    const from = threadToCanonical.get(l.from_thread_id)
    const to   = threadToCanonical.get(l.to_thread_id)
    if (!from || !to) continue
    if (from === to) { selfLoops++; continue }
    const key = `${from}:${to}:${l.link_type}`
    if (seen.has(key)) continue
    seen.add(key)
    finalEdges++
  }

  console.log(`  self-loops éliminés  : ${selfLoops}`)
  console.log(`  final edges (graphe) : ${finalEdges}`)

  if (finalEdges === 0 && linkRows.length > 0) {
    console.log('  ❌ 0 edge malgré des liens — vérifier STI mapping ci-dessus.')
  } else if (finalEdges > 0) {
    console.log(`  ✅ ${finalEdges} arête(s) dans le graphe OCEF.`)
  }

  // Afficher les arêtes
  if (finalEdges > 0) {
    console.log('\n  Arêtes du graphe :')
    const seen2 = new Set<string>()
    for (const l of linkRows) {
      const fromCid = threadToCanonical.get(l.from_thread_id)
      const toCid   = threadToCanonical.get(l.to_thread_id)
      if (!fromCid || !toCid || fromCid === toCid) continue
      const key = `${fromCid}:${toCid}:${l.link_type}`
      if (seen2.has(key)) continue
      seen2.add(key)
      // Chercher les labels
      const fromLabel = byCanonical.get(fromCid)?.label ?? fromCid.slice(0, 8)
      const toLabel   = byCanonical.get(toCid)?.label   ?? toCid.slice(0, 8)
      console.log(`    "${fromLabel}" ──${l.link_type}──▶ "${toLabel}"`)
    }
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1) })
