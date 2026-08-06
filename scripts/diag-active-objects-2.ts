/**
 * Diagnostic P3 partie 2 — chemin direct site_action.subject_thread_id
 * Les CS ids viennent du diag-active-objects.ts (ce73b108 = Débourbeur, 00f7763e = Rapport G3)
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

async function main() {
  const { data: sites } = await sb.from('sites').select('id,name').is('deleted_at', null).ilike('name', `%${sitePattern}%`)
  const site = (sites ?? [])[0] as { id: string; name: string } | undefined
  if (!site) { console.error('Site introuvable:', sitePattern); process.exit(1) }
  const siteId = site.id
  console.log(`\nDIAG 2 — chemin direct site_action.subject_thread_id — ${site.name}\n`)

  // 1. Tous les threads actifs du site
  const { data: stiData } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
  const threadToCsId = new Map((stiData ?? []).map((r: any) => [r.subject_thread_id, r.canonical_subject_id]))
  const allThreadIds = [...threadToCsId.keys()]
  console.log(`Threads du site : ${allThreadIds.length}`)

  // 2. Actions directement liées via subject_thread_id
  const { data: actionsDirect } = await sb
    .from('site_actions')
    .select('id, title, status, subject_thread_id')
    .eq('site_id', siteId)
    .not('subject_thread_id', 'is', null)
  const actsDirect = (actionsDirect ?? []) as Array<{ id: string; title: string; status: string; subject_thread_id: string }>
  console.log(`\nActions avec subject_thread_id non-null sur ce site : ${actsDirect.length}`)

  const actsWithSTI = actsDirect.filter(a => threadToCsId.has(a.subject_thread_id))
  const actsWithoutSTI = actsDirect.filter(a => !threadToCsId.has(a.subject_thread_id))
  console.log(`  dont thread présent dans subject_thread_identity : ${actsWithSTI.length}`)
  console.log(`  dont thread absent de subject_thread_identity    : ${actsWithoutSTI.length}`)

  if (actsWithSTI.length > 0) {
    console.log('\n  Exemples (actions avec thread → CS résolvable) :')
    for (const a of actsWithSTI.slice(0, 5)) {
      const csId = threadToCsId.get(a.subject_thread_id)!
      console.log(`    "${a.title?.slice(0, 50) ?? '?'}" [${a.status}] → CS ${csId.slice(0, 8)}…`)
    }
  }

  // 3. Actions SANS subject_thread_id (ni matérialisation ?)
  const { data: actsNoThread } = await sb
    .from('site_actions')
    .select('id, title, status, subject_thread_id')
    .eq('site_id', siteId)
    .is('subject_thread_id', null)
  const noThread = (actsNoThread ?? []) as Array<{ id: string; title: string; status: string }>
  console.log(`\nActions SANS subject_thread_id : ${noThread.length}`)
  for (const a of noThread.filter(a => ['open','planned'].includes(a.status)).slice(0, 5)) {
    console.log(`  "${a.title?.slice(0, 60) ?? '?'}" [${a.status}]`)
  }

  // 4. Réserves : ont-elles un subject_thread_id ?
  const { data: reserveCols } = await sb
    .from('site_reserve')
    .select('id, subject_thread_id, status')
    .eq('site_id', siteId)
    .limit(5)
  console.log(`\nRéserves (sample 5) subject_thread_id field:`)
  for (const r of (reserveCols ?? []) as any[]) {
    console.log(`  id=${r.id?.slice(0,8)}… thread=${r.subject_thread_id ? r.subject_thread_id.slice(0,8)+'…' : 'null'} status=${r.status}`)
  }

  // 5. Cas Débourbeur et Rapport G3 — recherche par label
  console.log('\n── Sujets cibles ───────────────────────────────────────')
  const { data: allCS } = await sb
    .from('canonical_subject')
    .select('id, label')
    .eq('site_id', siteId)
    .eq('status', 'active')
  const targets = (allCS ?? []).filter((cs: any) =>
    ['débourbeur','rapport g3','rapport g','debourbeur'].some(t => cs.label.toLowerCase().includes(t))
  ) as Array<{ id: string; label: string }>

  for (const cs of targets) {
    console.log(`\nCS "${cs.label}" [${cs.id.slice(0,8)}…]`)
    // Threads de ce CS
    const threads = [...threadToCsId.entries()]
      .filter(([, csId]) => csId === cs.id)
      .map(([tid]) => tid)
    console.log(`  Threads : ${threads.length}`)

    if (threads.length > 0) {
      // Actions directement liées
      const { data: csActs } = await sb.from('site_actions').select('id, title, status, subject_thread_id').in('subject_thread_id', threads)
      console.log(`  Actions directes (via thread) : ${(csActs ?? []).length}`)
      for (const a of (csActs ?? []) as any[]) console.log(`    "${a.title?.slice(0,50)}" [${a.status}]`)

      // Réserves directement liées
      const { data: csRes } = await sb.from('site_reserve').select('id, description, status, subject_thread_id').in('subject_thread_id', threads)
      console.log(`  Réserves directes (via thread) : ${(csRes ?? []).length}`)
      for (const r of (csRes ?? []) as any[]) console.log(`    "${(r.description ?? '?').slice(0,50)}" [${r.status}]`)

      // Matérialisations via propositions
      const { data: props } = await sb.from('document_extraction_proposal').select('id, proposal_family, label').in('subject_thread_id', threads)
      const propIds = (props ?? []).map((p: any) => p.id)
      console.log(`  Propositions totales : ${propIds.length}`)
      if (propIds.length > 0) {
        const { data: mats } = await sb.from('document_proposal_materialization').select('proposal_id, target_entity_type, target_entity_id').in('proposal_id', propIds)
        console.log(`  Matérialisations : ${(mats ?? []).length}`)
        for (const m of (mats ?? []) as any[]) console.log(`    ${m.target_entity_type} ${m.target_entity_id?.slice(0,8)}…`)
      }
    }
  }

  // 6. Est-ce que le read-model utilise site_action.subject_thread_id ?
  console.log('\n── Synthèse ─────────────────────────────────────────────')
  if (actsWithSTI.length > 0) {
    console.log(`⚠️  ${actsWithSTI.length} action(s) directement liées via subject_thread_id`)
    console.log('   getNavigableSubjectsForSite() ne les capture PAS — uniquement via document_proposal_materialization')
    console.log('   → CAUSE activeObjects partiel : le chemin direct n\'est pas lu')
  } else {
    console.log('Aucune action directe via subject_thread_id — le chemin direct n\'est pas utilisé non plus')
    console.log('Vérifier si des actions/réserves existent pour ces sujets via un autre mécanisme')
  }
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
