// Harnais de recette réversible — P4-E3 (CREATE_RESERVE / site_reserve).
// (Vincent, 2026-08-17.) Exécute les scénarios via le pipeline réel (detectIntent
// → buildReserveProposal → confirmSiteReserve — le MÊME confirmSiteReserve
// que la server action de production, pas une copie), journalise tous les IDs
// créés dans un manifeste, et laisse `rollback-reserve-test-run.ts <testRunId>`
// remettre la base dans son état initial.
//
// Décision de conception (rollback) : site_reserve n'a PAS de colonne
// deleted_at (contrairement à site_deadlines) — le rollback fait donc, comme
// pour watchpoint/deadline, une suppression DURE par ID exact, seule option
// disponible ici et cohérente avec la discipline des harnais précédents.
//
// Garanties couvertes par ce run :
//  - 3 scénarios d'écriture propre (verbes de création explicites : crée /
//    ajoute / mets une réserve) ;
//  - 5 scénarios de non-régression couvrant la matrice de frontières du
//    cadrage Vincent (OBSERVATION, CREATE_WATCHPOINT, CREATE_ACTION,
//    CREATE_DEADLINE, formulation anaphorique "mets ça en réserve")
//    → intent ≠ CREATE_RESERVE, AUCUNE écriture réserve ;
//  - un rejeu d'idempotence sur le 1er scénario écrit (même copilotProposalId
//    → même reserveId, pas de doublon) ;
//  - aucune ligne préexistante n'est lue en écriture ni modifiée ;
//  - le manifeste est la SEULE source de vérité pour le rollback (IDs exacts).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { buildReserveProposal } from '../lib/visits/copilot-proposal'
import { confirmSiteReserve } from '../lib/db/site-reserve-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'site_reserve'
  id: string
  phrase: string
  label: string
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

async function countReserves(supabase: ReturnType<typeof admin>, siteId: string) {
  const { count: total } = await supabase.from('site_reserve').select('id', { count: 'exact', head: true }).eq('site_id', siteId)
  const { count: open } = await supabase.from('site_reserve').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'open')
  return { total: total ?? 0, open: open ?? 0 }
}

// Scénarios issus du cadrage Vincent (P4-E3, 2026-08-17) : 3 exemples positifs,
// 5 non-régressions (frontières explicites de la matrice — OBSERVATION,
// WATCHPOINT, ACTION, DEADLINE, anaphorique).
type Scenario = { label: string; phrase: string; expect: 'write' | 'skip_wrong_intent' }
const SCENARIOS: Scenario[] = [
  { label: '1. verbe créer + réserve (positif)', phrase: 'Crée une réserve sur le portail cassé.', expect: 'write' },
  { label: '2. verbe ajouter + réserve (positif)', phrase: 'Ajoute une réserve sur la fissure du mur.', expect: 'write' },
  { label: '3. verbe mettre + réserve (positif)', phrase: 'Mets une réserve sur le carrelage décollé.', expect: 'write' },
  { label: '4. non-régression OBSERVATION (simple constat)', phrase: 'Le portail est cassé.', expect: 'skip_wrong_intent' },
  { label: '5. non-régression CREATE_WATCHPOINT (surveillance)', phrase: 'Surveille le portail.', expect: 'skip_wrong_intent' },
  { label: '6. non-régression CREATE_ACTION (impératif de réparation)', phrase: 'Fais réparer le portail.', expect: 'skip_wrong_intent' },
  { label: '7. non-régression CREATE_DEADLINE (obligation datée)', phrase: 'Le portail doit être réparé avant vendredi.', expect: 'skip_wrong_intent' },
  { label: '8. non-régression anaphorique (hors V1, résolution de contexte requise)', phrase: 'Mets ça en réserve.', expect: 'skip_wrong_intent' },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()
  const organizationId = await getPetroOrgId(supabase)

  console.log(`── Harnais de recette réversible P4-E3 (CREATE_RESERVE) ──`)
  console.log(`testRunId       = ${testRunId}`)
  console.log(`organizationId  = ${organizationId} (PETRO)`)
  console.log(`userId          = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)\n`)

  const before = await countReserves(supabase, PETRO_SITE_ID)
  console.log(`AVANT — site_reserve(site=PETRO): total=${before.total} open=${before.open}\n`)

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

    if (intentResult.intent !== 'CREATE_RESERVE') {
      const ok = s.expect === 'skip_wrong_intent'
      console.log(`   ${ok ? 'OK — routage attendu hors CREATE_RESERVE, AUCUNE écriture réserve.' : 'ECART — intent inattendu.'}\n`)
      continue
    }

    if (s.expect !== 'write') {
      console.log(`   ECART — intent=CREATE_RESERVE alors qu'un routage différent était attendu (${s.expect}).\n`)
    }

    // Pas de résolution de sujet dans ce harnais : canonicalSubjectId reste un
    // enrichissement d'affichage optionnel (jamais bloquant), cf. doctrine FACT/WATCHPOINT/DEADLINE.
    const proposal = buildReserveProposal({
      question: s.phrase,
      canonicalSubjectId: null,
      canonicalSubjectLabel: null,
    })

    const result = await confirmSiteReserve({
      organizationId,
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      label: proposal.title,
      copilotProposalId: proposal.proposalId,
      interactionId: null,
    })

    if (!result.ok) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ${result.error}\n`)
      continue
    }

    manifest.entries.push({
      table: 'site_reserve',
      id: result.reserveId,
      phrase: s.phrase,
      label: proposal.title,
      copilotProposalId: proposal.proposalId,
    })
    console.log(`   ÉCRIT → site_reserve.id=${result.reserveId} (label: "${proposal.title}")`)

    // Vérification directe de l'effet (pas de confiance dans la valeur de retour seule).
    const { data: row } = await supabase
      .from('site_reserve')
      .select('id, label, status, issued_by, issued_on, copilot_proposal_id, created_by')
      .eq('id', result.reserveId)
      .single()
    const okRow = row && row.label === proposal.title && row.status === 'open'
      && row.issued_by === null && row.copilot_proposal_id === proposal.proposalId
      && row.created_by === RECETTE_USER_ID && !!row.issued_on
    console.log(`   vérifié en base : ${okRow ? `OK (status=open, issued_by=null, issued_on=${row?.issued_on})` : 'ECART — ' + JSON.stringify(row)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId → même reserveId, pas de doublon.
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    const replay = await confirmSiteReserve({
      organizationId,
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      label: 'Libellé différent — ne doit avoir aucun effet',
      copilotProposalId: first.copilotProposalId,
      interactionId: null,
    })
    const idempotent = replay.ok && replay.reserveId === first.id
    console.log(`   rejeu → ${idempotent ? 'OK (même reserveId, pas de doublon)' : 'ECART — ' + JSON.stringify(replay)}\n`)
  }

  const after = await countReserves(supabase, PETRO_SITE_ID)
  console.log(`APRÈS — site_reserve(site=PETRO): total=${after.total} open=${after.open}`)
  console.log(`Δ total=${after.total - before.total} Δopen=${after.open - before.open}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-reserve-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
