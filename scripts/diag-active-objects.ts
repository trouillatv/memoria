/**
 * Diagnostic P3 — activeObjects = 0 pour tous les sujets
 *
 * Trace la chaîne complète pour 3 sujets concrets :
 *   canonical_subject
 *   → subject_thread_identity
 *   → document_extraction_proposal (runs canoniques seulement)
 *   → document_proposal_materialization
 *   → site_action / site_reserve / site_deadline / site_decision (statut)
 *
 * Identifie l'étape exacte qui casse.
 *
 * Usage :
 *   npx tsx scripts/diag-active-objects.ts [PATTERN_SITE]
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

function sep(char = '─', n = 60) { return char.repeat(n) }

async function main() {
  // ── Site ────────────────────────────────────────────────────────────────────
  const { data: sites } = await sb.from('sites').select('id,name').is('deleted_at', null).ilike('name', `%${sitePattern}%`)
  const site = (sites ?? [])[0] as { id: string; name: string } | undefined
  if (!site) { console.error('Site introuvable:', sitePattern); process.exit(1) }
  const siteId = site.id
  console.log(`\n${sep('═')}\nDIAGNOSTIC activeObjects — ${site.name}\n${sep('═')}\n`)

  // ── Étape 1 : Runs canoniques ──────────────────────────────────────────────
  const { data: runs } = await sb
    .from('document_extraction_run')
    .select('id, created_at, is_canonical, target_site_id')
    .eq('target_site_id', siteId)
  const allRuns = (runs ?? []) as Array<{ id: string; created_at: string; is_canonical: boolean; target_site_id: string }>
  const canonicalRuns = allRuns.filter(r => r.is_canonical)
  console.log(`Runs total pour ce site       : ${allRuns.length}`)
  console.log(`Runs canoniques (is_canonical) : ${canonicalRuns.length}`)
  if (canonicalRuns.length === 0) {
    console.log('\n⛔ BLOCAGE : aucun run marqué is_canonical=true → 0 proposition chargée → activeObjects=0 pour tous.')
    console.log('   Vérifier : les runs doivent avoir is_canonical=true pour alimenter getNavigableSubjectsForSite()')
    // Afficher quelques runs non-canoniques pour comparaison
    for (const r of allRuns.slice(0, 5)) {
      console.log(`  run ${r.id.slice(0, 8)}… is_canonical=${r.is_canonical} created=${r.created_at.slice(0, 10)}`)
    }
    return
  }
  const runIds = canonicalRuns.map(r => r.id)

  // ── Étape 2 : Propositions des runs canoniques ─────────────────────────────
  const { data: allProps } = await sb
    .from('document_extraction_proposal')
    .select('id, extraction_run_id, subject_thread_id, proposal_family, label')
    .in('extraction_run_id', runIds)
    .not('subject_thread_id', 'is', null)
  const props = (allProps ?? []) as Array<{ id: string; extraction_run_id: string; subject_thread_id: string; proposal_family: string | null; label: string }>
  const actionLikeProps = props.filter(p => ['reservation', 'action', 'decision', 'deadline'].includes(p.proposal_family ?? ''))
  console.log(`\nPropositions dans runs canoniques : ${props.length}`)
  console.log(`  dont family action/réserve/décision/échéance : ${actionLikeProps.length}`)

  if (props.length === 0) {
    console.log('\n⛔ BLOCAGE : aucune proposition liée aux runs canoniques.')
    return
  }

  // ── Étape 3 : STI pour les threads ────────────────────────────────────────
  const threadIds = [...new Set(props.map(p => p.subject_thread_id))]
  const { data: stiData } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('subject_thread_id', threadIds)
  const threadToCsId = new Map((stiData ?? []).map((r: any) => [r.subject_thread_id, r.canonical_subject_id]))
  const threadsWithSTI = threadIds.filter(t => threadToCsId.has(t))
  const threadsWithoutSTI = threadIds.filter(t => !threadToCsId.has(t))
  console.log(`\nThreads dans les props canoniques : ${threadIds.length}`)
  console.log(`  avec STI (subject_thread_identity) : ${threadsWithSTI.length}`)
  console.log(`  sans STI (orphelins)               : ${threadsWithoutSTI.length}`)
  if (threadsWithoutSTI.length > 0) {
    console.log(`  Exemple orphelins : ${threadsWithoutSTI.slice(0, 3).map(t => t.slice(0, 8) + '…').join(', ')}`)
  }

  // ── Étape 4 : Matérialisations ─────────────────────────────────────────────
  const propIds = props.map(p => p.id)
  let matRows: Array<{ proposal_id: string; target_entity_id: string; target_entity_type: string }> = []
  for (let i = 0; i < propIds.length; i += 500) {
    const { data } = await sb
      .from('document_proposal_materialization')
      .select('proposal_id, target_entity_id, target_entity_type')
      .in('proposal_id', propIds.slice(i, i + 500))
    matRows.push(...((data ?? []) as typeof matRows))
  }
  const matFiltered = matRows.filter(m => ['site_action', 'site_decision', 'site_reserve', 'site_deadline'].includes(m.target_entity_type))
  const matOtherTypes = [...new Set(matRows.filter(m => !['site_action', 'site_decision', 'site_reserve', 'site_deadline'].includes(m.target_entity_type)).map(m => m.target_entity_type))]
  console.log(`\nMatérialisations totales liées aux props canoniques : ${matRows.length}`)
  console.log(`  avec target_entity_type attendu (action/réserve/etc.) : ${matFiltered.length}`)
  console.log(`  avec autre target_entity_type                          : ${matRows.length - matFiltered.length}`)
  if (matOtherTypes.length > 0) console.log(`  types non attendus : ${matOtherTypes.join(', ')}`)

  if (matRows.length === 0) {
    console.log('\n⛔ BLOCAGE : aucune ligne dans document_proposal_materialization pour ces propositions.')
    console.log('   Les propositions existent mais ne sont pas matérialisées.')
    console.log('   → Vérifier le pipeline de matérialisation après extraction.')

    // Chercher des matérialisations sur des runs non-canoniques pour comparaison
    const nonCanonRunIds = allRuns.filter(r => !r.is_canonical).map(r => r.id)
    if (nonCanonRunIds.length > 0) {
      const { data: nonCanProps } = await sb
        .from('document_extraction_proposal')
        .select('id')
        .in('extraction_run_id', nonCanonRunIds.slice(0, 10))
        .limit(500)
      const nonCanPropIds = (nonCanProps ?? []).map((p: any) => p.id)
      if (nonCanPropIds.length > 0) {
        const { count: nonCanMatCount } = await sb
          .from('document_proposal_materialization')
          .select('id', { count: 'exact', head: true })
          .in('proposal_id', nonCanPropIds.slice(0, 200))
        console.log(`\n  Comparaison : ${nonCanMatCount ?? 0} matérialisation(s) sur runs NON-canoniques (${nonCanPropIds.length} props)`)
      }
    }
    return
  }

  // ── Étape 5 : Vérification des entity IDs ─────────────────────────────────
  const actionIds   = [...new Set(matFiltered.filter(m => m.target_entity_type === 'site_action').map(m => m.target_entity_id))]
  const reserveIds  = [...new Set(matFiltered.filter(m => m.target_entity_type === 'site_reserve').map(m => m.target_entity_id))]
  const deadlineIds = [...new Set(matFiltered.filter(m => m.target_entity_type === 'site_deadline').map(m => m.target_entity_id))]
  const decisionIds = [...new Set(matFiltered.filter(m => m.target_entity_type === 'site_decision').map(m => m.target_entity_id))]

  console.log(`\nEntity IDs référencés dans les matérialisations :`)
  console.log(`  site_action   : ${actionIds.length} IDs distincts`)
  console.log(`  site_reserve  : ${reserveIds.length} IDs distincts`)
  console.log(`  site_deadline : ${deadlineIds.length} IDs distincts`)
  console.log(`  site_decision : ${decisionIds.length} IDs distincts`)

  // Vérifier que ces IDs existent dans les tables
  const fetchCount = async (table: string, ids: string[], idField = 'id') => {
    if (ids.length === 0) return { found: 0, statuses: [] as string[] }
    const { data } = await sb.from(table).select(`${idField}, status`).in(idField, ids.slice(0, 500))
    const rows = (data ?? []) as Array<{ status: string }>
    return { found: rows.length, statuses: [...new Set(rows.map(r => r.status))] }
  }
  const fetchDecisionCount = async (ids: string[]) => {
    if (ids.length === 0) return { found: 0, statuses: [] as string[] }
    const { data } = await sb.from('site_decisions').select('id, statut').in('id', ids.slice(0, 500))
    const rows = (data ?? []) as Array<{ statut: string | null }>
    return { found: rows.length, statuses: [...new Set(rows.map(r => r.statut ?? 'null'))] }
  }

  const [actionRes, reserveRes, deadlineRes, decisionRes] = await Promise.all([
    fetchCount('site_actions', actionIds),
    fetchCount('site_reserve', reserveIds),
    fetchCount('site_deadlines', deadlineIds),
    fetchDecisionCount(decisionIds),
  ])

  console.log(`\nEntités trouvées dans les tables :`)
  console.log(`  site_actions  : ${actionRes.found}/${actionIds.length} — statuts : [${actionRes.statuses.join(', ')}]`)
  console.log(`  site_reserve  : ${reserveRes.found}/${reserveIds.length} — statuts : [${reserveRes.statuses.join(', ')}]`)
  console.log(`  site_deadlines: ${deadlineRes.found}/${deadlineIds.length} — statuts : [${deadlineRes.statuses.join(', ')}]`)
  console.log(`  site_decisions: ${decisionRes.found}/${decisionIds.length} — statuts : [${decisionRes.statuses.join(', ')}]`)

  const OPEN_ACTION   = new Set(['open', 'planned'])
  const OPEN_RESERVE  = new Set(['open'])
  const OPEN_DEADLINE = new Set(['to_plan', 'planned'])
  const OPEN_DECISION = new Set(['proposee'])

  // Cherche des actions actives dans les statuts trouvés
  const hasOpenActions   = actionRes.statuses.some(s => OPEN_ACTION.has(s))
  const hasOpenReserves  = reserveRes.statuses.some(s => OPEN_RESERVE.has(s))
  const hasOpenDeadlines = deadlineRes.statuses.some(s => OPEN_DEADLINE.has(s))
  const hasOpenDecisions = decisionRes.statuses.some(s => OPEN_DECISION.has(s))

  console.log(`\nStatuts actifs détectés :`)
  console.log(`  actions ouvertes  : ${hasOpenActions}`)
  console.log(`  réserves ouvertes : ${hasOpenReserves}`)
  console.log(`  échéances actives : ${hasOpenDeadlines}`)
  console.log(`  décisions ouvertes: ${hasOpenDecisions}`)

  // ── Cas concrets — sujets avec des matérialisations ──────────────────────
  console.log(`\n${sep()}\nCAS CONCRETS — sujets avec matérialisations\n${sep()}`)

  // Pour chaque mat, retrouver le CS associé via prop → thread → CS
  const propToThread = new Map(props.map(p => [p.id, p.subject_thread_id]))
  const csById = new Map<string, { label: string; id: string }>()
  {
    const csIds = [...new Set([...threadToCsId.values()])]
    if (csIds.length > 0) {
      const { data } = await sb.from('canonical_subject').select('id, label').in('id', csIds)
      for (const r of (data ?? []) as Array<{ id: string; label: string }>) csById.set(r.id, r)
    }
  }

  // Grouper matérialisations par CS
  const matByCs = new Map<string, typeof matFiltered>()
  for (const m of matFiltered) {
    const threadId = propToThread.get(m.proposal_id)
    if (!threadId) continue
    const csId = threadToCsId.get(threadId)
    if (!csId) continue
    if (!matByCs.has(csId)) matByCs.set(csId, [])
    matByCs.get(csId)!.push(m)
  }

  const topCs = [...matByCs.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)

  if (topCs.length === 0) {
    console.log('Aucun CS avec matérialisation trouvé — voir blocage étape 4 ci-dessus.')
  } else {
    for (const [csId, mats] of topCs) {
      const cs = csById.get(csId)
      console.log(`\n  "${cs?.label ?? csId.slice(0, 8)}"`)
      console.log(`    CS id : ${csId.slice(0, 8)}…`)
      const byType = mats.reduce((acc, m) => { acc[m.target_entity_type] = (acc[m.target_entity_type] ?? 0) + 1; return acc }, {} as Record<string, number>)
      for (const [type, count] of Object.entries(byType)) {
        const ids = mats.filter(m => m.target_entity_type === type).map(m => m.target_entity_id).slice(0, 3)
        console.log(`    ${type}: ${count} (ex: ${ids.map(id => id.slice(0, 8) + '…').join(', ')})`)
      }
    }
  }

  // ── Sujets spécifiques demandés ─────────────────────────────────────────
  const targets = ['rapport g3', 'débourbeur', 'debourbeur', 'débourb', 'debourbeur']
  console.log(`\n${sep()}\nSUJETS SPÉCIFIQUES\n${sep()}`)
  const { data: allCS } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', siteId)
    .eq('status', 'active')
  const matchedCS = (allCS ?? []).filter((cs: any) =>
    targets.some(t => cs.label.toLowerCase().includes(t))
  ) as Array<{ id: string; label: string }>

  if (matchedCS.length === 0) {
    console.log('Sujets "Rapport G3" / "Débourbeur" introuvables sur ce chantier (chercher des patterns proches)')
    // Afficher quelques sujets actifs pour identifier de bons candidats
    const { data: sample } = await sb
      .from('canonical_subject')
      .select('id, label')
      .eq('site_id', siteId)
      .eq('status', 'active')
      .ilike('label', '%rapport%')
      .limit(5)
    const sample2 = await sb.from('canonical_subject').select('id, label').eq('site_id', siteId).eq('status', 'active').ilike('label', '%bour%').limit(5)
    console.log('\n  Labels contenant "rapport" :')
    for (const r of (sample.data ?? []) as Array<{ id: string; label: string }>) console.log(`    "${r.label}"`)
    console.log('\n  Labels contenant "bour" :')
    for (const r of (sample2.data ?? []) as Array<{ id: string; label: string }>) console.log(`    "${r.label}"`)
  } else {
    for (const cs of matchedCS) {
      console.log(`\n  "${cs.label}"  [${cs.id.slice(0, 8)}…]`)
      const hasMat = matByCs.has(cs.id)
      console.log(`    Matérialisations : ${hasMat ? matByCs.get(cs.id)!.length : 0}`)
      if (!hasMat) console.log(`    → activeObjects=0 : aucune matérialisation liée à ce CS via les runs canoniques`)
    }
  }

  // ── Synthèse ─────────────────────────────────────────────────────────────
  console.log(`\n${sep('═')}\nSYNTHÈSE\n${sep('═')}`)
  if (matRows.length === 0) {
    console.log('CAUSE : document_proposal_materialization vide pour les runs canoniques.')
  } else if (matFiltered.length === 0) {
    console.log('CAUSE : matérialisations présentes mais avec des target_entity_type non attendus.')
    console.log(`Types trouvés : ${matOtherTypes.join(', ')}`)
  } else if (actionRes.found === 0 && reserveRes.found === 0 && deadlineRes.found === 0 && decisionRes.found === 0) {
    console.log('CAUSE : target_entity_id dans matérialisations ne correspondent à aucune entité en base.')
  } else if (!hasOpenActions && !hasOpenReserves && !hasOpenDeadlines && !hasOpenDecisions) {
    console.log('CAUSE : entités trouvées mais toutes avec statuts fermés.')
    console.log(`  Actions: [${actionRes.statuses.join(', ')}]`)
    console.log(`  Réserves: [${reserveRes.statuses.join(', ')}]`)
    console.log(`  Échéances: [${deadlineRes.statuses.join(', ')}]`)
    console.log(`  Décisions: [${decisionRes.statuses.join(', ')}]`)
  } else {
    console.log('ANOMALIE : entités actives existent mais activeObjects vaut 0 — bug dans le read-model.')
    console.log('  Vérifier getNavigableSubjectsForSite() : la chaîne prop → STI → CS est-elle correcte ?')
  }
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
