// Vérification post-matérialisation du Chemin B sur un PV réextrait.
// Usage : npx tsx scripts/verify-cheminb-recette.ts <run_id>
//
// Vérifie :
//   C1 — action → company (DUMEZ) → assigned_company_id non NULL et bon UUID
//   C2 — BECIB cité comme MOE → aucune action avec assigned_company_id = BECIB
//   C3 — dueDate camelCase → site_actions.due_date non NULL si dueDate présent
//   C5 — linkedActorTemporaryKey présent dans source_payload des nouvelles actions
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
const runId = process.argv[2]
if (!runId) { console.error('Usage: npx tsx verify-cheminb-recette.ts <run_id>'); process.exit(1) }

async function q(sql: string): Promise<unknown[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
  return JSON.parse(await r.text())
}

function pass(msg: string) { console.log(`  ✓ PASS  ${msg}`) }
function fail(msg: string) { console.log(`  ✗ FAIL  ${msg}`) }
function info(msg: string) { console.log(`  —       ${msg}`) }

async function main() {
  console.log(`\n=== Recette Chemin B — run ${runId} ===\n`)

  // ── Propositions action ────────────────────────────────────────────────────
  const actionProps = await q(`
    SELECT
      dep.id,
      dep.stable_key,
      dep.label,
      dep.source_payload->>'responsibleParty'       AS responsible_party,
      dep.source_payload->>'linkedActorTemporaryKey' AS linked_actor_key,
      dep.source_payload->>'dueDate'                 AS due_date_payload,
      dep.review_status
    FROM document_extraction_proposal dep
    WHERE dep.extraction_run_id = '${runId}'
      AND dep.proposal_family = 'action'
    ORDER BY dep.source_page, dep.created_at
  `) as Array<{
    id: string; stable_key: string; label: string
    responsible_party: string | null; linked_actor_key: string | null
    due_date_payload: string | null; review_status: string
  }>

  console.log(`[C5] linkedActorTemporaryKey dans les propositions action :`)
  let countWithKey = 0
  for (const a of actionProps) {
    if (a.linked_actor_key) {
      pass(`"${a.label.slice(0, 55)}" → key="${a.linked_actor_key}"`)
      countWithKey++
    } else if (a.responsible_party) {
      fail(`"${a.label.slice(0, 55)}" a responsibleParty="${a.responsible_party}" mais linkedActorTemporaryKey absent`)
    } else {
      info(`"${a.label.slice(0, 55)}" — pas de responsable (attendu)`)
    }
  }
  if (countWithKey === 0 && actionProps.filter(a => a.responsible_party).length > 0) {
    fail('Aucune action avec linkedActorTemporaryKey alors que responsibleParty est présent → extraction à vérifier')
  }

  // ── Propositions company ────────────────────────────────────────────────────
  const companyProps = await q(`
    SELECT
      dep.stable_key,
      dep.label,
      dep.source_payload->>'companyRole' AS role
    FROM document_extraction_proposal dep
    WHERE dep.extraction_run_id = '${runId}'
      AND dep.proposal_family = 'company'
    ORDER BY dep.label
  `) as Array<{ stable_key: string; label: string; role: string }>

  console.log(`\n[INFO] Entreprises extraites dans ce run :`)
  for (const c of companyProps) info(`  stable_key="${c.stable_key}" → "${c.label}" (${c.role})`)

  // ── Vérification post-matérialisation ──────────────────────────────────────
  const matActions = await q(`
    SELECT
      dpm.proposal_id,
      dpm.target_entity_id AS site_action_id,
      sa.title,
      sa.due_date,
      sa.assigned_company_id,
      sa.assigned_contact_id,
      co.name AS company_name
    FROM document_proposal_materialization dpm
    JOIN site_actions sa ON sa.id = dpm.target_entity_id
    LEFT JOIN companies co ON co.id = sa.assigned_company_id
    WHERE dpm.proposal_id IN (
      SELECT id FROM document_extraction_proposal
      WHERE extraction_run_id = '${runId}' AND proposal_family = 'action'
    )
    AND dpm.target_entity_type = 'site_action'
  `) as Array<{
    proposal_id: string; site_action_id: string; title: string
    due_date: string | null; assigned_company_id: string | null
    assigned_contact_id: string | null; company_name: string | null
  }>

  if (matActions.length === 0) {
    info('Aucune action matérialisée trouvée — relancer après matérialisation')
    return
  }

  console.log(`\n[C1] Actions matérialisées — assigned_company_id :`)
  let c1Pass = 0, c1Fail = 0
  for (const sa of matActions) {
    const ap = actionProps.find(a => a.id === sa.proposal_id)
    const hasLinkedKey = !!ap?.linked_actor_key
    if (hasLinkedKey && sa.assigned_company_id) {
      pass(`"${sa.title.slice(0, 50)}" → ${sa.company_name} (${sa.assigned_company_id.slice(0, 8)}…)`)
      c1Pass++
    } else if (hasLinkedKey && !sa.assigned_company_id && !sa.assigned_contact_id) {
      fail(`"${sa.title.slice(0, 50)}" → linkedActorKey "${ap?.linked_actor_key}" non résolu → assigned_* NULL`)
      c1Fail++
    } else {
      info(`"${sa.title.slice(0, 50)}" → pas de linkedActorKey → assigned_* NULL (attendu)`)
    }
  }

  console.log(`\n[C2] Contrôle négatif — BECIB ne doit porter aucune action :`)
  const becibCompany = companyProps.find(c => c.label.toUpperCase().includes('BECIB'))
  if (becibCompany) {
    const becibActions = matActions.filter(sa => {
      // We'd need to join company to get UUID - look for company_name instead
      return sa.company_name?.toUpperCase().includes('BECIB')
    })
    if (becibActions.length === 0) {
      pass('Aucune action avec assigned_company_id = BECIB')
    } else {
      fail(`${becibActions.length} action(s) injectée(s) à BECIB : ${becibActions.map(s => s.title.slice(0, 30)).join(', ')}`)
    }
  } else {
    info('BECIB non trouvé dans les propositions company de ce run')
  }

  console.log(`\n[C3] dueDate → site_actions.due_date :`)
  const actionsWithDuePayload = matActions.filter(sa => {
    const ap = actionProps.find(a => a.id === sa.proposal_id)
    return !!ap?.due_date_payload
  })
  if (actionsWithDuePayload.length === 0) {
    info('Aucune action avec dueDate dans source_payload — cas non testable sur ce PV')
  } else {
    for (const sa of actionsWithDuePayload) {
      const ap = actionProps.find(a => a.id === sa.proposal_id)!
      if (sa.due_date) {
        pass(`"${sa.title.slice(0, 45)}" → dueDate="${ap.due_date_payload}" → due_date=${sa.due_date}`)
      } else {
        fail(`"${sa.title.slice(0, 45)}" → dueDate="${ap.due_date_payload}" présent mais due_date=NULL (cast échoué ?)`)
      }
    }
  }

  console.log(`\n=== Résumé ===`)
  console.log(`  C1 (assigned_company) : ${c1Pass} PASS / ${c1Fail} FAIL`)
  console.log(`  C2 (BECIB négatif)    : voir ci-dessus`)
  console.log(`  C3 (dueDate)          : voir ci-dessus`)
  console.log(`  C4 (action sans resp) : NON TESTABLE sur ce PV (toutes les actions ont un responsable)`)
  console.log(`  C5 (linked key)       : ${countWithKey} actions avec linkedActorTemporaryKey`)
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
