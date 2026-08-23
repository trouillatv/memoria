/**
 * PRODUCT-DEADLINE-VS-FIELD-EVIDENCE — PHASE A — AUDIT LECTURE SEULE.
 *
 * Objectif (GO Vincent, 2026-08-24) : mesurer si le pont canonique (backfill 30921d8f)
 * permet de confronter les échéances « en retard » à la réalité terrain observée.
 *
 * AUCUN code applicatif, AUCUNE écriture DB, AUCUN changement de statut,
 * AUCUN LLM de rapprochement, AUCUNE migration.
 *
 * Lancer :  npx tsx scripts/_audit-deadline-field-evidence.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'

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

const TODAY = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : 'NULL')
const cut = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').slice(0, n)
const pct = (n: number, t: number) => (t === 0 ? '—' : `${((n / t) * 100).toFixed(0)} %`)

type Classification =
  | 'OVERDUE_WITHOUT_PROGRESS_EVIDENCE'
  | 'FIELD_PROGRESS_OBSERVED'
  | 'FIELD_COMPLETION_EVIDENCE'
  | 'CONTRADICTORY_OR_UNCLEAR'
  | 'NO_POST_DUE_EVIDENCE'

type DeadlineRow = {
  id: string
  site_id: string
  title: string | null
  due_date: string | null
  status: string | null
  canonical_subject_id: string | null
  report_id: string | null
  created_from: string | null
}

type OccurrenceRow = {
  id: string
  canonical_subject_id: string
  source_ref_id: string        // site_reports.id
  source_proposal_id: string | null
  visit_status: string | null  // field_checked / still_open / not_applicable
  validation_status: string    // observed / confirmed / rejected / source_superseded
  effective_date: string       // date de la visite
  label: string
  note: string | null
  evidence_count: number
}

type SubjectRow = {
  id: string
  label: string | null
  status: string | null
  merged_into: string | null
}

type SiteRow = {
  id: string
  name: string | null
}

function classifyEvidence(
  dueDate: string,
  occurrences: OccurrenceRow[],
): { classification: Classification; evidence: OccurrenceRow[]; rationale: string } {
  const active = occurrences.filter((o) => !['rejected', 'source_superseded'].includes(o.validation_status))
  // Fenêtre d'intérêt : 60 jours avant jusqu'à maintenant (preuves récentes pertinentes)
  const windowStart = new Date(dueDate)
  windowStart.setDate(windowStart.getDate() - 60)
  const windowStartStr = windowStart.toISOString().slice(0, 10)
  const recent = active.filter((o) => o.effective_date >= windowStartStr)
  const postDue = recent.filter((o) => o.effective_date >= dueDate)
  const preDue = recent.filter((o) => o.effective_date < dueDate)

  if (active.length === 0)
    return { classification: 'OVERDUE_WITHOUT_PROGRESS_EVIDENCE', evidence: [], rationale: 'aucune occurrence terrain active' }

  if (postDue.length === 0 && recent.length === 0)
    return { classification: 'NO_POST_DUE_EVIDENCE', evidence: active.slice(0, 2), rationale: 'occurrences trop anciennes (>60j avant due_date)' }

  if (postDue.length === 0)
    return { classification: 'OVERDUE_WITHOUT_PROGRESS_EVIDENCE', evidence: preDue.slice(0, 2), rationale: 'observations avant due_date, aucune après' }

  const checked = postDue.filter((o) => o.visit_status === 'field_checked')
  const stillOpen = postDue.filter((o) => o.visit_status === 'still_open')
  const mixed = checked.length > 0 && stillOpen.length > 0

  if (mixed)
    return { classification: 'CONTRADICTORY_OR_UNCLEAR', evidence: postDue.slice(0, 3), rationale: 'field_checked et still_open coexistent' }

  if (checked.length > 0) {
    const highConf = checked.filter((o) => o.validation_status === 'confirmed')
    if (highConf.length > 0)
      return { classification: 'FIELD_COMPLETION_EVIDENCE', evidence: highConf.slice(0, 2), rationale: `${highConf.length} occurrence(s) field_checked confirmée(s) humainement` }
    return { classification: 'FIELD_COMPLETION_EVIDENCE', evidence: checked.slice(0, 2), rationale: `${checked.length} occurrence(s) field_checked (observed)` }
  }

  if (stillOpen.length > 0)
    return { classification: 'FIELD_PROGRESS_OBSERVED', evidence: stillOpen.slice(0, 2), rationale: `${stillOpen.length} occurrence(s) still_open postérieures à due_date : activité suivie` }

  // Occurrences post-due sans visit_status qualifié (mentioned, etc.)
  return { classification: 'FIELD_PROGRESS_OBSERVED', evidence: postDue.slice(0, 2), rationale: `${postDue.length} occurrence(s) postérieures, visit_status non qualifié` }
}

async function main() {
  const db = createAdminClient()

  console.log(`PRODUCT-DEADLINE-VS-FIELD-EVIDENCE — Phase A (${TODAY})\n`)

  const [allDeadlines, allSubjects, allOccurrences, allSites] = await Promise.all([
    all<DeadlineRow>(db, 'site_deadlines', 'id, site_id, title, due_date, status, canonical_subject_id, report_id, created_from'),
    all<SubjectRow>(db, 'canonical_subject', 'id, label, status, merged_into'),
    all<OccurrenceRow>(db, 'canonical_subject_occurrence', 'id, canonical_subject_id, source_ref_id, source_proposal_id, visit_status, validation_status, effective_date, label, note, evidence_count'),
    all<SiteRow>(db, 'sites', 'id, name'),
  ])

  const subjectById = new Map(allSubjects.map((s) => [s.id, s]))
  const siteById = new Map(allSites.map((s) => [s.id, s]))
  const occurrencesByCs = new Map<string, OccurrenceRow[]>()
  for (const o of allOccurrences) {
    const l = occurrencesByCs.get(o.canonical_subject_id) ?? []
    l.push(o)
    occurrencesByCs.set(o.canonical_subject_id, l)
  }

  // ── 1. Corpus : échéances actuellement « en retard » ──────────────────────
  const overdue = allDeadlines.filter(
    (d) => ['to_plan', 'planned'].includes(d.status ?? '') && d.due_date && d.due_date < TODAY && !('deleted_at' in d),
  )
  console.log(`═════════════════════════════════════════════════════════════════`)
  console.log(`1. CORPUS`)
  console.log(`═════════════════════════════════════════════════════════════════`)
  console.log(`  Toutes les échéances : ${allDeadlines.length}`)
  console.log(`  Statut to_plan/planned avec due_date < ${TODAY} : ${overdue.length}`)

  // ── 2. Couverture canonique ────────────────────────────────────────────────
  const withCanonical = overdue.filter((d) => d.canonical_subject_id)
  const withoutCanonical = overdue.filter((d) => !d.canonical_subject_id)
  console.log(`\n═════════════════════════════════════════════════════════════════`)
  console.log(`2. COUVERTURE CANONICAL (post-backfill 30921d8f)`)
  console.log(`═════════════════════════════════════════════════════════════════`)
  console.log(`  A — CANONICAL_LINKED   : ${withCanonical.length}  (${pct(withCanonical.length, overdue.length)})`)
  console.log(`  B — NO_CANONICAL_IDENTITY : ${withoutCanonical.length}  (${pct(withoutCanonical.length, overdue.length)})`)

  // Répartition par chantier
  const bysite = new Map<string, number>()
  for (const d of overdue) bysite.set(d.site_id, (bysite.get(d.site_id) ?? 0) + 1)
  const bysiteLinked = new Map<string, number>()
  for (const d of withCanonical) bysiteLinked.set(d.site_id, (bysiteLinked.get(d.site_id) ?? 0) + 1)
  console.log('\n  Par chantier :')
  for (const [sid, total] of [...bysite].sort((a, b) => b[1] - a[1])) {
    const linked = bysiteLinked.get(sid) ?? 0
    console.log(`    ${(siteById.get(sid)?.name ?? sid).slice(0, 28).padEnd(28)} ${String(total).padStart(3)} total, ${String(linked).padStart(3)} liées (${pct(linked, total)})`)
  }

  // ── 3. Classification terrain ─────────────────────────────────────────────
  console.log(`\n═════════════════════════════════════════════════════════════════`)
  console.log(`3. CLASSIFICATION TERRAIN (échéances CANONICAL_LINKED)`)
  console.log(`═════════════════════════════════════════════════════════════════`)

  type ClassResult = {
    deadline: DeadlineRow
    classification: Classification
    evidence: OccurrenceRow[]
    rationale: string
    subjectLabel: string | null
  }
  const results: ClassResult[] = []

  for (const d of withCanonical) {
    const csId = d.canonical_subject_id!
    const cs = subjectById.get(csId)
    const occs = occurrencesByCs.get(csId) ?? []
    const { classification, evidence, rationale } = classifyEvidence(d.due_date!, occs)
    results.push({ deadline: d, classification, evidence, rationale, subjectLabel: cs?.label ?? null })
  }

  const classCounts = new Map<Classification, number>()
  for (const r of results) classCounts.set(r.classification, (classCounts.get(r.classification) ?? 0) + 1)

  const ORDER: Classification[] = [
    'FIELD_COMPLETION_EVIDENCE',
    'FIELD_PROGRESS_OBSERVED',
    'NO_POST_DUE_EVIDENCE',
    'OVERDUE_WITHOUT_PROGRESS_EVIDENCE',
    'CONTRADICTORY_OR_UNCLEAR',
  ]
  for (const cls of ORDER) {
    const n = classCounts.get(cls) ?? 0
    console.log(`  ${cls.padEnd(40)} ${String(n).padStart(3)}  (${pct(n, withCanonical.length)})`)
  }

  // ── 4. Sentinelle obligatoire PETRO ──────────────────────────────────────
  console.log(`\n═════════════════════════════════════════════════════════════════`)
  console.log(`4. SENTINELLE PETRO — « Démarrage du nettoyages » f0a18663`)
  console.log(`═════════════════════════════════════════════════════════════════`)
  const petro = allDeadlines.find((d) => d.id.startsWith('f0a18663'))
  if (!petro) {
    console.log(`  introuvable (deleted ?)`)
  } else {
    const ok = !petro.canonical_subject_id
    console.log(`  id=${petro.id}`)
    console.log(`  status=${petro.status}  due_date=${petro.due_date}  canonical_subject_id=${petro.canonical_subject_id ?? 'NULL'}`)
    console.log(`  ${ok ? '✔' : '✘ ANOMALIE'} reste bien dans B — NO_CANONICAL_IDENTITY`)
    console.log(`  Interdiction maintenue : aucun rattachement lexical aux sujets nettoyage.`)

    // Chercher d'autres échéances PETRO désormais liées (démonstration du modèle)
    const PETRO_SHORT = '75bd3d23'
    const petroLinked = withCanonical.filter((d) => d.site_id.startsWith(PETRO_SHORT))
    console.log(`\n  Autres échéances PETRO désormais liées : ${petroLinked.length}`)
    for (const d of petroLinked) {
      const r = results.find((r) => r.deadline.id === d.id)
      const occs = occurrencesByCs.get(d.canonical_subject_id!) ?? []
      console.log(`  → ${short(d.id)} « ${cut(d.title, 55)} »`)
      console.log(`     sujet=${short(d.canonical_subject_id)} « ${cut(r?.subjectLabel, 48)} »  due=${d.due_date}  cls=${r?.classification ?? '?'}`)
      console.log(`     occurrences terrain sur ce sujet : ${occs.length}`)
    }
  }

  // ── 5. Exemples détaillés (5-10 cas réels) ────────────────────────────────
  console.log(`\n═════════════════════════════════════════════════════════════════`)
  console.log(`5. EXEMPLES DÉTAILLÉS (un par classification)`)
  console.log(`═════════════════════════════════════════════════════════════════`)

  const picked = new Set<Classification>()
  let shown = 0
  for (const cls of ORDER) {
    const candidates = results
      .filter((r) => r.classification === cls)
      .sort((a, b) => (b.evidence.length - a.evidence.length))
    const pick = candidates[0]
    if (!pick) continue
    picked.add(cls)
    shown++
    const d = pick.deadline
    const site = siteById.get(d.site_id)?.name ?? d.site_id
    console.log(`\n  [${cls}]`)
    console.log(`  Chantier : ${site}`)
    console.log(`  Échéance : ${short(d.id)} « ${cut(d.title, 70)} »`)
    console.log(`  Due date : ${d.due_date}  Status : ${d.status}`)
    console.log(`  Sujet    : ${short(d.canonical_subject_id)} « ${cut(pick.subjectLabel, 60)} »`)
    console.log(`  Rationale: ${pick.rationale}`)
    if (pick.evidence.length > 0) {
      console.log(`  Preuves terrain :`)
      for (const occ of pick.evidence) {
        console.log(`    ${occ.effective_date}  visit_status=${occ.visit_status ?? 'null'}  validation=${occ.validation_status}  evidence_count=${occ.evidence_count}`)
        console.log(`      « ${cut(occ.label, 80)} »`)
        if (occ.note) console.log(`      note : ${cut(occ.note, 100)}`)
      }
    }
  }

  // Ajouter des cas OVERDUE_WITHOUT_PROGRESS + FIELD_COMPLETION supplémentaires
  const moreCompletion = results.filter((r) => r.classification === 'FIELD_COMPLETION_EVIDENCE').slice(1, 3)
  const moreOverdue = results.filter((r) => r.classification === 'OVERDUE_WITHOUT_PROGRESS_EVIDENCE').slice(1, 3)
  for (const pick of [...moreCompletion, ...moreOverdue]) {
    shown++
    const d = pick.deadline
    const site = siteById.get(d.site_id)?.name ?? d.site_id
    console.log(`\n  [${pick.classification}]`)
    console.log(`  Chantier : ${site}`)
    console.log(`  Échéance : ${short(d.id)} « ${cut(d.title, 70)} »`)
    console.log(`  Due date : ${d.due_date}  Sujet : ${short(d.canonical_subject_id)} « ${cut(pick.subjectLabel, 55)} »`)
    console.log(`  Rationale: ${pick.rationale}`)
    for (const occ of pick.evidence) {
      console.log(`    ${occ.effective_date}  visit_status=${occ.visit_status ?? 'null'}  validation=${occ.validation_status}`)
      console.log(`      « ${cut(occ.label, 80)} »`)
    }
  }

  // ── 6. Synthèse chiffrée ─────────────────────────────────────────────────
  console.log(`\n═════════════════════════════════════════════════════════════════`)
  console.log(`6. RÉPONSES AUX QUESTIONS PRODUIT`)
  console.log(`═════════════════════════════════════════════════════════════════`)
  console.log(`  Combien d'échéances sont actuellement « en retard » ?`)
  console.log(`    → ${overdue.length} (status to_plan/planned, due_date < ${TODAY})`)
  console.log(`  Combien sont désormais canoniquement liées ?`)
  console.log(`    → ${withCanonical.length} (${pct(withCanonical.length, overdue.length)}) — post-backfill 30921d8f`)
  console.log(`  Parmi celles liées, combien ont une preuve terrain postérieure ?`)
  const withPostDue = results.filter(r => ['FIELD_PROGRESS_OBSERVED', 'FIELD_COMPLETION_EVIDENCE', 'CONTRADICTORY_OR_UNCLEAR'].includes(r.classification))
  console.log(`    → ${withPostDue.length} (${pct(withPostDue.length, withCanonical.length)})`)
  console.log(`  Combien semblent réellement sans progression ?`)
  const trueOverdue = results.filter(r => r.classification === 'OVERDUE_WITHOUT_PROGRESS_EVIDENCE')
  console.log(`    → ${trueOverdue.length} (${pct(trueOverdue.length, withCanonical.length)})`)
  console.log(`  Combien ont une activité constatée (suivi en cours) ?`)
  const progress = results.filter(r => r.classification === 'FIELD_PROGRESS_OBSERVED')
  console.log(`    → ${progress.length} (${pct(progress.length, withCanonical.length)})`)
  console.log(`  Combien semblent potentiellement réalisées mais administrativement ouvertes ?`)
  const completion = results.filter(r => r.classification === 'FIELD_COMPLETION_EVIDENCE')
  console.log(`    → ${completion.length} (${pct(completion.length, withCanonical.length)})`)
  console.log(`  Combien sont indécidables (preuves contradictoires/portée insuffisante) ?`)
  const unclear = results.filter(r => r.classification === 'CONTRADICTORY_OR_UNCLEAR')
  const noDue = results.filter(r => r.classification === 'NO_POST_DUE_EVIDENCE')
  console.log(`    → ${unclear.length} contradictoires + ${noDue.length} sans preuve post-due = ${unclear.length + noDue.length}`)

  // ── 7. Verdict de faisabilité ─────────────────────────────────────════════
  console.log(`\n═════════════════════════════════════════════════════════════════`)
  console.log(`7. VERDICT DE FAISABILITÉ`)
  console.log(`═════════════════════════════════════════════════════════════════`)

  const coverageOk = withCanonical.length >= overdue.length * 0.3
  const evidenceQuality = withPostDue.length + completion.length + progress.length
  const evidenceOk = evidenceQuality >= withCanonical.length * 0.2

  let verdict: string
  let rationale: string
  if (coverageOk && evidenceOk) {
    verdict = 'DEADLINE_FIELD_BRIDGE_PARTIAL'
    rationale = `couverture ${pct(withCanonical.length, overdue.length)} des échéances en retard, ${pct(withPostDue.length, withCanonical.length)} ont une preuve terrain. Principe démontré, applicable sur un sous-ensemble fiable.`
  } else if (coverageOk) {
    verdict = 'DEADLINE_FIELD_BRIDGE_PARTIAL'
    rationale = `couverture ${pct(withCanonical.length, overdue.length)} OK mais peu de preuves terrain exploitables (${pct(withPostDue.length, withCanonical.length)}). Le pont existe, les occurrences manquent.`
  } else {
    verdict = 'DEADLINE_FIELD_BRIDGE_NOT_READY'
    rationale = `couverture canonique trop faible (${pct(withCanonical.length, overdue.length)}) — le pont ne couvre pas assez d'échéances en retard pour une surface fiable.`
  }

  console.log(`  Verdict : ${verdict}`)
  console.log(`  ${rationale}`)

  console.log(`\nHARD STOP — aucune écriture, aucun changement applicatif.`)
}

main().catch((e) => {
  console.error('AUDIT INTERROMPU :', e instanceof Error ? e.message : e)
  process.exit(1)
})
