// Harnais de recette réversible — P5-F3 (ADD_VISIT_ITEM).
// (Vincent, 2026-08-17.) Exécute les scénarios via le pipeline réel
// (detectIntent → buildCopilotProposal → upsertPreparationItem — le MÊME
// upsertPreparationItem que la server action addCopilotToBriefing en
// production, pas une copie), journalise tous les IDs créés dans un
// manifeste, et laisse `rollback-visit-item-test-run.ts <testRunId>` remettre
// la base dans son état initial.
//
// Décision de conception (idempotence) : upsertPreparationItem fait un UPSERT
// sur (site_id, prepared_by, stable_key) avec ignoreDuplicates=false — un
// rejeu avec le même copilotProposalId (stable_key = `copilot:<id>`) NE
// DUPLIQUE JAMAIS la ligne, mais MET À JOUR label/reason si différents
// (comportement documenté dans lib/db/visit-preparation.ts, pas un défaut).
// Idempotence testée = pas de doublon + id stable, PAS immutabilité du label.
//
// Décision de conception (rollback) : site_visit_preparation_item n'a pas de
// colonne deleted_at — le rollback fait donc, comme pour site_actions, une
// suppression DURE par ID exact.
//
// Garanties couvertes par ce run :
//  - 3 scénarios d'écriture propre (verbe fort, verbe faible via "pense à",
//    verbe fort "mets") ;
//  - 5 scénarios de non-régression couvrant la frontière avec CREATE_ACTION,
//    SCHEDULE_VISIT, READ, SCHEDULE_MEETING, CREATE_WATCHPOINT → intent ≠
//    ADD_VISIT_ITEM, AUCUNE écriture visit_item ;
//  - un rejeu d'idempotence sur le 1er scénario écrit (même copilotProposalId
//    → même id, pas de doublon, label mis à jour) ;
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
import { upsertPreparationItem } from '../lib/db/visit-preparation'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'site_visit_preparation_item'
  id: string
  phrase: string
  label: string
  stableKey: string
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

async function getOrganizationId(supabase: ReturnType<typeof admin>): Promise<string> {
  const { data, error } = await supabase.from('sites').select('organization_id').eq('id', PETRO_SITE_ID).single()
  if (error || !data) throw new Error(`Chantier PETRO introuvable : ${error?.message}`)
  return data.organization_id as string
}

async function countActive(supabase: ReturnType<typeof admin>, siteId: string, userId: string) {
  const { count } = await supabase
    .from('site_visit_preparation_item')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('prepared_by', userId)
    .is('consumed_at', null)
  return count ?? 0
}

