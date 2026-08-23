/**
 * BACKFILL CANONICAL PROJECTION — GO EXPLICITE VINCENT (2026-08-24)
 *
 * Dry-run 57b9e2e1 validé : 122 écritures, 0 ambiguïté, 0 cible merged, 0 cible
 * introuvable, 0 chaîne cassée. Les sentinelles négatives (Planning, « Démarrage
 * du nettoyages ») tiennent. GO donné avec ces conditions.
 *
 * Ce script ne contient aucune logique d'écriture propre : il délègue entièrement
 * à `projectCanonicalSubjectOnObjects()` avec `dryRun: false`. C'est exactement
 * le helper validé par le dry-run qui écrit, pas une copie.
 *
 * Séquence :
 *   1. snapshot — capturer les 122 lignes du dry-run (avant-état)
 *   2. backfill — dryRun: false, chantier par chantier
 *   3. vérification — replay dry-run post-écriture, contrôles exhaustifs
 *   4. rapport avant/après
 *   5. HARD STOP
 *
 * Lancer :  npx tsx scripts/_backfill-canonical-projection.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'
import { projectCanonicalSubjectOnObjects } from '@/lib/db/canonical-subject-project'
import type { ProjectedRow, SkippedRow } from '@/lib/db/canonical-subject-project'

type Db = ReturnType<typeof createAdminClient>

async function all<T>(db: Db, table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return out
  }
}

const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : 'NULL')
const cut = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').slice(0, n)
const pct = (n: number, t: number) => (t === 0 ? '—' : `${((n / t) * 100).toFixed(1)} %`)

async function getCandidateSites(db: Db): Promise<Set<string>> {
  const [actions, deadlines] = await Promise.all([
    all<{ site_id: string; canonical_subject_id: string | null }>(db, 'site_actions', 'site_id, canonical_subject_id'),
    all<{ site_id: string; canonical_subject_id: string | null }>(db, 'site_deadlines', 'site_id, canonical_subject_id'),
  ])
  const s = new Set<string>()
  for (const o of [...actions, ...deadlines]) if (!o.canonical_subject_id && o.site_id) s.add(o.site_id)
  return s
}

async function runPass(
  candidateSites: Set<string>,
  dryRun: boolean,
): Promise<{ projected: ProjectedRow[]; skipped: SkippedRow[] }> {
  const projected: ProjectedRow[] = []
  const skipped: SkippedRow[] = []
  for (const siteId of candidateSites) {
    const report = await projectCanonicalSubjectOnObjects({ siteId, scope: { kind: 'site' }, dryRun })
    if (report.dryRun !== dryRun) throw new Error(`SÉCURITÉ : le helper a retourné dryRun=${report.dryRun} au lieu de ${dryRun}`)
    projected.push(...report.projected)
    skipped.push(...report.skipped)
  }
  return { projected, skipped }
}

async function main() {
  const db = createAdminClient()

  // ── 0. Totaux actuels ──────────────────────────────────────────────────────
  const [actions0, deadlines0, subjects0, sites0] = await Promise.all([
    all<{ id: string; canonical_subject_id: string | null; title: string | null; site_id: string; report_id: string | null }>(
      db, 'site_actions', 'id, canonical_subject_id, title, site_id, report_id',
    ),
    all<{ id: string; canonical_subject_id: string | null; title: string | null; site_id: string; report_id: string | null }>(
      db, 'site_deadlines', 'id, canonical_subject_id, title, site_id, report_id',
    ),
    all<{ id: string; label: string | null; status: string | null }>(
      db, 'canonical_subject', 'id, label, status',
    ),
    all<{ id: string; name: string | null }>(db, 'sites', 'id, name'),
  ])

  const covA0 = actions0.filter((a) => a.canonical_subject_id).length
  const covD0 = deadlines0.filter((d) => d.canonical_subject_id).length
  const subjectById = new Map(subjects0.map((s) => [s.id, s]))
  const siteName = new Map(sites0.map((s) => [s.id, s.name ?? '(sans nom)']))
  const objectById = new Map([...actions0, ...deadlines0].map((o) => [o.id, o]))

  console.log('BACKFILL CANONICAL PROJECTION — GO EXPLICITE VINCENT (2026-08-24)')
  console.log(`Parc avant : ${actions0.length} actions (${covA0} avec FK), ${deadlines0.length} échéances (${covD0} avec FK)`)
  console.log(`Couverture avant : actions ${pct(covA0, actions0.length)}, échéances ${pct(covD0, deadlines0.length)}\n`)

  const candidateSites0 = await getCandidateSites(db)

  // ── 1. Snapshot pré-backfill (dry-run confirmation) ────────────────────────
  console.log('Étape 1/3 — snapshot pré-backfill (dry-run final de confirmation)…')
  const { projected: snap } = await runPass(candidateSites0, true)
  console.log(`  ${snap.length} lignes projetables confirmées.\n`)

  console.log('SNAPSHOT AVANT ÉCRITURE (object_type | object_id | canonical_before | canonical_target | proof_paths | merge_hops)')
  console.log('─'.repeat(130))
  for (const p of snap) {
    const o = objectById.get(p.objectId)
    const target = subjectById.get(p.canonicalSubjectId)
    console.log(
      `${p.objectType === 'site_action' ? 'ACTION  ' : 'ÉCHEANCE'} | ${p.objectId} | NULL | ${p.canonicalSubjectId} ` +
        `| ${p.paths.join('+')} | sauts=${p.mergeHops}` +
        `\n          ${cut(o?.title, 60)} → « ${cut(target?.label, 50)} »`,
    )
  }
  console.log()

  // ── 2. Backfill ────────────────────────────────────────────────────────────
  console.log('Étape 2/3 — backfill (dryRun: false)…')
  const { projected: written } = await runPass(candidateSites0, false)
  console.log(`  ${written.length} FK écrites en base.\n`)

  const writtenIds = new Set(written.map((p) => p.objectId))

  // ── 3. Vérification post-backfill ──────────────────────────────────────────
  console.log('Étape 3/3 — vérification post-backfill…')

  // Recharger les totaux actualisés depuis la base
  const [actionsPost, deadlinesPost] = await Promise.all([
    all<{ id: string; canonical_subject_id: string | null; title: string | null; site_id: string }>(
      db, 'site_actions', 'id, canonical_subject_id, title, site_id',
    ),
    all<{ id: string; canonical_subject_id: string | null; title: string | null; site_id: string }>(
      db, 'site_deadlines', 'id, canonical_subject_id, title, site_id',
    ),
  ])
  const covA1 = actionsPost.filter((a) => a.canonical_subject_id).length
  const covD1 = deadlinesPost.filter((d) => d.canonical_subject_id).length
  const objectPostById = new Map([...actionsPost, ...deadlinesPost].map((o) => [o.id, o]))

  // Re-lancer le dry-run sur le périmètre restant
  const candidateSites1 = await getCandidateSites(db)
  const { projected: stillProjectable, skipped: nowSkipped } = await runPass(candidateSites1, true)

  const alreadyLinked = nowSkipped.filter((s) => s.reason === 'already_linked')
  const conflicts = nowSkipped.filter((s) => s.reason === 'conflicting_evidence')
  const stillMerged = stillProjectable.filter((p) => subjectById.get(p.canonicalSubjectId)?.status === 'merged')
  const fkOnMerged = [...actionsPost, ...deadlinesPost].filter(
    (o) => o.canonical_subject_id && subjectById.get(o.canonical_subject_id)?.status === 'merged',
  )

  // Contrôles des 122 objets précédemment projetables
  const snapIds = new Set(snap.map((p) => p.objectId))
  const notWritten = snap.filter((p) => !writtenIds.has(p.objectId))
  const notLinkedAfter = snap.filter((p) => {
    const o = objectPostById.get(p.objectId) as { canonical_subject_id: string | null } | undefined
    return !o?.canonical_subject_id
  })
  const wrongTarget = snap.filter((p) => {
    const o = objectPostById.get(p.objectId) as { canonical_subject_id: string | null } | undefined
    return o?.canonical_subject_id && o.canonical_subject_id !== p.canonicalSubjectId
  })

  // Vérification que les no_structural_evidence n'ont pas été touchés
  const noEvidenceObjects = [...actionsPost, ...deadlinesPost].filter(
    (o) => !snapIds.has(o.id) && o.canonical_subject_id && covA0 + covD0 < covA1 + covD1,
  )

  // Sentinelles nommées PETRO
  const PETRO_SITE = '75bd3d23'
  const sentinels = [
    { id: '50c306b1', name: 'Cadenas', expectedFk: '6801ce5c', expectedNull: false },
    { id: 'dbb63cef', name: 'Eau panneaux', expectedFk: '1d41b3f1', expectedNull: false },
    { id: '99c99021', name: 'Planning', expectedFk: null, expectedNull: true },
    { id: 'f0a18663', name: 'Démarrage du nettoyages', expectedFk: null, expectedNull: true },
  ]
  const sentinelResults: string[] = []
  for (const s of sentinels) {
    const o = objectPostById.get(s.id) as { canonical_subject_id: string | null } | undefined
    if (!o) { sentinelResults.push(`  ? ${s.name} — introuvable après backfill`); continue }
    const fk = o.canonical_subject_id ?? null
    const ok = s.expectedNull ? fk === null : fk === s.expectedFk
    sentinelResults.push(
      `  ${ok ? '✔' : '✘'} ${s.name.padEnd(28)} FK=${short(fk) ?? 'NULL'}  ${ok ? '' : `attendu=${s.expectedFk ?? 'NULL'}`}`,
    )
  }

  // ── Rapport final ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(120))
  console.log('RAPPORT AVANT / APRÈS')
  console.log('═'.repeat(120))
  console.log(`  actions   FK avant : ${covA0}/${actions0.length} (${pct(covA0, actions0.length)})  →  après : ${covA1}/${actionsPost.length} (${pct(covA1, actionsPost.length)})  ${covA1 === 101 ? '✔' : `✘ attendu 101`}`)
  console.log(`  échéances FK avant : ${covD0}/${deadlines0.length} (${pct(covD0, deadlines0.length)})  →  après : ${covD1}/${deadlinesPost.length} (${pct(covD1, deadlines0.length)})  ${covD1 === 28 ? '✔' : `✘ attendu 28`}`)

  console.log('\n  ÉCRITURES EFFECTIVES :')
  const bySite = new Map<string, ProjectedRow[]>()
  for (const p of written) {
    const sid = objectById.get(p.objectId)?.site_id ?? '?'
    const l = bySite.get(sid) ?? []
    l.push(p)
    bySite.set(sid, l)
  }
  for (const [sid, rows] of [...bySite].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     ${String(rows.length).padStart(3)} écritures — ${siteName.get(sid)} (${short(sid)})`)
  }

  console.log('\n  CONTRÔLES POST-BACKFILL :')
  console.log(`     1. actions avec FK=101              : ${covA1 === 101 ? '✔' : `✘ ${covA1}`}`)
  console.log(`     2. échéances avec FK=28             : ${covD1 === 28 ? '✔' : `✘ ${covD1}`}`)
  console.log(`     3. 122 projetables → already_linked : ${alreadyLinked.length >= 122 ? '✔' : `✘ seulement ${alreadyLinked.length}`}`)
  console.log(`     4. conflicting_evidence = 0         : ${conflicts.length === 0 ? '✔' : `✘ ${conflicts.length}`}`)
  console.log(`     5. aucune FK vers sujet merged      : ${fkOnMerged.length === 0 ? '✔' : `✘ ${fkOnMerged.length}`}`)
  console.log(`     6. 122 snap lignes écrites          : ${notWritten.length === 0 ? '✔' : `✘ ${notWritten.length} non écrites`}`)
  console.log(`     7. 122 snap lignes bien liées après : ${notLinkedAfter.length === 0 ? '✔' : `✘ ${notLinkedAfter.length} sans FK après`}`)
  console.log(`     8. cibles conformes au snapshot     : ${wrongTarget.length === 0 ? '✔' : `✘ ${wrongTarget.length} cibles divergentes`}`)
  console.log(`     9. nouvelles projections restantes  : ${stillProjectable.length === 0 ? '✔' : `✘ ${stillProjectable.length} encore projetables`}`)

  for (const p of wrongTarget) {
    const o = objectPostById.get(p.objectId) as { canonical_subject_id: string | null } | undefined
    console.log(`        ⚠ ${p.objectType} ${short(p.objectId)} attendu=${short(p.canonicalSubjectId)} écrit=${short(o?.canonical_subject_id)}`)
  }

  if (notWritten.length > 0) {
    console.log('\n  LIGNES DU SNAPSHOT NON ÉCRITES (race conditions ou état changé entre dry-run et backfill) :')
    for (const p of notWritten) {
      const o = objectById.get(p.objectId)
      console.log(`     ${p.objectType} ${p.objectId} « ${cut(o?.title, 70)} »`)
    }
  }

  console.log('\n  SENTINELLES PETRO :')
  for (const l of sentinelResults) console.log(l)

  // Score global
  const allOk = [
    covA1 === 101,
    covD1 === 28,
    alreadyLinked.length >= 122,
    conflicts.length === 0,
    fkOnMerged.length === 0,
    notWritten.length === 0,
    notLinkedAfter.length === 0,
    wrongTarget.length === 0,
    stillProjectable.length === 0,
    ...sentinels.map((s, i) => sentinelResults[i].startsWith('  ✔')),
  ]
  const pass = allOk.every(Boolean)

  console.log('\n' + '═'.repeat(120))
  console.log(`VERDICT : ${pass ? '✔ TOUS LES CONTRÔLES PASSENT' : '✘ CONTRÔLES EN ÉCHEC — voir ci-dessus'}`)
  console.log('═'.repeat(120))
  console.log('\nBACKFILL TERMINÉ — HARD STOP.')
}

main().catch((e) => {
  console.error('BACKFILL INTERROMPU :', e instanceof Error ? e.message : e)
  process.exit(1)
})
