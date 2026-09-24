/**
 * CLI de recette — déclenchement manuel de l'extraction prescriptive d'engagements
 * (P0-2B) sur UN document contractuel déjà en base et déjà rattaché à un chantier.
 *
 * Réutilise UNIQUEMENT lib/documents/extract-engagement-candidates.ts (même
 * orchestrateur que produirait une future route/UI). Aucune logique dupliquée ici :
 * ce script est un simple point de déclenchement, pas un second moteur.
 *
 * Usage :
 *   npx tsx scripts/run-engagement-extraction.ts --document <documentId> --user <userId> [--force]
 *
 * N'effectue AUCUNE matérialisation : le résultat est une liste de
 * document_extraction_proposal (proposal_family='engagement') en attente de revue
 * humaine. Ne crée jamais d'Engagement canonique, d'Action, de site_obligation.
 */

import { existsSync, readFileSync } from 'node:fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

import { extractEngagementCandidates } from '@/lib/documents/extract-engagement-candidates'
import { createAdminClient } from '@/lib/supabase/admin'

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

const documentId = argValue('--document')
const userId = argValue('--user')
const force = process.argv.includes('--force')

if (!documentId || !userId) {
  console.error('Usage : npx tsx scripts/run-engagement-extraction.ts --document <documentId> --user <userId> [--force]')
  process.exit(1)
}

async function main() {
  console.log(`\n=== Extraction prescriptive d'engagements — document ${documentId} ===\n`)

  const result = await extractEngagementCandidates(documentId!, userId!, { force })

  if (!result.ok) {
    console.error(`ÉCHEC : ${result.error}${result.runId ? ` (run ${result.runId})` : ''}`)
    process.exit(1)
  }

  console.log(`Run          : ${result.runId}${result.reused ? ' (réutilisé, déjà exploitable)' : ''}`)
  console.log(`Candidats    : ${result.proposalCount}`)

  if (result.proposalCount === 0 && !result.reused) {
    console.log('\nAucun candidat retenu (aucune clause prescriptive détectée, ou tous les extraits proposés étaient introuvables verbatim dans le texte source).')
    return
  }

  const supabase = createAdminClient()
  const { data: proposals } = await supabase
    .from('document_extraction_proposal')
    .select('id, label, source_page, source_excerpt, source_payload, review_status')
    .eq('extraction_run_id', result.runId)
    .eq('proposal_family', 'engagement')
    .order('created_at', { ascending: true })

  if (proposals && proposals.length > 0) {
    console.log('\n=== Candidats extraits (proposal_family=engagement) ===\n')
    for (const p of proposals as Array<{
      id: string; label: string; source_page: number | null; source_excerpt: string
      source_payload: { kind?: string; category?: string; measurable?: boolean; frequency_raw?: string | null } | null
      review_status: string
    }>) {
      console.log(`- [${p.id.slice(0, 8)}] ${p.label}`)
      console.log(`    page=${p.source_page ?? '—'}  kind=${p.source_payload?.kind ?? '—'}  category=${p.source_payload?.category ?? '—'}  measurable=${p.source_payload?.measurable ?? '—'}  frequence=${p.source_payload?.frequency_raw ?? '—'}`)
      console.log(`    excerpt: "${p.source_excerpt.slice(0, 140)}${p.source_excerpt.length > 140 ? '…' : ''}"`)
      console.log(`    review_status=${p.review_status}`)
    }
  }

  console.log('\nAucune matérialisation effectuée (hors périmètre P0-2B). Revue humaine requise avant tout Engagement canonique.')
}

main().catch((e) => {
  console.error('Erreur inattendue :', e instanceof Error ? e.message : e)
  process.exit(1)
})
