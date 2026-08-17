// Harnais de recette réversible — P4-D1 (RELATION_CLAIM / canonical_subject_links).
// (Vincent, 2026-08-17.) Exécute 7 scénarios via le pipeline réel (detectIntent
// → extractRelationClaim → resolveCanonicalSubjectReference [source PUIS cible]
// → buildRelationClaimProposal → confirmSiteRelation — le MÊME confirmSiteRelation
// que la server action de production, pas une copie), journalise tous les IDs
// créés dans un manifeste, et laisse `rollback-relation-claim-test-run.ts
// <testRunId>` remettre la base dans son état initial.
//
// Décision de conception (rollback) : canonical_subject_links n'a PAS de colonne
// deleted_at (mig 316, contrairement à site_knowledge_entries) — le rollback ne
// peut donc être qu'une suppression DURE, par ID exact + organization_id (via
// site_id), comme défense en profondeur. canonical_subject_link_evidence a
// link_id ON DELETE CASCADE : supprimer le lien supprime sa preuve, pas de
// nettoyage séparé nécessaire.
//
// Garanties couvertes par ce run :
//  - 5 scénarios d'écriture propre, un par relation_type (requires/enables/
//    validates/causes/replaces) sur des paires de sujets réels PETRO, résolues
//    sans ambiguïté ;
//  - 1 scénario d'ambiguïté réelle (label dupliqué actif/auto_archived en base)
//    → clarification, AUCUNE écriture (garantie centrale du mandat) ;
//  - 1 scénario de paire déjà existante en base (lien causes/confirmed
//    préexistant, non créé par ce run) → rejet par la contrainte
//    UNIQUE(site_id, pair_low_id, pair_high_id), AUCUNE écriture, aucune
//    altération du lien préexistant ;
//  - un rejeu d'idempotence sur le 1er scénario écrit (même copilotProposalId
//    → même linkId, pas de doublon) ;
//  - aucune ligne préexistante n'est lue en écriture ni modifiée ;
//  - le manifeste est la SEULE source de vérité pour le rollback (IDs exacts).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { extractRelationClaim } from '../lib/visits/copilot-relation-claim'
import { resolveCanonicalSubjectReference } from '../lib/db/canonical-subject-resolve'
import { buildRelationClaimProposal } from '../lib/visits/copilot-proposal'
import { confirmSiteRelation } from '../lib/db/canonical-subject-link-write'

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const RECETTE_USER_ID = '4442bf88-c411-4965-b30b-33d76af018e1' // vincent.trouillat@memoria.nc, org PETRO

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'canonical_subject_links'
  id: string
  phrase: string
  relationType: string
  sourceSubjectId: string
  targetSubjectId: string
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

async function countLinks(supabase: ReturnType<typeof admin>, siteId: string) {
  const { count: total } = await supabase.from('canonical_subject_links').select('id', { count: 'exact', head: true }).eq('site_id', siteId)
  const { count: confirmed } = await supabase.from('canonical_subject_links').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'confirmed')
  return { total: total ?? 0, confirmed: confirmed ?? 0 }
}

