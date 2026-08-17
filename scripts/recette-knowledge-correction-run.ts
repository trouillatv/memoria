// Harnais de recette réversible — P5-F2b (CORRECTION_KNOWLEDGE conversationnel :
// détection → extraction → recherche de candidats → supersession/archivage).
// (Vincent, 2026-08-17.) Appelle les primitives réelles (extractKnowledgeCorrection,
// listRecentCurrentInformationEntries, supersedeKnowledgeEntry, archiveKnowledgeEntry,
// confirmSiteFact — les MÊMES que copilot-write-action.ts en production, pas des
// copies), journalise tous les IDs créés dans un manifeste, et laisse
// `rollback-knowledge-correction-test-run.ts <testRunId>` remettre la base dans
// son état initial.
//
// F2a (recette-knowledge-lifecycle-run.ts) a déjà prouvé l'atomicité de
// supersedeKnowledgeEntry/archiveKnowledgeEntry — pas dupliqué ici. Ce harnais
// couvre ce qui est NOUVEAU en F2b : la détection/extraction du langage de
// correction, la recherche de candidats bornée (max 5, current_information
// active seule, jamais durable_knowledge, aucune présélection), et le
// raccordement des 4 formulations de Vincent au bon chemin d'écriture.
//
// Couvre les 8 cas minimum demandés par Vincent :
//  1. "Correction, Jérôme passe lundi" après un FACT test "Jérôme passe demain"
//     → supersession, ancien candidat visible dans la recherche, ancienne
//     entrée superseded, nouvelle active, rollback ;
//  2. "Jérôme passe lundi" sans "correction" → aucune extraction déclenchée,
//     deux FACT indépendantes coexistent (aucune supersession) ;
//  3. "Ce n'est plus 4812, c'est 5830" → supersession ;
//  4. "Cette information n'est plus valable" avec un seul candidat → archivage ;
//  5. même phrase avec plusieurs candidats → liste complète, jamais de
//     sélection automatique ;
//  6. durable_knowledge présente sur le site → jamais candidate à la
//     recherche ;
//  7. idempotence/rejeu (côté supersession ET côté FACT indépendant) ;
//  8. rollback final et delta DB = 0 (prouvé par le script de rollback dédié).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { extractKnowledgeCorrection } from '../lib/visits/copilot-knowledge-correction'
import {
  listRecentCurrentInformationEntries,
  archiveKnowledgeEntry,
  supersedeKnowledgeEntry,
  createKnowledgeEntry,
} from '../lib/db/site-memory-entries'
import { confirmSiteFact } from '../lib/db/site-fact-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO
const PREFIX = '[TEST-RECETTE-P5F2B]'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = { table: 'site_knowledge_entries'; id: string; note: string; copilotProposalId: string }
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

