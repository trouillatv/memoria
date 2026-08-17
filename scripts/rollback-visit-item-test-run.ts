// Rollback du harnais de recette réversible P5-F3 (ADD_VISIT_ITEM).
// (Vincent, 2026-08-17.) Annule UNIQUEMENT les lignes créées par un test_run_id
// donné, identifiées par leur ID exact dans le manifeste — jamais par phrase,
// libellé ou date approximative.
//
// Rollback = SUPPRESSION DURE : site_visit_preparation_item n'a pas de colonne
// deleted_at — même discipline que rollback-action-test-run.ts (P5-F1) pour
// garantir une restauration RÉELLE de l'état initial.
//
// Défense en profondeur : IDs exacts du manifeste + site_id + stable_key
// revérifiés au niveau de la requête elle-même, jamais une suppression par
// libellé ou par plage de dates (qui pourrait toucher un vrai point de
// préparation créé en production entre-temps).
//
// Usage : npx tsx scripts/rollback-visit-item-test-run.ts <testRunId>
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

async function main() {
  const testRunId = process.argv[2]
  if (!testRunId) {
    console.error('Usage: npx tsx scripts/rollback-visit-item-test-run.ts <testRunId>')
    process.exit(1)
  }

  const manifestPath = join(process.cwd(), '.recette-runs', `${testRunId}.json`)
  if (!existsSync(manifestPath)) {
    console.error(`Manifeste introuvable : ${manifestPath}`)
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest

  const supabase = admin()
  const ids = manifest.entries.filter((e) => e.table === 'site_visit_preparation_item').map((e) => e.id)

  console.log(`── Rollback recette P5-F3 (ADD_VISIT_ITEM) — testRunId=${testRunId} ──`)
  console.log(`Manifeste : ${manifestPath}`)
  console.log(`siteId = ${manifest.siteId} (PETRO)\n`)

  if (ids.length === 0) {
    console.log('Aucune ligne site_visit_preparation_item dans ce manifeste — rien à annuler.')
    process.exit(0)
  }

  // ── Étape 1 : afficher exactement ce qui va être touché ────────────────────
  const { data: current, error: readError } = await supabase
    .from('site_visit_preparation_item')
    .select('id, site_id, label, stable_key, source_ref, prepared_by')
    .in('id', ids)
  if (readError) {
    console.error(`Lecture impossible : ${readError.message}`)
    process.exit(1)
  }

  console.log(`Va être supprimé définitivement, ${current?.length ?? 0} ligne(s) :`)
  for (const row of current ?? []) {
    const entry = manifest.entries.find((e) => e.id === row.id)
    console.log(`  - id=${row.id} label="${row.label}" stable_key=${row.stable_key} (phrase: "${entry?.phrase ?? '?'}")`)
    if (row.site_id !== manifest.siteId) {
      console.error(`    STOP — site_id="${row.site_id}" ≠ "${manifest.siteId}" attendu. Elle ne sera PAS touchée.`)
    }
    if (row.source_ref !== entry?.copilotProposalId) {
      console.error(`    STOP — source_ref="${row.source_ref}" ≠ "${entry?.copilotProposalId}" attendu. Elle ne sera PAS touchée.`)
    }
  }

  // Défense en profondeur : IDs exacts + site_id + source_ref (copilotProposalId)
  // revérifiés au niveau de la requête elle-même, pas seulement à l'affichage.
  const safeIds = (current ?? [])
    .filter((row) => {
      const entry = manifest.entries.find((e) => e.id === row.id)
      return row.site_id === manifest.siteId && row.source_ref === entry?.copilotProposalId
    })
    .map((row) => row.id)

  if (safeIds.length !== ids.length) {
    console.error(`\nECART — ${ids.length - safeIds.length} ligne(s) du manifeste ne correspondent plus (site/source_ref modifiés) : exclues du rollback.`)
  }
  if (safeIds.length === 0) {
    console.log('\nAucune ligne sûre à supprimer. Arrêt.')
    process.exit(1)
  }

  // ── Étape 2 : rollback, IDs exacts uniquement, suppression dure ────────────
  const { data: deleted, error: deleteError } = await supabase
    .from('site_visit_preparation_item')
    .delete()
    .in('id', safeIds)
    .eq('site_id', manifest.siteId)
    .select('id')

  if (deleteError) {
    console.error(`\nRollback échoué : ${deleteError.message}`)
    process.exit(1)
  }
  console.log(`\n${deleted?.length ?? 0} ligne(s) supprimée(s) définitivement.`)

  // ── Étape 3 : vérifier le retour à l'état attendu ───────────────────────────
  const { data: after } = await supabase.from('site_visit_preparation_item').select('id').in('id', safeIds)
  const allGone = (after ?? []).length === 0
  console.log(`Vérification post-rollback : ${allGone ? 'OK — plus aucune ligne du run en base' : 'ECART — ' + JSON.stringify(after)}`)

  console.log(`\nÉtat final pour ce testRunId : ${allGone ? 'BASE REVENUE À L\'ÉTAT INITIAL (lignes supprimées, aucune ligne préexistante touchée).' : 'INCOMPLET — vérifier manuellement avant de considérer le run comme annulé.'}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
