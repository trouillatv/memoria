// Harnais de recette réversible — P4-E2 (CREATE_DEADLINE / site_deadlines).
// (Vincent, 2026-08-17.) Exécute les scénarios via le pipeline réel (detectIntent
// → buildDeadlineProposal → confirmSiteDeadline — le MÊME confirmSiteDeadline
// que la server action de production, pas une copie), journalise tous les IDs
// créés dans un manifeste, et laisse `rollback-deadline-test-run.ts <testRunId>`
// remettre la base dans son état initial.
//
// Décision de conception (rollback) : site_deadlines a une colonne deleted_at,
// mais le rollback de ce harnais fait une suppression DURE par ID exact — même
// discipline que rollback-watchpoint-test-run.ts (P4-E1) et
// rollback-relation-claim-test-run.ts (P4-D1) — pour garantir une restauration
// RÉELLE de l'état initial plutôt que de laisser des lignes de test
// soft-deleted s'accumuler en base indéfiniment.
//
// Garanties couvertes par ce run :
//  - 2 scénarios d'écriture propre, un par exemple positif du cadrage Vincent
//    (« doit être réglé avant vendredi » / « doit arriver avant le 25 août ») ;
//  - 4 scénarios de non-régression (CREATE_ACTION ×2, FACT, SCHEDULE_MEETING)
//    → intent ≠ CREATE_DEADLINE, AUCUNE écriture deadline ;
//  - un rejeu d'idempotence sur le 1er scénario écrit (même copilotProposalId
//    → même deadlineId, pas de doublon) ;
//  - aucune ligne préexistante n'est lue en écriture ni modifiée ;
//  - le manifeste est la SEULE source de vérité pour le rollback (IDs exacts).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { buildDeadlineProposal } from '../lib/visits/copilot-proposal'
import { confirmSiteDeadline } from '../lib/db/site-deadline-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'site_deadlines'
  id: string
  phrase: string
  title: string
  copilotProposalId: string
}
type Manifest = {
  testRunId: string
  createdAt: string
  siteId: string
  organizationId: string
  userId: string
  entries: ManifestEntry[]
}

async function getPetroOrgId(supabase: ReturnType<typeof admin>): Promise<string> {
  const { data, error } = await supabase.from('sites').select('organization_id').eq('id', PETRO_SITE_ID).single()
  if (error || !data) throw new Error(`site PETRO introuvable: ${error?.message}`)
  return data.organization_id as string
}

async function countDeadlines(supabase: ReturnType<typeof admin>, siteId: string) {
  const { count: total } = await supabase.from('site_deadlines').select('id', { count: 'exact', head: true }).eq('site_id', siteId).is('deleted_at', null)
  const { count: active } = await supabase.from('site_deadlines').select('id', { count: 'exact', head: true }).eq('site_id', siteId).is('deleted_at', null).in('status', ['to_plan', 'planned'])
  return { total: total ?? 0, active: active ?? 0 }
}

