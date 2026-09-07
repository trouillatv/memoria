// Phase 6C.1 — recette post-write (v3, après 6C.1.A read-model site_reserve/site_deadline +
// 6C.1.B réconciliation F8 par IDs réels). READ-ONLY. Volets demandés par Vincent :
//  1. Couverture CBO : 149/149 backrefs posés, cboIds.length>=1 pour chaque Point cbo — désormais
//     SANS condition object_type (6C.1.A a étendu le read-model à site_action+site_reserve+site_deadline).
//  2. Vérité du reducer (Gate 4) : tracked_point → cboIds → CboReducedState (union des deux loaders) →
//     computedCurrentState → derivedState, avec IDs réels, preuve que le Point consomme
//     le verdict CBO tel quel (jamais un doc brut qui contournait le reducer avant le
//     correctif backref).
//  3. Bridge documentaire HARD (témoin §8, inchangé) : tracked_point_member HARD →
//     proposal → PointLifecycleEvent → trajectory.
//  4. Isolation du candidat SOFT : chemin correct via
//     tracked_point_identity_candidate.candidate_point_id (jamais cboIds.includes(...),
//     qui échouait avant le correctif et restait un raccourci fragile après).
//  5. F8 — réconciliation par IDs réels (6C.1.B) : F8 est un codename interne (P0-1D-VALIDATION-
//     MECANISME-F8.md), jamais un texte de label. Une recherche par label ne prouve rien ;
//     on reconstitue PRE-FLIGHT → unité prévue → point UUID planifié → APPLY → ligne DB réelle
//     à partir des IDs exacts du preflight (_p6c-preflight-rus.ts:517-522).
import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'
import { loadCboReducedStates, loadNonActionCboReducedStates } from '@/lib/knowledge/canonical-business-object-evolution'

const SITE_ID = 'bebcdf12-fec0-44d8-858b-249ddea02db4'