let pass = 0
let fail = 0
function verdict(ok: boolean, label: string, detail?: string) {
  if (ok) pass++
  else fail++
  console.log(`   ${ok ? 'OK' : 'ECART'} — ${label}${detail ? ` (${detail})` : ''}`)
}

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()
  const organizationId = await getPetroOrgId(supabase)

  console.log(`── Harnais de recette réversible P5-F2b (CORRECTION_KNOWLEDGE) ──`)
  console.log(`testRunId       = ${testRunId}`)
  console.log(`organizationId  = ${organizationId} (PETRO)`)
  console.log(`userId          = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)\n`)

  const manifest: Manifest = { testRunId, createdAt: new Date().toISOString(), siteId: PETRO_SITE_ID, organizationId, userId: RECETTE_USER_ID, entries: [] }
  function record(id: string, note: string, copilotProposalId: string) {
    manifest.entries.push({ table: 'site_knowledge_entries', id, note, copilotProposalId })
  }

  // ── Cas 1 — "Correction, Jérôme passe lundi." après un FACT test existant ──
  console.log('── Cas 1 — "Correction, Jérôme passe lundi." supersède le FACT test')
  {
    const cpidBase = randomUUID()
    const oldId = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'current_information',
      title: `${PREFIX} Jérôme passe demain`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidBase,
    })
    record(oldId, 'cas1-old', cpidBase)

    const extraction = extractKnowledgeCorrection('Correction, Jérôme passe lundi.')
    verdict(extraction?.mode === 'supersede', 'extraction → mode supersede', JSON.stringify(extraction))

    const candidates = await listRecentCurrentInformationEntries(PETRO_SITE_ID)
    const oldVisible = candidates.some((c) => c.id === oldId)
    verdict(oldVisible, 'ancien candidat visible dans la recherche (max 5, non filtrée)')

    const cpidSupersede = randomUUID()
    const res = await supersedeKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, oldEntryId: oldId,
      title: `${PREFIX} ${extraction?.mode === 'supersede' ? extraction.newTitle : ''}`,
      confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidSupersede,
    })
    verdict(res.ok, 'confirmation → supersession réussit', res.ok ? undefined : res.error)
    if (res.ok) {
      record(res.newEntryId, 'cas1-new', cpidSupersede)
      const { data: oldRow } = await supabase.from('site_knowledge_entries').select('status').eq('id', oldId).single()
      const { data: newRow } = await supabase.from('site_knowledge_entries').select('status, supersedes_id').eq('id', res.newEntryId).single()
      verdict(
        oldRow?.status === 'superseded' && newRow?.status === 'active' && newRow?.supersedes_id === oldId,
        'ancienne → superseded, nouvelle → active, supersedes_id correct',
        `old=${oldRow?.status} new=${newRow?.status}`,
      )
    }
  }
  console.log()

  // ── Cas 2 — "Jérôme passe lundi." SANS "correction" : deux FACT coexistent ──
  console.log('── Cas 2 — "Jérôme passe lundi." sans marqueur : aucune supersession')
  {
    const extraction = extractKnowledgeCorrection('Jérôme passe lundi.')
    verdict(extraction === null, 'extraction → null, aucune recherche de candidat déclenchée', JSON.stringify(extraction))

    const cpidA = randomUUID()
    const factA = await confirmSiteFact({
      organizationId, siteId: PETRO_SITE_ID, userId: RECETTE_USER_ID, kind: 'current_information',
      title: `${PREFIX} Cas 2 — première affirmation`, body: null, copilotProposalId: cpidA, interactionId: null,
    })
    if (factA.ok) record(factA.entryId, 'cas2-fact-a', cpidA)

    const cpidB = randomUUID()
    const factB = await confirmSiteFact({
      organizationId, siteId: PETRO_SITE_ID, userId: RECETTE_USER_ID, kind: 'current_information',
      title: `${PREFIX} Cas 2 — seconde affirmation`, body: null, copilotProposalId: cpidB, interactionId: null,
    })
    if (factB.ok) record(factB.entryId, 'cas2-fact-b', cpidB)

    const bothActive = factA.ok && factB.ok
    if (bothActive) {
      const { data: rows } = await supabase.from('site_knowledge_entries').select('id, status').in('id', [
        (factA as { ok: true; entryId: string }).entryId,
        (factB as { ok: true; entryId: string }).entryId,
      ])
      const bothIndependentlyActive = (rows ?? []).every((r) => r.status === 'active')
      verdict(bothIndependentlyActive, 'deux FACT indépendantes coexistent, toutes deux actives — aucune supersession')
    } else {
      verdict(false, 'création des deux FACT test', `factA.ok=${factA.ok} factB.ok=${factB.ok}`)
    }
  }
  console.log()

  // ── Cas 3 — "Ce n'est plus 4812, c'est 5830." ──
  console.log('── Cas 3 — "Ce n\'est plus 4812, c\'est 5830." → supersession')
  {
    const cpidBase = randomUUID()
    const oldId = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'current_information',
      title: `${PREFIX} Le code d'accès est 4812`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidBase,
    })
    record(oldId, 'cas3-old', cpidBase)

    const extraction = extractKnowledgeCorrection("Ce n'est plus 4812, c'est 5830.")
    verdict(extraction?.mode === 'supersede', 'extraction → mode supersede', JSON.stringify(extraction))

    const cpidSupersede = randomUUID()
    const res = await supersedeKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, oldEntryId: oldId,
      title: `${PREFIX} ${extraction?.mode === 'supersede' ? extraction.newTitle : ''}`,
      confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidSupersede,
    })
    verdict(res.ok, 'confirmation → supersession réussit', res.ok ? undefined : res.error)
    if (res.ok) record(res.newEntryId, 'cas3-new', cpidSupersede)
  }
  console.log()

  // ── Cas 4 — "Cette information n'est plus valable." avec UN SEUL candidat ──
  console.log('── Cas 4 — "Cette information n\'est plus valable." avec un seul candidat → archivage')
  {
    const cpidBase = randomUUID()
    const entryId = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'current_information',
      title: `${PREFIX} Cas 4 — à archiver`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidBase,
    })
    record(entryId, 'cas4-base', cpidBase)

    const extraction = extractKnowledgeCorrection("Cette information n'est plus valable.")
    verdict(extraction?.mode === 'archive', 'extraction → mode archive', JSON.stringify(extraction))

    await archiveKnowledgeEntry(entryId, PETRO_SITE_ID)
    const { data: row } = await supabase.from('site_knowledge_entries').select('status').eq('id', entryId).single()
    verdict(row?.status === 'archived', 'confirmation → status=archived', `status=${row?.status}`)
  }
  console.log()

  // ── Cas 5 — même phrase, PLUSIEURS candidats → liste, jamais de sélection auto ──
  console.log('── Cas 5 — plusieurs candidats actifs → la recherche les liste tous, aucune sélection automatique')
  {
    const cpid1 = randomUUID()
    const e1 = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'current_information',
      title: `${PREFIX} Cas 5 — candidat A`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpid1,
    })
    record(e1, 'cas5-a', cpid1)

    const cpid2 = randomUUID()
    const e2 = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'current_information',
      title: `${PREFIX} Cas 5 — candidat B`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpid2,
    })
    record(e2, 'cas5-b', cpid2)

    const candidates = await listRecentCurrentInformationEntries(PETRO_SITE_ID)
    const bothPresent = candidates.some((c) => c.id === e1) && candidates.some((c) => c.id === e2)
    verdict(bothPresent, 'les deux candidats apparaissent dans la même recherche — aucun filtrage arbitraire à 1')
    // La primitive ne renvoie qu'une LISTE — aucune fonction "choisir le meilleur"
    // n'existe dans lib/db/site-memory-entries.ts (vérifié structurellement par
    // tests/lib/copilot-knowledge-correction.doctrine.test.tsx, invariant 4+5).
  }
  console.log()

  // ── Cas 6 — durable_knowledge présente sur le site → jamais candidate ──
  console.log('── Cas 6 — une durable_knowledge active sur PETRO n\'est jamais candidate à la correction')
  {
    const cpid = randomUUID()
    const durableId = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'durable_knowledge',
      title: `${PREFIX} Cas 6 — connaissance durable, jamais candidate`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpid,
    })
    record(durableId, 'cas6-durable', cpid)

    const candidates = await listRecentCurrentInformationEntries(PETRO_SITE_ID)
    const durablePresent = candidates.some((c) => c.id === durableId)
    verdict(!durablePresent, 'durable_knowledge absente de la recherche de candidats')

    const res = await supersedeKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, oldEntryId: durableId,
      title: 'Tentative sur durable_knowledge — doit échouer', confirmedBy: RECETTE_USER_ID, copilotProposalId: randomUUID(),
    })
    verdict(!res.ok, 'la RPC refuse aussi une tentative directe de supersession sur durable_knowledge', res.ok ? undefined : res.error)
  }
  console.log()

  // ── Cas 7 — idempotence / rejeu ──
  console.log('── Cas 7 — idempotence : rejouer la même proposition ne crée rien de plus')
  {
    const cpidBase = randomUUID()
    const oldId = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'current_information',
      title: `${PREFIX} Cas 7 — base rejeu`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidBase,
    })
    record(oldId, 'cas7-old', cpidBase)

    const cpidSupersede = randomUUID()
    const first = await supersedeKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, oldEntryId: oldId,
      title: `${PREFIX} Cas 7 — nouvelle version`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidSupersede,
    })
    if (first.ok) record(first.newEntryId, 'cas7-new', cpidSupersede)

    const replay = await supersedeKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, oldEntryId: oldId,
      title: 'Titre différent — ne doit avoir aucun effet', confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidSupersede,
    })
    verdict(first.ok && replay.ok && replay.newEntryId === first.newEntryId, 'rejeu supersession — même newEntryId, pas de doublon')

    // Rejeu côté FACT indépendant ("Aucune de celles-ci").
    const cpidFact = randomUUID()
    const factFirst = await confirmSiteFact({
      organizationId, siteId: PETRO_SITE_ID, userId: RECETTE_USER_ID, kind: 'current_information',
      title: `${PREFIX} Cas 7 — FACT indépendant`, body: null, copilotProposalId: cpidFact, interactionId: null,
    })
    if (factFirst.ok) record(factFirst.entryId, 'cas7-fact', cpidFact)
    const factReplay = await confirmSiteFact({
      organizationId, siteId: PETRO_SITE_ID, userId: RECETTE_USER_ID, kind: 'current_information',
      title: 'Titre différent — ne doit avoir aucun effet', body: null, copilotProposalId: cpidFact, interactionId: null,
    })
    verdict(
      factFirst.ok && factReplay.ok && factReplay.entryId === factFirst.entryId,
      'rejeu FACT indépendant — même entryId, pas de doublon',
    )
  }
  console.log()

  console.log(`── Bilan : ${pass} OK / ${fail} ÉCART${fail > 0 ? ' ⚠️' : ''}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run (cas 8 — delta DB = 0) :`)
  console.log(`  npx tsx scripts/rollback-knowledge-correction-test-run.ts ${testRunId}`)

  if (fail > 0) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1) })
