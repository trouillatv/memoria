// Harnais de recette réversible — P5-F2a (cycle de vie site_knowledge_entries :
// archivage + supersession). (Vincent, 2026-08-17.) Appelle les primitives
// réelles (archiveKnowledgeEntry, supersedeKnowledgeEntry, createKnowledgeEntry,
// listKnowledgeEntries — les MÊMES que memoire-actions.ts en production, pas des
// copies), journalise tous les IDs créés dans un manifeste, et laisse
// `rollback-knowledge-lifecycle-test-run.ts <testRunId>` remettre la base dans
// son état initial.
//
// Rollback = deleted_at (soft delete), même discipline que rollback-fact-test-run.ts
// (P4-C) : status='archived'/'superseded' porte un sens métier réel qu'un
// nettoyage de test ne doit pas détourner.
//
// Couvre 6 des 8 invariants de clôture P5-F2a (les 2 restants ne se prouvent pas
// par une écriture live) :
//  1. une entrée active peut être archivée explicitement et disparaît de la
//     mémoire courante (listKnowledgeEntries) ;
//  2. le CR et ses compteurs (readMaterializedCountsByReport) restent inchangés
//     après un archivage — la lecture historique ne filtre jamais par status ;
//  3+4. la supersession est atomique : nouvelle entrée active avec le bon
//     supersedes_id, ancienne entrée → superseded avec valid_until posé ;
//  5. impossible de superseder silencieusement une entrée déjà inactive
//     (déjà supersédée) — la RPC doit rejeter ;
//  6. durable_knowledge n'entre pas dans ce mécanisme en V1 — la RPC doit
//     rejeter.
// (7) aucun TTL/cron/âge ne modifie jamais une entrée : prouvé statiquement par
//     tests/lib/knowledge-lifecycle-cr-figé.doctrine.test.ts, pas ici.
// (8) c'est la propriété de ce harnais dans son ensemble (manifeste + rollback).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { createKnowledgeEntry, archiveKnowledgeEntry, supersedeKnowledgeEntry, listKnowledgeEntries } from '../lib/db/site-memory-entries'
import { readMaterializedCountsByReport } from '../lib/knowledge/repository'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO
const PREFIX = '[TEST-RECETTE-P5F2A]'

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

