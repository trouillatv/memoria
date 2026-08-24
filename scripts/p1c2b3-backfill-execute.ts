// P1-C2B.3 — Phase B : EXÉCUTION RÉELLE du backfill historique CBO.
//
// Écrit en base (canonical_business_object + canonical_business_object_member).
// GO conditionnel de Vincent (2026-08-24), déclenché une fois les 2 gates durcis
// (chunking + winner resolver Gate 1, reroutage SQL migration 348 Gate 2) et le
// preview court confirmé PASS (memberships=23, 2 entités Gate 1 réconciliées, 0 stale).
//
// Ne reproduit PAS littéralement p1c2b3-dryrun-records.json (calculé AVANT le fix
// Gate 1 — sa baseline "0 déjà membre" était fausse, donc une partie de ses "187
// éligibles" étaient en réalité déjà membres). À la place : rejoue le même calcul
// d'éligibilité (sujet résolu, colonne directe > chaîne historique) sur l'état
// actuel de la base, puis appelle pour de vrai attachToCanonicalBusinessObject()
// — le même point d'entrée live que P1-C2B.2, déjà durci Gate 1 + Gate 2 — pour
// chaque objet. attachToCanonicalBusinessObject revérifie l'appartenance existante
// juste avant d'écrire (idempotent, contrainte UNIQUE mig 302) : un objet déjà
// membre réel est automatiquement sauté (reason=already_member), aucune écriture
// invalide possible. Le regroupement (buckets sujet×type, ordre date/entityId) est
// répliqué à l'identique du dry-run pour que les décisions du resolver LLM portent
// sur les mêmes pools de candidats.
//
// Usage : npx tsx scripts/p1c2b3-backfill-execute.ts

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'
import {
  attachToCanonicalBusinessObject,
  type AttachOutcome,
} from '../lib/db/canonical-business-object-attach'
import { fetchCboMemberships } from '../lib/knowledge/canonical-business-object-projection'
import type { CanonicalBusinessObjectEntityType } from '../lib/db/canonical-business-object-resolve'

const ENTITY_TYPES: CanonicalBusinessObjectEntityType[] = ['site_action', 'site_reserve', 'site_deadline']

type PhysicalRow = {
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  label: string
  date: string | null
  siteId: string
  directSubjectId: string | null
}

type ExecutedOutcome = {
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  label: string
  canonicalSubjectId: string
  outcome: AttachOutcome
}

function log(msg: string) {
  console.log(msg)
}

