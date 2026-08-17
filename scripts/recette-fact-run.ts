// Harnais de recette réversible — P4-C (FACT / site_knowledge_entries).
// (Vincent, 2026-08-17.) Exécute les 8 phrases de l'audit via le pipeline réel
// (detectIntent → buildFactProposal → confirmSiteFact — le MÊME confirmSiteFact
// que la server action createCopilotFact, pas une copie), journalise tous les
// IDs créés dans un manifeste, et laisse `rollback-fact-test-run.ts <testRunId>`
// remettre la base dans son état initial.
//
// Décision de conception (rollback) : site_knowledge_entries n'a PAS de colonne
// `source` comme actor_alias (mig 327) — le rollback ne peut donc pas filtrer
// par source='copilot_test'. Il s'appuie sur les IDs exacts du manifeste +
// organization_id, comme défense en profondeur.
//
// status='archived' N'EST PAS le mécanisme de rollback : ce statut porte un sens
// métier (« information remplacée, plus courante ») déjà utilisé par la
// promotion normale (cf. commentaire mig 218, supersedes_id). L'annuler avec ce
// statut polluerait la sémantique du champ pour un usage qui n'est pas le sien.
// `deleted_at` est la colonne conçue pour ça : déjà exclue de TOUTES les lectures
// (listKnowledgeEntries filtre `.is('deleted_at', null)`, mig 218 index partiel
// `WHERE deleted_at IS NULL`), sans ambiguïté avec le cycle de vie métier.
//
// Garanties :
//  - la nature (current_information/durable_knowledge) est choisie ICI par le
//    script, jamais déduite par le LLM — même doctrine que la production
//    (nature never defaulted), simplement simulée côté recette ;
//  - un vrai utilisateur PETRO existant est utilisé comme confirmedBy ;
//  - aucune ligne préexistante n'est lue en écriture ni modifiée ;
//  - le manifeste est la SEULE source de vérité pour le rollback (IDs exacts).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { buildFactProposal } from '../lib/visits/copilot-proposal'
import { confirmSiteFact } from '../lib/db/site-fact-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'site_knowledge_entries'
  id: string
  phrase: string
  kind: 'current_information' | 'durable_knowledge'
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

async function countKnowledgeEntries(supabase: ReturnType<typeof admin>, siteId: string) {
  const { count: total } = await supabase.from('site_knowledge_entries').select('id', { count: 'exact', head: true }).eq('site_id', siteId)
  const { count: active } = await supabase.from('site_knowledge_entries').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'active').is('deleted_at', null)
  return { total: total ?? 0, active: active ?? 0 }
}

// Les 8 phrases obligatoires de l'audit (cadrage Vincent, P4-C). La nature est
// choisie ICI, par le script — jamais déduite du texte par un LLM.
const SCENARIOS: { label: string; phrase: string; kind: 'current_information' | 'durable_knowledge' }[] = [
  { label: '1. passage ponctuel', phrase: 'Jérôme passe demain matin.', kind: 'current_information' },
  { label: '2. souhait rapporté', phrase: 'Le client veut conserver cette porte.', kind: 'durable_knowledge' },
  { label: '3. interlocuteur durable', phrase: "Vincent Milon est l'interlocuteur principal sur ce dossier.", kind: 'durable_knowledge' },
  { label: '4. récurrence durable', phrase: 'La réunion de coordination est toujours le mardi.', kind: 'durable_knowledge' },
  { label: '5. accès durable', phrase: "L'accès livraison se fait par l'arrière du bâtiment.", kind: 'durable_knowledge' },
  { label: '6. code durable', phrase: 'Le code du portail est 4812.', kind: 'durable_knowledge' },
  { label: '7. effectif prévu ponctuel', phrase: "L'entreprise a prévu deux personnes pour la mise en service.", kind: 'current_information' },
  { label: '8. fermeture ponctuelle', phrase: 'Le chantier sera fermé vendredi après-midi.', kind: 'current_information' },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()
  const organizationId = await getPetroOrgId(supabase)

  console.log(`── Harnais de recette réversible P4-C (FACT) ──`)
  console.log(`testRunId       = ${testRunId}`)
  console.log(`organizationId  = ${organizationId} (PETRO)`)
  console.log(`userId          = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)\n`)

  const before = await countKnowledgeEntries(supabase, PETRO_SITE_ID)
  console.log(`AVANT — site_knowledge_entries(site=PETRO): total=${before.total} active=${before.active}\n`)

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
    if (intentResult.intent !== 'FACT') {
      console.log(`   ECART — intent=${intentResult.intent}, attendu FACT. Scénario ignoré (aucune écriture).\n`)
      continue
    }

    const proposal = buildFactProposal({
      question: s.phrase,
      canonicalSubjectId: null,
      canonicalSubjectLabel: null,
    })

    const result = await confirmSiteFact({
      organizationId,
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      kind: s.kind,
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
      table: 'site_knowledge_entries',
      id: result.entryId,
      phrase: s.phrase,
      kind: s.kind,
      copilotProposalId: proposal.proposalId,
    })
    console.log(`   ÉCRIT → site_knowledge_entries.id=${result.entryId} (kind=${s.kind}, titre="${proposal.title}")`)

    // Vérification directe de l'effet (pas de confiance dans la valeur de retour seule).
    const { data: row } = await supabase
      .from('site_knowledge_entries')
      .select('id, kind, status, copilot_proposal_id, deleted_at')
      .eq('id', result.entryId)
      .single()
    const okRow = row && row.kind === s.kind && row.status === 'active' && row.copilot_proposal_id === proposal.proposalId && row.deleted_at === null
    console.log(`   vérifié en base : ${okRow ? 'OK' : 'ECART — ' + JSON.stringify(row)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId → même entryId, pas de doublon.
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    const replay = await confirmSiteFact({
      organizationId,
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      kind: first.kind,
      title: 'Titre différent — ne doit avoir aucun effet (idempotence par ID)',
      body: null,
      copilotProposalId: first.copilotProposalId,
      interactionId: null,
    })
    const idempotent = replay.ok && replay.entryId === first.id
    console.log(`   rejeu → ${idempotent ? 'OK (même entryId, pas de doublon)' : 'ECART — ' + JSON.stringify(replay)}\n`)
  }

  const after = await countKnowledgeEntries(supabase, PETRO_SITE_ID)
  console.log(`APRÈS — site_knowledge_entries(site=PETRO): total=${after.total} active=${after.active}`)
  console.log(`Δ total=${after.total - before.total} Δactive=${after.active - before.active}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-fact-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