// Scénarios issus du cadrage Vincent (P4-E2, 2026-08-17) : 2 exemples positifs,
// 4 non-régressions (voisins qui ne doivent jamais être absorbés).
type Scenario = { label: string; phrase: string; expect: 'write' | 'skip_wrong_intent' }
const SCENARIOS: Scenario[] = [
  { label: '1. obligation + délai explicite (positif)', phrase: 'Le SSI doit être réglé avant vendredi.', expect: 'write' },
  { label: '2. obligation + date explicite (positif)', phrase: 'Le VISA doit arriver avant le 25 août.', expect: 'write' },
  { label: '3. non-régression CREATE_ACTION (impératif daté)', phrase: 'Fais régler le SSI vendredi.', expect: 'skip_wrong_intent' },
  { label: '4. non-régression FACT (futur simple daté)', phrase: 'Le chantier sera fermé vendredi.', expect: 'skip_wrong_intent' },
  { label: '5. non-régression SCHEDULE_MEETING', phrase: 'Réunion vendredi à 14h.', expect: 'skip_wrong_intent' },
  { label: '6. non-régression CREATE_ACTION (rappel daté)', phrase: 'Rappelle-moi vendredi de vérifier le SSI.', expect: 'skip_wrong_intent' },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()
  const organizationId = await getPetroOrgId(supabase)

  console.log(`── Harnais de recette réversible P4-E2 (CREATE_DEADLINE) ──`)
  console.log(`testRunId       = ${testRunId}`)
  console.log(`organizationId  = ${organizationId} (PETRO)`)
  console.log(`userId          = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)\n`)

  const before = await countDeadlines(supabase, PETRO_SITE_ID)
  console.log(`AVANT — site_deadlines(site=PETRO): total=${before.total} active=${before.active}\n`)

  const manifest: Manifest = {
    testRunId,
    createdAt: new Date().toISOString(),
    siteId: PETRO_SITE_ID,
    organizationId,
    userId: RECETTE_USER_ID,
    entries: [],
  }

  for (const s of SCENARIOS) {
    console.log(`── ${s.label}`)
    console.log(`   phrase: "${s.phrase}"`)

    const intentResult = detectIntent(s.phrase)
    console.log(`   intent = ${intentResult.intent} (confiance=${intentResult.confidence})`)

    if (intentResult.intent !== 'CREATE_DEADLINE') {
      const ok = s.expect === 'skip_wrong_intent'
      console.log(`   ${ok ? 'OK — routage attendu hors CREATE_DEADLINE, AUCUNE écriture deadline.' : 'ECART — intent inattendu.'}\n`)
      continue
    }

    if (s.expect !== 'write') {
      console.log(`   ECART — intent=CREATE_DEADLINE alors qu'un routage différent était attendu (${s.expect}).\n`)
    }

    // Pas de résolution de sujet dans ce harnais : canonicalSubjectId reste un
    // enrichissement d'affichage optionnel (jamais bloquant), cf. doctrine FACT/WATCHPOINT.
    const proposal = buildDeadlineProposal({
      question: s.phrase,
      canonicalSubjectId: null,
      canonicalSubjectLabel: null,
    })
    console.log(`   dueDate extraite = ${proposal.deadlineDueDate ?? '(aucune — à planifier)'}`)

    const result = await confirmSiteDeadline({
      organizationId,
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      title: proposal.title,
      constraintText: proposal.body,
      dueDate: proposal.deadlineDueDate,
      copilotProposalId: proposal.proposalId,
      interactionId: null,
    })

    if (!result.ok) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ${result.error}\n`)
      continue
    }

    manifest.entries.push({
      table: 'site_deadlines',
      id: result.deadlineId,
      phrase: s.phrase,
      title: proposal.title,
      copilotProposalId: proposal.proposalId,
    })
    console.log(`   ÉCRIT → site_deadlines.id=${result.deadlineId} (titre: "${proposal.title}")`)

    // Vérification directe de l'effet (pas de confiance dans la valeur de retour seule).
    const { data: row } = await supabase
      .from('site_deadlines')
      .select('id, title, constraint_text, due_date, status, copilot_proposal_id, created_by')
      .eq('id', result.deadlineId)
      .single()
    const expectedStatus = proposal.deadlineDueDate ? 'planned' : 'to_plan'
    const okRow = row && row.title === proposal.title && row.constraint_text === s.phrase
      && row.status === expectedStatus && row.copilot_proposal_id === proposal.proposalId
      && row.created_by === RECETTE_USER_ID && row.due_date === proposal.deadlineDueDate
    console.log(`   vérifié en base : ${okRow ? `OK (status=${expectedStatus}, constraint_text=phrase verbatim, due_date=${row?.due_date ?? 'null'})` : 'ECART — ' + JSON.stringify(row)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId → même deadlineId, pas de doublon.
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    const replay = await confirmSiteDeadline({
      organizationId,
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      title: 'Titre différent — ne doit avoir aucun effet',
      constraintText: 'Corps différent — ne doit avoir aucun effet (idempotence par copilot_proposal_id).',
      dueDate: null,
      copilotProposalId: first.copilotProposalId,
      interactionId: null,
    })
    const idempotent = replay.ok && replay.deadlineId === first.id
    console.log(`   rejeu → ${idempotent ? 'OK (même deadlineId, pas de doublon)' : 'ECART — ' + JSON.stringify(replay)}\n`)
  }

  const after = await countDeadlines(supabase, PETRO_SITE_ID)
  console.log(`APRÈS — site_deadlines(site=PETRO): total=${after.total} active=${after.active}`)
  console.log(`Δ total=${after.total - before.total} Δactive=${after.active - before.active}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-deadline-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
