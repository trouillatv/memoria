// Harnais de recette réversible — P5-F3 (OBSERVATION).
// (Vincent, 2026-08-17.) Exécute les scénarios via le pipeline réel
// (detectIntent → buildObservationProposal → confirmSiteObservation — le MÊME
// confirmSiteObservation que la server action createCopilotObservation en
// production, tout juste extrait de copilot-write-action.ts sans changement
// de comportement, pas une copie), journalise tous les IDs créés dans un
// manifeste, et laisse `rollback-observation-test-run.ts <testRunId>` remettre
// la base dans son état initial.
//
// Particularité OBSERVATION : canonicalSubjectId doit être résolu AVANT
// d'atteindre ce writer (canonical_subject_id est NOT NULL en base, voir
// site-observation-write.ts) — en production cette résolution vient de
// copilot-free-prepare.ts, hors périmètre de ce harnais. Ce script utilise
// donc un canonical_subject RÉEL et déjà actif sur PETRO (lu, jamais créé ni
// modifié) : 72bc3ea9-d054-4951-8593-f7627be5a5c6 ("Vérification des lignes
// électriques et consignations").
//
// Décision de conception (idempotence) : confirmSiteObservation fait une
// lecture d'existence sur (source_kind='copilot', source_ref_id=copilotProposalId)
// AVANT insert — un rejeu avec le même copilotProposalId retourne le même
// occurrenceId, ne duplique jamais, mais (asymétrie déjà présente en
// production, préservée telle quelle) N'APPELLE PAS updateCopilotProposalStatus
// dans cette branche.
//
// Décision de conception (rollback) : canonical_subject_occurrence N'A PAS de
// colonne deleted_at (mig 291) — le rollback fait donc, comme pour
// site_actions et site_visit_preparation_item, une suppression DURE par ID
// exact.
//
// Garanties couvertes par ce run :
//  - 2 scénarios d'écriture propre (état inchangé, nouvelle information) ;
//  - 5 scénarios de non-régression couvrant la frontière avec CREATE_ACTION
//    (verbe fort, et verbe fort qui domine un état), READ, FACT (engagement
//    futur), et une opinion qui ne doit jamais devenir un constat ;
//  - un rejeu d'idempotence sur le 1er scénario écrit (même copilotProposalId
//    → même id, pas de doublon) ;
//  - aucune ligne préexistante n'est lue en écriture ni modifiée ;
//  - le manifeste est la SEULE source de vérité pour le rollback (IDs exacts).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { buildObservationProposal } from '../lib/visits/copilot-proposal'
import { confirmSiteObservation } from '../lib/db/site-observation-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO
const RECETTE_SUBJECT_ID = '72bc3ea9-d054-4951-8593-f7627be5a5c6' // canonical_subject réel, actif, non modifié par ce harnais
const RECETTE_SUBJECT_LABEL = 'Vérification des lignes électriques et consignations'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'canonical_subject_occurrence'
  id: string
  phrase: string
  label: string
  copilotProposalId: string
}
type Manifest = {
  testRunId: string
  createdAt: string
  siteId: string
  userId: string
  canonicalSubjectId: string
  entries: ManifestEntry[]
}

async function countActive(supabase: ReturnType<typeof admin>, siteId: string, userId: string) {
  const { count } = await supabase
    .from('canonical_subject_occurrence')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('created_by', userId)
    .eq('source_kind', 'copilot')
  return count ?? 0
}

