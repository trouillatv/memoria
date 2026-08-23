// TRANCHE 3 — AUDIT LECTURE SEULE. AUCUNE ÉCRITURE.
//
// Deux questions, mesurées sur PETRO (régime terrain) et OCEF (régime import PV) :
//   (A) où les deux moteurs d'attention divergent-ils RÉELLEMENT, en objets ?
//   (B) combien d'échéances affichées « en retard » sont contredites par une
//       preuve terrain, et le rapprochement est-il assez solide pour le dire ?
//
// Aucun INSERT / UPDATE / DELETE. Aucun replay. Aucune mutation de statut.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase/admin'
import { deriveSiteAttentionItems } from '../lib/knowledge/site-attention-items'
import { actionHealth } from '../lib/actions/health'
import { describeOverdueAction } from '../lib/knowledge/overdue-action'

const db = createAdminClient()
const TODAY = new Date().toISOString().slice(0, 10)

function h(t: string) {
  console.log(`\n${'═'.repeat(78)}\n${t}\n${'═'.repeat(78)}`)
}
function sub(t: string) {
  console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 72 - t.length))}`)
}
function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}
function dayGap(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

// Rapprochement lexical PRUDENT : sert à mesurer la SOLIDITÉ d'un lien, jamais
// à en créer un. Vincent : « le rapprochement doit être suffisamment solide ».
const STOP = new Set([
  'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'ou', 'a', 'à', 'au', 'aux',
  'en', 'sur', 'pour', 'dans', 'par', 'avec', 'sans', 'ce', 'cette', 'ces', 'est',
])
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)),
  )
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

async function main() {
  const { data: siteRows } = await db.from('sites').select('id, name').is('deleted_at', null)
  const sites = (siteRows ?? []) as Array<{ id: string; name: string }>
  const targets = sites.filter((s) => /petro|ocef/i.test(s.name))

  h(`TRANCHE 3 — AUDIT VÉRITÉ (lecture seule) · ${TODAY}`)
  console.log(`Chantiers ciblés : ${targets.map((s) => s.name).join(' · ') || '(aucun)'}`)
  if (targets.length === 0) {
    console.log(`Aucun chantier PETRO/OCEF. Chantiers présents : ${sites.map((s) => s.name).join(' · ')}`)
    return
  }

  for (const site of targets) {
    h(`${site.name}  (${site.id})`)

    // ── Moteur B — appelé RÉELLEMENT ────────────────────────────────────────
    const bItems = await deriveSiteAttentionItems(site.id)
    const bBySignal = new Map<string, { n: number; urgencies: string[] }>()
    for (const it of bItems) {
      const e = bBySignal.get(it.signal) ?? { n: 0, urgencies: [] }
      e.n++
      e.urgencies.push(it.urgency)
      bBySignal.set(it.signal, e)
    }

    sub('MOTEUR B — deriveSiteAttentionItems (mono-chantier, non plafonné)')
    console.log(`  total items : ${bItems.length}`)
    for (const [sig, e] of [...bBySignal].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`    ${sig.padEnd(20)} ${String(e.n).padStart(3)}   [${e.urgencies.join(', ')}]`)
    }

    // ── Moteur A — RÉPLIQUE de l'agrégation par chantier de getAttentionDigest
    // (la fonction réelle exige une session utilisateur : on rejoue ses
    // prédicats à l'identique, sans son plafond ni son scope org).
    const { data: actRows } = await db
      .from('site_actions')
      .select('id, title, kind, due_date, due_date_status, created_at, status, snooze_reason')
      .eq('site_id', site.id)
      .eq('status', 'open')
    const actions = (actRows ?? []) as Array<{
      id: string; title: string; kind: string | null; due_date: string | null
      due_date_status: 'explicit' | 'estimated' | null; created_at: string
      snooze_reason: string | null
    }>
    const aOverdue = actions.filter((a) => a.due_date && a.due_date < TODAY)
    const aOldOpen = actions.filter((a) => !(a.due_date && a.due_date < TODAY) && actionHealth(a.created_at) === 'critique')

    const { data: resRows } = await db
      .from('site_reserve')
      .select('id, label, status, created_at, issued_on')
      .eq('site_id', site.id)
      .eq('status', 'open')
    const reserves = (resRows ?? []) as Array<{
      id: string; label: string; created_at: string; issued_on: string | null
    }>

    sub('MOTEUR A — getAttentionDigest (réplique des prédicats, par chantier)')
    console.log(`  actions en retard      : ${aOverdue.length}   → 🔴 rouge`)
    console.log(`  actions anciennes ≥14j : ${aOldOpen.length}   → 🟠 orange`)
    if (reserves.length > 0) {
      const oldestCreated = reserves.reduce((o, x) => (x.created_at < o.created_at ? x : o))
      const ageA = ageDays(oldestCreated.created_at)
      console.log(`  réserves ouvertes      : ${reserves.length}   → ${ageA >= 30 ? '🔴 rouge' : '🟠 orange'} (plus ancienne ${ageA} j, source created_at)`)
    } else {
      console.log(`  réserves ouvertes      : 0`)
    }

    // ── D1 — Réserves : deux colonnes de date, deux seuils ──────────────────
    sub('D1 · Réserves — quelle date, quel seuil ?')
    if (reserves.length === 0) {
      console.log('  (aucune réserve ouverte)')
    } else {
      let divergentDate = 0
      let divergentClass = 0
      for (const r of reserves) {
        const ageCreated = ageDays(r.created_at)
        const ageIssued = r.issued_on ? dayGap(r.issued_on, TODAY) : null
        const drift = ageIssued == null ? null : ageIssued - ageCreated
        if (drift !== null && Math.abs(drift) >= 1) divergentDate++
        // A : ≥30 j (created_at) → rouge. B : >15 j (issued_on) → high.
        const aRed = ageCreated >= 30
        const bHigh = ageIssued != null && ageIssued > 15
        if (aRed !== bHigh) divergentClass++
        console.log(
          `  ${r.label.slice(0, 40).padEnd(40)} created_at=${ageCreated}j  issued_on=${ageIssued ?? '—'}${ageIssued != null ? 'j' : ''}` +
          `  écart=${drift ?? '—'}  A=${aRed ? 'rouge' : 'orange'} B=${bHigh ? 'high' : 'medium'}${aRed !== bHigh ? '   ⚠ DIVERGE' : ''}`,
        )
      }
      console.log(`  → dates différentes : ${divergentDate}/${reserves.length} · classement contradictoire : ${divergentClass}/${reserves.length}`)
    }

    // ── D2 — Actions en retard : prudence due_date_status ────────────────────
    sub('D2 · Actions en retard — date confirmée ou déduite ?')
    if (aOverdue.length === 0) {
      console.log('  (aucune action ouverte à échéance dépassée)')
    } else {
      let estimated = 0
      let deadlineKind = 0
      let snoozed = 0
      for (const a of aOverdue) {
        const d = describeOverdueAction(a.title, a.due_date!, a.due_date_status, TODAY)
        if (!d.confirmed) estimated++
        if (a.kind === 'deadline') deadlineKind++
        if (a.snooze_reason) snoozed++
        console.log(
          `  ${a.title.slice(0, 40).padEnd(40)} due=${a.due_date} statut=${a.due_date_status ?? 'null'} kind=${a.kind ?? '—'}` +
          `  A=« en retard » 🔴   B=${d.confirmed ? 'action_overdue' : 'action_to_verify'}${!d.confirmed ? '   ⚠ DIVERGE' : ''}`,
        )
      }
      console.log(`  → A annonce « en retard » sur ${estimated}/${aOverdue.length} action(s) dont la date n'est PAS confirmée.`)
      console.log(`  → dont kind='deadline' comptées comme « action » par A : ${deadlineKind}`)
      console.log(`  → dont reportées (snooze_reason) mais toujours alarmées par A : ${snoozed}`)
    }

    // ── D3 — Ce que A ne voit pas ───────────────────────────────────────────
    sub('D3 · Angle mort de A — site_deadlines')
    const { data: dlRows } = await db
      .from('site_deadlines')
      .select('id, title, due_date, status, canonical_subject_id, report_id, created_at')
      .eq('site_id', site.id)
      .is('deleted_at', null)
    const deadlines = (dlRows ?? []) as Array<{
      id: string; title: string; due_date: string | null; status: string
      canonical_subject_id: string | null; report_id: string | null; created_at: string
    }>
    const overdueDl = deadlines.filter(
      (d) => ['to_plan', 'planned'].includes(d.status) && d.due_date && d.due_date < TODAY,
    )
    console.log(`  échéances (total non supprimées) : ${deadlines.length}`)
    console.log(`  affichées « en retard » (to_plan|planned + date passée) : ${overdueDl.length}`)
    console.log(`  → A n'interroge JAMAIS site_deadlines : ces ${overdueDl.length} objets sont invisibles sur l'accueil.`)

    sub('D4 · Angle mort de B — signaux propres à A')
    console.log(`  actions anciennes ≥14 j sans échéance dépassée : ${aOldOpen.length} (aucun équivalent dans B)`)
    const { data: capRows } = await db
      .from('site_reports')
      .select('id')
      .eq('site_id', site.id)
      .not('origin', 'is', null)
      .not('ended_at', 'is', null)
      .is('deleted_at', null)
    const reportIds = ((capRows ?? []) as Array<{ id: string }>).map((r) => r.id)
    let pendingCaptures = 0
    if (reportIds.length > 0) {
      const { data: cRows } = await db
        .from('visit_capture').select('report_id').in('report_id', reportIds).eq('status', 'captured')
      pendingCaptures = (cRows ?? []).length
    }
    console.log(`  captures non triées (débriefs en attente) : ${pendingCaptures} (aucun équivalent dans B)`)

    // ── PARTIE B — Contradiction échéance / preuve terrain ──────────────────
    h(`(B) ${site.name} — échéances « en retard » vs preuve terrain`)
    if (overdueDl.length === 0) {
      console.log('  Aucune échéance affichée en retard : rien à confronter.')
    } else {
      const { data: occRows } = await db
        .from('canonical_subject_occurrence')
        .select('id, canonical_subject_id, label, note, visit_status, effective_date, source_kind')
        .eq('site_id', site.id)
      const occs = (occRows ?? []) as Array<{
        id: string; canonical_subject_id: string; label: string; note: string | null
        visit_status: string | null; effective_date: string; source_kind: string
      }>
      const terrainOccs = occs.filter((o) => o.source_kind !== 'historical_pdf' && o.visit_status !== null)
      console.log(`  occurrences terrain porteuses d'un constat : ${terrainOccs.length} / ${occs.length}`)

      let strong = 0, weak = 0, none = 0
      for (const d of overdueDl) {
        const dTok = tokens(d.title)
        // Preuve = constat terrain POSTÉRIEUR à la date due.
        const after = terrainOccs.filter((o) => o.effective_date >= d.due_date!)
        const byId = d.canonical_subject_id
          ? after.filter((o) => o.canonical_subject_id === d.canonical_subject_id)
          : []
        const byText = after
          .map((o) => ({ o, score: jaccard(dTok, tokens(o.label)) }))
          .filter((x) => x.score >= 0.34)
          .sort((a, b) => b.score - a.score)

        const lateDays = dayGap(d.due_date!, TODAY)
        let verdict: string
        if (byId.length > 0) { verdict = 'LIEN SOLIDE (canonical_subject_id)'; strong++ }
        else if (byText.length > 0) { verdict = `lien LEXICAL seulement (jaccard ${byText[0].score.toFixed(2)}) — insuffisant`; weak++ }
        else { verdict = 'aucune preuve postérieure'; none++ }

        console.log(`\n  « ${d.title.slice(0, 60)} »`)
        console.log(`    statut=${d.status} due=${d.due_date} (+${lateDays} j) cs=${d.canonical_subject_id ?? 'null'}`)
        console.log(`    verdict rapprochement : ${verdict}`)
        for (const o of byId.slice(0, 3)) {
          console.log(`      · constat ${o.effective_date} visit_status=${o.visit_status} « ${o.label.slice(0, 50)} »`)
        }
        for (const x of byText.slice(0, 2)) {
          console.log(`      ~ candidat ${x.o.effective_date} visit_status=${x.o.visit_status} « ${x.o.label.slice(0, 50)} » (${x.score.toFixed(2)})`)
        }
      }
      console.log(`\n  RÉCAPITULATIF : solide=${strong} · lexical seul=${weak} · sans preuve=${none} (sur ${overdueDl.length})`)
    }
  }

  h('GARANTIE — aucune mutation automatique de site_deadlines.status')
  console.log('  Ce script est en LECTURE SEULE : aucun INSERT/UPDATE/DELETE émis.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
