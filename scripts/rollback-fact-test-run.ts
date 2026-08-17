// Rollback du harnais de recette réversible P4-C (site_knowledge_entries).
// (Vincent, 2026-08-17.) Annule UNIQUEMENT les lignes créées par un test_run_id
// donné, identifiées par leur ID exact dans le manifeste — jamais par titre,
// phrase ou date approximative.
//
// Rollback = deleted_at (soft delete), PAS status='archived' : 'archived' porte
// un sens métier existant (information remplacée, plus courante — mig 218) que
// ce harnais ne doit pas détourner pour un usage de nettoyage de test.
// deleted_at est déjà exclu de toutes les lectures (listKnowledgeEntries filtre
// `.is('deleted_at', null)`, index partiel `WHERE deleted_at IS NULL`).
//
// site_knowledge_entries n'a pas de colonne `source` (contrairement à
// actor_alias, mig 327) : la défense en profondeur repose sur les IDs exacts du
// manifeste + organization_id, revérifiés au niveau de la requête elle-même.
//
// Usage : npx tsx scripts/rollback-fact-test-run.ts <testRunId>
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

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

async function main() {
  const testRunId = process.argv[2]
  if (!testRunId) {
    console.error('Usage: npx tsx scripts/rollback-fact-test-run.ts <testRunId>')
    process.exit(1)
  }

  const manifestPath = join(process.cwd(), '.recette-runs', `${testRunId}.json`)
  if (!existsSync(manifestPath)) {
    console.error(`Manifeste introuvable : ${manifestPath}`)
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest

  const supabase = admin()
  const ids = manifest.entries.filter((e) => e.table === 'site_knowledge_entries').map((e) => e.id)

  console.log(`── Rollback recette P4-C — testRunId=${testRunId} ──`)
  console.log(`Manifeste : ${manifestPath}`)
  console.log(`organizationId = ${manifest.organizationId}\n`)

  if (ids.length === 0) {
    console.log('Aucune ligne site_knowledge_entries dans ce manifeste — rien à annuler.')
    process.exit(0)
  }

  // ── Étape 1 : afficher exactement ce qui va être touché ────────────────────
  const { data: current, error: readError } = await supabase
    .from('site_knowledge_entries')
    .select('id, title, kind, status, deleted_at, organization_id, copilot_proposal_id')
    .in('id', ids)
  if (readError) {
    console.error(`Lecture impossible : ${readError.message}`)
    process.exit(1)
  }

  console.log(`Va être supprimé (deleted_at → maintenant), ${current?.length ?? 0} ligne(s) :`)
  for (const row of current ?? []) {
    const entry = manifest.entries.find((e) => e.id === row.id)
    console.log(`  - id=${row.id} titre="${row.title}" kind=${row.kind} statut=${row.status} (phrase: "${entry?.phrase ?? '?'}")`)
    if (row.organization_id !== manifest.organizationId) {
      console.error(`    STOP — organization_id="${row.organization_id}" ≠ "${manifest.organizationId}" attendu. Elle ne sera PAS touchée.`)
    }
    if (row.copilot_proposal_id !== entry?.copilotProposalId) {
      console.error(`    STOP — copilot_proposal_id="${row.copilot_proposal_id}" ≠ "${entry?.copilotProposalId}" attendu. Elle ne sera PAS touchée.`)
    }
  }

  // Défense en profondeur : IDs exacts + organizationId + copilot_proposal_id
  // re-vérifiés au niveau de la requête elle-même, pas seulement à l'affichage.
  const safeIds = (current ?? [])
    .filter((row) => {
      const entry = manifest.entries.find((e) => e.id === row.id)
      return row.organization_id === manifest.organizationId && row.copilot_proposal_id === entry?.copilotProposalId
    })
    .map((row) => row.id)

  if (safeIds.length !== ids.length) {
    console.error(`\nECART — ${ids.length - safeIds.length} ligne(s) du manifeste ne correspondent plus (org/copilot_proposal_id modifiés) : exclues du rollback.`)
  }
  if (safeIds.length === 0) {
    console.log('\nAucune ligne sûre à supprimer. Arrêt.')
    process.exit(1)
  }

  // ── Étape 2 : rollback, IDs exacts uniquement ───────────────────────────────
  const { data: deleted, error: updateError } = await supabase
    .from('site_knowledge_entries')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', safeIds)
    .eq('organization_id', manifest.organizationId)
    .select('id')

  if (updateError) {
    console.error(`\nRollback échoué : ${updateError.message}`)
    process.exit(1)
  }
  console.log(`\n${deleted?.length ?? 0} ligne(s) supprimée(s) (deleted_at).`)

  // ── Étape 3 : vérifier le retour à l'état attendu ───────────────────────────
  const { data: after } = await supabase.from('site_knowledge_entries').select('id, deleted_at').in('id', safeIds)
  const allDeleted = (after ?? []).every((r) => r.deleted_at !== null)
  console.log(`Vérification post-rollback : ${allDeleted ? 'OK — toutes les lignes du run ont deleted_at renseigné' : 'ECART — ' + JSON.stringify(after)}`)

  console.log(`\nÉtat final pour ce testRunId : ${allDeleted ? 'BASE REVENUE À L\'ÉTAT INITIAL (lignes supprimées, aucune ligne préexistante touchée).' : 'INCOMPLET — vérifier manuellement avant de considérer le run comme annulé.'}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
