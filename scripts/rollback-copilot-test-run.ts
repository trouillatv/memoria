// Rollback du harnais de recette réversible P4-B.2 (actor_alias).
// (Vincent, 2026-08-17.) Annule UNIQUEMENT les lignes créées par un test_run_id
// donné, identifiées par leur ID exact dans le manifeste — jamais par libellé,
// alias ou date approximative. Rollback SÉMANTIQUE (status='revoked'), pas de
// DELETE : actor_alias porte une doctrine de révocation explicite (mig 327,
// status CHECK inclut 'revoked') plutôt qu'une suppression physique.
//
// Usage : npx tsx scripts/rollback-copilot-test-run.ts <testRunId>
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

async function main() {
  const testRunId = process.argv[2]
  if (!testRunId) {
    console.error('Usage: npx tsx scripts/rollback-copilot-test-run.ts <testRunId>')
    process.exit(1)
  }

  const manifestPath = join(process.cwd(), '.recette-runs', `${testRunId}.json`)
  if (!existsSync(manifestPath)) {
    console.error(`Manifeste introuvable : ${manifestPath}`)
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest

  const supabase = admin()
  const ids = manifest.entries.filter((e) => e.table === 'actor_alias').map((e) => e.id)

  console.log(`── Rollback recette P4-B.2 — testRunId=${testRunId} ──`)
  console.log(`Manifeste : ${manifestPath}`)
  console.log(`organizationId = ${manifest.organizationId}`)
  console.log(`source attendu = ${manifest.source}\n`)

  if (ids.length === 0) {
    console.log('Aucune ligne actor_alias dans ce manifeste — rien à annuler.')
    process.exit(0)
  }

  // ── Étape 1 : afficher exactement ce qui va être touché ────────────────────
  const { data: current, error: readError } = await supabase
    .from('actor_alias')
    .select('id, alias, status, source, organization_id, copilot_proposal_id')
    .in('id', ids)
  if (readError) {
    console.error(`Lecture impossible : ${readError.message}`)
    process.exit(1)
  }

  console.log(`Va être révoqué (status → 'revoked'), ${current?.length ?? 0} ligne(s) :`)
  for (const row of current ?? []) {
    const entry = manifest.entries.find((e) => e.id === row.id)
    console.log(`  - id=${row.id} alias="${row.alias}" statut actuel=${row.status} source=${row.source} (scénario: ${entry?.scenario ?? '?'})`)
    if (row.source !== manifest.source) {
      console.error(`    STOP — cette ligne a source="${row.source}" ≠ "${manifest.source}" attendu. Elle ne sera PAS touchée : le manifeste ne correspond plus à l'état réel.`)
    }
    if (row.organization_id !== manifest.organizationId) {
      console.error(`    STOP — organization_id="${row.organization_id}" ≠ "${manifest.organizationId}" attendu. Elle ne sera PAS touchée.`)
    }
  }

  // Défense en profondeur : IDs exacts + source ET organizationId re-vérifiés
  // au niveau de la requête elle-même, pas seulement à l'affichage ci-dessus.
  const safeIds = (current ?? [])
    .filter((row) => row.source === manifest.source && row.organization_id === manifest.organizationId)
    .map((row) => row.id)

  if (safeIds.length !== ids.length) {
    console.error(`\nECART — ${ids.length - safeIds.length} ligne(s) du manifeste ne correspondent plus (source/org modifiés) : exclues du rollback.`)
  }
  if (safeIds.length === 0) {
    console.log('\nAucune ligne sûre à révoquer. Arrêt.')
    process.exit(1)
  }

  // ── Étape 2 : rollback sémantique, IDs exacts uniquement ────────────────────
  const { data: revoked, error: updateError } = await supabase
    .from('actor_alias')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .in('id', safeIds)
    .eq('source', manifest.source)
    .eq('organization_id', manifest.organizationId)
    .select('id')

  if (updateError) {
    console.error(`\nRollback échoué : ${updateError.message}`)
    process.exit(1)
  }
  console.log(`\n${revoked?.length ?? 0} ligne(s) révoquée(s).`)

  // ── Étape 3 : vérifier le retour à l'état attendu ───────────────────────────
  const { data: after } = await supabase.from('actor_alias').select('id, status').in('id', safeIds)
  const allRevoked = (after ?? []).every((r) => r.status === 'revoked')
  console.log(`Vérification post-rollback : ${allRevoked ? 'OK — toutes les lignes du run sont status=revoked' : 'ECART — ' + JSON.stringify(after)}`)

  // copilot_interactions n'est PAS annulé : c'est un journal opérationnel
  // (Observatoire "Pourquoi MemorIA sait-elle que…"), pas la mémoire canonique
  // que ce harnais protège. Décision documentée, pas un oubli.
  console.log(`\nNote : les lignes copilot_interactions créées pendant ce run (le cas échéant) ne sont PAS supprimées — journal opérationnel, hors périmètre du rollback.`)

  console.log(`\nÉtat final pour ce testRunId : ${allRevoked ? 'BASE REVENUE À L\'ÉTAT INITIAL (alias révoqués, aucune ligne préexistante touchée).' : 'INCOMPLET — vérifier manuellement avant de considérer le run comme annulé.'}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