// Scénarios choisis contre les données réelles PETRO (cf. scripts/_probe-petro-canonical-subjects-p4d1.ts
// et scripts/_dryrun-relation-claim-p4d1.ts, exécutés au préalable en lecture seule).
type Scenario = { label: string; phrase: string; expect: 'write' | 'ambiguous' | 'duplicate_pair' }
const SCENARIOS: Scenario[] = [
  { label: '1. requires (dépend de)', phrase: 'Vérification des lignes électriques et consignations dépend de Absence de courant au tableau de distribution (TD).', expect: 'write' },
  { label: '2. causes', phrase: 'Installation et gestion du nouveau toilette pour équipes cuisines cause Accès difficile toilettes/salle de réunion existantes (cuisines).', expect: 'write' },
  { label: '3. replaces', phrase: 'Clim Expair remplace Risque de retard Clim Expert.', expect: 'write' },
  { label: '4. enables (permet)', phrase: 'Diffusion et mise à jour du planning général permet Lancement et avancement de la dépose du matériel de cuisine.', expect: 'write' },
  { label: '5. validates (valide)', phrase: 'Nettoyage panneaux isothermes (chambres froides) valide Dépôt de suie sur les panneaux électriques.', expect: 'write' },
  { label: '6. ambiguïté réelle (label dupliqué actif/auto_archived) → clarification, jamais d\'écriture', phrase: 'Absence de courant au tableau de distribution (TD) permet Réseau électrique inexploitable et à retirer.', expect: 'ambiguous' },
  { label: '7. paire déjà existante en base (causes/confirmed préexistant) → rejet UNIQUE(pair)', phrase: 'Accès sécurisé au chantier (portail et cadenas à code) dépend de Gestion du matériel sur site non sécurisé.', expect: 'duplicate_pair' },
]

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()
  const organizationId = await getPetroOrgId(supabase)

  console.log(`── Harnais de recette réversible P4-D1 (RELATION_CLAIM) ──`)
  console.log(`testRunId       = ${testRunId}`)
  console.log(`organizationId  = ${organizationId} (PETRO)`)
  console.log(`userId          = ${RECETTE_USER_ID} (vincent.trouillat@memoria.nc)\n`)

  const before = await countLinks(supabase, PETRO_SITE_ID)
  console.log(`AVANT — canonical_subject_links(site=PETRO): total=${before.total} confirmed=${before.confirmed}\n`)

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
    if (intentResult.intent !== 'RELATION_CLAIM') {
      console.log(`   ECART — intent=${intentResult.intent}, attendu RELATION_CLAIM. Scénario ignoré (aucune écriture).\n`)
      continue
    }

    const extraction = extractRelationClaim(s.phrase)
    if (!extraction) {
      console.log(`   ECART — extraction null. Scénario ignoré (aucune écriture).\n`)
      continue
    }

    // Source résolue AVANT la cible — même ordre que copilot-free-prepare.ts.
    const src = await resolveCanonicalSubjectReference(PETRO_SITE_ID, extraction.sourceText)
    if (src.kind !== 'resolved') {
      console.log(`   source = ${JSON.stringify(src)}`)
      const ok = s.expect === 'ambiguous' && src.kind === 'ambiguous'
      console.log(`   ${ok ? 'OK — arrêt attendu sur la source, AUCUNE écriture, cible jamais résolue.' : 'ECART — arrêt inattendu sur la source.'}\n`)
      continue
    }

    const tgt = await resolveCanonicalSubjectReference(PETRO_SITE_ID, extraction.targetText)
    if (tgt.kind !== 'resolved') {
      console.log(`   source = resolved (${src.candidate.label})`)
      console.log(`   cible  = ${JSON.stringify(tgt)}`)
      const ok = s.expect === 'ambiguous' && tgt.kind === 'ambiguous'
      console.log(`   ${ok ? 'OK — arrêt attendu sur la cible, AUCUNE écriture.' : 'ECART — arrêt inattendu sur la cible.'}\n`)
      continue
    }

    if (src.candidate.id === tgt.candidate.id) {
      console.log(`   ECART — source et cible identiques, AUCUNE écriture. Scénario ignoré.\n`)
      continue
    }

    const proposal = buildRelationClaimProposal({
      question: s.phrase,
      relationType: extraction.relationType,
      sourceSubjectId: src.candidate.id,
      sourceSubjectLabel: src.candidate.label,
      targetSubjectId: tgt.candidate.id,
      targetSubjectLabel: tgt.candidate.label,
    })

    const result = await confirmSiteRelation({
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      relationType: extraction.relationType,
      sourceSubjectId: src.candidate.id,
      targetSubjectId: tgt.candidate.id,
      evidenceText: proposal.body,
      copilotProposalId: proposal.proposalId,
      interactionId: null,
    })

    if (!result.ok) {
      const ok = s.expect === 'duplicate_pair'
      console.log(`   ÉCRITURE ÉCHOUÉE — ${result.error}`)
      console.log(`   ${ok ? 'OK — rejet attendu (paire déjà existante en base), AUCUNE écriture.' : 'ECART — échec inattendu.'}\n`)
      continue
    }

    if (s.expect !== 'write') {
      console.log(`   ECART — écriture réussie alors qu'un arrêt était attendu (${s.expect}). linkId=${result.linkId}\n`)
    }

    manifest.entries.push({
      table: 'canonical_subject_links',
      id: result.linkId,
      phrase: s.phrase,
      relationType: extraction.relationType,
      sourceSubjectId: src.candidate.id,
      targetSubjectId: tgt.candidate.id,
      copilotProposalId: proposal.proposalId,
    })
    console.log(`   ÉCRIT → canonical_subject_links.id=${result.linkId} (${src.candidate.label} -[${extraction.relationType}]-> ${tgt.candidate.label})`)

    // Vérification directe de l'effet (pas de confiance dans la valeur de retour seule).
    const { data: row } = await supabase
      .from('canonical_subject_links')
      .select('id, relation_type, status, copilot_proposal_id, source_subject_id, target_subject_id')
      .eq('id', result.linkId)
      .single()
    const okRow = row && row.relation_type === extraction.relationType && row.status === 'confirmed'
      && row.copilot_proposal_id === proposal.proposalId
      && row.source_subject_id === src.candidate.id && row.target_subject_id === tgt.candidate.id
    console.log(`   vérifié en base (lien) : ${okRow ? 'OK' : 'ECART — ' + JSON.stringify(row)}`)

    const { data: evidence } = await supabase
      .from('canonical_subject_link_evidence')
      .select('id, evidence_text')
      .eq('link_id', result.linkId)
    const okEvidence = evidence && evidence.length === 1 && evidence[0].evidence_text === s.phrase
    console.log(`   vérifié en base (preuve verbatim) : ${okEvidence ? 'OK' : 'ECART — ' + JSON.stringify(evidence)}\n`)
  }

  // Rejeu idempotence : même copilotProposalId → même linkId, pas de doublon.
  if (manifest.entries.length > 0) {
    const first = manifest.entries[0]
    console.log(`── Rejeu idempotence sur le 1er scénario écrit (id=${first.id})`)
    const replay = await confirmSiteRelation({
      siteId: PETRO_SITE_ID,
      userId: RECETTE_USER_ID,
      relationType: first.relationType as import('../lib/visits/copilot-relation-claim').RelationClaimType,
      sourceSubjectId: first.sourceSubjectId,
      targetSubjectId: first.targetSubjectId,
      evidenceText: 'Preuve différente — ne doit avoir aucun effet (idempotence par copilot_proposal_id).',
      copilotProposalId: first.copilotProposalId,
      interactionId: null,
    })
    const idempotent = replay.ok && replay.linkId === first.id
    console.log(`   rejeu → ${idempotent ? 'OK (même linkId, pas de doublon)' : 'ECART — ' + JSON.stringify(replay)}\n`)
  }

  const after = await countLinks(supabase, PETRO_SITE_ID)
  console.log(`APRÈS — canonical_subject_links(site=PETRO): total=${after.total} confirmed=${after.confirmed}`)
  console.log(`Δ total=${after.total - before.total} Δconfirmed=${after.confirmed - before.confirmed}\n`)

  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Manifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run :`)
  console.log(`  npx tsx scripts/rollback-relation-claim-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