async function main() {
  const applyReport = JSON.parse(readFileSync('scripts/_p6c-apply-rus-report.json', 'utf8'))
  const { points: entries, pendingIdentityCandidates } = await loadTrackedPointReadModel(SITE_ID)
  console.log(
    `loadTrackedPointReadModel(RUS) : ${entries.length} points chargés (attendu 199), ${pendingIdentityCandidates.length} identity candidates (attendu 73).`,
  )

  // ── 0. Postcondition pilote — tracked_point_member RUS = 216 ──────────────────
  // Vincent (6C.1 CLOSURE) : postcondition importante du pilote, doit rester
  // reproductible à chaque recette. Pas un gate fonctionnel nouveau — une assertion
  // de stabilité du volume de membership écrit par l'APPLY (compte réel DB, jamais
  // dérivé du read-model).
  const sb = createAdminClient()
  const { count: membershipCount } = await sb
    .from('tracked_point_member')
    .select('id, tracked_point:tracked_point_id!inner(site_id)', { count: 'exact', head: true })
    .eq('tracked_point.site_id', SITE_ID)
    .eq('status', 'active')
  console.log(
    `tracked_point_member (RUS, status=active) : ${membershipCount} (attendu 216, garde APPLY _p6c-apply-rus.mjs:269-272)`,
  )
  if (membershipCount !== 216) {
    console.log('ÉCHEC POSTCONDITION — memberships RUS ≠ 216, voir écart ci-dessus avant toute lecture des gates suivants.')
  }

  // ── 1. Couverture CBO ────────────────────────────────────────────────────────
  // Deux niveaux distincts, volontairement non confondus :
  //  (i)  vérité DB — canonical_business_object.tracked_point_id, posé par l'étape 3 de
  //       l'APPLY (requête directe, ground truth du correctif backref lui-même) ;
  //  (ii) exposition read-model — PointReadModelEntry.cboIds, qui depuis 6C.1.A couvre les
  //       trois object_type CBO (site_action via loadCboReducedStates, site_reserve/site_deadline
  //       via loadNonActionCboReducedStates, union faite dans loadTrackedPointReadModel). Gate
  //       6C.1.A : (i) et (ii) doivent désormais coïncider SANS condition sur l'object_type.
  const cboPoints = entries.filter((e) => e.foundingKind === 'cbo')
  const { data: dbBackrefRows } = await sb
    .from('canonical_business_object')
    .select('id, tracked_point_id, object_type')
    .eq('site_id', SITE_ID)
    .not('tracked_point_id', 'is', null)
  const dbBackrefCount = dbBackrefRows?.length ?? 0

  const withBackref = cboPoints.filter((e) => e.cboIds.length >= 1)
  const missingBackref = cboPoints.filter((e) => e.cboIds.length === 0)
  const multiCbo = cboPoints.filter((e) => e.cboIds.length > 1)
  console.log('\n=== 1. COUVERTURE CBO → Point ===')
  console.log('(i) Vérité DB — canonical_business_object.tracked_point_id posés (RUS):', dbBackrefCount, '(attendu 149)')
  console.log('Points founding_kind=cbo (read-model):', cboPoints.length, '(attendu 149)')
  console.log('(ii) Points avec cboIds.length>=1 dans le read-model:', withBackref.length, '(attendu 149/149, gate 6C.1.A — plus de condition object_type)')
  if (missingBackref.length > 0) {
    const objectTypeById = new Map((dbBackrefRows ?? []).map((r) => [r.tracked_point_id, r.object_type]))
    console.log(
      'ÉCHEC GATE 6C.1.A — points dont le backref DB existe mais est encore absent de cboIds après extension read-model, avec object_type du CBO fondateur :',
      missingBackref.map((e) => ({ id: e.id, label: e.label, founderObjectType: objectTypeById.get(e.id) })),
    )
  }
  console.log(
    'Points multi-CBO (exception explicite, jamais consolidés par ce correctif) :',
    multiCbo.length,
    multiCbo.map((e) => ({ id: e.id, label: e.label, cboIds: e.cboIds })),
  )

  // ── 2. Vérité du reducer — CBO → Point (Gate 4, IDs réels) ────────────────────
  // Le Point et le CBO utilisent DEUX vocabulaires différents par construction :
  //  - CboComputedCurrentState (riche, P1-4C2A) : native_completed / documentary_completed /
  //    conforme_at / native_cancelled / native_reopened / documentary_reopened / open /
  //    progressing / conflict / unknown.
  //  - PointComputedCurrentState (grossier, 5 valeurs) : unknown / open / resolved / reopened / conflict.
  // Gate 4 ("le Point ne ré-arbitre jamais l'intérieur d'un CBO, il consomme le verdict tel
  // quel") ne veut donc PAS dire égalité littérale des deux chaînes — ça voudrait dire changer
  // le vocabulaire du Point pour copier celui du CBO, ce qui n'a jamais été demandé. Gate 4
  // veut dire : la traduction passe par UNE table de classification gelée (tracked-point-
  // lifecycle-reducer.ts:121-148, CBO_RESOLVING/CBO_REOPENING/CBO_BLOCKING → classifyCbo →
  // cboVerdict), jamais par un raccourci ad hoc. On rejoue ici cette même table (miroir, pas
  // import — les Set/fonctions sont volontairement non exportées) pour prouver la fidélité.
  const CBO_RESOLVING = new Set(['native_completed', 'documentary_completed', 'conforme_at', 'native_cancelled'])
  const CBO_REOPENING = new Set(['native_reopened', 'documentary_reopened'])
  const CBO_BLOCKING = new Set(['open', 'progressing'])
  function classifyCbo(s: string | undefined): 'resolving' | 'reopening' | 'blocking' | 'conflict' | 'neutral' {
    if (s === 'conflict') return 'conflict'
    if (s && CBO_REOPENING.has(s)) return 'reopening'
    if (s && CBO_BLOCKING.has(s)) return 'blocking'
    if (s && CBO_RESOLVING.has(s)) return 'resolving'
    return 'neutral'
  }
  // Étalon RIA "listing/plan" (tracked-point-lifecycle-reducer.ts:188-194) : Point sans signal
  // natif propre (aucune décision/doc au niveau Point) et à CBO membre unique → verdict CBO
  // consommé TEL QUEL, sans ré-arbitration. C'est exactement la forme du témoin ici (native
  // state = unknown, un seul cboIds).
  const [cboReducedAction, cboReducedNonAction] = await Promise.all([
    loadCboReducedStates(SITE_ID),
    loadNonActionCboReducedStates(SITE_ID),
  ])
  const cboReduced = new Map([...cboReducedAction, ...cboReducedNonAction])
  const reducerWitness = entries.find((e) => e.id === applyReport.witness[0].tracked_point_id)
  const witnessCboId = reducerWitness?.cboIds[0]
  const witnessCboReduced = witnessCboId ? cboReduced.get(witnessCboId) : undefined
  const cboClass = classifyCbo(witnessCboReduced?.reduced.computedCurrentState)
  const expectedPointState = cboClass === 'resolving' ? 'resolved' : cboClass === 'reopening' ? 'reopened' : cboClass === 'blocking' ? 'open' : cboClass === 'conflict' ? 'conflict' : 'unknown'
  console.log('\n=== 2. VÉRITÉ DU REDUCER — CBO → Point (Gate 4, real IDs) ===')
  console.log('tracked_point.id:', reducerWitness?.id)
  console.log('label:', reducerWitness?.label)
  console.log('cboIds (real, désormais peuplé, membre unique attendu pour cet étalon) :', reducerWitness?.cboIds)
  console.log('CboReducedState.computedCurrentState (vocabulaire CBO riche, moteur gelé P1-4C2A) :', witnessCboReduced?.reduced.computedCurrentState)
  console.log('classification Gate 4 de ce verdict CBO (resolving/reopening/blocking/conflict/neutral) :', cboClass)
  console.log('PointReadModelEntry.derivedState (vocabulaire Point, grossier, 5 valeurs) :', reducerWitness?.derivedState)
  console.log('derivedState attendu par la table de traduction gelée, à partir de la classification ci-dessus :', expectedPointState)
  console.log(
    'match — le Point traduit-il fidèlement le verdict CBO via la table gelée (PAS une égalité littérale des deux vocabulaires) :',
    expectedPointState === reducerWitness?.derivedState,
  )

  // ── 3. Bridge documentaire HARD — témoin §8 (inchangé) ────────────────────────
  console.log('\n=== 3. BRIDGE DOCUMENTAIRE HARD — témoin §8 (HARD membership → proposal → trajectory) ===')
  console.log('membership_id (Management API, hors read-model) :', applyReport.witness[0].membership_id)
  console.log('identityStatus:', reducerWitness?.identityStatus)
  console.log('hardMemberThreadIds:', reducerWitness?.hardMemberThreadIds)
  console.log('trajectory:', JSON.stringify(reducerWitness?.trajectory))
  console.log('stateBasis:', reducerWitness?.stateBasis)
  console.log('markers:', reducerWitness?.markers)
  console.log('toConfirm:', reducerWitness?.toConfirm)
  console.log('hasDocumentaryDivergence:', reducerWitness?.hasDocumentaryDivergence)
  console.log('hasConflict:', reducerWitness?.hasConflict)

  // ── 4. Isolation du candidat SOFT — via candidate_point_id (chemin correct) ──
  // Un même thread peut porter plusieurs candidats pending rail=exact vers des Points
  // CIBLES distincts (constaté : 3 candidats pour ce thread). thread+rail seul est donc
  // ambigu — la désambiguïsation utilise candidateOfPlanKey (le Point CIBLE proposé au
  // moment de l'APPLY, distinct de sourcePointId = le Point où le thread est déjà HARD).
  const probeCandidate = applyReport.softCandidateProbe
  const expectedTargetCboId = String(probeCandidate.candidateOfPlanKey).replace(/^cbo:/, '')
  const matchingPendingCandidate = pendingIdentityCandidates.find((c) => {
    if (c.candidateTraceThreadId !== probeCandidate.subject_thread_id || c.rail !== probeCandidate.rail) return false
    const targetEntry = entries.find((e) => e.id === c.candidatePointId)
    return targetEntry?.cboIds.includes(expectedTargetCboId) ?? false
  })
  const probeTargetEntry = matchingPendingCandidate
    ? entries.find((e) => e.id === matchingPendingCandidate.candidatePointId)
    : undefined
  console.log('\n=== 4. ISOLATION DU CANDIDAT SOFT — via tracked_point_identity_candidate.candidate_point_id ===')
  console.log('candidat — id:', matchingPendingCandidate?.id, '| rail:', matchingPendingCandidate?.rail, '| status:', matchingPendingCandidate?.status)
  console.log('candidat — candidatePointId (real, FK directe, jamais déduit de cboIds) :', matchingPendingCandidate?.candidatePointId)
  console.log('point cible — id:', probeTargetEntry?.id, '| label:', probeTargetEntry?.label, '| foundingKind:', probeTargetEntry?.foundingKind)
  console.log('point cible — hardMemberThreadIds réels (granularité thread, pas assez fin pour scope=proposal_set) :', probeTargetEntry?.hardMemberThreadIds)

  // hardMemberThreadIds est à la granularité THREAD. Sous scope='proposal_set', l'unité réelle
  // de membership est le sous-ensemble de proposal_ids, pas le thread entier — un même thread
  // peut légitimement être HARD member de plusieurs Points via des proposal_ids disjoints
  // (invariant proposal_set, tracked-point-read-model.ts:23-28). Le test correct interroge donc
  // directement tracked_point_member au grain de la candidature : y a-t-il déjà une HARD
  // membership active, à CE point, qui couvre CE thread (scope='thread') ou dont les
  // proposal_ids RECOUVRENT ceux du candidat (scope='proposal_set') ?
  const { data: targetMemberRows } = await sb
    .from('tracked_point_member')
    .select('id, scope, proposal_ids, status, evidence_grade')
    .eq('tracked_point_id', matchingPendingCandidate?.candidatePointId ?? '')
    .eq('subject_thread_id', probeCandidate.subject_thread_id)
    .eq('status', 'active')
    .eq('evidence_grade', 'HARD')
  const candidateProposalIds: string[] = probeCandidate.proposal_ids ?? []
  const overlappingHardMembership = (targetMemberRows ?? []).find((m) => {
    if (probeCandidate.scope === 'thread' || m.scope === 'thread') return true
    const existing: string[] = m.proposal_ids ?? []
    return existing.some((id) => candidateProposalIds.includes(id))
  })
  console.log('candidat — proposal_ids visés (scope=proposal_set) :', candidateProposalIds)
  console.log('HARD memberships actives déjà présentes à CE point pour CE thread (grain brut) :', targetMemberRows)
  console.log(
    'le sous-ensemble précis visé par le candidat (thread ou proposal_ids) est-il déjà couvert par une HARD membership à ce point ? (doit être NON — c\'est le sens même du candidat) :',
    Boolean(overlappingHardMembership),
  )
  console.log('derivedState du point cible (doit être stable, jamais influencé par un candidat pending) :', probeTargetEntry?.derivedState)
  console.log(
    'activeMembershipCountForThread capturé au moment de l\'APPLY (rapport, doit rester inchangé) :',
    probeCandidate.activeMembershipCountForThread,
  )

  // ── (b) F8 — réconciliation par IDs réels (6C.1.B) ────────────────────────────
  // F8 est le codename interne du cas témoin cross-thread documenté dans
  // P0-1D-VALIDATION-MECANISME-F8.md (RUS, baie de brassage/compartimentage, PV 22/07/2026,
  // report_id=95269675-fc48-4bd2-a73e-96fc06a78c01) et rejoué dans le preflight 6C
  // (_p6c-preflight-rus.ts:517-522) : deux threads DIFFÉRENTS sur le MÊME problème réel
  // fondent chacun leur propre Point — l'un CONFIRMED par CBO, l'autre PROVISIONAL par condition
  // trackable. Une recherche par label ne peut PAS servir de preuve d'absence (F8 n'est écrit
  // dans aucun label) — on reconstitue la chaîne par IDs exacts.
  console.log('\n=== (b) F8 — PRE-FLIGHT → unité prévue → point UUID → APPLY → ligne DB réelle ===')
  const F8_THREAD_CBO = 'fab64580-2472-41fb-ad92-c3ba0d840633' // fonde le Point CONFIRMED (cbo)
  const F8_THREAD_TRACKABLE = 'd7f19ec8-7932-415f-9cc8-5c064412500c' // fonde le Point PROVISIONAL (trackable_condition)
  const F8_POINT_CBO = '7d32427d-b276-4269-b779-eab52103cf83'
  const F8_POINT_TRACKABLE = 'eabdad0a-a134-48ce-8451-60023580729f'
  const F8_CBO_FOUNDER = '9fbc1eae-cb38-4d82-8297-74d67abb44ea'

  const f8PointCbo = entries.find((e) => e.id === F8_POINT_CBO)
  const f8PointTrackable = entries.find((e) => e.id === F8_POINT_TRACKABLE)
  const { data: f8CboRow } = await sb
    .from('canonical_business_object')
    .select('id, site_id, object_type, tracked_point_id, canonical_subject_id')
    .eq('id', F8_CBO_FOUNDER)
    .maybeSingle()
  const { data: f8MemberRows } = await sb
    .from('tracked_point_member')
    .select('id, tracked_point_id, subject_thread_id, scope, evidence_grade, status')
    .in('tracked_point_id', [F8_POINT_CBO, F8_POINT_TRACKABLE])

  console.log('planKey cbo:9fbc1eae… (preflight) → point UUID planifié :', F8_POINT_CBO)
  console.log('  point réel (read-model) — id/label/identityStatus/foundingKind/foundingReference :', f8PointCbo && {
    id: f8PointCbo.id, label: f8PointCbo.label, identityStatus: f8PointCbo.identityStatus,
    foundingKind: f8PointCbo.foundingKind, foundingReference: f8PointCbo.foundingReference,
  })
  console.log('  CBO fondateur 9fbc1eae… — tracked_point_id (backref DB) :', f8CboRow?.tracked_point_id, '(attendu =', F8_POINT_CBO, ')')
  console.log('  tracked_point_member actif HARD pour thread', F8_THREAD_CBO, ':', (f8MemberRows ?? []).filter((m) => m.tracked_point_id === F8_POINT_CBO && m.subject_thread_id === F8_THREAD_CBO))

  console.log('planKey thread:d7f19ec8… (preflight) → point UUID planifié :', F8_POINT_TRACKABLE)
  console.log('  point réel (read-model) — id/label/identityStatus/foundingKind/foundingReference :', f8PointTrackable && {
    id: f8PointTrackable.id, label: f8PointTrackable.label, identityStatus: f8PointTrackable.identityStatus,
    foundingKind: f8PointTrackable.foundingKind, foundingReference: f8PointTrackable.foundingReference,
  })
  console.log('  tracked_point_member actif HARD pour thread', F8_THREAD_TRACKABLE, ':', (f8MemberRows ?? []).filter((m) => m.tracked_point_id === F8_POINT_TRACKABLE && m.subject_thread_id === F8_THREAD_TRACKABLE))

  const f8Explained = Boolean(f8PointCbo) && Boolean(f8PointTrackable) && f8CboRow?.tracked_point_id === F8_POINT_CBO
  console.log(
    'F8 expliqué par IDs réels — les deux Points témoins existent, matérialisés exactement comme planifié, backref CBO posé :',
    f8Explained,
  )
  if (!f8Explained) {
    console.log('ÉCART NON EXPLIQUÉ — voir f8PointCbo/f8PointTrackable/f8CboRow/f8MemberRows ci-dessus pour localiser où la chaîne s\'interrompt.')
  }

  // ── (a) VÉRITÉ MÉTIER — étalons nommés (labels légitimes, PAS F8 — codename, jamais un label) ──
  const etalons: { name: string; matcher: (label: string) => boolean }[] = [
    { name: 'RIA', matcher: (l) => /\bRIA\b/i.test(l) },
    { name: 'CTA', matcher: (l) => /\bCTA\b/i.test(l) },
    { name: 'Extincteurs', matcher: (l) => /extincteur/i.test(l) },
    { name: 'Compartimentage', matcher: (l) => /compartimentage|calfeutrement|porte CF/i.test(l) },
  ]

  console.log('\n=== (a) VÉRITÉ MÉTIER — étalons nommés (derivedState maintenant fondé sur le reducer CBO réel) ===')
  for (const et of etalons) {
    const matches = entries.filter((e) => et.matcher(e.label))
    console.log(`\n--- ${et.name} : ${matches.length} point(s) ---`)
    for (const m of matches) {
      console.log({
        id: m.id,
        label: m.label,
        identityStatus: m.identityStatus,
        foundingKind: m.foundingKind,
        cboIds: m.cboIds,
        derivedState: m.derivedState,
        hardMemberThreadIds: m.hardMemberThreadIds.length,
        hasDocumentaryDivergence: m.hasDocumentaryDivergence,
        hasConflict: m.hasConflict,
      })
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
