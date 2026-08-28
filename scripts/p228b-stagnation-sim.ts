/**
 * #228 Lot B — AUDIT + SIMULATION READ-ONLY de l'éligibilité à la STAGNATION. Aucun code moteur, aucun seuil
 * modifié, aucune migration, aucun changement d'Attention.
 *
 * Rappel doctrine (3 notions distinctes) :
 *   navigable   : vrai sujet métier (durableKind ≠ … ; tous ici).
 *   opérationnel: peut participer aux calculs métier — corrigé au Lot A (durableKind=business_subject).
 *   stagnant    : une évolution était ATTENDUE et n'est pas arrivée depuis assez longtemps. ← objet du Lot B.
 *
 * Aujourd'hui (S0) : isStagnant = !STAGNATION_INELIGIBLE.has(dominantFamily) && !closed
 *                    && stagnationDays>=30 && consecutiveMentions>=2.  STAGNATION_INELIGIBLE =
 *                    {person, company, knowledge_fact, deadline}. Depuis Lot A, exclure par famille
 *                    (knowledge_fact) est un héritage faux — MAIS « business_subject ⇒ peut stagner » (S1)
 *                    transformerait 34 knowledge purs OCEF en faux problèmes.
 *
 * On fait VARIER UNIQUEMENT le prédicat d'ÉLIGIBILITÉ, en réutilisant les métriques temporelles exposées
 * (stagnationDays, consecutiveMentionsWithoutChange) et les seuils EXISTANTS (30 j / 2 mentions / !closed) :
 *   S0 actuel   : !STAGNATION_INELIGIBLE.has(dominantFamily)              (family-based, hérité)
 *   S1 borne haute : durableKind='business_subject'                       (tout business → bruit potentiel)
 *   S2 trajectoire ouverte : business && currentTriState='open'
 *   S3 attente prouvée : business && (objet opérationnel ouvert OU reopened)  (signal concret d'évolution attendue)
 *
 * READ-ONLY. HARD STOP. Exécuter : npx tsx --env-file=.env.local scripts/p228b-stagnation-sim.ts
 */
import { createClient } from '@supabase/supabase-js'
import { getNavigableSubjectsForSite, type NavigableSubjectSummary } from '../lib/db/canonical-subject-life'
import { buildSiteSubjectCells, cellDeltaTransition } from '../lib/documents/site-occurrence-timeline'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const TARGET = /bella|ocef|petro/i
const CLOSED = new Set(['done', 'cancelled', 'not_applicable'])
const STAGNATION_INELIGIBLE = new Set(['person', 'company', 'knowledge_fact', 'deadline']) // S0, tel quel
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const BELLA_TEMOINS: Record<string, string> = {
  '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9': 'électrique', 'b78526f9-9dc6-43f7-8edb-e4278f207988': 'cuisson',
  '22bef24e-3a1a-4566-beca-c5a5c845dd1d': 'nettoyage', 'cc12fce6-8780-4f93-88a1-21905a37325b': 'éclairage',
  '75da7744-287d-47fd-80d8-e62ea1660ca1': 'flux', 'e8929f5e-4c20-4c1c-bdd8-2b65a7433389': 'huiles',
  '71db6b00-3d03-4bc6-879f-067d92b4a3f9': 'Registre', '8815498b-3100-43b9-9038-bf479c658a29': 'Largeur',
  '943a5a7f-9cd8-40f2-92f4-eb33d4b592d4': 'Mall',
}
function pad(s: string, n: number): string { return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length) }

const TEMP_OK = (s: NavigableSubjectSummary) => !CLOSED.has(s.currentStatus ?? '') && s.stagnationDays >= 30 && s.consecutiveMentionsWithoutChange >= 2
const isBusiness = (s: NavigableSubjectSummary) => s.durableKind === 'business_subject' || s.durableKind == null

