/**
 * Refresh guardé, thread par thread, des 6 threads PV6 restants avec perte réelle de
 * candidats (08/06/2026, document d95a8808-b98c-4fa5-bb8e-d00383b99a0c). Round 2 de ce
 * script, réécrit suite à l'incident du Round 1 (voir _pv6-13-refresh-out.txt) :
 *
 *   BUG IDENTIFIÉ (confirmé au niveau code, migration 411 CREATE_CANDIDATES = purement
 *   additive avec garde de dédoublonnage par clé métier) : le Round 1 supprimait les
 *   anciens candidats pending par ID PHYSIQUE de ligne (`oldPendingCandidateIds`), sans
 *   jamais comparer `candidate_point_id`. Sur 13 threads, 7 threads / 28 lignes = nettoyage
 *   légitime (0 candidat recalculé, aucun appel LLM) ; 6 threads / 34 lignes = perte réelle
 *   (juge LLM indisponible HTTP 402 → AMBIGUOUS jamais tranché → UNCERTAIN conservé côté
 *   moteur, mais le RPC n'insère 0 nouvelle ligne quand l'ensemble recalculé == l'ensemble
 *   déjà pending → le script Round 1, aveugle à candidate_point_id, supprimait quand même).
 *
 *   Mandat Vincent (GO — FIX script refresh uniquement) :
 *   - Clé d'identité = thread_id + candidate_point_id, JAMAIS l'id physique de ligne.
 *   - à supprimer = OLD − NEW ; à conserver = OLD ∩ NEW ; à ajouter = NEW − OLD (le RPC
 *     gère déjà l'ajout via sa garde NOT EXISTS, purement informatif ici).
 *   - Ne jamais supprimer un candidat encore présent dans NEW, y compris si le RPC n'a
 *     inséré aucune nouvelle ligne (business key déjà existante).
 *   - Garde-fous explicites AVANT toute suppression : calculer NEW, logger OLD/NEW/diff,
 *     vérifier la cohérence avec verdict/write_pattern renvoyé, supprimer seulement ensuite.
 *   - Si write_pattern=CREATE_CANDIDATES mais NEW vide (ou incohérence inverse) → HARD STOP
 *     sur CE thread, aucun prune effectué, les autres threads continuent.
 *   - Juge LLM indisponible → logger explicitement "judge unavailable", jamais une
 *     autorisation de suppression d'un candidat encore présent dans NEW.
 *   - Mode --dry-run obligatoire, exécuté avant toute écriture réelle.
 *   - Ne PAS toucher aux 7 threads déjà à 0 candidat (nettoyage Round 1 confirmé correct) :
 *     absents de ce script (cf. ALREADY_CLEAN_THREAD_IDS_DO_NOT_TOUCH ci-dessous, pour
 *     mémoire uniquement).
 *
 * Calcul de NEW en dry-run — ZÉRO écriture DB, y compris aucune suppression de
 * tracked_point_reconcile_state : on rejoue exactement le calcul TS pur que la RPC reçoit
 * en entrée (p_cross_thread_candidate_point_ids), sans jamais appeler la RPC elle-même.
 * Chaîne réutilisée telle quelle (aucune nouvelle logique de décision) :
 *   loadThreadsFoundingInput → buildUnitContext → isTrackableEligible → loadSitePointCandidates
 *   → crossThreadConcurrentPointIds (avec juge instrumenté, lecture réseau seule, aucune
 *     écriture DB).
 * Les 3 fonctions buildUnitContext/loadSitePointCandidates/isTrackableEligible ont été
 * rendues exportées dans lib/db/tracked-point-live-writer-historical-adapter.ts (export de
 * visibilité uniquement, aucun changement de logique) pour permettre cette simulation sans
 * dupliquer leur code dans ce script.
 *
 * En mode --execute (NON utilisé dans ce tour — mandat Vincent : aucune écriture DB cette
 * fois), le script réalise la séquence guardée réelle (delete reconcile_state → replay via
 * reconcileFoundingUnits → vérification write_pattern/NEW → suppression OLD−NEW revérifiée
 * pending au moment du delete).
 *
 * Usage :
 *   npx tsx _pv6-13-refresh-guarded.ts               (dry-run, défaut, zéro écriture)
 *   npx tsx _pv6-13-refresh-guarded.ts --execute      (écriture réelle — PAS utilisé ce tour)
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

import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadThreadsFoundingInput,
  reconcileFoundingUnits,
  buildUnitContext,
  loadSitePointCandidates,
  isTrackableEligible,
} from '@/lib/db/tracked-point-live-writer-historical-adapter'
import { crossThreadConcurrentPointIds } from '@/lib/knowledge/tracked-point-write-plan'
import { trackedPointIdentityJudge } from '@/lib/ai/tracked-point-identity-judge'
import type { IdentityJudge } from '@/lib/knowledge/tracked-point-identity-widening'

const SITE_ID = 'e4936823-3d40-4a5d-ab41-ef0509ff3e4c'
const DOCUMENT_ID = 'd95a8808-b98c-4fa5-bb8e-d00383b99a0c'

// Pour mémoire uniquement — NE PAS INCLURE dans THREAD_IDS, ne jamais traiter dans ce script.
// Round 1 confirmé correct : 0 candidat recalculé, aucun appel LLM, suppression légitime.
const ALREADY_CLEAN_THREAD_IDS_DO_NOT_TOUCH = [
  '08573d31-0d2f-4a11-9663-0ebfa61e738a',
  '7bdc0af7-eca4-46ad-b497-4d4f494962fa',
  '5ddbbd12-34bf-449d-8eb3-7433a45ded35',
  'c424a59e-6a64-4a25-898b-1f64f17acfa8',
  'eacd0e1a-c82c-40af-b0be-b615164a748b',
  '1f49cfa7-cfb0-4cee-ad1b-3e5ee319f0b5',
  'bbd0929b-524c-4dcf-b25d-e7758dba53c9',
]
void ALREADY_CLEAN_THREAD_IDS_DO_NOT_TOUCH

// Les 6 threads avec perte réelle (34 lignes) — seuls threads traités par ce script.
const THREAD_IDS = [
  'a6f78193-839f-4dd9-9f28-fd58d3519cef',
  '28167fc0-c08f-4efb-9891-2179e72c1240',
  '4c89a13e-f6ac-438b-83cc-7893d881e2ec',
  'df3a4f9a-a554-4b62-9517-b96629396f4a',
  '8bae3ea7-46c2-4788-8cfe-fa1243b95878',
  '0c972828-f0fb-43e5-a54d-ec6e75da445a',
]

const EXECUTE = process.argv.includes('--execute')

type JudgeCallLog = {
  candidatePointId: string
  called: true
  judgeUnavailable: boolean
  verdict: string | null
  reasoning: string | null
}

type ThreadReport = {
  threadId: string
  mode: 'DRY_RUN' | 'EXECUTE'
  status:
    | 'COMPUTED'
    | 'PROCESSED'
    | 'SKIPPED_HUMAN_DECISION_DETECTED'
    | 'SKIPPED_TRACE_NOT_PENDING'
    | 'SKIPPED_NO_UNIT_LOADED'
    | 'HARD_STOP_VERDICT_NEW_MISMATCH'
  guardCandidateStatuses?: string[]
  guardTraceStatus?: string | null
  old: string[]
  new: string[]
  kept: string[]
  toDelete: string[]
  toAdd: string[]
  judgeCalled: boolean
  judgeCalls: JudgeCallLog[]
  postReconcileState?: { verdict: string; write_pattern: string; target_point_id: string | null } | null
  staleCandidatesDeleted?: number
}

async function computeOldAndGuard(db: ReturnType<typeof createAdminClient>, threadId: string) {
  const { data: traceRows } = await db
    .from('tracked_point_pending_trace')
    .select('id, status, kind')
    .eq('source_thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(1)
  const trace = (traceRows ?? [])[0] as { id: string; status: string; kind: string } | undefined

  const { data: candRows } = await db
    .from('tracked_point_identity_candidate')
    .select('id, candidate_point_id, status')
    .eq('subject_thread_id', threadId)
  const candidates = (candRows ?? []) as Array<{ id: string; candidate_point_id: string; status: string }>
  const nonPending = candidates.filter((c) => c.status !== 'pending')

  return { trace, candidates, nonPending }
}

// Simule p_cross_thread_candidate_point_ids EXACTEMENT comme reconcileTrackedPointUnit
// (lib/db/tracked-point-live-writer.ts:166) le calculerait, sans jamais appeler la RPC ni
// écrire en base — lecture pure + appel réseau juge LLM instrumenté.
async function computeNewCandidateSet(
  db: ReturnType<typeof createAdminClient>,
  threadId: string,
  judgeCalls: JudgeCallLog[],
): Promise<{ ok: true; newIds: string[] } | { ok: false }> {
  const loaded = await loadThreadsFoundingInput(db, SITE_ID, [threadId])
  if (!loaded) return { ok: false }
  const unit = loaded.units.find((u) => u.threadId === threadId)
  if (!unit) return { ok: false }

  const ctx = await buildUnitContext(unit, loaded.cboLabelById, loaded.cboSubjectRootById, loaded.threadSubjectRootById, loaded.resolver)
  const needsSitePoints = isTrackableEligible(unit)
  const sitePoints = needsSitePoints ? await loadSitePointCandidates(db, SITE_ID, loaded.resolver) : []

  const instrumentedJudge: IdentityJudge = async (candidate, point, candidateSig, pointSig) => {
    const verdict = await trackedPointIdentityJudge(candidate, point, candidateSig, pointSig)
    judgeCalls.push({
      candidatePointId: point.pointId,
      called: true,
      judgeUnavailable: verdict === null,
      verdict: verdict?.decision ?? null,
      reasoning: verdict?.reasoning ?? null,
    })
    return verdict
  }

  const newIds = needsSitePoints
    ? await crossThreadConcurrentPointIds(unit, sitePoints, ctx, { identityJudge: instrumentedJudge })
    : []
  return { ok: true, newIds }
}

function setDiff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort()
}
function setIntersect(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => b.has(x)).sort()
}

async function main() {
  const db = createAdminClient()
  const reports: ThreadReport[] = []

  console.log(EXECUTE ? '=== MODE EXECUTE — écritures réelles activées ===' : '=== MODE DRY-RUN — aucune écriture DB (défaut, passer --execute pour écrire) ===')

  for (const threadId of THREAD_IDS) {
    console.log(`\n--- Thread ${threadId} (${EXECUTE ? 'EXECUTE' : 'DRY_RUN'}) ---`)

    const { trace, candidates, nonPending } = await computeOldAndGuard(db, threadId)

    if (!trace || trace.status !== 'pending') {
      console.log(`  SKIP — trace non pending (status=${trace?.status ?? 'absente'})`)
      reports.push({
        threadId, mode: EXECUTE ? 'EXECUTE' : 'DRY_RUN', status: 'SKIPPED_TRACE_NOT_PENDING',
        guardTraceStatus: trace?.status ?? null,
        old: [], new: [], kept: [], toDelete: [], toAdd: [], judgeCalled: false, judgeCalls: [],
      })
      continue
    }
    if (nonPending.length > 0) {
      console.log(`  SKIP — décision humaine détectée sur ${nonPending.length} candidat(s) (${nonPending.map((c) => c.status).join(',')})`)
      reports.push({
        threadId, mode: EXECUTE ? 'EXECUTE' : 'DRY_RUN', status: 'SKIPPED_HUMAN_DECISION_DETECTED',
        guardCandidateStatuses: nonPending.map((c) => c.status),
        old: [], new: [], kept: [], toDelete: [], toAdd: [], judgeCalled: false, judgeCalls: [],
      })
      continue
    }

    const oldSet = new Set(candidates.map((c) => c.candidate_point_id))
    console.log(`  OLD (${oldSet.size}): ${[...oldSet].join(', ') || '(vide)'}`)

    const judgeCalls: JudgeCallLog[] = []

    if (!EXECUTE) {
      // Dry-run : calcul pur de NEW, aucune écriture, y compris aucune suppression de
      // tracked_point_reconcile_state.
      const computed = await computeNewCandidateSet(db, threadId, judgeCalls)
      if (!computed.ok) {
        console.log('  SKIP — aucune unité chargée pour ce thread (loadThreadsFoundingInput)')
        reports.push({
          threadId, mode: 'DRY_RUN', status: 'SKIPPED_NO_UNIT_LOADED',
          old: [...oldSet].sort(), new: [], kept: [], toDelete: [], toAdd: [], judgeCalled: false, judgeCalls: [],
        })
        continue
      }
      const newSet = new Set(computed.newIds)
      const kept = setIntersect(oldSet, newSet)
      const toDelete = setDiff(oldSet, newSet)
      const toAdd = setDiff(newSet, oldSet)

      console.log(`  NEW (${newSet.size}): ${[...newSet].join(', ') || '(vide)'}`)
      console.log(`  KEPT (${kept.length}): ${kept.join(', ') || '(vide)'}`)
      console.log(`  TO_DELETE = OLD − NEW (${toDelete.length}): ${toDelete.join(', ') || '(vide)'}`)
      console.log(`  TO_ADD = NEW − OLD, informatif — le RPC dédoublonne déjà (${toAdd.length}): ${toAdd.join(', ') || '(vide)'}`)

      if (judgeCalls.length === 0) {
        console.log('  [JUDGE] non appelé (aucune paire AMBIGUOUS après signature déterministe)')
      } else {
        const unavailable = judgeCalls.filter((j) => j.judgeUnavailable)
        if (unavailable.length > 0) {
          console.log(`  [JUDGE] indisponible pour ${unavailable.length}/${judgeCalls.length} paire(s) — candidats concernés restent dans NEW par construction (UNCERTAIN), jamais supprimés pour cette raison.`)
        }
        for (const j of judgeCalls) {
          console.log(`  [JUDGE] point=${j.candidatePointId} appelé=oui verdict=${j.verdict ?? 'null (indisponible)'} reasoning=${j.reasoning ?? '(n/a)'}`)
        }
      }

      reports.push({
        threadId, mode: 'DRY_RUN', status: 'COMPUTED',
        old: [...oldSet].sort(), new: [...newSet].sort(), kept, toDelete, toAdd,
        judgeCalled: judgeCalls.length > 0, judgeCalls,
      })
      continue
    }

    // ── Mode EXECUTE — NON utilisé dans ce tour (mandat Vincent : aucune écriture DB). ──────
    const { data: deletedState, error: delStateErr } = await db
      .from('tracked_point_reconcile_state')
      .delete()
      .eq('site_id', SITE_ID)
      .eq('unit_key', threadId)
      .select('unit_key')
    if (delStateErr) throw new Error(`delete reconcile_state ${threadId}: ${delStateErr.message}`)
    console.log(`  reconcile_state supprimé: ${(deletedState ?? []).length} ligne(s)`)

    const loaded = await loadThreadsFoundingInput(db, SITE_ID, [threadId])
    if (!loaded) throw new Error(`loadThreadsFoundingInput a retourné null pour ${threadId}`)
    const result = await reconcileFoundingUnits(db, SITE_ID, loaded, 'historical_pdf', DOCUMENT_ID)
    console.log(`  replay: ${JSON.stringify(result.verdictCounts)} refusals=${result.refusals}`)

    const { data: newStateRows } = await db
      .from('tracked_point_reconcile_state')
      .select('verdict, write_pattern, target_point_id')
      .eq('site_id', SITE_ID)
      .eq('unit_key', threadId)
      .maybeSingle()
    const postState = (newStateRows ?? null) as { verdict: string; write_pattern: string; target_point_id: string | null } | null

    const { data: newCandRows } = await db
      .from('tracked_point_identity_candidate')
      .select('id, candidate_point_id, status')
      .eq('subject_thread_id', threadId)
      .eq('status', 'pending')
    const newCandidates = (newCandRows ?? []) as Array<{ id: string; candidate_point_id: string; status: string }>
    const newSet = new Set(newCandidates.map((c) => c.candidate_point_id))

    const kept = setIntersect(oldSet, newSet)
    const toDelete = setDiff(oldSet, newSet)
    const toAdd = setDiff(newSet, oldSet)
    console.log(`  NEW post-replay (${newSet.size}): ${[...newSet].join(', ') || '(vide)'}`)
    console.log(`  KEPT (${kept.length}) / TO_DELETE (${toDelete.length}) / TO_ADD (${toAdd.length})`)

    // Garde de cohérence write_pattern vs NEW — HARD STOP sur ce thread si incohérent.
    const writePattern = postState?.write_pattern ?? null
    const mismatch =
      (writePattern === 'CREATE_CANDIDATES' && newSet.size === 0) ||
      (writePattern !== 'CREATE_CANDIDATES' && newSet.size > 0)
    if (mismatch) {
      console.log(`  HARD STOP — incohérence write_pattern=${writePattern} vs NEW.size=${newSet.size} : AUCUN prune effectué sur ce thread.`)
      reports.push({
        threadId, mode: 'EXECUTE', status: 'HARD_STOP_VERDICT_NEW_MISMATCH',
        old: [...oldSet].sort(), new: [...newSet].sort(), kept, toDelete, toAdd,
        judgeCalled: false, judgeCalls: [], postReconcileState: postState, staleCandidatesDeleted: 0,
      })
      continue
    }

    // Suppression = OLD − NEW uniquement, revérifiée pending au moment du delete, jamais par
    // id physique seul.
    let staleCandidatesDeleted = 0
    if (toDelete.length > 0) {
      const rowIdsToDelete = candidates.filter((c) => toDelete.includes(c.candidate_point_id)).map((c) => c.id)
      const { data: stillPendingOld } = await db
        .from('tracked_point_identity_candidate')
        .select('id, candidate_point_id')
        .in('id', rowIdsToDelete)
        .eq('status', 'pending')
      const idsToDelete = (stillPendingOld ?? [])
        .filter((r: { candidate_point_id: string }) => !newSet.has(r.candidate_point_id))
        .map((r: { id: string }) => r.id)
      if (idsToDelete.length > 0) {
        const { data: deletedCand, error: delCandErr } = await db
          .from('tracked_point_identity_candidate')
          .delete()
          .in('id', idsToDelete)
          .eq('status', 'pending')
          .select('id')
        if (delCandErr) throw new Error(`delete stale candidates ${threadId}: ${delCandErr.message}`)
        staleCandidatesDeleted = (deletedCand ?? []).length
      }
    }
    console.log(`  candidats OLD−NEW supprimés: ${staleCandidatesDeleted}/${toDelete.length}`)

    reports.push({
      threadId, mode: 'EXECUTE', status: 'PROCESSED',
      old: [...oldSet].sort(), new: [...newSet].sort(), kept, toDelete, toAdd,
      judgeCalled: false, judgeCalls: [], postReconcileState: postState, staleCandidatesDeleted,
    })
  }

  console.log('\n\n=== RAPPORT FINAL — 6 threads ===')
  console.log(JSON.stringify(reports, null, 2))
}

main().catch((e) => {
  console.error('ERREUR FATALE:', e)
  process.exit(1)
})
