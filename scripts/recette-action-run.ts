// Harnais de recette réversible — P5-F1 (CREATE_ACTION avec échéance datée).
// (Vincent, 2026-08-17.) Exécute les scénarios via le pipeline réel
// (detectIntent → buildCopilotProposal → confirmSiteAction — le MÊME
// confirmSiteAction que la server action de production, pas une copie),
// journalise tous les IDs créés dans un manifeste, et laisse
// `rollback-action-test-run.ts <testRunId>` remettre la base dans son état
// initial.
//
// Décision de conception (rollback) : site_actions n'a PAS de colonne
// deleted_at — le rollback fait donc, comme pour watchpoint/deadline/reserve,
// une suppression DURE par ID exact.
//
// Garanties couvertes par ce run :
//  - 3 scénarios d'écriture propre (2 avec date détectée, 1 sans — la date
//    reste un état valide « pas d'échéance », jamais forcée) ;
//  - 5 scénarios de non-régression couvrant la frontière avec OBSERVATION,
//    CREATE_WATCHPOINT, CREATE_DEADLINE, CREATE_RESERVE, SCHEDULE_MEETING
//    → intent ≠ CREATE_ACTION, AUCUNE écriture action ;
//  - un rejeu d'idempotence sur le 1er scénario écrit (même copilotProposalId
//    → même actionId, pas de doublon) ;
//  - due_date_status='explicit' quand une date est détectée, null sinon —
//    même convention que la saisie manuelle humaine (addActionAction) ;
//  - aucune ligne préexistante n'est lue en écriture ni modifiée ;
//  - le manifeste est la SEULE source de vérité pour le rollback (IDs exacts).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { buildCopilotProposal } from '../lib/visits/copilot-proposal'
import { confirmSiteAction } from '../lib/db/site-action-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'site_actions'
  id: string
  phrase: string
  title: string
  copilotProposalId: string
}
type Manifest = {
  testRunId: string
  createdAt: string
  siteId: string
  userId: string
  entries: ManifestEntry[]
}

async function countActions(supabase: ReturnType<typeof admin>, siteId: string) {
  const { count: total } = await supabase.from('site_actions').select('id', { count: 'exact', head: true }).eq('site_id', siteId)
  const { count: open } = await supabase.from('site_actions').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'open')
  return { total: total ?? 0, open: open ?? 0 }
}

