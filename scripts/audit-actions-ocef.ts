import { createAdminClient } from '../lib/supabase/admin'

const sb = createAdminClient()

async function auditSite(siteId: string, siteName: string) {
  const { data: allActions } = await sb
    .from('site_actions')
    .select('id, title, status, due_date, created_at, report_id')
    .eq('site_id', siteId)

  const total = allActions?.length ?? 0
  if (total === 0) return

  const open = allActions?.filter((a) => !['done','cancelled'].includes(a.status)).length ?? 0
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`${siteName} (${siteId.slice(0,8)}...)`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`Total actions  : ${total}   Ouvertes : ${open}`)

  if (total === 0) return

  const actionIds = (allActions ?? []).map((a) => a.id)

  // Par batch de 100
  const matRows: Array<{ target_entity_id: string; proposal_id: string }> = []
  for (let i = 0; i < actionIds.length; i += 100) {
    const { data } = await sb
      .from('document_proposal_materialization')
      .select('target_entity_id, proposal_id')
      .eq('target_entity_type', 'site_action')
      .in('target_entity_id', actionIds.slice(i, i + 100))
    matRows.push(...(data ?? []))
  }

  const propIds = matRows.map((m) => m.proposal_id)
  const propRows: Array<{ id: string; subject_thread_id: string | null; label: string; extraction_run_id: string }> = []
  for (let i = 0; i < propIds.length; i += 100) {
    const { data } = await sb
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, extraction_run_id, label')
      .in('id', propIds.slice(i, i + 100))
    propRows.push(...(data ?? []))
  }

  const propById   = new Map(propRows.map((p) => [p.id, p]))
  const matByAction = new Map<string, string | null>()
  for (const m of matRows) {
    const prop = propById.get(m.proposal_id)
    matByAction.set(m.target_entity_id, prop?.subject_thread_id ?? null)
  }

  const openActions = (allActions ?? []).filter((a) => !['done','cancelled'].includes(a.status))
  const threadsOpen = new Set<string>()
  let noThread = 0
  for (const a of openActions) {
    const t = matByAction.get(a.id)
    if (t) threadsOpen.add(t)
    else noThread++
  }

  console.log(`Threads distincts ouverts : ${threadsOpen.size}   sans thread : ${noThread}`)

  // Doublons
  const threadToActions = new Map<string, string[]>()
  for (const a of openActions) {
    const t = matByAction.get(a.id)
    if (!t) continue
    if (!threadToActions.has(t)) threadToActions.set(t, [])
    threadToActions.get(t)!.push(a.title ?? '?')
  }

  const duplicates = [...threadToActions.entries()]
    .filter(([, acts]) => acts.length > 1)
    .sort((a, b) => b[1].length - a[1].length)

  if (duplicates.length > 0) {
    console.log(`\nThreads avec plusieurs actions ouvertes : ${duplicates.length}`)
    for (const [thread, titles] of duplicates.slice(0, 10)) {
      console.log(`  [${titles.length}x] ${titles[0].slice(0, 65)}`)
    }
  } else {
    console.log(`Aucun doublon détecté par thread.`)
  }

  // Statuts
  const statuses = new Map<string, number>()
  for (const a of allActions ?? []) statuses.set(a.status, (statuses.get(a.status) ?? 0) + 1)
  const statusStr = [...statuses.entries()].map(([s, n]) => `${s}:${n}`).join('  ')
  console.log(`Statuts : ${statusStr}`)

  // Origine
  const fromImport = openActions.filter((a) => a.report_id).length
  console.log(`Origine : ${fromImport} import PV  /  ${openActions.length - fromImport} manuelles`)
  console.log(`Échéances : ${openActions.filter(a=>a.due_date).length} avec  /  ${openActions.filter(a=>!a.due_date).length} sans`)
}

async function main() {
  const { data: sites } = await sb
    .from('sites')
    .select('id, name')
    .ilike('name', '%ocef%')
    .order('name')

  if (!sites?.length) {
    console.log('Aucun site OCEF trouvé.')
    return
  }

  console.log(`${sites.length} sites OCEF à auditer`)

  for (const site of sites) {
    await auditSite(site.id, site.name)
  }
}

main().catch(console.error)
