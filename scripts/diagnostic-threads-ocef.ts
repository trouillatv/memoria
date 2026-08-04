// Diagnostic des 36 threads distincts — OCEF Compostage
// Classifie chaque thread : occurrences, statuts, labels, dates, proposition source

import { createAdminClient } from '../lib/supabase/admin'

const sb = createAdminClient()
const SITE_ID = '2c939e67-e986-4635-86a0-638cda870480' // OCEF Compostage

async function main() {
  const { data: actions } = await sb
    .from('site_actions')
    .select('id, title, status, due_date, created_at, report_id')
    .eq('site_id', SITE_ID)
    .order('created_at', { ascending: true })

  const actionIds = (actions ?? []).map(a => a.id)

  // Récupère les materialization rows
  const matRows: Array<{ target_entity_id: string; proposal_id: string }> = []
  for (let i = 0; i < actionIds.length; i += 100) {
    const { data } = await sb
      .from('document_proposal_materialization')
      .select('target_entity_id, proposal_id')
      .eq('target_entity_type', 'site_action')
      .in('target_entity_id', actionIds.slice(i, i + 100))
    matRows.push(...(data ?? []))
  }

  const propIds = matRows.map(m => m.proposal_id)
  const propRows: Array<{
    id: string
    subject_thread_id: string | null
    label: string
    proposal_family: string
    thematic_category: string | null
    document_status: string | null
    extraction_run_id: string
  }> = []
  for (let i = 0; i < propIds.length; i += 100) {
    const { data } = await sb
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, label, proposal_family, thematic_category, document_status, extraction_run_id')
      .in('id', propIds.slice(i, i + 100))
    propRows.push(...(data ?? []))
  }

  // Construit un index action → proposition
  const matByAction = new Map(matRows.map(m => [m.target_entity_id, m.proposal_id]))
  const propById = new Map(propRows.map(p => [p.id, p]))

  // Construit un index thread → actions
  const threadMap = new Map<string, Array<{ action: typeof actions extends null ? never : NonNullable<typeof actions>[number]; prop: typeof propRows[number] }>>()
  const noThread: typeof actions = []

  for (const action of actions ?? []) {
    const propId = matByAction.get(action.id)
    const prop = propId ? propById.get(propId) : undefined
    const threadId = prop?.subject_thread_id ?? null
    if (!threadId) {
      noThread.push(action)
      continue
    }
    if (!threadMap.has(threadId)) threadMap.set(threadId, [])
    threadMap.get(threadId)!.push({ action, prop: prop! })
  }

  console.log(`\n=== Diagnostic threads — OCEF Compostage ===`)
  console.log(`Total actions  : ${actions?.length ?? 0}`)
  console.log(`Threads distincts : ${threadMap.size}`)
  console.log(`Sans thread    : ${noThread.length}`)

  // Trie les threads par nombre d'occurrences desc, puis par label
  const sorted = [...threadMap.entries()].sort((a, b) => {
    const diff = b[1].length - a[1].length
    if (diff !== 0) return diff
    return (a[1][0]?.prop.label ?? '').localeCompare(b[1][0]?.prop.label ?? '')
  })

  // Classifie
  function classify(family: string, category: string | null, label: string): string {
    if (family === 'action') {
      const lc = label.toLowerCase()
      if (/transm|fournir|envoyer|communiquer|rapport|fiche|relevé|bilan|document/.test(lc)) return 'Transmission documentaire'
      if (/travaux|rép[ae]r|réhabilit|install|remplace|construi|interven/.test(lc)) return 'Travaux/Intervention'
      if (/contr[oô]le|vérif|test|essai|mesure|inspect/.test(lc)) return 'Contrôle/Essai'
      if (/valid|approv|autoris|accord|décision|convention|permis/.test(lc)) return 'Décision/Validation'
    }
    return 'Autre'
  }

  // Distribution par catégorie
  const catCount = new Map<string, number>()

  console.log(`\n${'─'.repeat(100)}`)
  console.log(`${'THREAD'.padEnd(38)} ${'OCCUR'.padEnd(6)} ${'STATUTS'.padEnd(30)} ${'CATÉGORIE'.padEnd(24)} LABEL`)
  console.log(`${'─'.repeat(100)}`)

  for (const [threadId, entries] of sorted) {
    const statuses = entries.map(e => e.action.status)
    const statusMap = new Map<string, number>()
    for (const s of statuses) statusMap.set(s, (statusMap.get(s) ?? 0) + 1)
    const statusStr = [...statusMap.entries()].map(([s, n]) => `${s}:${n}`).join(',')

    const family = entries[0].prop.proposal_family
    const category = entries[0].prop.thematic_category
    const label = entries[0].prop.label ?? ''
    const cat = classify(family, category, label)
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1)

    const hasDue = entries.some(e => e.action.due_date)
    const dueMark = hasDue ? '📅' : ''
    const dupMark = entries.length > 1 ? `[${entries.length}x]` : '     '

    console.log(
      `${threadId.slice(0, 36).padEnd(38)} ${dupMark.padEnd(6)} ${statusStr.padEnd(30)} ${cat.padEnd(24)} ${label.slice(0, 60)}${dueMark}`
    )
  }

  console.log(`${'─'.repeat(100)}`)
  console.log(`\nRépartition par catégorie :`)
  for (const [cat, n] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(28)} : ${n}`)
  }

  // Threads avec doublons
  const dups = sorted.filter(([, e]) => e.length > 1)
  console.log(`\nThreads avec plusieurs actions (${dups.length}) :`)
  for (const [threadId, entries] of dups) {
    const statuses = entries.map(e => e.action.status).join(', ')
    console.log(`  [${entries.length}x] ${entries[0].prop.label?.slice(0, 70)}`)
    console.log(`        statuts : ${statuses}`)
    for (const e of entries) {
      console.log(`        action  : ${e.action.id.slice(0, 8)}... ${e.action.title?.slice(0, 55)}`)
    }
  }

  // Statuts globaux
  const allStatuses = new Map<string, number>()
  for (const a of actions ?? []) allStatuses.set(a.status, (allStatuses.get(a.status) ?? 0) + 1)
  console.log(`\nDistribution statuts des 52 actions :`)
  for (const [s, n] of [...allStatuses.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(20)} : ${n}`)
  }
}

main().catch(console.error)
