// Harnais de recette réversible — P4-E1 (CREATE_WATCHPOINT / site_watchpoints).
// (Vincent, 2026-08-17.) Exécute les scénarios via le pipeline réel (detectIntent
// → buildWatchpointProposal → confirmSiteWatchpoint — le MÊME confirmSiteWatchpoint
// que la server action de production, pas une copie), journalise tous les IDs
// créés dans un manifeste, et laisse `rollback-watchpoint-test-run.ts <testRunId>`
// remettre la base dans son état initial.
//
// Décision de conception (rollback) : site_watchpoints A une colonne deleted_at
// (mig 217), mais le rollback de ce harnais fait une suppression DURE par ID
// exact — même discipline que rollback-relation-claim-test-run.ts (P4-D1) —
// pour garantir une restauration RÉELLE de l'état initial plutôt que de laisser
// des lignes de test soft-deleted s'accumuler en base indéfiniment.
//
// Garanties couvertes par ce run :
//  - 3 scénarios d'écriture propre, un par exemple positif du cadrage Vincent
//    (surveille / garde un œil / il faudrait le suivre) ;
//  - 4 scénarios de non-régression (ADD_VISIT_ITEM, CREATE_ACTION ×2, FACT)
//    → intent ≠ CREATE_WATCHPOINT, AUCUNE écriture watchpoint ;
//  - 2 scénarios de récurrence (tripwire P4-E4) → UNKNOWN_WRITE, AUCUNE
//    écriture, jamais absorbé silencieusement dans un watchpoint ;
//  - un rejeu d'idempotence sur le 1er scénario écrit (même copilotProposalId
//    → même watchpointId, pas de doublon) ;
//  - aucune ligne préexistante n'est lue en écriture ni modifiée ;
//  - le manifeste est la SEULE source de vérité pour le rollback (IDs exacts).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { buildWatchpointProposal } from '../lib/visits/copilot-proposal'
import { confirmSiteWatchpoint } from '../lib/db/site-watchpoint-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'site_watchpoints'
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

async function countWatchpoints(supabase: ReturnType<typeof admin>, siteId: string) {
  const { count: total } = await supabase.from('site_watchpoints').select('id', { count: 'exact', head: true }).eq('site_id', siteId)
  const { count: active } = await supabase.from('site_watchpoints').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'active')
  return { total: total ?? 0, active: active ?? 0 }
}

// Scénarios issus du cadrage Vincent (P4-E1, 2026-08-17) : 3 exemples positifs,
// 4 non-régressions (voisins qui ne doivent jamais être absorbés), 2 tripwires
// de récurrence (P4-E4, non géré).
type Scenario = { label: string; phrase: string; expect: 'write' | 'skip_wrong_intent' }
const SCENARIOS: Scenario[] = [
  { label: '1. surveille (positif)', phrase: "Surveille le SSI tant que ce n'est pas réglé.", expect: 'write' },
  { label: '2. garde un œil (positif)', phrase: 'Garde un œil sur la fissure du mur nord.', expect: 'write' },
  { label: '3. il faudrait le suivre (positif)', phrase: "Ça fait trois visites qu'on parle du SSI, il faudrait le suivre.", expect: 'write' },
  { label: '4. non-régression ADD_VISIT_ITEM', phrase: 'À ma prochaine visite, vérifie le SSI.', expect: 'skip_wrong_intent' },
  { label: '5. non-régression CREATE_ACTION', phrase: 'Fais poser un cadenas sur le portail.', expect: 'skip_wrong_intent' },
  { label: '6. non-régression CREATE_ACTION (demande)', phrase: "Demande au chef d'équipe de vérifier le SSI.", expect: 'skip_wrong_intent' },
  { label: '7. non-régression FACT', phrase: 'Jérôme passe demain matin.', expect: 'skip_wrong_intent' },
  { label: '8. tripwire récurrence simple', phrase: "Pense à revérifier le SSI à chaque visite tant que ce n'est pas réglé.", expect: 'skip_wrong_intent' },
  { label: '9. tripwire récurrence + surveille', phrase: 'Surveille le SSI à chaque visite.', expect: 'skip_wrong_intent' },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()
  const organizationId = await getPetroOrgId(supabase)

  console.log(`── Harnais de recette réversible P4-E1 (CREATE_WATCHPOINT) ──`)
  console.log(`testRunId       = ${testRunId}`)
  console.log(`organizationId  = ${organizationId} (PETRO)`)
  console.log(`userId          = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)\n`)

  const before = await countWatchpoints(supabase, PETRO_SITE_ID)
  console.log(`AVANT — site_watchpoints(site=PETRO): total=${before.total} active=${before.active}\n`)

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

    if (intentResult.intent !== 'CREATE_WATCHPOINT') {
      const ok = s.expect === 'skip_wrong_intent'
      console.log(`   ${ok ? 'OK — routage attendu hors CREATE_WATCHPOINT, AUCUNE écriture watchpoint.' : 'ECART — intent inattendu.'}\n`)
      continue
    }

    if (s.expect !== 'write') {
      console.log(`   ECART — intent=CREATE_WATCHPOINT alors qu'un routage différent était attendu (${s.expect}).\n`)
    }

    // Pas de résolution de sujet dans ce harnais : canonicalSubjectId reste un
    // enrichissement d'affichage optionnel (jamais bloquant), cf. doctrine FACT.
    const proposal = buildWatchpointProposal({
      question: s.phrase,
      canonicalSubjectId: null,
      canonicalSubjectLabel: null,
    })

    const result = await confirmSiteWatchpoint({
      organizationId,
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      title: proposal.title,
      body: proposal.body,
      copilotProposalId: proposal.proposalId,
      interactionId: null,
    })

    if (!result.ok) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ${result.error}\n`)
      continue
    }

    manifest.entries.push({
      table: 'site_watchpoints',
      id: result.watchpointId,
      phrase: s.phrase,
      title: proposal.title,
      copilotProposalId: proposal.proposalId,
    })
    console.log(`   ÉCRIT → site_watchpoints.id=${result.watchpointId} (titre: "${proposal.title}")`)

    // Vérification directe de l'effet (pas de confiance dans la valeur de retour seule).
    const { data: row } = await supabase
      .from('site_watchpoints')
      .select('id, title, body, status, copilot_proposal_id, confirmed_by')
      .eq('id', result.watchpointId)
      .single()
    const okRow = row && row.title === proposal.title && row.body === s.phrase
      && row.status === 'active' && row.copilot_proposal_id === proposal.proposalId
      && row.confirmed_by === RECETTE_USER_ID
    console.log(`   vérifié en base : ${okRow ? 'OK (status=active, body=phrase verbatim)' : 'ECART — ' + JSON.stringify(row)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId → même watchpointId, pas de doublon.
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    const replay = await confirmSiteWatchpoint({
      organizationId,
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      title: 'Titre différent — ne doit avoir aucun effet',
      body: 'Corps différent — ne doit avoir aucun effet (idempotence par copilot_proposal_id).',
      copilotProposalId: first.copilotProposalId,
      interactionId: null,
    })
    const idempotent = replay.ok && replay.watchpointId === first.id
    console.log(`   rejeu → ${idempotent ? 'OK (même watchpointId, pas de doublon)' : 'ECART — ' + JSON.stringify(replay)}\n`)
  }

  const after = await countWatchpoints(supabase, PETRO_SITE_ID)
  console.log(`APRÈS — site_watchpoints(site=PETRO): total=${after.total} active=${after.active}`)
  console.log(`Δ total=${after.total - before.total} Δactive=${after.active - before.active}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-watchpoint-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
