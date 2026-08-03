// Recette complète Chemin B — chantier de recette dédié.
// Usage : npx tsx scripts/recette-cheminb.ts
//
// Idempotent : peut être relancé plusieurs fois sans dupliquer les données.
// Détecte l'état existant et reprend depuis l'étape adéquate.
import { existsSync, readFileSync } from 'node:fs'

function loadEnv() {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const l = line.trim(); if (!l || l.startsWith('#')) continue
    const eq = l.indexOf('='); if (eq < 0) continue
    const k = l.slice(0, eq).trim(); let v = l.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!
const PROJECT = 'srixnofmaydxouhucawn'

const SITE_OCEF      = '2c939e67-e986-4635-86a0-638cda870480'
const RUN_PV009      = '9338350c-d5f5-49c7-bf01-23968df43a6b'
const RECETTE_NAME   = 'OCEF — Recette Chemin B'
const VISIT_DATE     = '2026-07-02'
const ADMIN_USER_ID  = 'c16d2984-74d8-4f8b-9f8e-0efadc342f0d'

type Row = Record<string, unknown>

async function q(sql: string): Promise<Row[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`SQL ${r.status}: ${text}`)
  return JSON.parse(text) as Row[]
}

function pass(msg: string) { console.log(`  ✓ PASS  ${msg}`) }
function fail(msg: string) { console.log(`  ✗ FAIL  ${msg}`) }
function info(msg: string) { console.log(`  —       ${msg}`) }
function section(msg: string) { console.log(`\n${msg}`) }
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║  Recette Chemin B — linkedActorTemporaryKey  ║')
  console.log('╚══════════════════════════════════════════════╝\n')

  // ── 1. Infos org ──────────────────────────────────────────────────────────
  section('[1] Contexte org')
  const [siteRow] = await q(`SELECT organization_id, tenant_id, client_id FROM sites WHERE id = '${SITE_OCEF}'`)
  if (!siteRow) throw new Error('Chantier OCEF introuvable')
  const orgId     = siteRow.organization_id as string
  const tenantId  = siteRow.tenant_id  as string | null
  const clientId  = siteRow.client_id  as string | null
  info(`org=${orgId}`)

  // ── 2. Chantier de recette ────────────────────────────────────────────────
  section('[2] Chantier de recette')
  let [existSite] = await q(`SELECT id FROM sites WHERE name = '${RECETTE_NAME}' AND organization_id = '${orgId}' LIMIT 1`)
  let recetteSiteId: string
  if (existSite) {
    recetteSiteId = existSite.id as string
    info(`Existant : ${recetteSiteId}`)
  } else {
    const [s] = await q(`INSERT INTO sites (name, organization_id, tenant_id, client_id, address, created_at)
      VALUES ('${RECETTE_NAME}','${orgId}',${tenantId?`'${tenantId}'`:'NULL'},${clientId?`'${clientId}'`:'NULL'},'Recette',NOW()) RETURNING id`)
    recetteSiteId = s.id as string
    info(`Créé : ${recetteSiteId}`)
  }

  // ── 3. Document source (PV009) ────────────────────────────────────────────
  section('[3] Document PV009')
  const [srcDocRow] = await q(`SELECT d.id, d.storage_path FROM document_extraction_run der JOIN documents d ON d.id=der.document_id WHERE der.id='${RUN_PV009}'`)
  if (!srcDocRow) throw new Error('Document PV009 introuvable')
  const storagePath = srcDocRow.storage_path as string
  info(`storage_path : ${storagePath}`)

  // ── 4. Copie du document ──────────────────────────────────────────────────
  section('[4] Document de recette')
  const [existDoc] = await q(`
    SELECT d.id FROM documents d JOIN document_collections dc ON dc.id=d.collection_id
    WHERE dc.scope_id='${recetteSiteId}' AND d.storage_path='${storagePath}' AND d.deleted_at IS NULL LIMIT 1
  `)
  let recetteDocId: string
  if (existDoc) {
    recetteDocId = existDoc.id as string
    info(`Existant : ${recetteDocId}`)
  } else {
    let [existColl] = await q(`SELECT id FROM document_collections WHERE scope_type='site' AND scope_id='${recetteSiteId}' LIMIT 1`)
    let collId: string
    if (existColl) {
      collId = existColl.id as string
    } else {
      const [c] = await q(`INSERT INTO document_collections (name,scope_type,scope_id,organization_id,tenant_id,created_at)
        VALUES ('Documents chantier','site','${recetteSiteId}','${orgId}',${tenantId?`'${tenantId}'`:'NULL'},NOW()) RETURNING id`)
      collId = c.id as string
    }
    const [d] = await q(`INSERT INTO documents (organization_id,tenant_id,collection_id,document_type,storage_path,filename,visibility_level,status,analysis_status,tags,created_at,updated_at)
      VALUES ('${orgId}',${tenantId?`'${tenantId}'`:'NULL'},'${collId}','historical_visit_report','${storagePath}','PV009-RecetteCheminB.pdf','manager','active','ready','{}',NOW(),NOW()) RETURNING id`)
    recetteDocId = d.id as string
    info(`Créé : ${recetteDocId}`)
  }

  // ── 5. Run canonique ──────────────────────────────────────────────────────
  section('[5] Run d\'extraction')
  const runs = await q(`
    SELECT id, status, is_canonical FROM document_extraction_run
    WHERE document_id='${recetteDocId}' AND is_canonical=true ORDER BY created_at DESC LIMIT 1
  `)
  let runId: string
  let runStatus: string

  if (runs.length && runs[0].status !== 'failed') {
    runId     = runs[0].id as string
    runStatus = runs[0].status as string
    info(`Run canonique existant (${runStatus}) : ${runId}`)
  } else {
    info(`Lancement extraction…`)
    const { extractHistoricalPv } = await import('../lib/documents/extract-historical-pv')
    await extractHistoricalPv(recetteDocId, null, recetteSiteId)
    const [newRun] = await q(`
      SELECT id, status FROM document_extraction_run
      WHERE document_id='${recetteDocId}' AND is_canonical=true ORDER BY created_at DESC LIMIT 1
    `)
    if (!newRun) throw new Error('Aucun run canonique créé')
    runId = newRun.id as string; runStatus = newRun.status as string
    info(`Extraction terminée — statut: ${runStatus}, runId: ${runId}`)
  }

  // ── 6. Poll si en cours ───────────────────────────────────────────────────
  if (runStatus === 'pending' || runStatus === 'processing') {
    section('[6] Attente extraction')
    for (let i = 0; i < 60; i++) {
      const [r] = await q(`SELECT status, error_message FROM document_extraction_run WHERE id='${runId}'`)
      runStatus = r.status as string
      if (runStatus === 'ready_for_review') { info(`Statut : ${runStatus}`); break }
      if (runStatus === 'failed') throw new Error(`Extraction échouée : ${r.error_message}`)
      process.stdout.write(`\r  — ${runStatus} (${i * 5}s)…`)
      await sleep(5000)
    }
    console.log()
    if (runStatus !== 'ready_for_review') throw new Error('Timeout extraction')
  } else {
    info(`[6] Skip polling (statut: ${runStatus})`)
  }

  // ── 7. Accepter propositions (si ready_for_review) ────────────────────────
  if (runStatus === 'ready_for_review') {
    section('[7] Acceptation propositions')
    await q(`UPDATE document_extraction_proposal SET review_status='accepted' WHERE extraction_run_id='${runId}' AND review_status='pending'`)
    const [cnt] = await q(`SELECT COUNT(*) AS n FROM document_extraction_proposal WHERE extraction_run_id='${runId}' AND review_status='accepted'`)
    info(`${cnt.n} propositions acceptées`)
    runStatus = 'accepted'
  } else {
    info(`[7] Skip acceptation (statut: ${runStatus})`)
  }

  // ── 8. Matérialisation SQL (idempotent) ───────────────────────────────────
  section('[8] Matérialisation SQL')
  const [existSR] = await q(`SELECT id FROM site_reports WHERE extraction_run_id='${runId}'`)
  let siteReportId: string
  if (existSR) {
    siteReportId = existSR.id as string
    info(`Visite déjà matérialisée : ${siteReportId}`)
  } else {
    const [sr] = await q(`
      SELECT materialize_historical_visit(
        '${runId}'::uuid,'${ADMIN_USER_ID}'::uuid,
        '${recetteSiteId}'::uuid,'${VISIT_DATE}'::date,
        'PV009 — Recette Chemin B'
      ) AS id
    `)
    siteReportId = sr.id as string
    info(`Matérialisé → site_report_id: ${siteReportId}`)
  }

  // ── 8b. Pipeline TypeScript : company/person → Chemin B resolution ────────
  section('[8b] Pipeline company/person + resolveLinkedActors')
  const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: companyPropsRaw } = await admin
    .from('document_extraction_proposal')
    .select('id, label, reviewed_label, source_payload, stable_key')
    .eq('extraction_run_id', runId)
    .in('review_status', ['accepted', 'edited', 'materialized'])
    .eq('proposal_family', 'company')

  const { data: personPropsRaw } = await admin
    .from('document_extraction_proposal')
    .select('id, label, reviewed_label, description, source_payload, stable_key')
    .eq('extraction_run_id', runId)
    .in('review_status', ['accepted', 'edited', 'materialized'])
    .eq('proposal_family', 'person')

  type SPCompany = { companyRole?: string; statusAtDocumentDate?: string }
  type SPPerson  = { linkedCompanyName?: string | null; emailAddress?: string | null; phoneNumber?: string | null }

  const companyNameMap = new Map<string, { companyId: string; siteIntervenantId: string }>()
  const stableKeyToCompanyId = new Map<string, string>()
  const stableKeyToContactId = new Map<string, string>()

  for (const raw of companyPropsRaw ?? []) {
    const prop = raw as { id: string; label: string; reviewed_label: string | null; source_payload: SPCompany | null; stable_key: string | null }
    const name = prop.reviewed_label ?? prop.label
    const role = prop.source_payload?.companyRole ?? prop.source_payload?.statusAtDocumentDate ?? 'partenaire'

    let companyId: string
    const { data: existCo } = await admin.from('companies').select('id').eq('organization_id', orgId).ilike('name', name).is('deleted_at', null).maybeSingle()
    if (existCo) {
      companyId = (existCo as { id: string }).id
      info(`Company existante "${name}" → ${companyId.slice(0, 8)}…`)
    } else {
      const { data: newCo } = await admin.from('companies').insert({ organization_id: orgId, name }).select('id').single()
      if (!newCo) { info(`Échec création company "${name}"`); continue }
      companyId = (newCo as { id: string }).id
      info(`Company créée "${name}" → ${companyId.slice(0, 8)}…`)
    }

    let siteIntervenantId: string
    const { data: existSi } = await admin.from('site_intervenants').select('id').eq('site_id', recetteSiteId).eq('company_id', companyId).maybeSingle()
    if (existSi) {
      siteIntervenantId = (existSi as { id: string }).id
    } else {
      const { data: newSi } = await admin.from('site_intervenants').insert({ site_id: recetteSiteId, role, company_id: companyId, effective_from: VISIT_DATE, source_report_id: siteReportId }).select('id').single()
      if (!newSi) continue
      siteIntervenantId = (newSi as { id: string }).id
    }

    companyNameMap.set(name.toLowerCase(), { companyId, siteIntervenantId })
    if (prop.stable_key) stableKeyToCompanyId.set(prop.stable_key, companyId)

    await admin.from('document_extraction_proposal').update({ review_status: 'materialized' }).eq('id', prop.id)
    await admin.from('document_proposal_materialization').upsert(
      { organization_id: orgId, proposal_id: prop.id, target_entity_type: 'site_intervenants', target_entity_id: siteIntervenantId, status: 'done', created_by: ADMIN_USER_ID },
      { onConflict: 'proposal_id, target_entity_type, target_entity_id', ignoreDuplicates: true }
    )
  }
  info(`${stableKeyToCompanyId.size} companies → stableKeyToCompanyId`)

  for (const raw of personPropsRaw ?? []) {
    const prop = raw as { id: string; label: string; reviewed_label: string | null; description: string | null; source_payload: SPPerson | null; stable_key: string | null }
    const name = prop.reviewed_label ?? prop.label
    const sp = prop.source_payload
    const linkedCo = sp?.linkedCompanyName ?? null
    if (!linkedCo) continue
    const entry = companyNameMap.get(linkedCo.toLowerCase())
    if (!entry) continue

    let contactId: string
    const { data: existCt } = await admin.from('company_contacts').select('id').eq('company_id', entry.companyId).ilike('full_name', name).is('deleted_at', null).maybeSingle()
    if (existCt) {
      contactId = (existCt as { id: string }).id
    } else {
      const { data: newCt } = await admin.from('company_contacts').insert({ company_id: entry.companyId, full_name: name, function: prop.description?.split(' — ')[0]?.trim() ?? null }).select('id').single()
      if (!newCt) continue
      contactId = (newCt as { id: string }).id
    }

    if (prop.stable_key) stableKeyToContactId.set(prop.stable_key, contactId)
    await admin.from('document_extraction_proposal').update({ review_status: 'materialized' }).eq('id', prop.id)
    await admin.from('document_proposal_materialization').upsert(
      { organization_id: orgId, proposal_id: prop.id, target_entity_type: 'company_contacts', target_entity_id: contactId, status: 'done', created_by: ADMIN_USER_ID },
      { onConflict: 'proposal_id, target_entity_type, target_entity_id', ignoreDuplicates: true }
    )
  }
  info(`${stableKeyToContactId.size} persons → stableKeyToContactId`)

  // Chemin B : resolveLinkedActors → UPDATE site_actions
  const { resolveLinkedActors } = await import('../lib/documents/linked-actor-resolution')
  const { data: actionPropsRaw } = await admin
    .from('document_extraction_proposal')
    .select('id, source_payload')
    .eq('extraction_run_id', runId)
    .in('review_status', ['accepted', 'edited', 'materialized'])
    .eq('proposal_family', 'action')

  if (actionPropsRaw && actionPropsRaw.length > 0) {
    const ids = (actionPropsRaw as Array<{ id: string }>).map(p => p.id)
    const { data: matRows } = await admin
      .from('document_proposal_materialization')
      .select('proposal_id, target_entity_id')
      .in('proposal_id', ids)
      .eq('target_entity_type', 'site_action')

    const materializedActions = new Map<string, string>(
      (matRows ?? []).map(r => {
        const row = r as { proposal_id: string; target_entity_id: string }
        return [row.proposal_id, row.target_entity_id]
      })
    )

    const assignments = resolveLinkedActors(
      actionPropsRaw as Array<{ id: string; source_payload: Record<string, unknown> | null }>,
      materializedActions,
      stableKeyToCompanyId,
      stableKeyToContactId,
    )

    info(`resolveLinkedActors → ${assignments.length} assignation(s)`)
    for (const a of assignments) {
      info(`  → site_action ${a.siteActionId.slice(0,8)}… : ${a.kind}=${a.actorId.slice(0,8)}…`)
      await admin.from('site_actions').update(
        a.kind === 'company' ? { assigned_company_id: a.actorId } : { assigned_contact_id: a.actorId }
      ).eq('id', a.siteActionId)
    }
  }

  // Marquer run comme fully materialized
  await admin.from('document_extraction_run').update({ status: 'materialized' }).eq('id', runId).eq('status', 'partially_materialized')

  // ── 9. Recette C1–C6 ──────────────────────────────────────────────────────
  section('[9] Recette Chemin B\n')

  const actionProps = await q(`
    SELECT dep.id, dep.stable_key, dep.label,
      dep.source_payload->>'responsibleParty'        AS responsible_party,
      dep.source_payload->>'linkedActorTemporaryKey'  AS linked_actor_key,
      dep.source_payload->>'dueDate'                  AS due_date_payload
    FROM document_extraction_proposal dep
    WHERE dep.extraction_run_id = '${runId}' AND dep.proposal_family = 'action'
    ORDER BY dep.source_page, dep.created_at
  `) as Array<{ id: string; stable_key: string; label: string; responsible_party: string | null; linked_actor_key: string | null; due_date_payload: string | null }>

  const companyProps = await q(`
    SELECT dep.stable_key, dep.label, dep.source_payload->>'companyRole' AS role
    FROM document_extraction_proposal dep
    WHERE dep.extraction_run_id = '${runId}' AND dep.proposal_family = 'company'
    ORDER BY dep.label
  `) as Array<{ stable_key: string; label: string; role: string }>

  const personProps = await q(`
    SELECT dep.stable_key, dep.label
    FROM document_extraction_proposal dep
    WHERE dep.extraction_run_id = '${runId}' AND dep.proposal_family = 'person'
    ORDER BY dep.label
  `) as Array<{ stable_key: string; label: string }>

  console.log(`[INFO] Entreprises :`)
  for (const c of companyProps) info(`  ${c.stable_key} → "${c.label}" (${c.role ?? '-'}) — companyId: ${stableKeyToCompanyId.get(c.stable_key)?.slice(0,8) ?? 'NON RÉSOLU'}…`)
  console.log(`[INFO] Personnes :`)
  for (const p of personProps) info(`  ${p.stable_key} → "${p.label}" — contactId: ${stableKeyToContactId.get(p.stable_key)?.slice(0,8) ?? 'NON RÉSOLU'}…`)

  const matActions = await q(`
    SELECT dpm.proposal_id, dpm.target_entity_id AS site_action_id, sa.title, sa.due_date,
      sa.assigned_company_id, sa.assigned_contact_id,
      co.name AS company_name, ct.full_name AS contact_name
    FROM document_proposal_materialization dpm
    JOIN site_actions sa ON sa.id = dpm.target_entity_id
    LEFT JOIN companies co ON co.id = sa.assigned_company_id
    LEFT JOIN company_contacts ct ON ct.id = sa.assigned_contact_id
    WHERE dpm.proposal_id IN (
      SELECT id FROM document_extraction_proposal
      WHERE extraction_run_id = '${runId}' AND proposal_family = 'action'
    ) AND dpm.target_entity_type = 'site_action'
  `) as Array<{ proposal_id: string; site_action_id: string; title: string; due_date: string | null; assigned_company_id: string | null; assigned_contact_id: string | null; company_name: string | null; contact_name: string | null }>

  if (!matActions.length) { fail('Aucune action matérialisée'); return }

  // ── C5 ────────────────────────────────────────────────────────────────────
  console.log(`\n─── C5 : linkedActorTemporaryKey dans propositions action ───`)
  let c5WithKey = 0, c5Missing = 0
  for (const a of actionProps) {
    const lbl = a.label.slice(0, 55)
    if (a.linked_actor_key)        { pass(`"${lbl}" → key="${a.linked_actor_key}"`); c5WithKey++ }
    else if (a.responsible_party)  { fail(`"${lbl}" a responsibleParty="${a.responsible_party}" mais linkedActorTemporaryKey absent`); c5Missing++ }
    else                           { info(`"${lbl}" — pas de responsable (attendu)`) }
  }

  // ── C1 ────────────────────────────────────────────────────────────────────
  console.log(`\n─── C1 : action → assigned_company_id / assigned_contact_id ───`)
  let c1Pass = 0, c1Fail = 0
  const tableRows: string[][] = []
  for (const sa of matActions) {
    const ap = actionProps.find(a => a.id === sa.proposal_id)
    const lbl = sa.title.slice(0, 45)
    const key = ap?.linked_actor_key
    if (key) {
      if (sa.assigned_company_id) {
        pass(`"${lbl}" → ${sa.company_name} (${sa.assigned_company_id.slice(0, 8)}…)`)
        c1Pass++
        tableRows.push([lbl, ap?.responsible_party ?? '—', key, sa.company_name ?? '—', sa.assigned_company_id.slice(0, 8) + '…', 'PASS'])
      } else if (sa.assigned_contact_id) {
        pass(`"${lbl}" → contact ${sa.contact_name ?? '?'} (${sa.assigned_contact_id.slice(0, 8)}…)`)
        c1Pass++
        tableRows.push([lbl, ap?.responsible_party ?? '—', key, sa.contact_name ?? '—', sa.assigned_contact_id.slice(0, 8) + '…', 'PASS'])
      } else {
        fail(`"${lbl}" → linkedActorKey="${key}" non résolu → assigned_* NULL`)
        c1Fail++
        tableRows.push([lbl, ap?.responsible_party ?? '—', key, 'NON RÉSOLU', '—', 'FAIL'])
      }
    } else {
      info(`"${lbl}" → pas de linkedActorKey → assigned_* NULL (attendu)`)
      tableRows.push([lbl, ap?.responsible_party ?? '—', '—', '—', '—', 'n/a'])
    }
  }

  // ── C2 ────────────────────────────────────────────────────────────────────
  console.log(`\n─── C2 : BECIB ne doit porter aucune action ───`)
  const becib = companyProps.find(c => c.label.toUpperCase().includes('BECIB'))
  if (becib) {
    const becibActions = matActions.filter(sa => sa.company_name?.toUpperCase().includes('BECIB'))
    if (!becibActions.length) pass('Aucune action attribuée à BECIB')
    else fail(`${becibActions.length} action(s) BECIB : ${becibActions.map(s => s.title.slice(0, 30)).join(', ')}`)
  } else {
    info('BECIB absent de ce run')
  }

  // ── C3 ────────────────────────────────────────────────────────────────────
  console.log(`\n─── C3 : dueDate → site_actions.due_date ───`)
  const withDue = matActions.filter(sa => actionProps.find(a => a.id === sa.proposal_id)?.due_date_payload)
  if (!withDue.length) { info('Aucune action avec dueDate dans ce PV — C3 non testable') }
  else for (const sa of withDue) {
    const ap = actionProps.find(a => a.id === sa.proposal_id)!
    const lbl = sa.title.slice(0, 45)
    if (sa.due_date) pass(`"${lbl}" → dueDate="${ap.due_date_payload}" → due_date=${sa.due_date}`)
    else fail(`"${lbl}" → dueDate="${ap.due_date_payload}" présent mais due_date=NULL`)
  }

  // ── C4 ────────────────────────────────────────────────────────────────────
  console.log(`\n─── C4 : action sans responsable → assigned_* NULL ───`)
  const noKey = matActions.filter(sa => !actionProps.find(a => a.id === sa.proposal_id)?.linked_actor_key)
  if (!noKey.length) { info('Toutes les actions ont un linkedActorKey — C4 non testable sur ce PV') }
  else for (const sa of noKey) {
    const lbl = sa.title.slice(0, 50)
    if (!sa.assigned_company_id && !sa.assigned_contact_id) pass(`"${lbl}" → assigned_* NULL (correct)`)
    else fail(`"${lbl}" → assigned_company=${sa.assigned_company_id}, assigned_contact=${sa.assigned_contact_id}`)
  }

  // ── C6 ────────────────────────────────────────────────────────────────────
  console.log(`\n─── C6 : stable_key non NULL dans company/person ───`)
  let c6Pass = 0, c6Fail = 0
  for (const a of [...companyProps, ...personProps]) {
    if (a.stable_key) { pass(`"${a.label}" → stable_key="${a.stable_key}"`); c6Pass++ }
    else              { fail(`"${a.label}" → stable_key NULL`); c6Fail++ }
  }

  // ── Tableau récap ─────────────────────────────────────────────────────────
  console.log('\n')
  console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐')
  console.log('│  Chaîne complète : texte → responsibleParty → linkedActorTemporaryKey → acteur résolu → UUID → site_action.assigned_*   │')
  console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤')
  for (const [lbl, resp, key, actor, uuid, res] of tableRows) {
    const r = res === 'PASS' ? '✓ PASS' : res === 'FAIL' ? '✗ FAIL' : '  n/a '
    console.log(`  ${lbl.padEnd(45)} | ${(resp).slice(0,16).padEnd(16)} | ${key.slice(0,18).padEnd(18)} | ${actor.slice(0,14).padEnd(14)} | ${uuid.padEnd(9)} | ${r}`)
  }
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘')

  // ── Résumé ────────────────────────────────────────────────────────────────
  console.log('\n══════════ RÉSUMÉ ══════════')
  console.log(`  C1 (assigned_company/contact) : ${c1Pass} PASS / ${c1Fail} FAIL`)
  console.log(`  C2 (BECIB négatif)            : voir ci-dessus`)
  console.log(`  C3 (dueDate)                  : voir ci-dessus`)
  console.log(`  C4 (action sans responsable)  : voir ci-dessus`)
  console.log(`  C5 (linkedActorTemporaryKey)  : ${c5WithKey} avec clé / ${c5Missing} clé manquante`)
  console.log(`  C6 (stable_key non NULL)      : ${c6Pass} PASS / ${c6Fail} FAIL`)
  console.log(`\n  run_id       : ${runId}`)
  console.log(`  site_id      : ${recetteSiteId}`)
  console.log(`  site_report  : ${siteReportId}`)
}

main().catch(e => { console.error('\n[FATAL]', e.message ?? e); process.exit(1) })
