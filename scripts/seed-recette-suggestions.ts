/**
 * Seed des suggestions de recette — Lot 3
 *
 * Crée les canonical_subject_suggestion pour les 3 faux-éclatements connus sur
 * OCEF Compostage, afin de les valider via l'interface "Rapprochements suggérés".
 *
 * Protocole :
 *   - resolver_version = 'seed_v1' (distinct du LLM 'v1' → pas de conflit UNIQUE)
 *   - model_name       = 'manual_seed' (provenance explicite, pas un modèle LLM)
 *   - shadow_decision  = 'would_suggest' (toujours soumis à validation humaine)
 *   - Pour chaque cluster, un canonical_subject est désigné "cible principale".
 *     Les autres threads du cluster reçoivent une suggestion vers cette cible.
 *
 * Ces suggestions ne modifient pas les données existantes — shadow mode strict.
 * La validation humaine via l'interface Lot 3 appliquera réellement les merges.
 *
 * Usage :
 *   npx tsx scripts/seed-recette-suggestions.ts [--dry-run]
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

async function sql(query: string): Promise<unknown[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const res = await fetch('https://api.supabase.com/v1/projects/srixnofmaydxouhucawn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

const SITE_COMPOSTAGE = '2c939e67-e986-4635-86a0-638cda870480'
const RESOLVER_VERSION = 'seed_v1'
const MODEL_NAME = 'manual_seed'

// ── Clusters avec cible principale ───────────────────────────────────────────
//
// La cible principale est le canonical_subject choisi comme "identité de référence"
// pour chaque sujet physique. Les autres threads fusionneront vers lui.
//
// Choix de la cible : label le plus récent et le plus complet (fin de chaîne PV).

const CLUSTERS = [
  {
    name: 'Regard R4',
    // Cible : "Regard R4 chute manquante repris" (état final, résolution confirmée)
    targetCsId: 'd8861786-2f44-461c-bf57-e873336ac9ea',
    targetLabel: 'Regard R4 chute manquante repris',
    // Sources : les 4 autres threads du cluster
    sources: [
      {
        csId: '024dab7e-16d9-4927-bedc-f92c5ac89a64',
        threadId: 'a360431f-2125-43ea-a900-ad92687cb57f',
        label: 'Prévision: Reprise du réseau pour problème regard R4 (manque chute) y compris le weekend',
        reasoning: 'Cluster R4 : même ouvrage (regard R4 manque chute), formulations différentes selon l\'avancement du PV.',
      },
      {
        csId: '858a9f11-3190-49e6-ad06-584fb0027b15',
        threadId: 'ed5e001b-6586-495a-936d-6322ee91645e',
        label: 'Problème regard R4 manque Chute pour la mise en œuvre du dégrilleur',
        reasoning: 'Cluster R4 : même ouvrage (regard R4 manque chute), formulations différentes selon l\'avancement du PV.',
      },
      {
        csId: '4fb967c3-4432-4bc2-9e47-e626fcd6fa84',
        threadId: 'bff1c1b5-0cf8-4af1-9f87-173c7f2223e6',
        label: 'Regard R4 (125x125) avec chute manquante pour mise en place dégrilleur',
        reasoning: 'Cluster R4 : même ouvrage (regard R4 manque chute), formulations différentes selon l\'avancement du PV.',
      },
      {
        csId: 'bba40ef0-3192-4aae-ac63-f95be8790926',
        threadId: '46775ec8-a42f-4a58-9bcc-a526fce9c63f',
        label: 'Reprise du réseau pour problème regard R4 (manque chute) prévue fin de semaine 28',
        reasoning: 'Cluster R4 : même ouvrage (regard R4 manque chute), formulations différentes selon l\'avancement du PV.',
      },
    ],
  },
  {
    name: 'Raccordement lagunage',
    // Cible : "Validation du raccordement sur le lagunage" (label le plus explicite)
    targetCsId: '2bff30b9-8298-4363-89db-45f12eb8c0bd',
    targetLabel: 'Validation du raccordement sur le lagunage',
    sources: [
      {
        csId: '185865b3-351a-49a0-92af-c0c61bd2652e',
        threadId: 'e6a8d80a-a83f-4690-8088-4b178a388951',
        label: 'Raccordement sur le lagunage',
        reasoning: 'Cluster lagunage : même objet (raccordement physique vers le lagunage), libellés à différents stades de validation.',
      },
      {
        csId: '4d43c82d-3ba1-4310-b609-7eca698f095c',
        threadId: 'c7b41810-e785-49fd-8c94-2e685bf68de6',
        label: 'Raccordement sur le lagunage fera l\'objet d\'une validation du MOA/MOE',
        reasoning: 'Cluster lagunage : même objet (raccordement physique vers le lagunage), libellés à différents stades de validation.',
      },
      {
        csId: 'b93fafd9-dd27-48bb-babb-094c33e23f53',
        threadId: '2a2754d0-13ac-4d6c-90b6-b0ca1b433c47',
        label: 'Validation raccordement lagunage',
        reasoning: 'Cluster lagunage : même objet (raccordement physique vers le lagunage), libellés à différents stades de validation.',
      },
    ],
  },
  {
    name: 'FT Débourbeur déshuileur',
    // Cible : "Fiche technique débourbeur déshuileur conforme" (état final validé)
    targetCsId: '966af6f5-9fae-4a9b-8bcb-89983f87ed71',
    targetLabel: 'Fiche technique débourbeur déshuileur conforme',
    sources: [
      {
        csId: '27384e81-bbd2-4138-bc4a-653170e479b0',
        threadId: 'd891518e-b757-420c-933d-6a29fef3faad',
        label: 'Assainissement : Mise en place du Débourbeur déshuileur = FT transmise non conforme',
        reasoning: 'Cluster débourbeur : même équipement (débourbeur déshuileur), suivi de la FT de non-conforme à conforme.',
      },
      {
        csId: 'ce73b108-c4f1-486b-b421-338d44e0943c',
        threadId: 'f44d6f71-be95-4fad-b1ed-d016ee11ddb4',
        label: 'Débourbeur déshuileur',
        reasoning: 'Cluster débourbeur : même équipement (débourbeur déshuileur), libellé générique puis précisé.',
      },
      {
        csId: '7c9b287a-979e-4dd8-a1f6-7c8ddc9bb8b3',
        threadId: '49f50384-9cf6-4840-b32f-a519f9173c5b',
        label: 'FT débourbeur déshuileur à retransmettre (transmission non conforme)',
        reasoning: 'Cluster débourbeur : même équipement (débourbeur déshuileur), suivi de la FT de non-conforme à conforme.',
      },
      {
        csId: '0e8a3996-0610-421d-898c-199af6536684',
        threadId: '296e888f-7af2-44d1-b4c8-dc71334fc245',
        label: 'FT débourbeur déshuileur retransmis le 27.04.2026 conforme',
        reasoning: 'Cluster débourbeur : même équipement (débourbeur déshuileur), suivi de la FT de non-conforme à conforme.',
      },
      {
        csId: 'deeff5d1-0b80-4d30-8527-64e62eff4e23',
        threadId: 'aa3d6d76-16b5-4308-8c8c-fa193523d4d9',
        label: 'Mise en place Débourbeur déshuileur',
        reasoning: 'Cluster débourbeur : même équipement (débourbeur déshuileur), libellé de mise en place.',
      },
    ],
  },
]

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`Mode : ${dryRun ? 'DRY-RUN' : 'ÉCRITURE'}\n`)

  const suggestions: Array<{
    site_id: string
    subject_thread_id: string
    proposal_label: string
    proposal_family: string
    candidate_canonical_subject_id: string
    model_confidence: number
    reasoning: string
    shadow_decision: string
    resolver_version: string
    model_name: string
    candidate_count: number
  }> = []

  for (const cluster of CLUSTERS) {
    console.log(`Cluster : ${cluster.name}`)
    console.log(`  Cible : "${cluster.targetLabel}"`)
    console.log(`  Sources : ${cluster.sources.length} threads`)

    for (const src of cluster.sources) {
      suggestions.push({
        site_id: SITE_COMPOSTAGE,
        subject_thread_id: src.threadId,
        proposal_label: src.label,
        proposal_family: 'knowledge_fact',
        candidate_canonical_subject_id: cluster.targetCsId,
        model_confidence: 0.95,
        reasoning: src.reasoning,
        shadow_decision: 'would_suggest',
        resolver_version: RESOLVER_VERSION,
        model_name: MODEL_NAME,
        candidate_count: cluster.sources.length,
      })
      console.log(`    + [${src.threadId.slice(0, 8)}] "${src.label.slice(0, 60)}"`)
    }
    console.log()
  }

  console.log(`Total suggestions à créer : ${suggestions.length}`)

  if (dryRun) {
    console.log('\nDRY-RUN : relancez sans --dry-run pour appliquer.')
    return
  }

  // Insert avec ON CONFLICT DO NOTHING (idempotent)
  const esc = (s: string) => `'${s.replace(/'/g, "''")}'`

  const values = suggestions.map((s) => `(
    ${esc(s.site_id)},
    '${s.subject_thread_id}',
    ${esc(s.proposal_label)},
    ${esc(s.proposal_family)},
    '${s.candidate_canonical_subject_id}',
    ${s.model_confidence},
    ${esc(s.reasoning)},
    ${esc(s.shadow_decision)},
    ${esc(s.resolver_version)},
    ${esc(s.model_name)},
    ${s.candidate_count}
  )`).join(',\n')

  const result = await sql(`
    INSERT INTO canonical_subject_suggestion
      (site_id, subject_thread_id, proposal_label, proposal_family,
       candidate_canonical_subject_id, model_confidence, reasoning,
       shadow_decision, resolver_version, model_name, candidate_count)
    VALUES ${values}
    ON CONFLICT (subject_thread_id, resolver_version) DO NOTHING
  `)

  console.log(`\nRésultat SQL :`, result)
  console.log('\n✓ Suggestions de recette créées.')
  console.log('  Elles apparaîtront dans la section "Rapprochements suggérés"')
  console.log('  de la revue du PV (site OCEF Compostage, extraction_run_id IS NULL).')
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