function eligible(s: NavigableSubjectSummary, scenario: string, reopened: Set<string>): boolean {
  switch (scenario) {
    case 'S0': return !STAGNATION_INELIGIBLE.has(s.dominantFamily ?? '')
    case 'S1': return isBusiness(s)
    case 'S2': return isBusiness(s) && s.currentTriState === 'open'
    case 'S3': return isBusiness(s) && (s.activeObjects.total > 0 || reopened.has(s.canonicalSubjectId))
    default: return false
  }
}
const stagnantSet = (nav: NavigableSubjectSummary[], sc: string, re: Set<string>) =>
  nav.filter((s) => eligible(s, sc, re) && TEMP_OK(s))

async function reopenedFor(siteId: string): Promise<Set<string>> {
  const view = await buildSiteSubjectCells(siteId)
  const set = new Set<string>()
  for (const row of view.rows) {
    const firstIdx = row.cells.findIndex((c) => c !== null)
    let lastIdx = -1; for (let i = row.cells.length - 1; i >= 0; i--) if (row.cells[i]) { lastIdx = i; break }
    if (lastIdx >= 0 && cellDeltaTransition(row.cells[lastIdx]!, lastIdx === firstIdx) === 'réouvert') set.add(row.canonicalSubjectId)
  }
  return set
}

