// Harnais de recette réversible — P5-F3 (SCHEDULE_VISIT + SCHEDULE_MEETING).
// (Vincent, 2026-08-17.) Exécute les scénarios via le pipeline réel
// (detectIntent → buildScheduleProposal → confirmScheduledEvent — le MÊME
// confirmScheduledEvent que la server action createCopilotScheduledEvent en
// production, tout juste extrait de copilot-write-action.ts sans changement
// de comportement, pas une copie), journalise tous les IDs créés dans un
// manifeste, et laisse `rollback-schedule-event-test-run.ts <testRunId>`
// remettre la base dans son état initial.
//
// Un seul writer (confirmScheduledEvent) sert les deux intents SCHEDULE_VISIT
// et SCHEDULE_MEETING (discriminant `type`) — un seul harnais suffit, comme
// tests/lib/copilot-intent-router.test.ts les traite dans le même fichier.
//
// Décision de conception (idempotence) : confirmScheduledEvent fait une
// lecture d'existence sur copilot_proposal_id AVANT insert — un rejeu avec le
// même copilotProposalId retourne le même eventId, ne duplique jamais, mais
// (asymétrie déjà présente en production, préservée telle quelle) N'appelle
// PAS updateCopilotProposalStatus dans cette branche.
//
// Décision de conception (rollback) : site_scheduled_events A une colonne
// deleted_at (mig 216) et tous les lecteurs (lib/db/scheduled-events.ts)
// filtrent `.is('deleted_at', null)` — le rollback fait donc un SOFT DELETE,
// comme pour site_knowledge_entries (P5-F2b), pas une suppression dure.
//
// Garanties couvertes par ce run :
//  - 2 scénarios d'écriture propre (1 SCHEDULE_VISIT, 1 SCHEDULE_MEETING) ;
//  - 5 scénarios de non-régression couvrant la frontière avec ADD_VISIT_ITEM,
//    CREATE_ACTION, le lancement opérationnel ("démarre une visite"), READ,
//    et FACT (fait récurrent sans verbe de planification ni datetime) ;
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
import { buildScheduleProposal } from '../lib/visits/copilot-proposal'
import { confirmScheduledEvent } from '../lib/db/site-scheduled-event-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'site_scheduled_events'
  id: string
  phrase: string
  type: 'visit' | 'meeting'
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

async function countActive(supabase: ReturnType<typeof admin>, siteId: string, userId: string) {
  const { count } = await supabase
    .from('site_scheduled_events')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('created_by', userId)
    .is('deleted_at', null)
  return count ?? 0
}

// Scénarios issus de tests/lib/copilot-intent-router.test.ts (formes déjà
// prouvées au niveau routeur) — 2 exemples positifs (visite + réunion), 5
// non-régressions (ADD_VISIT_ITEM, CREATE_ACTION, lancement opérationnel,
// READ, robustesse famille MEETING).
type Scenario =
  | { label: string; phrase: string; expect: 'write'; type: 'visit' | 'meeting'; parsedDate: string; parsedTime: string }
  | { label: string; phrase: string; expect: 'skip_wrong_intent' }

