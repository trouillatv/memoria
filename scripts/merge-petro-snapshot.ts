// Capture un snapshot pré-merge pour chaque fusion PETRO ATITI.
// À lancer AVANT les fusions pour permettre un rollback fiable.
//
// Usage : npx tsx scripts/merge-petro-snapshot.ts
// Produit : scripts/petro-merge-snapshots.json

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { writeFileSync } from 'fs'
import { join } from 'path'

config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const SITE = '75bd3d23-d515-46bd-8de8-254495a5bade'

// IDs résolus lors du dry-run — hardcodés pour éviter toute ambiguïté
const MERGES = [
  {
    name: 'merge-1-cadenas-acces',
    sourceId: 'e00596a5-91f0-4f3a-ae97-a24db8db637d',
    sourceLabel: 'Installation et présentation cadenas à code',
    targetId: '6801ce5c-17e9-4939-93c5-175754add1f5',
    targetLabel: 'Accès sécurisé au chantier (code portail/cadenas)',
    finalLabel: 'Accès sécurisé au chantier (portail et cadenas à code)',
  },
  {
    name: 'merge-2-planning-maj-diffusion',
    sourceId: 'e3d61d65-4f3f-424e-bf04-a8ee80484f26',
    sourceLabel: 'Mise à jour du planning suite à l\'avancement de la dépose',
    targetId: '14cd6eaa-926b-4262-90fa-9a323b49f35b',
    targetLabel: 'Diffusion et complétude du planning général',
    finalLabel: 'Diffusion et mise à jour du planning général',
  },
  {
    name: 'merge-3-retard-planning',
    sourceId: '56c705a4-168e-41dc-945e-3494bf748972',
    sourceLabel: 'Retard dans l\'avancement général du chantier',
    targetId: '14cd6eaa-926b-4262-90fa-9a323b49f35b',
    targetLabel: 'Diffusion et complétude du planning général',
    finalLabel: 'Diffusion et mise à jour du planning général',
  },
]

async function captureSnapshot(merge: typeof MERGES[0]) {
  console.log(`\nCapture snapshot : ${merge.name}`)

  // État source
  const { data: srcData } = await sb
    .from('canonical_subject')
    .select('id, label, aliases, status, merged_into')
    .eq('id', merge.sourceId)
    .single()

  // État target
  const { data: tgtData } = await sb
    .from('canonical_subject')
    .select('id, label, aliases, status')
    .eq('id', merge.targetId)
    .single()

  // Occurrences à déplacer
  const { data: occs } = await sb
    .from('canonical_subject_occurrence')
    .select('id, source_ref_id, source_proposal_id, source_kind, effective_date, label')
    .eq('canonical_subject_id', merge.sourceId)

  // Threads à déplacer
  const { data: threads } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id, site_id, confidence, source')
    .eq('canonical_subject_id', merge.sourceId)

  // Proposals à déplacer
  const { data: props } = await sb
    .from('site_knowledge_proposals')
    .select('id, title, status, canonical_subject_id')
    .eq('canonical_subject_id', merge.sourceId)
    .eq('site_id', SITE)

  const snapshot = {
    name: merge.name,
    capturedAt: new Date().toISOString(),
    merge: {
      sourceId: merge.sourceId,
      sourceLabel: merge.sourceLabel,
      targetId: merge.targetId,
      targetLabel: merge.targetLabel,
      finalLabel: merge.finalLabel,
    },
    before: {
      source: srcData,
      target: tgtData,
      occurrenceIds: (occs ?? []).map((o: { id: string }) => o.id),
      occurrenceDetails: occs ?? [],
      threadIds: (threads ?? []).map((t: { subject_thread_id: string }) => t.subject_thread_id),
      threadDetails: threads ?? [],
      proposalIds: (props ?? []).map((p: { id: string }) => p.id),
      proposalDetails: props ?? [],
    },
  }

  console.log(`  Source  : [${(srcData as { status: string } | null)?.status}] ${merge.sourceLabel}`)
  console.log(`  Target  : [${(tgtData as { status: string } | null)?.status}] ${merge.targetLabel}`)
  console.log(`  Occs    : ${snapshot.before.occurrenceIds.length}`)
  console.log(`  Threads : ${snapshot.before.threadIds.length}`)
  console.log(`  Props   : ${snapshot.before.proposalIds.length}`)

  return snapshot
}

async function main() {
  console.log('=== CAPTURE SNAPSHOTS PRÉ-MERGE PETRO ===')

  const snapshots = []
  for (const merge of MERGES) {
    const snap = await captureSnapshot(merge)
    snapshots.push(snap)
  }

  const outPath = join(process.cwd(), 'scripts', 'petro-merge-snapshots.json')
  writeFileSync(outPath, JSON.stringify(snapshots, null, 2), 'utf-8')

  console.log(`\n✅ Snapshots sauvegardés : ${outPath}`)
  console.log('   Conserve ce fichier jusqu\'à validation complète des 3 fusions.')
}

main().catch((e) => {
  console.error('❌ ERREUR :', e.message)
  process.exit(1)
})
