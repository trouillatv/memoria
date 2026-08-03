/**
 * Recette de clôture — Graphe historique V1 sur OCEF Compostage
 *
 * Vérifie 4 niveaux pour chacun des 5 sujets cibles :
 *   1. Fragmentation : combien de canonical_subject recouvrent ce thème
 *   2. Occurrences PV : apparitions dans les documents via subject_thread
 *   3. Événements métier matérialisés : actions / décisions / réserves / échéances
 *   4. Acteurs associés (FK fiables seulement)
 *
 * READ ONLY.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// OCEF site IDs détectés lors du dry-run
const OCEF_SITES = [
  '2c939e67-e986-4635-86a0-638cda870480',
  '655edb00-032d-4379-b76d-d598c2c7c254',
]

// Sujets cibles : mots-clés pour repérer les canonical_subjects pertinents
const TARGETS: Array<{ name: string; keywords: string[] }> = [
  { name: 'Regard R4',       keywords: ['r4', 'regard r4'] },
  { name: 'Rapport G3',      keywords: ['g3', 'rapport g3', 'avis g3'] },
  { name: 'Débourbeur',      keywords: ['débourbeur', 'debourbeur'] },
  { name: 'Lagunage',        keywords: ['lagunage'] },
  { name: 'Couche de forme', keywords: ['couche de forme'] },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesKeywords(label: string, keywords: string[]): boolean {
  const l = label.toLowerCase()
  return keywords.some((k) => l.includes(k))
}

async function recetteForTarget(target: { name: string; keywords: string[] }) {
  console.log(`\n${'═'.repeat(72)}`)
  console.log(`  SUJET : ${target.name}`)
  console.log('═'.repeat(72))

  // ── Niveau 1 : canonical_subjects concernés ─────────────────────────────
  const { data: allCs } = await sb
    .from('canonical_subject')
    .select('id, label, status, site_id')
    .in('site_id', OCEF_SITES)

  const matchingCs = ((allCs ?? []) as Array<{ id: string; label: string; status: string; site_id: string }>)
    .filter((r) => matchesKeywords(r.label, target.keywords))

  console.log(`\n[1] Fragmentation : ${matchingCs.length} canonical_subject(s) détecté(s)`)
  for (const cs of matchingCs) {
    console.log(`    [${cs.status}] ${cs.label}`)
    console.log(`         → id: ${cs.id}`)
  }

  if (matchingCs.length === 0) {
    console.log('    ⚠ Aucun canonical_subject trouvé pour ce thème.')
    return
  }

  const csIds = matchingCs.map((cs) => cs.id)

  // ── Niveau 2 : occurrences PV ────────────────────────────────────────────
  // Thread IDs rattachés à ces canonical_subjects
  const { data: stiRows } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('canonical_subject_id', csIds)

  const threadIds = ((stiRows ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)
    .map((r) => r.subject_thread_id)

  const threadToCs = new Map(
    ((stiRows ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)
      .map((r) => [r.subject_thread_id, r.canonical_subject_id]),
  )

  console.log(`\n[2] Threads rattachés : ${threadIds.length}`)

  if (threadIds.length === 0) {
    console.log('    ⚠ Aucun thread → sujet non traçable dans les PV.')
  } else {
    // Proposals portant ces threads
    const { data: propRows } = await sb
      .from('document_extraction_proposal')
      .select('id, extraction_run_id, subject_thread_id, label, proposal_family, document_status')
      .in('subject_thread_id', threadIds)
      .order('extraction_run_id')

    // Regrouper par run pour compter les PV
    const runSet = new Set(
      ((propRows ?? []) as Array<{ extraction_run_id: string }>).map((r) => r.extraction_run_id),
    )
    console.log(`    Occurrences PV : ${runSet.size} run(s) distincts / ${(propRows ?? []).length} proposition(s)`)

    // Détail compact : label, famille, statut
    const byCs = new Map<string, Array<{ label: string; family: string; status: string }>>()
    for (const r of (propRows ?? []) as Array<{ subject_thread_id: string; label: string; proposal_family: string; document_status: string }>) {
      const csId = threadToCs.get(r.subject_thread_id) ?? '?'
      if (!byCs.has(csId)) byCs.set(csId, [])
      byCs.get(csId)!.push({ label: r.label, family: r.proposal_family, status: r.document_status })
    }

    for (const cs of matchingCs) {
      const occ = byCs.get(cs.id) ?? []
      if (occ.length === 0) continue
      const families = [...new Set(occ.map((o) => o.family))].join(', ')
      const statuses = [...new Set(occ.map((o) => o.status).filter(Boolean))].join(', ')
      console.log(`    → [${cs.id.slice(0, 8)}] ${occ.length} prop. — familles: ${families} — statuts: ${statuses || 'n/a'}`)
      // Premier et dernier label
      if (occ.length > 0) {
        console.log(`       Exemple : « ${occ[0].label.slice(0, 80)} »`)
      }
    }

    // ── Niveau 3 : événements matérialisés ──────────────────────────────────
    const proposalIds = ((propRows ?? []) as Array<{ id: string }>).map((r) => r.id)

    const { data: matRows } = await sb
      .from('document_proposal_materialization')
      .select('target_entity_type, target_entity_id, proposal_id')
      .in('proposal_id', proposalIds)
      .in('target_entity_type', ['site_action', 'site_decision', 'site_reserve', 'site_deadline'])

    const byType = new Map<string, Array<{ entityId: string; proposalId: string }>>()
    for (const r of (matRows ?? []) as Array<{ target_entity_type: string; target_entity_id: string; proposal_id: string }>) {
      if (!byType.has(r.target_entity_type)) byType.set(r.target_entity_type, [])
      byType.get(r.target_entity_type)!.push({ entityId: r.target_entity_id, proposalId: r.proposal_id })
    }

    const totalMat = (matRows ?? []).length
    console.log(`\n[3] Événements matérialisés : ${totalMat} total`)

    // site_actions
    const actionItems = byType.get('site_action') ?? []
    if (actionItems.length > 0) {
      const { data: actions } = await sb
        .from('site_actions')
        .select('id, title, status, due_date, assigned_company_id, assigned_contact_id')
        .in('id', actionItems.map((a) => a.entityId))
      console.log(`    site_action (${actions?.length ?? 0}) :`)
      for (const a of (actions ?? []) as Array<{ id: string; title: string; status: string; due_date: string | null; assigned_company_id: string | null }>) {
        const hasActor = a.assigned_company_id ? '✓ acteur' : '∅ acteur'
        console.log(`       [${a.status}] ${a.title.slice(0, 70)} ${hasActor}`)
      }
    }

    // site_decisions
    const decisionItems = byType.get('site_decision') ?? []
    if (decisionItems.length > 0) {
      const { data: decisions } = await sb
        .from('site_decisions')
        .select('id, titre, statut, decisionnaire_company_id, subject_id')
        .in('id', decisionItems.map((d) => d.entityId))
      console.log(`    site_decision (${decisions?.length ?? 0}) :`)
      for (const d of (decisions ?? []) as Array<{ id: string; titre: string; statut: string; decisionnaire_company_id: string | null; subject_id: string | null }>) {
        const hasActor = d.decisionnaire_company_id ? '✓ acteur' : '∅ acteur'
        const hasSubj = d.subject_id ? '✓ sujet' : '∅ sujet'
        console.log(`       [${d.statut}] ${d.titre.slice(0, 70)} ${hasActor} ${hasSubj}`)
      }
    }

    // site_reserve
    const reserveItems = byType.get('site_reserve') ?? []
    if (reserveItems.length > 0) {
      const { data: reserves } = await sb
        .from('site_reserve')
        .select('id, label, status, responsible_company_id, subject_id')
        .in('id', reserveItems.map((r) => r.entityId))
      console.log(`    site_reserve (${reserves?.length ?? 0}) :`)
      for (const r of (reserves ?? []) as Array<{ id: string; label: string; status: string; responsible_company_id: string | null; subject_id: string | null }>) {
        const hasActor = r.responsible_company_id ? '✓ responsable' : '∅ responsable'
        const hasSubj = r.subject_id ? '✓ sujet' : '∅ sujet'
        console.log(`       [${r.status}] ${r.label.slice(0, 70)} ${hasActor} ${hasSubj}`)
      }
    }

    // site_deadlines
    const deadlineItems = byType.get('site_deadline') ?? []
    if (deadlineItems.length > 0) {
      const { data: deadlines } = await sb
        .from('site_deadlines')
        .select('id, title, status, due_date, assigned_company_id, assigned_contact_id, subject_id')
        .in('id', deadlineItems.map((d) => d.entityId))
      console.log(`    site_deadline (${deadlines?.length ?? 0}) :`)
      for (const d of (deadlines ?? []) as Array<{ id: string; title: string; status: string; due_date: string | null; assigned_company_id: string | null; subject_id: string | null }>) {
        const hasActor = d.assigned_company_id ? '✓ acteur' : '∅ acteur'
        const hasSubj = d.subject_id ? '✓ sujet' : '∅ sujet'
        const due = d.due_date ? d.due_date.slice(0, 10) : 'n/a'
        console.log(`       [${d.status}] ${d.title.slice(0, 60)} due:${due} ${hasActor} ${hasSubj}`)
      }
    }

    if (totalMat === 0) {
      console.log('    (aucun objet matérialisé — sujet documentaire uniquement, normal)')
    }
  }

  // ── Niveau 4 : cohérence de la synthèse ─────────────────────────────────
  console.log(`\n[4] Synthèse`)
  if (matchingCs.length > 1) {
    const activeCs = matchingCs.filter((cs) => cs.status === 'active')
    if (activeCs.length > 1) {
      console.log(`    ⚠ ${activeCs.length} canonical_subjects actifs pour ce thème → fragmentation non résolue.`)
      console.log('    Attendu : merges manuels ou résolution LLM (Lot 2/3 moteur V2).')
    } else {
      console.log(`    ✓ ${matchingCs.length} canonical_subjects dont ${activeCs.length} actif — fragmentation gérée.`)
    }
  } else {
    console.log(`    ✓ 1 seul canonical_subject — pas de fragmentation.`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // D'abord : identifier les deux chantiers OCEF
  const { data: siteRows } = await sb
    .from('sites')
    .select('id, name')
    .in('id', OCEF_SITES)
  console.log('Chantiers OCEF :')
  for (const r of (siteRows ?? []) as Array<{ id: string; name: string }>) {
    console.log(`  ${r.id} → ${r.name}`)
  }

  for (const target of TARGETS) {
    await recetteForTarget(target)
  }

  console.log(`\n${'═'.repeat(72)}`)
  console.log('  FIN RECETTE')
  console.log('═'.repeat(72))
}

main().catch(console.error)
