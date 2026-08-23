/**
 * DRY-RUN EXHAUSTIF DE LA PROJECTION CANONIQUE — LECTURE SEULE.
 *
 * GO Vincent (2026-08-24) : « dry-run exhaustif uniquement, pas de backfill
 * encore ». Ce script n'écrit rien : il appelle le helper de production avec
 * `dryRun: true`, donc c'est bien LE code qui sera exécuté au backfill qui est
 * observé ici, et non une réimplémentation d'audit qui pourrait diverger.
 *
 * Il produit, pour chaque objet projetable :
 *   objet → sujet cible → chemin de preuve → winner final → nombre de sauts
 *
 * Et il recontrôle les deux invariants exigés :
 *   A. 0 ambiguïté          → aucun `conflicting_evidence`
 *   B. 0 cible encore merged → aucun winner dont le status est 'merged'
 *
 * Lancer :  npx tsx scripts/_dryrun-canonical-projection.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'
import { projectCanonicalSubjectOnObjects } from '@/lib/db/canonical-subject-project'
import type { ProjectedRow, SkippedRow } from '@/lib/db/canonical-subject-project'

type Db = ReturnType<typeof createAdminClient>

/** Le plafond Supabase est à 1000 lignes : sans pagination, sous-comptage silencieux. */
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

