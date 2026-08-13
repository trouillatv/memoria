// Audit des 6 nouveaux canonical_subjects PETRO créés par V4/V5
// But : identifier fragmentation et doublons avant P0-F (rendu life-line)
// Sortie :
//   1. Liste historiques (8) vs nouveaux (6)
//   2. Pour chaque nouveau CS : occurrences + labels + reports associés
//   3. Overlap : nouveaux CS partageant un site_report avec un historique
//   4. Paires de nouveaux CS proches (même rapport + labels similaires)

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
// Cutoff : le nettoyage PETRO (3 fusions → 8 sujets) a été clos le 2026-08-12.
// Les 6 nouveaux ont été créés par le pipeline V4/V5 après cette date.
const CUTOFF = '2026-08-12T00:00:00Z'

type CS = { id: string; label: string; created_at: string }
type Occ = {
  id: string
  canonical_subject_id: string
  source_ref_id: string   // = site_reports.id
  effective_date: string
  label: string
  note: string | null
  visit_status: string | null
}

async function main() {
  // ── 1. Tous les CS actifs PETRO ──────────────────────────────────────────────
  const { data: allCs, error: csErr } = await sb
    .from('canonical_subject')
    .select('id, label, created_at')
    .eq('site_id', PETRO_SITE_ID)
    .eq('status', 'active')
    .order('created_at')

  if (csErr || !allCs) { console.error(csErr); process.exit(1) }
  const subjects = allCs as CS[]

  const historical = subjects.filter(s => s.created_at < CUTOFF)
  const newCs      = subjects.filter(s => s.created_at >= CUTOFF)

  console.log(`\n═══════════════════════════════════════════════════════`)
  console.log(`AUDIT nouveaux CS PETRO ATITI (V4/V5)`)
  console.log(`Total actifs : ${subjects.length}  (historiques: ${historical.length}, nouveaux: ${newCs.length})`)
  console.log(`═══════════════════════════════════════════════════════\n`)

  if (newCs.length === 0) {
    console.log('Aucun nouveau CS trouvé après le cutoff — vérifier la date CUTOFF.')
    return
  }

  // ── 2. Occurrences de tous les CS ───────────────────────────────────────────
  const allIds = subjects.map(s => s.id)
  const { data: occRows, error: occErr } = await sb
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_ref_id, effective_date, label, note, visit_status')
    .in('canonical_subject_id', allIds)
    .order('effective_date')

  if (occErr) { console.error(occErr); process.exit(1) }
  const occs = (occRows ?? []) as Occ[]

  // Index : report → liste de CS (historiques) qui l'ont
  const historicalIds = new Set(historical.map(s => s.id))
  const reportToHistoricalCs = new Map<string, string[]>()
  for (const o of occs) {
    if (!historicalIds.has(o.canonical_subject_id)) continue
    if (!reportToHistoricalCs.has(o.source_ref_id))
      reportToHistoricalCs.set(o.source_ref_id, [])
    reportToHistoricalCs.get(o.source_ref_id)!.push(o.canonical_subject_id)
  }

  // Index : csId → label du CS
  const csLabel = new Map(subjects.map(s => [s.id, s.label]))

  // ── 3. Sujets historiques ────────────────────────────────────────────────────
  console.log(`── HISTORIQUES (${historical.length}) ─────────────────────────────────────`)
  for (const s of historical) {
    const myOccs = occs.filter(o => o.canonical_subject_id === s.id)
    const reports = [...new Set(myOccs.map(o => o.source_ref_id))]
    console.log(`  [${myOccs.length} occ / ${reports.length} visites] ${s.label}`)
  }

  // ── 4. Nouveaux CS — détail complet ─────────────────────────────────────────
  console.log(`\n── NOUVEAUX (${newCs.length}) — créés le/après ${CUTOFF.slice(0,10)} ─────`)
  for (const s of newCs) {
    const myOccs = occs.filter(o => o.canonical_subject_id === s.id)
    const reportIds = [...new Set(myOccs.map(o => o.source_ref_id))]

    // Overlap avec historiques
    const overlappingHistorical: string[] = []
    for (const rid of reportIds) {
      const hIds = reportToHistoricalCs.get(rid) ?? []
      for (const hId of hIds) {
        const lbl = csLabel.get(hId)!
        if (!overlappingHistorical.includes(lbl)) overlappingHistorical.push(lbl)
      }
    }

    console.log(`\n┌─ ${s.label}`)
    console.log(`│  Créé le    : ${s.created_at.slice(0, 16)}`)
    console.log(`│  Occurrences: ${myOccs.length}  |  Visites distinctes : ${reportIds.length}`)

    if (overlappingHistorical.length > 0) {
      console.log(`│  ⚠ OVERLAP avec historique(s) :`)
      for (const h of overlappingHistorical) console.log(`│     → ${h}`)
    } else {
      console.log(`│  ✓ Aucun overlap avec les historiques`)
    }

    console.log(`│  Occurrences détail :`)
    for (const o of myOccs) {
      const date = o.effective_date?.slice(0, 10) ?? '?'
      const status = o.visit_status ? ` [${o.visit_status}]` : ''
      console.log(`│    ${date}${status} — ${o.label}`)
      if (o.note) console.log(`│        note: ${o.note.slice(0, 100)}`)
    }
    console.log(`└`)
  }

  // ── 5. Paires de nouveaux CS avec visites communes ──────────────────────────
  console.log(`\n── PAIRES de nouveaux CS partageant ≥1 visite ───────────`)
  const newReportSets = new Map<string, Set<string>>()
  for (const s of newCs) {
    const myOccs = occs.filter(o => o.canonical_subject_id === s.id)
    newReportSets.set(s.id, new Set(myOccs.map(o => o.source_ref_id)))
  }

  let pairFound = false
  for (let i = 0; i < newCs.length; i++) {
    for (let j = i + 1; j < newCs.length; j++) {
      const a = newCs[i], b = newCs[j]
      const setA = newReportSets.get(a.id)!
      const common = [...newReportSets.get(b.id)!].filter(r => setA.has(r))
      if (common.length > 0) {
        pairFound = true
        console.log(`  ⚠ ${common.length} visite(s) communes :`)
        console.log(`     A: ${a.label}`)
        console.log(`     B: ${b.label}`)

        // Montrer les labels d'occurrences en vis-à-vis pour chaque visite commune
        for (const rid of common) {
          const labelsA = occs.filter(o => o.canonical_subject_id === a.id && o.source_ref_id === rid).map(o => o.label)
          const labelsB = occs.filter(o => o.canonical_subject_id === b.id && o.source_ref_id === rid).map(o => o.label)
          const date = occs.find(o => o.source_ref_id === rid)?.effective_date?.slice(0, 10) ?? '?'
          console.log(`     — Visite ${date}:`)
          console.log(`       A: ${labelsA.join(' / ')}`)
          console.log(`       B: ${labelsB.join(' / ')}`)
        }
      }
    }
  }
  if (!pairFound) console.log('  ✓ Aucune visite commune entre deux nouveaux CS.')

  // ── 6. Résumé consolidé pour décision humaine ────────────────────────────────
  console.log(`\n═══════════════════════════════════════════════════════`)
  console.log(`DÉCISION À PRENDRE POUR CHAQUE NOUVEAU CS`)
  console.log(`  (A) Vrai nouveau sujet → garder tel quel`)
  console.log(`  (B) Évolution d'un historique → fusionner ou lier`)
  console.log(`  (C) Doublon/fragmentation → fusionner`)
  console.log(`  (D) Sujet distinct mais lié → garder, ajouter relation`)
  console.log(`═══════════════════════════════════════════════════════\n`)
  for (const s of newCs) {
    console.log(`  [ ] ${s.label}`)
  }
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
