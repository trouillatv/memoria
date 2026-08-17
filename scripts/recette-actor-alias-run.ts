// Harnais de recette réversible — P4-B.2 (actor_alias).
// (Vincent, 2026-08-17.) Exécute les scénarios réels via le pipeline normal
// (detectIntent → extractIdentityCorrection → resolveActorTarget →
// confirmActorAlias — le MÊME confirmActorAlias que la server action
// createCopilotActorAlias, pas une copie), journalise tous les IDs créés dans
// un manifeste, et laisse `rollback-copilot-test-run.ts <testRunId>` remettre
// la base dans son état initial.
//
// Garanties :
//  - source = 'copilot_test' sur CHAQUE ligne créée (jamais 'copilot' — donc
//    jamais confondu avec une vraie correspondance terrain) ;
//  - un vrai utilisateur PETRO existant est utilisé comme created_by/confirmed_by
//    (pas d'utilisateur fictif) ;
//  - aucune ligne préexistante n'est lue en écriture ni modifiée ;
//  - le manifeste est la SEULE source de vérité pour le rollback (IDs exacts).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { extractIdentityCorrection } from '../lib/visits/copilot-identity-correction'
import { resolveActorTarget } from '../lib/db/actor-alias-resolve'
import { confirmActorAlias } from '../lib/db/actor-alias-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO
const RECETTE_SOURCE = 'copilot_test'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'actor_alias'
  id: string
  scenario: string
  alias: string
  targetKind: 'company' | 'contact'
  targetId: string
  targetLabel: string
  copilotProposalId: string
}
type Manifest = {
  testRunId: string
  createdAt: string
  siteId: string
  organizationId: string
  userId: string
  source: string
  entries: ManifestEntry[]
}

async function getPetroOrgId(supabase: ReturnType<typeof admin>): Promise<string> {
  const { data, error } = await supabase.from('sites').select('organization_id').eq('id', PETRO_SITE_ID).single()
  if (error || !data) throw new Error(`site PETRO introuvable: ${error?.message}`)
  return data.organization_id as string
}

async function countActorAlias(supabase: ReturnType<typeof admin>, organizationId: string) {
  const { count: total } = await supabase.from('actor_alias').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)
  const { count: confirmed } = await supabase.from('actor_alias').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'confirmed')
  const { count: testRows } = await supabase.from('actor_alias').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('source', RECETTE_SOURCE)
  return { total: total ?? 0, confirmed: confirmed ?? 0, testRows: testRows ?? 0 }
}

// Scénarios à réel effet d'écriture (cible résoluble sans ambiguïté sur PETRO).
// Les scénarios de frontière (RELATION_CLAIM) et les cibles introuvables ne
// produisent aucune ligne — ils prouvent l'absence d'écriture, pas une écriture.
const WRITE_SCENARIOS: { label: string; phrase: string }[] = [
  { label: '1. transcription_alias — Clim Expert → Clim Expair (company réelle)', phrase: 'Quand je dis Clim Expert, je parle de Clim Expair.' },
  { label: '2. transcription_alias — Vincent → Vincent Milon (contact réel)', phrase: 'Quand je dis Vincent, je parle de Vincent Milon.' },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()
  const organizationId = await getPetroOrgId(supabase)

  console.log(`── Harnais de recette réversible P4-B.2 ──`)
  console.log(`testRunId       = ${testRunId}`)
  console.log(`organizationId  = ${organizationId} (PETRO)`)
  console.log(`userId          = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)`)
  console.log(`source          = ${RECETTE_SOURCE}\n`)

  const before = await countActorAlias(supabase, organizationId)
  console.log(`AVANT — actor_alias(org=PETRO): total=${before.total} confirmed=${before.confirmed} source=${RECETTE_SOURCE}:${before.testRows}\n`)

  const manifest: Manifest = {
    testRunId,
    createdAt: new Date().toISOString(),
    siteId: PETRO_SITE_ID,
    organizationId,
    userId: RECETTE_USER_ID,
    source: RECETTE_SOURCE,
    entries: [],
  }

  for (const s of WRITE_SCENARIOS) {
    console.log(`── ${s.label}`)
    console.log(`   phrase: "${s.phrase}"`)

    const intentResult = detectIntent(s.phrase)
    if (intentResult.intent !== 'CORRECTION_IDENTITY') {
      console.log(`   ECART — intent=${intentResult.intent}, attendu CORRECTION_IDENTITY. Scénario ignoré (aucune écriture).\n`)
      continue
    }

    const extraction = extractIdentityCorrection(s.phrase)
    if (!extraction) {
      console.log('   ECART — extraction NULL malgré intent détecté. Scénario ignoré.\n')
      continue
    }

    const resolution = await resolveActorTarget(organizationId, extraction.target)
    if (resolution.kind !== 'resolved') {
      console.log(`   resolution=${resolution.kind} — pas de cible unique, aucune écriture possible. Scénario ignoré.\n`)
      continue
    }

    const copilotProposalId = randomUUID()
    const result = await confirmActorAlias({
      organizationId,
      userId: RECETTE_USER_ID,
      alias: extraction.alias,
      targetKind: resolution.candidate.kind,
      targetId: resolution.candidate.id,
      aliasNature: extraction.proposedNature,
      copilotProposalId,
      interactionId: null,
      source: RECETTE_SOURCE,
    })

    if (!result.ok) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ${result.error}\n`)
      continue
    }

    manifest.entries.push({
      table: 'actor_alias',
      id: result.aliasId,
      scenario: s.label,
      alias: extraction.alias,
      targetKind: resolution.candidate.kind,
      targetId: resolution.candidate.id,
      targetLabel: resolution.candidate.label,
      copilotProposalId,
    })
    console.log(`   ÉCRIT → actor_alias.id=${result.aliasId} ("${extraction.alias}" désigne ${resolution.candidate.kind} "${resolution.candidate.label}")`)

    // Vérification directe de l'effet (pas de confiance dans la valeur de retour seule).
    const { data: row } = await supabase.from('actor_alias').select('id, status, source, alias_norm, copilot_proposal_id').eq('id', result.aliasId).single()
    const okRow = row && row.status === 'confirmed' && row.source === RECETTE_SOURCE && row.copilot_proposal_id === copilotProposalId
    console.log(`   vérifié en base : ${okRow ? 'OK' : 'ECART — ' + JSON.stringify(row)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId → même aliasId, pas de doublon.
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    const replay = await confirmActorAlias({
      organizationId,
      userId: RECETTE_USER_ID,
      alias: first.alias,
      targetKind: first.targetKind,
      targetId: first.targetId,
      aliasNature: 'transcription_alias',
      copilotProposalId: first.copilotProposalId,
      interactionId: null,
      source: RECETTE_SOURCE,
    })
    const idempotent = replay.ok && replay.aliasId === first.id
    console.log(`   rejeu → ${idempotent ? 'OK (même aliasId, pas de doublon)' : 'ECART — ' + JSON.stringify(replay)}\n`)
  }

  const after = await countActorAlias(supabase, organizationId)
  console.log(`APRÈS — actor_alias(org=PETRO): total=${after.total} confirmed=${after.confirmed} source=${RECETTE_SOURCE}:${after.testRows}`)
  console.log(`Δ total=${after.total - before.total} Δconfirmed=${after.confirmed - before.confirmed} Δ${RECETTE_SOURCE}=${after.testRows - before.testRows}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-copilot-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