async function main() {
  const db = createAdminClient()

  const [actions, deadlines, subjects, sites] = await Promise.all([
    all<{ id: string; site_id: string; canonical_subject_id: string | null; title: string | null; report_id: string | null; created_from: string | null }>(
      db, 'site_actions', 'id, site_id, canonical_subject_id, title, report_id, created_from',
    ),
    all<{ id: string; site_id: string; canonical_subject_id: string | null; title: string | null; report_id: string | null; created_from: string | null }>(
      db, 'site_deadlines', 'id, site_id, canonical_subject_id, title, report_id, created_from',
    ),
    all<{ id: string; label: string | null; status: string | null; merged_into: string | null }>(
      db, 'canonical_subject', 'id, label, status, merged_into',
    ),
    all<{ id: string; name: string | null }>(db, 'sites', 'id, name'),
  ])

  const subjectById = new Map(subjects.map((s) => [s.id, s]))
  const siteName = new Map(sites.map((s) => [s.id, s.name ?? '(sans nom)']))
  const objectById = new Map([...actions, ...deadlines].map((o) => [o.id, o]))

  // ── Périmètre : tout chantier portant au moins un objet sans FK ─────────────
  const candidateSites = new Set<string>()
  for (const o of [...actions, ...deadlines]) if (!o.canonical_subject_id && o.site_id) candidateSites.add(o.site_id)

  console.log('DRY-RUN PROJECTION CANONIQUE — AUCUNE ÉCRITURE')
  console.log(`Parc : ${actions.length} actions, ${deadlines.length} échéances.`)
  console.log(
    `FK déjà posée : ${actions.filter((a) => a.canonical_subject_id).length} actions, ` +
      `${deadlines.filter((d) => d.canonical_subject_id).length} échéances.`,
  )
  console.log(`Chantiers à balayer : ${candidateSites.size}\n`)

  const projected: ProjectedRow[] = []
  const skipped: SkippedRow[] = []
  const bySite = new Map<string, { projected: ProjectedRow[]; skipped: SkippedRow[] }>()

  for (const siteId of candidateSites) {
    const report = await projectCanonicalSubjectOnObjects({ siteId, scope: { kind: 'site' }, dryRun: true })
    if (!report.dryRun) throw new Error('SÉCURITÉ : le helper a signalé une exécution NON dry-run — arrêt.')
    projected.push(...report.projected)
    skipped.push(...report.skipped)
    bySite.set(siteId, { projected: report.projected, skipped: report.skipped })
  }

  // ── Détail exhaustif ────────────────────────────────────────────────────────
  console.log('═'.repeat(120))
  console.log('LIGNES QUI SERAIENT ÉCRITES')
  console.log('═'.repeat(120))

  const orderedSites = [...bySite.entries()]
    .filter(([, r]) => r.projected.length > 0)
    .sort((a, b) => b[1].projected.length - a[1].projected.length)

  for (const [siteId, r] of orderedSites) {
    console.log(`\n── ${siteName.get(siteId)} (${short(siteId)}) — ${r.projected.length} écriture(s) ──`)
    const rows = [...r.projected].sort((a, b) => a.objectType.localeCompare(b.objectType))
    for (const p of rows) {
      const o = objectById.get(p.objectId)
      const target = subjectById.get(p.canonicalSubjectId)
      console.log(
        `  ${p.objectType === 'site_action' ? 'ACTION  ' : 'ÉCHÉANCE'} ${short(p.objectId)} « ${cut(o?.title, 58).padEnd(58)} »`,
      )
      console.log(
        `      → sujet ${short(p.canonicalSubjectId)} « ${cut(target?.label, 52)} »` +
          `  [${target?.status ?? '?'}]`,
      )
      console.log(
        `      preuve=${p.paths.join('+').padEnd(26)} winner: ${short(p.rawSubjectId)} → ${short(p.canonicalSubjectId)}  sauts=${p.mergeHops}`,
      )
    }
  }

  // ── Invariants ──────────────────────────────────────────────────────────────
  const conflicts = skipped.filter((s) => s.reason === 'conflicting_evidence')
  const brokenChains = skipped.filter((s) => s.reason === 'merge_chain_unresolved')
  const stillMerged = projected.filter((p) => subjectById.get(p.canonicalSubjectId)?.status === 'merged')
  const unknownTarget = projected.filter((p) => !subjectById.has(p.canonicalSubjectId))

  console.log(`\n${'═'.repeat(120)}`)
  console.log('CONTRÔLES')
  console.log('═'.repeat(120))
  console.log(`  A. ambiguïtés (conflicting_evidence)     : ${conflicts.length}  ${conflicts.length === 0 ? '✔' : '✘ BLOQUANT'}`)
  console.log(`  B. cibles encore merged après résolution : ${stillMerged.length}  ${stillMerged.length === 0 ? '✔' : '✘ BLOQUANT'}`)
  console.log(`  C. cibles introuvables en base          : ${unknownTarget.length}  ${unknownTarget.length === 0 ? '✔' : '✘ BLOQUANT'}`)
  console.log(`  D. chaînes de fusion non résolues        : ${brokenChains.length}  (laissées NULL, non bloquant)`)

  for (const c of conflicts) {
    const o = objectById.get(c.objectId)
    console.log(`     ⚠ ${c.objectType} ${short(c.objectId)} « ${cut(o?.title, 60)} » → ${c.targets.map(short).join(' | ')}`)
  }
  for (const p of stillMerged) {
    console.log(`     ⚠ ${p.objectType} ${short(p.objectId)} → ${short(p.canonicalSubjectId)} status=merged`)
  }

  // ── Synthèse ────────────────────────────────────────────────────────────────
  const nA = projected.filter((p) => p.objectType === 'site_action').length
  const nD = projected.filter((p) => p.objectType === 'site_deadline').length
  const pathTally = new Map<string, number>()
  for (const p of projected) {
    const k = [...p.paths].sort().join('+')
    pathTally.set(k, (pathTally.get(k) ?? 0) + 1)
  }
  const hopTally = new Map<number, number>()
  for (const p of projected) hopTally.set(p.mergeHops, (hopTally.get(p.mergeHops) ?? 0) + 1)
  const skipTally = new Map<string, number>()
  for (const s of skipped) skipTally.set(s.reason, (skipTally.get(s.reason) ?? 0) + 1)

  console.log(`\n${'═'.repeat(120)}`)
  console.log('SYNTHÈSE')
  console.log('═'.repeat(120))
  console.log(`  écritures : ${nA} actions + ${nD} échéances = ${nA + nD}`)
  console.log('  par chemin de preuve :')
  for (const [k, n] of [...pathTally].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${k}`)
  console.log('  par nombre de sauts de fusion :')
  for (const [h, n] of [...hopTally].sort((a, b) => a[0] - b[0])) console.log(`     ${String(n).padStart(4)}  ${h} saut(s)`)
  console.log('  non projetés :')
  for (const [k, n] of [...skipTally].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${k}`)

  const covA = actions.filter((a) => a.canonical_subject_id).length
  const covD = deadlines.filter((d) => d.canonical_subject_id).length
  const pct = (n: number, t: number) => (t === 0 ? '—' : `${((n / t) * 100).toFixed(1)} %`)
  console.log('\n  couverture FK avant → après (si le backfill était appliqué) :')
  console.log(`     actions   : ${covA}/${actions.length} (${pct(covA, actions.length)}) → ${covA + nA}/${actions.length} (${pct(covA + nA, actions.length)})`)
  console.log(`     échéances : ${covD}/${deadlines.length} (${pct(covD, deadlines.length)}) → ${covD + nD}/${deadlines.length} (${pct(covD + nD, deadlines.length)})`)

  // ── Sentinelles nommées ─────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(120)}`)
  console.log('SENTINELLES NOMMÉES')
  console.log('═'.repeat(120))
  const projectedById = new Map(projected.map((p) => [p.objectId, p]))
  const skippedById = new Map(skipped.map((s) => [s.objectId, s]))
  const NAMED: Array<[string, string, 'PROJETÉ' | 'NULL']> = [
    ['cadenas à code lors de l', 'Cadenas (accueil sécurité)', 'PROJETÉ'],
    ['panneaux en bois', 'Eau panneaux', 'PROJETÉ'],
    ['planning d', 'Planning', 'NULL'],
    ['démarrage du nettoyage', 'Démarrage du nettoyages', 'NULL'],
  ]
  for (const [needle, label, expected] of NAMED) {
    const hits = [...actions, ...deadlines].filter((o) => (o.title ?? '').toLowerCase().includes(needle))
    if (hits.length === 0) {
      console.log(`  ${label.padEnd(28)} introuvable`)
      continue
    }
    for (const o of hits) {
      const p = projectedById.get(o.id)
      const s = skippedById.get(o.id)
      const observed = p ? 'PROJETÉ' : o.canonical_subject_id ? 'DÉJÀ LIÉ' : 'NULL'
      const ok = observed === expected || (expected === 'PROJETÉ' && observed === 'DÉJÀ LIÉ')
      const detail = p
        ? `→ ${short(p.canonicalSubjectId)} via ${p.paths.join('+')} (sauts=${p.mergeHops})`
        : o.canonical_subject_id
          ? `→ ${short(o.canonical_subject_id)} (FK préexistante)`
          : `motif=${s?.reason ?? 'hors périmètre'}`
      console.log(`  ${ok ? '✔' : '✘'} ${label.padEnd(28)} ${short(o.id)} ${observed.padEnd(9)} ${detail}`)
      console.log(`      « ${cut(o.title, 90)} »`)
    }
  }

  console.log('\nDRY-RUN TERMINÉ — aucune écriture émise. HARD STOP.')
}

main().catch((e) => {
  console.error('DRY-RUN INTERROMPU :', e instanceof Error ? e.message : e)
  process.exit(1)
})