async function main() {
  const sb = createAdminClient()
  const out: string[] = []
  const record = (m: string) => { out.push(m); log(m) }

  record('=== P1-C2B.3 Phase B — EXÉCUTION RÉELLE du backfill CBO (ÉCRITURE) ===\n')

  // ── Baseline "avant" (mêmes requêtes que le preview / dry-run) ────────────
  const [{ data: actions }, { data: reserves }, { data: deadlines }] = await Promise.all([
    sb.from('site_actions').select('id, title, due_date, site_id, canonical_subject_id'),
    sb.from('site_reserve').select('id, label, issued_on, site_id, canonical_subject_id'),
    sb.from('site_deadlines').select('id, title, due_date, site_id, canonical_subject_id'),
  ])

  const physicalRows: PhysicalRow[] = [
    ...((actions ?? []) as Array<{ id: string; title: string | null; due_date: string | null; site_id: string; canonical_subject_id: string | null }>).map((r) => ({
      entityType: 'site_action' as const, entityId: r.id, label: r.title ?? '', date: r.due_date, siteId: r.site_id, directSubjectId: r.canonical_subject_id,
    })),
    ...((reserves ?? []) as Array<{ id: string; label: string | null; issued_on: string | null; site_id: string; canonical_subject_id: string | null }>).map((r) => ({
      entityType: 'site_reserve' as const, entityId: r.id, label: r.label ?? '', date: r.issued_on, siteId: r.site_id, directSubjectId: r.canonical_subject_id,
    })),
    ...((deadlines ?? []) as Array<{ id: string; title: string | null; due_date: string | null; site_id: string; canonical_subject_id: string | null }>).map((r) => ({
      entityType: 'site_deadline' as const, entityId: r.id, label: r.title ?? '', date: r.due_date, siteId: r.site_id, directSubjectId: r.canonical_subject_id,
    })),
  ]
  record(`physicalCount avant : ${physicalRows.length}`)

  const membershipBefore = await fetchCboMemberships(physicalRows.map((r) => r.entityId))
  record(`memberships avant   : ${membershipBefore.size}`)

  // ── Chaîne historique inversée (entité → sujet), identique au dry-run ─────
  const { data: mats } = await sb
    .from('document_proposal_materialization')
    .select('proposal_id, target_entity_type, target_entity_id')
    .in('target_entity_type', ENTITY_TYPES)
  const proposalIds = [...new Set((mats ?? []).map((m) => m.proposal_id as string))]

  const { data: proposals } = proposalIds.length
    ? await sb.from('document_extraction_proposal').select('id, subject_thread_id').in('id', proposalIds)
    : { data: [] as { id: string; subject_thread_id: string | null }[] }
  const subjectThreadByProposalId = new Map((proposals ?? []).map((p) => [p.id as string, p.subject_thread_id as string | null]))

  const threadIds = [...new Set((proposals ?? []).map((p) => p.subject_thread_id).filter((id): id is string => Boolean(id)))]
  const { data: identities } = threadIds.length
    ? await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').in('subject_thread_id', threadIds)
    : { data: [] as { subject_thread_id: string; canonical_subject_id: string }[] }
  const subjectByThreadId = new Map((identities ?? []).map((i) => [i.subject_thread_id as string, i.canonical_subject_id as string]))

  const historicalSubjectByEntity = new Map<string, string>()
  for (const m of mats ?? []) {
    const threadId = subjectThreadByProposalId.get(m.proposal_id as string)
    if (!threadId) continue
    const subjectId = subjectByThreadId.get(threadId)
    if (!subjectId) continue
    historicalSubjectByEntity.set(`${m.target_entity_type}:${m.target_entity_id}`, subjectId)
  }

  function resolveSubjectId(row: PhysicalRow): string | null {
    if (row.directSubjectId) return row.directSubjectId
    return historicalSubjectByEntity.get(`${row.entityType}:${row.entityId}`) ?? null
  }

  const rowsWithSubject = physicalRows.filter((r) => resolveSubjectId(r) !== null)
  record(`objets avec sujet canonique résolu (éligibles au traitement) : ${rowsWithSubject.length}`)
  record('(attachToCanonicalBusinessObject saute lui-même tout objet déjà réellement membre — idempotent)\n')

  // ── Buckets sujet×type, même tri que le dry-run (date asc, puis entityId) ─
  const buckets = new Map<string, PhysicalRow[]>()
  for (const row of rowsWithSubject) {
    const subjectId = resolveSubjectId(row)!
    const key = `${subjectId}::${row.entityType}`
    const list = buckets.get(key) ?? []
    list.push(row)
    buckets.set(key, list)
  }
  record(`Buckets (sujet × type) à traiter : ${buckets.size}`)

  const executed: ExecutedOutcome[] = []

  async function processBucket(subjectId: string, entityType: CanonicalBusinessObjectEntityType, members: PhysicalRow[]) {
    const ordered = [...members].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.entityId.localeCompare(b.entityId))
    for (const row of ordered) {
      const outcome = await attachToCanonicalBusinessObject({
        siteId: row.siteId,
        canonicalSubjectId: subjectId,
        entityType,
        entityId: row.entityId,
        label: row.label,
        date: row.date,
      })
      executed.push({ entityType, entityId: row.entityId, label: row.label, canonicalSubjectId: subjectId, outcome })
    }
  }

  async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0
    async function worker() {
      while (cursor < items.length) {
        const i = cursor++
        await fn(items[i])
      }
    }
    await Promise.all(Array.from({ length: limit }, worker))
  }

  const bucketEntries = [...buckets.entries()]
  let done = 0
  await mapWithConcurrency(bucketEntries, 4, async ([key, members]) => {
    const [subjectId, entityType] = key.split('::') as [string, CanonicalBusinessObjectEntityType]
    await processBucket(subjectId, entityType, members)
    done++
    if (done % 10 === 0) console.error(`  ... buckets ${done}/${bucketEntries.length}`)
  })

  // ── Résumé des outcomes ────────────────────────────────────────────────────
  const byKind = new Map<string, number>()
  const byReason = new Map<string, number>()
  for (const e of executed) {
    byKind.set(e.outcome.kind, (byKind.get(e.outcome.kind) ?? 0) + 1)
    if (e.outcome.kind === 'skipped') byReason.set(e.outcome.reason, (byReason.get(e.outcome.reason) ?? 0) + 1)
  }
  record('\n' + '─'.repeat(78))
  record('RÉSULTAT DE L\'EXÉCUTION')
  record('─'.repeat(78))
  record(`Objets traités                    : ${executed.length}`)
  for (const [kind, n] of byKind) record(`  ${kind.padEnd(20)} : ${n}`)
  if (byReason.size > 0) {
    record('  détail skipped :')
    for (const [reason, n] of byReason) record(`    ${reason.padEnd(24)} : ${n}`)
  }

  const uncertainCreations = executed.filter((e) => e.outcome.kind === 'created_new' && e.outcome.decision === 'UNCERTAIN')
  record(`\nCréations issues d'une décision UNCERTAIN : ${uncertainCreations.length}`)

  // ── Contrôles de sortie obligatoires (mandat Vincent) ──────────────────────
  record('\n' + '─'.repeat(78))
  record('CONTRÔLES DE SORTIE')
  record('─'.repeat(78))

  const membershipAfter = await fetchCboMemberships(physicalRows.map((r) => r.entityId))
  record(`memberships avant → après : ${membershipBefore.size} → ${membershipAfter.size}`)

  // 0 double-appartenance : compte par (type, entity_id) dans canonical_business_object_member.
  const { data: allMembers } = await sb
    .from('canonical_business_object_member')
    .select('member_entity_type, member_entity_id')
  const dupCounts = new Map<string, number>()
  for (const m of (allMembers ?? []) as Array<{ member_entity_type: string; member_entity_id: string }>) {
    const key = `${m.member_entity_type}:${m.member_entity_id}`
    dupCounts.set(key, (dupCounts.get(key) ?? 0) + 1)
  }
  const doubles = [...dupCounts.entries()].filter(([, n]) => n > 1)
  record(`Double-appartenance (member_entity_type+id en >1 CBO) : ${doubles.length} (attendu 0)`)
  for (const [key, n] of doubles) record(`  [FAIL] ${key} → ${n} CBO`)

  // 0 CBO pointant vers un canonical_subject fusionné (stale).
  const { data: cbos } = await sb.from('canonical_business_object').select('id, label, canonical_subject_id')
  const cboRows = (cbos ?? []) as Array<{ id: string; label: string; canonical_subject_id: string | null }>
  const subjectIds = [...new Set(cboRows.map((c) => c.canonical_subject_id).filter((id): id is string => Boolean(id)))]
  const { data: subjects } = subjectIds.length
    ? await sb.from('canonical_subject').select('id, status, merged_into').in('id', subjectIds)
    : { data: [] as Array<{ id: string; status: string; merged_into: string | null }> }
  const subjectById = new Map((subjects ?? []).map((s) => [s.id as string, s as { id: string; status: string; merged_into: string | null }]))
  const staleCbos = cboRows.filter((c) => c.canonical_subject_id && subjectById.get(c.canonical_subject_id)?.status === 'merged')
  record(`CBO pointant vers un sujet fusionné (stale)            : ${staleCbos.length} (attendu 0)`)
  for (const c of staleCbos) record(`  [FAIL] ${c.id} "${c.label}" -> ${c.canonical_subject_id}`)

  // 0 UNCERTAIN groupé (chaque CBO créé sur décision UNCERTAIN doit avoir exactement 1 membre).
  let uncertainGrouped = 0
  for (const e of uncertainCreations) {
    if (e.outcome.kind !== 'created_new') continue
    const { count } = await sb
      .from('canonical_business_object_member')
      .select('id', { count: 'exact', head: true })
      .eq('canonical_business_object_id', e.outcome.canonicalBusinessObjectId)
    if ((count ?? 0) > 1) {
      uncertainGrouped++
      record(`  [FAIL] CBO UNCERTAIN ${e.outcome.canonicalBusinessObjectId} a ${count} membres (attendu 1)`)
    }
  }
  record(`UNCERTAIN groupé (>1 membre)                           : ${uncertainGrouped} (attendu 0)`)

  // 502 → projectedCount réel après (comparaison avec le 424 théorique du dry-run).
  const { count: totalCboCount } = await sb.from('canonical_business_object').select('id', { count: 'exact', head: true })
  const noSubjectCount = physicalRows.length - rowsWithSubject.length
  const projectedCountReal = (totalCboCount ?? 0) + noSubjectCount
  record(`\nphysicalCount avant                     : ${physicalRows.length}`)
  record(`projectedCount réel après (CBO distincts + sans sujet) : ${projectedCountReal}`)
  record(`projectedCount théorique du dry-run (avant durcissement) : 424`)
  if (projectedCountReal !== 424) {
    record(`ÉCART : ${projectedCountReal - 424} — attendu si le resolver LLM a pu trancher différemment sur un re-run, ou si des objets réellement déjà membres (23 vs 0 dans le dry-run bugué) ont réduit le nombre d'objets réellement traités.`)
  }

  const allChecksPass = doubles.length === 0 && staleCbos.length === 0 && uncertainGrouped === 0
  record('\n' + '─'.repeat(78))
  record('VERDICT')
  record('─'.repeat(78))
  record(allChecksPass ? 'PASS — tous les contrôles de sortie obligatoires sont au vert.' : 'FAIL — au moins un contrôle de sortie a échoué, cf. détail ci-dessus.')

  writeFileSync('p1c2b3-backfill-execute-out.txt', out.join('\n'), 'utf-8')
  writeFileSync('p1c2b3-backfill-execute-records.json', JSON.stringify({ executed }, null, 2), 'utf-8')
  console.log('\n[dump] p1c2b3-backfill-execute-out.txt + p1c2b3-backfill-execute-records.json écrits')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
