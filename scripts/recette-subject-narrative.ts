/**
 * Sujets candidats pour la recette de buildSubjectNarrative
 *
 * 4 profils :
 *   A — sujet avec relations confirmées (stagnation probable)
 *   B — sujet avec acteur lié, sans relation confirmée
 *   C — sujet avec objets ouverts (réserves ou échéances actives)
 *   D — sujet récent / pauvre en faits (attendu : pas de narrative)
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/recette-subject-narrative.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceKey) {
  console.error('[FATAL] env manquant — NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis')
  process.exit(1)
}

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

// ── helpers ───────────────────────────────────────────────────────────────────

function url(canonicalSubjectId: string, siteId: string) {
  return `/sites/${siteId}/historique/sujets/${canonicalSubjectId}`
}

function log(label: string, rows: unknown[]) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`PROFIL ${label}`)
  console.log('─'.repeat(60))
  if (!rows.length) { console.log('  (aucun résultat)'); return }
  rows.forEach((r: any) => {
    console.log(`  [${r.site_name}] ${r.label}`)
    console.log(`    → ${url(r.id, r.site_id)}`)
    if (r.detail) console.log(`    ${r.detail}`)
  })
}

// ── Profil A — relations confirmées ──────────────────────────────────────────

async function profilA() {
  const { data: links } = await sb
    .from('subject_thread_links')
    .select('from_thread_id, to_thread_id, link_type')
    .eq('status', 'confirmed')
    .limit(100)

  if (!links?.length) { log('A — relations confirmées', []); return }

  const threadIds = [...new Set(links.flatMap((l) => [l.from_thread_id, l.to_thread_id]))]

  const { data: identities } = await sb
    .from('subject_thread_identity')
    .select('canonical_subject_id, subject_thread_id')
    .in('subject_thread_id', threadIds)

  const csIds = [...new Set((identities ?? []).map((i) => i.canonical_subject_id))]
  if (!csIds.length) { log('A — relations confirmées', []); return }

  const { data: subjects } = await sb
    .from('canonical_subject')
    .select('id, label, site_id, sites(name)')
    .in('id', csIds)
    .eq('status', 'active')
    .limit(8)

  const rows = (subjects ?? []).map((cs: any) => {
    const myThreads = (identities ?? [])
      .filter((i) => i.canonical_subject_id === cs.id)
      .map((i) => i.subject_thread_id)
    const myLinks = links.filter(
      (l) => myThreads.includes(l.from_thread_id) || myThreads.includes(l.to_thread_id),
    )
    return {
      id: cs.id,
      label: cs.label,
      site_id: cs.site_id,
      site_name: (cs.sites as any)?.name ?? cs.site_id,
      detail: `${myLinks.length} lien(s) : ${[...new Set(myLinks.map((l) => l.link_type))].join(', ')}`,
    }
  })
  log('A — relations confirmées', rows)
}

// ── Profil B — acteur lié ─────────────────────────────────────────────────────

async function profilB() {
  const { data: subjects } = await sb
    .from('canonical_subject')
    .select('id, label, site_id, contact_id, company_id, sites(name)')
    .eq('status', 'active')
    .or('contact_id.not.is.null,company_id.not.is.null')
    .limit(8)

  if (!subjects?.length) { log('B — acteur lié', []); return }

  const contactIds = subjects.filter((s) => s.contact_id).map((s) => s.contact_id as string)
  const companyIds = subjects.filter((s) => s.company_id).map((s) => s.company_id as string)

  const [{ data: contacts }, { data: companies }] = await Promise.all([
    contactIds.length
      ? sb.from('company_contacts').select('id, full_name').in('id', contactIds)
      : Promise.resolve({ data: [] }),
    companyIds.length
      ? sb.from('companies').select('id, name').in('id', companyIds)
      : Promise.resolve({ data: [] }),
  ])

  const contactMap = Object.fromEntries((contacts ?? []).map((c) => [c.id, c.full_name]))
  const companyMap = Object.fromEntries((companies ?? []).map((c) => [c.id, c.name]))

  const rows = subjects.map((cs: any) => ({
    id: cs.id,
    label: cs.label,
    site_id: cs.site_id,
    site_name: (cs.sites as any)?.name ?? cs.site_id,
    detail: cs.contact_id
      ? `acteur personne : ${contactMap[cs.contact_id] ?? cs.contact_id}`
      : `acteur entreprise : ${companyMap[cs.company_id] ?? cs.company_id}`,
  }))
  log('B — acteur lié', rows)
}

// ── Profil C — objets ouverts ─────────────────────────────────────────────────

async function profilC() {
  // Réserves ouvertes
  const { data: reserves } = await sb
    .from('site_reserve')
    .select('id, site_id')
    .eq('status', 'open')
    .limit(100)

  // Échéances actives (to_plan ou planned)
  const { data: deadlines } = await sb
    .from('site_deadlines')
    .select('id, site_id')
    .in('status', ['to_plan', 'planned'])
    .is('deleted_at', null)
    .limit(100)

  const allEntityIds = [
    ...(reserves ?? []).map((r) => r.id),
    ...(deadlines ?? []).map((d) => d.id),
  ]

  if (!allEntityIds.length) { log('C — objets ouverts', []); return }

  const { data: mats } = await sb
    .from('document_proposal_materialization')
    .select('proposal_id, target_entity_id, target_entity_type')
    .in('target_entity_id', allEntityIds)
    .in('target_entity_type', ['site_reserve', 'site_deadline'])

  if (!mats?.length) { log('C — objets ouverts', []); return }

  const proposalIds = [...new Set(mats.map((m) => m.proposal_id))]

  const { data: proposals } = await sb
    .from('document_extraction_proposal')
    .select('id, subject_thread_id')
    .in('id', proposalIds)
    .not('subject_thread_id', 'is', null)

  const threadIds = [...new Set(proposals?.map((p) => p.subject_thread_id) ?? [])]

  if (!threadIds.length) { log('C — objets ouverts', []); return }

  const { data: identities } = await sb
    .from('subject_thread_identity')
    .select('canonical_subject_id, subject_thread_id')
    .in('subject_thread_id', threadIds)

  const csIds = [...new Set(identities?.map((i) => i.canonical_subject_id) ?? [])]

  const { data: subjects } = await sb
    .from('canonical_subject')
    .select('id, label, site_id, sites(name)')
    .in('id', csIds)
    .eq('status', 'active')
    .limit(8)

  const rows = (subjects ?? []).map((cs: any) => {
    const myThreads = (identities ?? [])
      .filter((i) => i.canonical_subject_id === cs.id)
      .map((i) => i.subject_thread_id)
    const myProposals = (proposals ?? []).filter((p) => myThreads.includes(p.subject_thread_id)).map((p) => p.id)
    const myMats = mats.filter((m) => myProposals.includes(m.proposal_id))
    const openRes = myMats.filter((m) => m.target_entity_type === 'site_reserve').length
    const openDl  = myMats.filter((m) => m.target_entity_type === 'site_deadline').length
    return {
      id: cs.id,
      label: cs.label,
      site_id: cs.site_id,
      site_name: (cs.sites as any)?.name ?? cs.site_id,
      detail: `${openRes} réserve(s) ouverte(s), ${openDl} échéance(s) active(s)`,
    }
  })
  log('C — objets ouverts', rows)
}

// ── Profil D — peu de faits (pas de narrative attendue) ──────────────────────

async function profilD() {
  // Sujets sans acteur, on cherche ceux avec peu d'occurrences (1-2 runs)
  const { data: subjects } = await sb
    .from('canonical_subject')
    .select('id, label, site_id, sites(name)')
    .eq('status', 'active')
    .is('contact_id', null)
    .is('company_id', null)
    .order('created_at', { ascending: false })
    .limit(100)

  if (!subjects?.length) { log('D — peu de faits', []); return }

  const csIds = subjects.map((s) => s.id)

  const { data: identities } = await sb
    .from('subject_thread_identity')
    .select('canonical_subject_id, subject_thread_id')
    .in('canonical_subject_id', csIds)

  const threadIds = (identities ?? []).map((i) => i.subject_thread_id)

  const { data: proposals } = await sb
    .from('document_extraction_proposal')
    .select('subject_thread_id, extraction_run_id')
    .in('subject_thread_id', threadIds)

  // Compte les runs distincts par canonical_subject_id
  const runsByCsId: Record<string, Set<string>> = {}
  for (const sti of identities ?? []) {
    const runs = new Set<string>()
    for (const p of proposals ?? []) {
      if (p.subject_thread_id === sti.subject_thread_id) runs.add(p.extraction_run_id)
    }
    const existing = runsByCsId[sti.canonical_subject_id] ?? new Set<string>()
    runs.forEach((r) => existing.add(r))
    runsByCsId[sti.canonical_subject_id] = existing
  }

  const rows = subjects
    .map((cs: any) => ({
      id: cs.id,
      label: cs.label,
      site_id: cs.site_id,
      site_name: (cs.sites as any)?.name ?? cs.site_id,
      nb_runs: runsByCsId[cs.id]?.size ?? 0,
    }))
    .filter((r) => r.nb_runs <= 2)
    .sort((a, b) => a.nb_runs - b.nb_runs)
    .slice(0, 8)
    .map((r) => ({ ...r, detail: `${r.nb_runs} occurrence(s) — narrative attendue : absente` }))

  log('D — peu de faits (pas de narrative)', rows)
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Recette buildSubjectNarrative — candidats par profil\n')
  await profilA()
  await profilB()
  await profilC()
  await profilD()
  console.log('\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