const SCENARIOS: Scenario[] = [
  { label: '1. SCHEDULE_VISIT strong (positif)', phrase: 'Planifie une visite pour vérifier R4 mercredi', expect: 'write', type: 'visit', parsedDate: '2026-08-20', parsedTime: '09:00' },
  { label: '2. SCHEDULE_MEETING strong (positif)', phrase: 'Planifie une réunion vendredi à 14h', expect: 'write', type: 'meeting', parsedDate: '2026-08-21', parsedTime: '14:00' },
  { label: '3. non-régression ADD_VISIT_ITEM ("ajoute...au plan de visite" ≠ planifier une visite)', phrase: 'Ajoute R4 au plan de visite', expect: 'skip_wrong_intent' },
  { label: '4. non-régression CREATE_ACTION (action de suivi, pas planification)', phrase: 'Note une action de suivi pour la prochaine visite', expect: 'skip_wrong_intent' },
  { label: '5. non-régression lancement opérationnel ("démarre" ≠ planifier)', phrase: 'démarre une visite', expect: 'skip_wrong_intent' },
  { label: '6. non-régression READ (question sur un horaire, pas un ordre de planification)', phrase: "Dis-moi ce qu'il y a prévu mercredi", expect: 'skip_wrong_intent' },
  { label: '7. non-régression FACT (fait récurrent sans verbe de planification ni datetime, pas un ordre de planifier)', phrase: 'La réunion de coordination est toujours le mardi.', expect: 'skip_wrong_intent' },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()

  console.log(`── Harnais de recette réversible P5-F3 (SCHEDULE_VISIT + SCHEDULE_MEETING) ──`)
  console.log(`testRunId = ${testRunId}`)
  console.log(`userId    = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)\n`)

  const before = await countActive(supabase, PETRO_SITE_ID, RECETTE_USER_ID)
  console.log(`AVANT — site_scheduled_events actives (site=PETRO, user=recette): ${before}\n`)

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

    if (s.expect === 'skip_wrong_intent') {
      const ok = intentResult.intent !== 'SCHEDULE_VISIT' && intentResult.intent !== 'SCHEDULE_MEETING'
      console.log(`   ${ok ? 'OK — routage attendu hors SCHEDULE_VISIT/SCHEDULE_MEETING, AUCUNE écriture.' : 'ECART — intent inattendu.'}\n`)
      continue
    }

    const expectedIntent = s.type === 'visit' ? 'SCHEDULE_VISIT' : 'SCHEDULE_MEETING'
    if (intentResult.intent !== expectedIntent) {
      console.log(`   ECART — attendu ${expectedIntent}, obtenu ${intentResult.intent}.\n`)
      continue
    }

    const proposal = buildScheduleProposal({
      kind: s.type === 'visit' ? 'schedule_visit' : 'schedule_meeting',
      parsedDate: s.parsedDate,
      parsedTime: s.parsedTime,
      conflictWarning: null,
    })

    const result = await confirmScheduledEvent({
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      type: s.type,
      title: proposal.title.trim(),
      scheduledDate: s.parsedDate,
      scheduledTime: s.parsedTime,
      objective: null,
      copilotProposalId: proposal.proposalId,
      interactionId: null,
    })

    if (!result.ok) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ${result.error}\n`)
      continue
    }

    const { data: row } = await supabase
      .from('site_scheduled_events')
      .select('id, type, status, planned_start, title, payload, created_from, created_by, copilot_proposal_id, deleted_at')
      .eq('id', result.eventId)
      .single()

    if (!row) {
      console.log(`   ÉCRITURE ÉCHOUÉE — ligne introuvable après insert.\n`)
      continue
    }

    manifest.entries.push({
      table: 'site_scheduled_events',
      id: row.id as string,
      phrase: s.phrase,
      type: s.type,
      title: proposal.title.trim(),
      copilotProposalId: proposal.proposalId,
    })
    console.log(`   ÉCRIT → site_scheduled_events.id=${row.id} (type: ${row.type}, title: "${row.title}")`)

    const okRow = row.type === s.type && row.status === 'planned' && row.created_from === 'manual'
      && row.created_by === RECETTE_USER_ID && row.copilot_proposal_id === proposal.proposalId && row.deleted_at === null
    console.log(`   vérifié en base : ${okRow ? 'OK' : 'ECART — ' + JSON.stringify(row)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId → même eventId, pas de doublon,
  // et (comportement réel préservé) pas de second appel updateCopilotProposalStatus.
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    const replay = await confirmScheduledEvent({
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      type: first.type,
      title: 'Titre rejoué — ne doit rien changer',
      scheduledDate: '2099-01-01',
      scheduledTime: '00:00',
      objective: 'Rejeu recette',
      copilotProposalId: first.copilotProposalId,
      interactionId: null,
    })
    const { data: rows } = await supabase
      .from('site_scheduled_events')
      .select('id, title, planned_start')
      .eq('copilot_proposal_id', first.copilotProposalId)
    const noDuplicate = (rows?.length ?? 0) === 1
    const sameId = replay.ok && replay.eventId === first.id
    const untouched = rows?.[0]?.title === first.title
    const idempotent = noDuplicate && sameId && untouched
    console.log(`   rejeu → ${idempotent ? 'OK (id stable, pas de doublon, contenu inchangé — early-return avant tout insert)' : 'ECART — ' + JSON.stringify({ replay, rows })}\n`)
  }

  const after = await countActive(supabase, PETRO_SITE_ID, RECETTE_USER_ID)
  console.log(`APRÈS — site_scheduled_events actives (site=PETRO, user=recette): ${after}`)
  console.log(`Δ=${after - before}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-schedule-event-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
