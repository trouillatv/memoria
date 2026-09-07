// Phase 6D.1B — recette métier par site (lecture seule, post-APPLY).
// Vérifie, pour chaque site écrit : au moins 1 Point CONFIRMED (CBO) si applicable,
// au moins 1 Point PROVISIONAL si le site en a, un backref CBO réellement consommé,
// une adhésion HARD réellement consommée, et l'absence d'effet des candidates/pending
// sur loadTrackedPointReadModel (isolation structurelle, mig 388/389/390).

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'

const SITES = [
  { id: '2c939e67-e986-4635-86a0-638cda870480', name: '2C93' },
  { id: '06c62e48-c488-4787-b322-0581c36b83c8', name: 'OCEF' },
  { id: 'fae6149d-f490-4b8e-b1fa-34f0ce8a32b4', name: 'FAE' },
  { id: '655edb00-032d-4379-b76d-d598c2c7c254', name: '655E' },
  { id: 'bebcdf12-fec0-44d8-858b-249ddea02db4', name: 'RUS' },
  { id: '23a66c4e-e758-412d-a613-d3626b2a10bc', name: '23A6' },
]

async function main() {
  const db = createAdminClient()

  for (const site of SITES) {
    console.log(`\n=== ${site.name} ===`)

    const { data: points } = await db
      .from('tracked_point')
      .select('id, founding_kind, identity_status, label, founding_reference, has_upstream_defect')
      .eq('site_id', site.id)

    const confirmed = (points ?? []).filter((p) => p.founding_kind === 'cbo')
    const provisional = (points ?? []).filter((p) => p.founding_kind === 'trackable_condition')
    console.log(`Points: ${points?.length ?? 0} total — CONFIRMED(cbo)=${confirmed.length} PROVISIONAL(trackable)=${provisional.length}`)

    if (confirmed.length > 0) {
      const sample = confirmed[0]
      const { data: cbo } = await db
        .from('canonical_business_object')
        .select('id, object_type, tracked_point_id, site_id')
        .eq('id', sample.founding_reference)
        .maybeSingle()
      const backrefOk = cbo && cbo.tracked_point_id === sample.id && cbo.site_id === site.id
      console.log(`  CONFIRMED échantillon: point=${sample.id} label="${sample.label}" -> CBO=${cbo?.id} object_type=${cbo?.object_type} backref_vers_ce_point=${backrefOk}`)

      const { data: members } = await db
        .from('tracked_point_member')
        .select('subject_thread_id, scope, resolution_source, evidence_grade')
        .eq('tracked_point_id', sample.id)
        .eq('status', 'active')
      console.log(`  HARD memberships consommées pour ce point: ${members?.length ?? 0}`, members?.slice(0, 2))
    } else if (site.name !== '23A6' && site.name !== '655E') {
      console.log("  ATTENTION: 0 CONFIRMED alors qu'attendu (à vérifier vs préflight)")
    }

    if (provisional.length > 0) {
      const sample = provisional[0]
      console.log(`  PROVISIONAL échantillon: point=${sample.id} label="${sample.label}" upstream_defect=${sample.has_upstream_defect}`)
    } else {
      console.log('  0 PROVISIONAL sur ce site (conforme au préflight si site sans PROVISIONAL_TRACKABLE)')
    }

    const { count: candidateCount } = await db
      .from('tracked_point_identity_candidate')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', site.id)
    const { count: pendingCount } = await db
      .from('tracked_point_pending_trace')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', site.id)
      .eq('status', 'pending')
    console.log(`  SOFT candidates=${candidateCount} pending traces=${pendingCount}`)

    const readModel = await loadTrackedPointReadModel(site.id)
    const readModelPointCount = readModel.points.length
    console.log(`  loadTrackedPointReadModel: ${readModelPointCount} points restitués (DB tracked_point=${points?.length ?? 0})`)
    if (readModelPointCount !== (points?.length ?? 0)) {
      console.log(`  ATTENTION: écart read-model vs DB brute pour ${site.name}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