// Scénarios issus de tests/lib/copilot-intent-router.test.ts (formes déjà
// prouvées au niveau routeur) — 3 exemples positifs, 5 non-régressions
// (frontières explicites avec CREATE_ACTION, SCHEDULE_VISIT, READ,
// SCHEDULE_MEETING, CREATE_WATCHPOINT).
type Scenario = { label: string; phrase: string; expect: 'write' | 'skip_wrong_intent' }
const SCENARIOS: Scenario[] = [
  { label: '1. verbe fort "ajoute" + "au plan de visite" (positif)', phrase: 'Ajoute R4 au plan de visite', expect: 'write' },
  { label: '2. verbe faible "pense à" + "prochaine visite" (positif, implicite)', phrase: 'Pense à vérifier R4 à la prochaine visite', expect: 'write' },
  { label: '3. verbe fort "mets" + "mon plan de visite" (positif)', phrase: 'Mets les points de contrôle dans mon plan de visite', expect: 'write' },
  { label: '4. non-régression CREATE_ACTION ("action" domine "prochaine visite")', phrase: 'Ajoute une action pour préparer la prochaine visite', expect: 'skip_wrong_intent' },
  { label: '5. non-régression SCHEDULE_VISIT (planifier une visite, pas y ajouter un point)', phrase: 'Planifie une visite pour vérifier R4', expect: 'skip_wrong_intent' },
  { label: '6. non-régression READ (question sur la prochaine visite)', phrase: 'Quand est ma prochaine visite ?', expect: 'skip_wrong_intent' },
  { label: '7. non-régression SCHEDULE_MEETING (autre famille de planification)', phrase: 'Planifie une réunion vendredi à 14h', expect: 'skip_wrong_intent' },
  { label: '8. non-régression CREATE_WATCHPOINT (vigilance durable, pas bornée à une visite)', phrase: "Surveille le SSI tant que ce n'est pas réglé.", expect: 'skip_wrong_intent' },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()
  const organizationId = await getOrganizationId(supabase)

  console.log(`── Harnais de recette réversible P5-F3 (ADD_VISIT_ITEM) ──`)
  console.log(`testRunId = ${testRunId}`)
  console.log(`userId    = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)`)
  console.log(`orgId     = ${organizationId}\n`)

  const before = await countActive(supabase, PETRO_SITE_ID, RECETTE_USER_ID)
  console.log(`AVANT — site_visit_preparation_item actives (site=PETRO, user=recette): ${before}\n`)

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

    if (intentResult.intent !== 'ADD_VISIT_ITEM') {
      const ok = s.expect === 'skip_wrong_intent'
      console.log(`   ${ok ? 'OK — routage attendu hors ADD_VISIT_ITEM, AUCUNE écriture visit_item.' : 'ECART — intent inattendu.'}\n`)
      continue
    }

    if (s.expect !== 'write') {
      console.log(`   ECART — intent=ADD_VISIT_ITEM alors qu'un routage différent était attendu (${s.expect}).\n`)
    }

    const proposal = buildCopilotProposal({
      question: s.phrase,
      canonicalSubjectId: null,
      canonicalSubjectLabel: null,
      resolvedWithConfidence: false,
    })
    const stableKey = `copilot:${proposal.proposalId}`

    await upsertPreparationItem({
      siteId: PETRO_SITE_ID,
      organizationId,
      stableKey,
      label: proposal.title.trim(),
      sourceKind: 'copilot_suggestion',
      sourceRef: proposal.proposalId,
      canonicalSubjectId: null,
      priority: 'normal',
      reason: proposal.whyText,
      preparedBy: RECETTE_USER_ID,
    })

    const { data: row } = await supabase
      .from('site_visit_preparation_item')
      .select('id, label, source_kind, source_ref, priority, reason, organization_id, prepared_by, consumed_at')
      .eq('site_id', PETRO_SITE_ID)
      .eq('prepared_by', RECETTE_USER_ID)
      .eq('stable_key', stableKey)
      .single()

    if (!row) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ligne introuvable après upsert.\n`)
      continue
    }

    manifest.entries.push({
      table: 'site_visit_preparation_item',
      id: row.id as string,
      phrase: s.phrase,
      label: proposal.title.trim(),
      stableKey,
      copilotProposalId: proposal.proposalId,
    })
    console.log(`   ÉCRIT → site_visit_preparation_item.id=${row.id} (label: "${row.label}")`)

    const okRow = row.label === proposal.title.trim() && row.source_kind === 'copilot_suggestion'
      && row.source_ref === proposal.proposalId && row.priority === 'normal' && row.reason === proposal.whyText
      && row.organization_id === organizationId && row.prepared_by === RECETTE_USER_ID && row.consumed_at === null
    console.log(`   vérifié en base : ${okRow ? 'OK' : 'ECART — ' + JSON.stringify(row)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId (donc même stable_key) → même id,
  // pas de doublon. Le label EST mis à jour (comportement réel de l'upsert,
  // documenté dans lib/db/visit-preparation.ts — ce n'est pas un no-op strict).
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    await upsertPreparationItem({
      siteId: PETRO_SITE_ID,
      organizationId,
      stableKey: first.stableKey,
      label: 'Titre différent — vérifie l’update, pas de doublon',
      sourceKind: 'copilot_suggestion',
      sourceRef: first.copilotProposalId,
      canonicalSubjectId: null,
      priority: 'normal',
      reason: 'Rejeu recette',
      preparedBy: RECETTE_USER_ID,
    })
    const { data: rows } = await supabase
      .from('site_visit_preparation_item')
      .select('id, label')
      .eq('site_id', PETRO_SITE_ID)
      .eq('prepared_by', RECETTE_USER_ID)
      .eq('stable_key', first.stableKey)
    const noDuplicate = (rows?.length ?? 0) === 1
    const sameId = rows?.[0]?.id === first.id
    const labelUpdated = rows?.[0]?.label === 'Titre différent — vérifie l’update, pas de doublon'
    const idempotent = noDuplicate && sameId
    console.log(`   rejeu → ${idempotent ? `OK (id stable, pas de doublon, label mis à jour=${labelUpdated})` : 'ECART — ' + JSON.stringify(rows)}\n`)
  }

  const after = await countActive(supabase, PETRO_SITE_ID, RECETTE_USER_ID)
  console.log(`APRÈS — site_visit_preparation_item actives (site=PETRO, user=recette): ${after}`)
  console.log(`Δ=${after - before}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-visit-item-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