async function main() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const matched: Array<{ id: string; name: string }> = []
  for (const s of ((sites ?? []) as Array<{ id: string; name: string }>).filter((x) => TARGET.test(x.name))) {
    const { count } = await sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('site_id', s.id)
    if ((count ?? 0) > 0) matched.push(s)
  }
  matched.sort((a, b) => a.name.localeCompare(b.name))

  console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
  console.log('║  #228 Lot B — SIMULATION READ-ONLY éligibilité STAGNATION (S0/S1/S2/S3)          ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  console.log('Seuils INCHANGÉS (30 j / 2 mentions / !closed). Seul le prédicat d\'éligibilité varie.\n')
  console.log(`${pad('Chantier', 24)}${pad('S0', 6)}${pad('S1', 6)}${pad('S2', 6)}${pad('S3', 6)} | nouveaux vs S0 (S1/S2/S3) · acteurs`)

  const agg = { S0: 0, S1: 0, S2: 0, S3: 0, newS1: 0, newS2: 0, newS3: 0, actors: 0,
    knowledgePureNew: 0, resolvedNew: 0, unknownNew: 0, doublonNew: 0 }

  for (const site of matched) {
    const nav = await getNavigableSubjectsForSite(site.id)
    const re = await reopenedFor(site.id)
    const sets = { S0: stagnantSet(nav, 'S0', re), S1: stagnantSet(nav, 'S1', re), S2: stagnantSet(nav, 'S2', re), S3: stagnantSet(nav, 'S3', re) }
    const s0ids = new Set(sets.S0.map((s) => s.canonicalSubjectId))
    const newOf = (sc: 'S1' | 'S2' | 'S3') => sets[sc].filter((s) => !s0ids.has(s.canonicalSubjectId))
    const [nS1, nS2, nS3] = [newOf('S1'), newOf('S2'), newOf('S3')]
    const actors = [...sets.S1, ...sets.S2, ...sets.S3].filter((s) => s.durableKind === 'actor')
    console.log(`${pad(site.name, 24)}${pad(String(sets.S0.length), 6)}${pad(String(sets.S1.length), 6)}${pad(String(sets.S2.length), 6)}${pad(String(sets.S3.length), 6)} | +${nS1.length}/+${nS2.length}/+${nS3.length} · act=${actors.length}`)

    agg.S0 += sets.S0.length; agg.S1 += sets.S1.length; agg.S2 += sets.S2.length; agg.S3 += sets.S3.length
    agg.newS1 += nS1.length; agg.newS2 += nS2.length; agg.newS3 += nS3.length; agg.actors += actors.length
    // Analyse des nouveaux de la borne haute S1 (le pire cas)
    for (const s of nS1) {
      const pureK = s.dominantFamily === 'knowledge_fact' && s.activeObjects.total === 0
      if (pureK) agg.knowledgePureNew++
      if (s.currentTriState === 'resolved') agg.resolvedNew++
      if (s.currentTriState === 'unknown') agg.unknownNew++
      if (s.activeObjects.total > 0 || s.currentStatus === 'non_compliant') agg.doublonNew++
    }
  }

  console.log('\n════════════ SYNTHÈSE CORPUS ════════════')
  console.log(`Stagnants actuels (S0)            : ${agg.S0}`)
  console.log(`Total stagnants S1/S2/S3          : ${agg.S1} / ${agg.S2} / ${agg.S3}`)
  console.log(`NOUVEAUX stagnants vs S0           : S1 +${agg.newS1}  ·  S2 +${agg.newS2}  ·  S3 +${agg.newS3}`)
  console.log(`Acteurs stagnants (doit être 0)   : ${agg.actors}`)
  console.log(`— Décomposition des nouveaux S1 (borne haute / bruit potentiel) :`)
  console.log(`    knowledge purs sans objet      : ${agg.knowledgePureNew}   ← flood attendu si S1`)
  console.log(`    resolved devenant stagnants    : ${agg.resolvedNew}   ← faux positifs (déjà résolus)`)
  console.log(`    unknown devenant stagnants     : ${agg.unknownNew}`)
  console.log(`    doublons Attention (objet/NC)  : ${agg.doublonNew}`)

  // ── Bella corpus témoin ──────────────────────────────────────────────────────
  console.log('\n════════════ BELLA — sujets témoins (le sujet doit-il être « stagnant » ?) ════════════')
  const nav = await getNavigableSubjectsForSite(BELLA)
  const re = await reopenedFor(BELLA)
  console.log(`${pad('Sujet', 12)}${pad('stagn(j)', 9)}${pad('ment', 5)}${pad('tri', 9)}${pad('famille', 15)}${pad('obj', 7)}${pad('reopen', 7)}S0 S1 S2 S3  tempOK`)
  for (const [cs, name] of Object.entries(BELLA_TEMOINS)) {
    const s = nav.find((x) => x.canonicalSubjectId === cs); if (!s) { console.log(`  ${name}: absent`); continue }
    const flags = ['S0', 'S1', 'S2', 'S3'].map((sc) => eligible(s, sc, re) ? '✓' : '·').join('  ')
    console.log(`${pad(name, 12)}${pad(String(s.stagnationDays), 9)}${pad(String(s.consecutiveMentionsWithoutChange), 5)}${pad(s.currentTriState, 9)}${pad(s.dominantFamily ?? 'null', 15)}${pad(`A${s.activeObjects.actionsOpen}/R${s.activeObjects.reservesOpen}/D${s.activeObjects.deadlinesActive}`, 7)}${pad(re.has(cs) ? 'oui' : 'non', 7)}${flags}   ${TEMP_OK(s) ? 'oui' : 'non'}`)
  }

  // ── Cas négatifs : business résolus/anciens sans attente d'évolution ──────────
  console.log('\n════════════ CAS NÉGATIFS — business légitimes SANS attente d\'évolution (garde anti-flood) ════════════')
  console.log('(business_subject, currentTriState=resolved, 0 objet ouvert, non reopened, ancien) — doivent rester NON stagnants sous S2/S3')
  let shown = 0
  for (const site of matched) {
    const navS = await getNavigableSubjectsForSite(site.id)
    const reS = await reopenedFor(site.id)
    for (const s of navS) {
      if (isBusiness(s) && s.currentTriState === 'resolved' && s.activeObjects.total === 0 && !reS.has(s.canonicalSubjectId) && s.stagnationDays >= 60 && !CLOSED.has(s.currentStatus ?? '')) {
        const under = (sc: string) => eligible(s, sc, reS) && TEMP_OK(s) ? sc : ''
        console.log(`  [${pad(site.name.slice(0, 10), 10)}] ${pad(s.title.slice(0, 38), 40)} ${s.stagnationDays}j tri=resolved → stagnant sous: ${['S0', 'S1', 'S2', 'S3'].map(under).filter(Boolean).join(',') || 'aucun'}`)
        if (++shown >= 12) break
      }
    }
    if (shown >= 12) break
  }
  if (shown === 0) console.log('  (aucun business resolved ancien ≥60 j sur ces sites)')

  console.log('\nHARD STOP — aucun code, aucun seuil, aucune migration. Décision règle stagnation = Vincent.')
}
main().catch((e) => { console.error(e); process.exit(1) })
