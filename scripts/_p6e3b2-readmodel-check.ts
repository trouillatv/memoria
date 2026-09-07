// Phase 6E.3B.2 — vérifie le read-model réel (loadTrackedPointReadModel) sur RUS après le
// pilote confirm_pending_trackability : le Point créé doit être visible, sa trajectoire ne
// doit provenir QUE de la proposition figée par 394, et son derivedState doit être ce que
// le réducteur calcule réellement — jamais forcé à 'open'.

import { loadTrackedPointReadModel } from '../lib/knowledge/tracked-point-read-model'

const RUS_SITE_ID = 'bebcdf12-fec0-44d8-858b-249ddea02db4'
const NEW_POINT_ID = '2f970d39-6fc0-498e-9c46-1979651c884d'
const PREEXISTING_CBO_POINT_ID = 'ccdc1c7e-c816-43e0-a9b7-fb6a08beaf3c'
const EXPECTED_PROPOSAL_ID = 'd31f26c5-654f-470c-9bef-0903e460301c'

async function main() {
  const model = await loadTrackedPointReadModel(RUS_SITE_ID)

  const newPoint = model.points.find((p) => p.id === NEW_POINT_ID)
  if (!newPoint) throw new Error(`HARD STOP: Point ${NEW_POINT_ID} absent du read-model`)

  console.log('=== Point créé — vu par loadTrackedPointReadModel ===')
  console.log(JSON.stringify(newPoint, null, 2))

  const trajectorySources = newPoint.trajectory.map((e) => ('source' in e ? (e as any).source : null)).filter(Boolean)
  const onlyExpectedProposal = trajectorySources.every((s) => s === `proposal:${EXPECTED_PROPOSAL_ID}`)

  console.log('\n=== Vérifications ===')
  console.log('identityStatus (attendu PROVISIONAL):', newPoint.identityStatus, newPoint.identityStatus === 'PROVISIONAL' ? 'OK' : 'FAIL')
  console.log('foundingKind (attendu manual):', newPoint.foundingKind, newPoint.foundingKind === 'manual' ? 'OK' : 'FAIL')
  console.log('hardMemberThreadIds:', JSON.stringify(newPoint.hardMemberThreadIds))
  console.log('trajectory length:', newPoint.trajectory.length)
  console.log('trajectory sources:', JSON.stringify(trajectorySources))
  console.log('trajectory limitée à la proposition figée (attendu true):', onlyExpectedProposal)
  console.log('derivedState (calculé par le réducteur, NON imposé):', newPoint.derivedState)
  console.log('stateBasis:', JSON.stringify(newPoint.stateBasis))
  console.log('markers:', JSON.stringify(newPoint.markers))

  const preexisting = model.points.find((p) => p.id === PREEXISTING_CBO_POINT_ID)
  if (!preexisting) throw new Error(`HARD STOP: Point préexistant ${PREEXISTING_CBO_POINT_ID} absent du read-model (ne devrait pas disparaître)`)
  console.log('\n=== Point préexistant (CBO-founded, même Subject) — doit être INCHANGÉ ===')
  console.log(JSON.stringify({ id: preexisting.id, derivedState: preexisting.derivedState, hardMemberThreadIds: preexisting.hardMemberThreadIds, trajectoryLength: preexisting.trajectory.length }, null, 2))

  const subjectModel = model.bySubject.get(newPoint.ownerCanonicalSubjectId!)
  console.log('\n=== SubjectPointReadModel du Subject concerné ===')
  console.log(JSON.stringify({ totalPoints: subjectModel?.totalPoints, confirmedPoints: subjectModel?.confirmedPoints, provisionalPoints: subjectModel?.provisionalPoints }, null, 2))

  if (!onlyExpectedProposal) throw new Error('HARD STOP: trajectoire contaminée par une source hors evidence figée')
  if (newPoint.identityStatus !== 'PROVISIONAL') throw new Error('HARD STOP: identityStatus doit être PROVISIONAL')

  console.log('\n=== VERDICT: read-model conforme ===')
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