// Scénarios issus de tests/lib/copilot-intent-router.test.ts (formes déjà
// prouvées au niveau routeur) — 2 exemples positifs, 5 non-régressions
// (CREATE_ACTION verbe fort, CREATE_ACTION verbe fort qui domine un état,
// READ, FACT engagement futur, opinion jamais promue en constat).
type Scenario = { label: string; phrase: string; expect: 'write' | 'skip_wrong_intent' }
const SCENARIOS: Scenario[] = [
  { label: '1. état inchangé (positif)', phrase: "Le cadenas n'est toujours pas installé.", expect: 'write' },
  { label: '2. nouvelle information (positif)', phrase: 'Les gaines sont arrivées ce matin.', expect: 'write' },
  { label: '3. non-régression CREATE_ACTION (verbe fort "il faut")', phrase: 'Il faut rappeler Clim Expair', expect: 'skip_wrong_intent' },
  { label: '4. non-régression READ (question, pas un constat)', phrase: 'Qui intervient sur la clim ?', expect: 'skip_wrong_intent' },
  { label: '5. non-régression FACT (engagement futur, exclu d\'OBSERVATION)', phrase: 'Le cadenas sera installé vendredi', expect: 'skip_wrong_intent' },
  { label: '6. non-régression opinion (jamais promue en constat)', phrase: 'Je pense que Clim Expair est encore responsable', expect: 'skip_wrong_intent' },
  { label: '7. non-régression CREATE_ACTION (verbe fort domine un état)', phrase: 'Il faut vérifier le tableau qui est encore hors tension', expect: 'skip_wrong_intent' },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()

  console.log(`── Harnais de recette réversible P5-F3 (OBSERVATION) ──`)
  console.log(`testRunId = ${testRunId}`)
  console.log(`userId    = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)`)
  console.log(`sujet     = ${RECETTE_SUBJECT_ID} ("${RECETTE_SUBJECT_LABEL}")\n`)

  const before = await countActive(supabase, PETRO_SITE_ID, RECETTE_USER_ID)
  console.log(`AVANT — canonical_subject_occurrence copilot actives (site=PETRO, user=recette): ${before}\n`)

  const manifest: Manifest = {
    testRunId,
    createdAt: new Date().toISOString(),
    siteId: PETRO_SITE_ID,
    userId: RECETTE_USER_ID,
    canonicalSubjectId: RECETTE_SUBJECT_ID,
    entries: [],
  }

  for (const s of SCENARIOS) {
    console.log(`── ${s.label}`)
    console.log(`   phrase: "${s.phrase}"`)

    const intentResult = detectIntent(s.phrase)
    console.log(`   intent = ${intentResult.intent} (confiance=${intentResult.confidence})`)

    if (intentResult.intent !== 'OBSERVATION') {
      const ok = s.expect === 'skip_wrong_intent'
      console.log(`   ${ok ? 'OK — routage attendu hors OBSERVATION, AUCUNE écriture.' : 'ECART — intent inattendu.'}\n`)
      continue
    }

    if (s.expect !== 'write') {
      console.log(`   ECART — intent=OBSERVATION alors qu'un routage différent était attendu (${s.expect}).\n`)
    }

    const proposal = buildObservationProposal({
      question: s.phrase,
      canonicalSubjectId: RECETTE_SUBJECT_ID,
      canonicalSubjectLabel: RECETTE_SUBJECT_LABEL,
      resolvedWithConfidence: true,
      actorLabel: null,
    })

    const result = await confirmSiteObservation({
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      canonicalSubjectId: RECETTE_SUBJECT_ID,
      label: proposal.title.trim(),
      body: proposal.body,
      copilotProposalId: proposal.proposalId,
      interactionId: null,
    })

    if (!result.ok) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ${result.error}\n`)
      continue
    }

    const { data: row } = await supabase
      .from('canonical_subject_occurrence')
      .select('id, canonical_subject_id, site_id, source_kind, source_ref_id, label, note, created_by, validation_status, effective_date')
      .eq('id', result.occurrenceId)
      .single()

    if (!row) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ligne introuvable après insert.\n`)
      continue
    }

    manifest.entries.push({
      table: 'canonical_subject_occurrence',
      id: row.id as string,
      phrase: s.phrase,
      label: proposal.title.trim(),
      copilotProposalId: proposal.proposalId,
    })
    console.log(`   ÉCRIT → canonical_subject_occurrence.id=${row.id} (label: "${row.label}")`)

    const okRow = row.canonical_subject_id === RECETTE_SUBJECT_ID && row.site_id === PETRO_SITE_ID
      && row.source_kind === 'copilot' && row.source_ref_id === proposal.proposalId
      && row.note === proposal.body && row.created_by === RECETTE_USER_ID
      && row.validation_status === 'confirmed'
    console.log(`   vérifié en base : ${okRow ? 'OK' : 'ECART — ' + JSON.stringify(row)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId → même occurrenceId, pas de
  // doublon, et (comportement réel préservé) pas de second appel
  // updateCopilotProposalStatus.
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    const replay = await confirmSiteObservation({
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      canonicalSubjectId: RECETTE_SUBJECT_ID,
      label: 'Titre rejoué — ne doit rien changer',
      body: 'Corps rejoué — ne doit rien changer',
      copilotProposalId: first.copilotProposalId,
      interactionId: null,
    })
    const { data: rows } = await supabase
      .from('canonical_subject_occurrence')
      .select('id, label')
      .eq('source_kind', 'copilot')
      .eq('source_ref_id', first.copilotProposalId)
    const noDuplicate = (rows?.length ?? 0) === 1
    const sameId = replay.ok && replay.occurrenceId === first.id
    const untouched = rows?.[0]?.label === first.label
    const idempotent = noDuplicate && sameId && untouched
    console.log(`   rejeu → ${idempotent ? 'OK (id stable, pas de doublon, contenu inchangé — early-return avant tout insert)' : 'ECART — ' + JSON.stringify({ replay, rows })}\n`)
  }

  const after = await countActive(supabase, PETRO_SITE_ID, RECETTE_USER_ID)
  console.log(`APRÈS — canonical_subject_occurrence copilot actives (site=PETRO, user=recette): ${after}`)
  console.log(`Δ=${after - before}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-observation-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