async function getPetroReportId(supabase: ReturnType<typeof admin>): Promise<string> {
  const { data, error } = await supabase
    .from('site_reports').select('id').eq('site_id', PETRO_SITE_ID)
    .order('started_at', { ascending: false }).limit(1).single()
  if (error || !data) throw new Error(`aucun site_reports pour PETRO: ${error?.message}`)
  return data.id as string
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
  const reportId = await getPetroReportId(supabase)

  console.log(`── Harnais de recette réversible P5-F2a (archivage + supersession) ──`)
  console.log(`testRunId       = ${testRunId}`)
  console.log(`organizationId  = ${organizationId} (PETRO)`)
  console.log(`reportId        = ${reportId} (le plus récent, lecture seule)`)
  console.log(`userId          = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)\n`)

  const manifest: Manifest = { testRunId, createdAt: new Date().toISOString(), siteId: PETRO_SITE_ID, organizationId, userId: RECETTE_USER_ID, entries: [] }

  function record(id: string, note: string, copilotProposalId: string) {
    manifest.entries.push({ table: 'site_knowledge_entries', id, note, copilotProposalId })
  }

  // ── Invariant 1 — archiver une entrée active la fait disparaître de la mémoire courante ──
  console.log('── Invariant 1 — archiver une entrée active')
  {
    const cpid = randomUUID()
    const e1 = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'current_information',
      title: `${PREFIX} Invariant 1 — à archiver`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpid,
    })
    record(e1, 'invariant1-base', cpid)

    const beforeList = await listKnowledgeEntries(PETRO_SITE_ID)
    const presentBefore = beforeList.some((e) => e.id === e1)

    await archiveKnowledgeEntry(e1, PETRO_SITE_ID)

    const afterList = await listKnowledgeEntries(PETRO_SITE_ID)
    const absentAfter = !afterList.some((e) => e.id === e1)
    const { data: row } = await supabase.from('site_knowledge_entries').select('status').eq('id', e1).single()
    verdict(presentBefore && absentAfter && row?.status === 'archived', 'active avant, absente après, status=archived', `status=${row?.status}`)

    // Idempotence : un second archivage ne doit ni lever, ni changer l'état.
    await archiveKnowledgeEntry(e1, PETRO_SITE_ID)
    const { data: row2 } = await supabase.from('site_knowledge_entries').select('status').eq('id', e1).single()
    verdict(row2?.status === 'archived', 'second archivage idempotent (pas d\'erreur, statut inchangé)')
  }
  console.log()

  // ── Invariant 2 — le CR figé : les compteurs par report ne changent pas avec l'archivage ──
  console.log('── Invariant 2 — le CR ne change jamais après un archivage')
  {
    const cpid = randomUUID()
    const countsBefore = await readMaterializedCountsByReport([reportId])
    const knowledgeBefore = countsBefore.get(reportId)?.knowledge ?? 0

    const e2 = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'current_information',
      title: `${PREFIX} Invariant 2 — CR figé`, sourceReportId: reportId,
      confirmedBy: RECETTE_USER_ID, copilotProposalId: cpid,
    })
    record(e2, 'invariant2-base', cpid)

    const countsAfterCreate = await readMaterializedCountsByReport([reportId])
    const knowledgeAfterCreate = countsAfterCreate.get(reportId)?.knowledge ?? 0
    verdict(knowledgeAfterCreate === knowledgeBefore + 1, 'la création du CR incrémente le compteur', `${knowledgeBefore} → ${knowledgeAfterCreate}`)

    await archiveKnowledgeEntry(e2, PETRO_SITE_ID)

    const countsAfterArchive = await readMaterializedCountsByReport([reportId])
    const knowledgeAfterArchive = countsAfterArchive.get(reportId)?.knowledge ?? 0
    verdict(knowledgeAfterArchive === knowledgeAfterCreate, 'le compteur du CR ne bouge PAS après archivage — le CR est figé', `${knowledgeAfterCreate} → ${knowledgeAfterArchive}`)
  }
  console.log()

  // ── Invariant 3+4 — supersession atomique ──
  console.log('── Invariant 3+4 — supersession atomique')
  let oldId3 = ''
  {
    const cpidBase = randomUUID()
    oldId3 = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'current_information',
      title: `${PREFIX} Invariant 3 — ancienne version`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidBase,
    })
    record(oldId3, 'invariant3-old', cpidBase)

    const cpidSupersede = randomUUID()
    const res = await supersedeKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, oldEntryId: oldId3,
      title: `${PREFIX} Invariant 3 — nouvelle version`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidSupersede,
    })
    verdict(res.ok, 'la supersession réussit', res.ok ? undefined : res.error)

    if (res.ok) {
      record(res.newEntryId, 'invariant3-new', cpidSupersede)
      const { data: oldRow } = await supabase.from('site_knowledge_entries').select('status, valid_until').eq('id', oldId3).single()
      const { data: newRow } = await supabase.from('site_knowledge_entries').select('status, supersedes_id').eq('id', res.newEntryId).single()
      verdict(
        oldRow?.status === 'superseded' && !!oldRow?.valid_until && newRow?.status === 'active' && newRow?.supersedes_id === oldId3,
        'ancienne → superseded (valid_until posé), nouvelle → active, supersedes_id correct',
        `old.status=${oldRow?.status} old.valid_until=${oldRow?.valid_until} new.status=${newRow?.status} new.supersedes_id=${newRow?.supersedes_id}`,
      )

      // Rejeu idempotence : le même copilot_proposal_id ne doit créer qu'une seule supersession.
      const replay = await supersedeKnowledgeEntry({
        organizationId, siteId: PETRO_SITE_ID, oldEntryId: oldId3,
        title: 'Titre différent — ne doit avoir aucun effet', confirmedBy: RECETTE_USER_ID, copilotProposalId: cpidSupersede,
      })
      verdict(replay.ok && replay.newEntryId === res.newEntryId, 'rejeu idempotent — même newEntryId, pas de doublon')
    }
  }
  console.log()

  // ── Invariant 5 — impossible de superseder silencieusement une entrée déjà inactive ──
  console.log('── Invariant 5 — superseder une entrée déjà supersédée doit être rejeté')
  if (oldId3) {
    const res = await supersedeKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, oldEntryId: oldId3,
      title: 'Tentative de double supersession — doit échouer', confirmedBy: RECETTE_USER_ID, copilotProposalId: randomUUID(),
    })
    verdict(!res.ok, 'la RPC rejette une entrée non active', res.ok ? undefined : res.error)
  }
  console.log()

  // ── Invariant 6 — durable_knowledge exclue du mécanisme en V1 ──
  console.log('── Invariant 6 — durable_knowledge ne peut pas être supersédée')
  {
    const cpid = randomUUID()
    const e6 = await createKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, kind: 'durable_knowledge',
      title: `${PREFIX} Invariant 6 — durable, non supersedable`, confirmedBy: RECETTE_USER_ID, copilotProposalId: cpid,
    })
    record(e6, 'invariant6-base', cpid)

    const res = await supersedeKnowledgeEntry({
      organizationId, siteId: PETRO_SITE_ID, oldEntryId: e6,
      title: 'Tentative sur durable_knowledge — doit échouer', confirmedBy: RECETTE_USER_ID, copilotProposalId: randomUUID(),
    })
    verdict(!res.ok, 'la RPC rejette une entrée durable_knowledge', res.ok ? undefined : res.error)
  }
  console.log()

  console.log(`── Bilan : ${pass} OK / ${fail} ÉCART${fail > 0 ? ' ⚠️' : ''}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-knowledge-lifecycle-test-run.ts ${testRunId}`)

  if (fail > 0) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1) })