// Scénarios issus du cadrage Vincent (P5-F1, 2026-08-17) : 3 exemples positifs
// (2 datés, 1 sans date), 5 non-régressions (frontières explicites avec
// OBSERVATION, CREATE_WATCHPOINT, CREATE_DEADLINE, CREATE_RESERVE,
// SCHEDULE_MEETING).
type Scenario = { label: string; phrase: string; expect: 'write' | 'skip_wrong_intent'; expectDate: boolean }
const SCENARIOS: Scenario[] = [
  { label: '1. verbe créer + action + date relative (positif, daté)', phrase: 'Crée une action pour rappeler Clim Expair demain.', expect: 'write', expectDate: true },
  { label: '2. verbe ajouter + action, sans date (positif, non daté)', phrase: 'Ajoute une action de suivi.', expect: 'write', expectDate: false },
  { label: '3. formulation implicite + jour de semaine (positif, daté)', phrase: 'Il faut rappeler Clim Expair vendredi.', expect: 'write', expectDate: true },
  { label: '4. non-régression OBSERVATION (simple constat)', phrase: 'Le portail est cassé.', expect: 'skip_wrong_intent', expectDate: false },
  { label: '5. non-régression CREATE_WATCHPOINT (surveillance)', phrase: 'Surveille le portail.', expect: 'skip_wrong_intent', expectDate: false },
  { label: '6. non-régression CREATE_DEADLINE (obligation datée)', phrase: 'Le portail doit être réparé avant vendredi.', expect: 'skip_wrong_intent', expectDate: false },
  { label: '7. non-régression CREATE_RESERVE (réserve)', phrase: 'Crée une réserve sur le portail cassé.', expect: 'skip_wrong_intent', expectDate: false },
  { label: '8. non-régression SCHEDULE_MEETING (planification datée)', phrase: 'Ajoute une réunion vendredi à 14h.', expect: 'skip_wrong_intent', expectDate: false },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()

  console.log(`── Harnais de recette réversible P5-F1 (CREATE_ACTION daté) ──`)
  console.log(`testRunId = ${testRunId}`)
  console.log(`userId    = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)\n`)

  const before = await countActions(supabase, PETRO_SITE_ID)
  console.log(`AVANT — site_actions(site=PETRO): total=${before.total} open=${before.open}\n`)

  const manifest: Manifest = {
    testRunId,
    createdAt: new Date().toISOString(),
    siteId: PETRO_SITE_ID,
    userId: RECETTE_USER_ID,
    entries: [],
  }

  for (const s of SCENARIOS) {
    console.log(`── ${s.label}`)
    console.log(`   phrase: "${s.phrase}"`)

    const intentResult = detectIntent(s.phrase)
    console.log(`   intent = ${intentResult.intent} (confiance=${intentResult.confidence})`)

    if (intentResult.intent !== 'CREATE_ACTION') {
      const ok = s.expect === 'skip_wrong_intent'
      console.log(`   ${ok ? 'OK — routage attendu hors CREATE_ACTION, AUCUNE écriture action.' : 'ECART — intent inattendu.'}\n`)
      continue
    }

    if (s.expect !== 'write') {
      console.log(`   ECART — intent=CREATE_ACTION alors qu'un routage différent était attendu (${s.expect}).\n`)
    }

    const proposal = buildCopilotProposal({
      question: s.phrase,
      canonicalSubjectId: null,
      canonicalSubjectLabel: null,
      resolvedWithConfidence: false,
    })

    const dateOk = s.expectDate ? !!proposal.actionDueDate : proposal.actionDueDate === null
    console.log(`   actionDueDate = ${proposal.actionDueDate ?? 'null'} — ${dateOk ? 'OK' : 'ECART, date attendue différente'}`)

    const result = await confirmSiteAction({
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      title: proposal.title,
      body: null,
      dueDate: proposal.actionDueDate,
      copilotProposalId: proposal.proposalId,
      llmModel: proposal.llmModel,
      promptVersion: proposal.promptVersion,
      interactionId: null,
    })

    if (!result.ok) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ${result.error}\n`)
      continue
    }

    manifest.entries.push({
      table: 'site_actions',
      id: result.actionId,
      phrase: s.phrase,
      title: proposal.title,
      copilotProposalId: proposal.proposalId,
    })
    console.log(`   ÉCRIT → site_actions.id=${result.actionId} (title: "${proposal.title}")`)

    // Vérification directe de l'effet (pas de confiance dans la valeur de retour seule).
    const { data: row } = await supabase
      .from('site_actions')
      .select('id, title, status, due_date, due_date_status, copilot_proposal_id, created_by, created_from')
      .eq('id', result.actionId)
      .single()
    const expectedDueDateStatus = proposal.actionDueDate ? 'explicit' : null
    const okRow = row && row.title === proposal.title && row.status === 'open'
      && row.due_date === proposal.actionDueDate && row.due_date_status === expectedDueDateStatus
      && row.copilot_proposal_id === proposal.proposalId && row.created_by === RECETTE_USER_ID
      && row.created_from === 'copilot'
    console.log(`   vérifié en base : ${okRow ? `OK (due_date=${row?.due_date}, due_date_status=${row?.due_date_status})` : 'ECART — ' + JSON.stringify(row)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId → même actionId, pas de doublon.
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    const replay = await confirmSiteAction({
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      title: 'Titre différent — ne doit avoir aucun effet',
      body: null,
      dueDate: null,
      copilotProposalId: first.copilotProposalId,
      llmModel: 'classifier-deterministic',
      promptVersion: '3c-v1',
      interactionId: null,
    })
    const idempotent = replay.ok && replay.actionId === first.id
    console.log(`   rejeu → ${idempotent ? 'OK (même actionId, pas de doublon)' : 'ECART — ' + JSON.stringify(replay)}\n`)
  }

  const after = await countActions(supabase, PETRO_SITE_ID)
  console.log(`APRÈS — site_actions(site=PETRO): total=${after.total} open=${after.open}`)
  console.log(`Δ total=${after.total - before.total} Δopen=${after.open - before.open}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-action-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
