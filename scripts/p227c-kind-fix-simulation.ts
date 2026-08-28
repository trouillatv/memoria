/**
 * #228 — SIMULATION READ-ONLY du correctif « éligibilité opérationnelle = kind durable stocké ».
 *
 * Aucun code moteur modifié. On REPRODUIT localement la décision actuelle et la décision proposée, et on
 * chiffre l'écart, AVANT tout code. Le correctif proposé : baser l'opérationnel sur canonical_subject.kind
 * STOCKÉ (business_subject/NULL → opérationnel ; actor → non) au lieu du kind CALCULÉ (famille de la 1re
 * occurrence). STAGNATION_INELIGIBLE reste INCHANGÉE ici (auditée séparément — 2e lot) : la simulation
 * n'ajoute donc AUCUN nouveau stagnant, seulement des sujets rendus éligibles à l'analyse.
 *
 * Critère de sécurité prouvé par la sim : business_subject éligible ≠ business_subject mérite attention.
 * Les gates aval existants (objets ouverts / non-conformité / réservation / awaiting / stagnation)
 * décident seuls des cartes d'attention. Un knowledge pur sans objet reste CALME.
 *
 * READ-ONLY. HARD STOP. Exécuter : npx tsx --env-file=.env.local scripts/p227c-kind-fix-simulation.ts
 */
import { createClient } from '@supabase/supabase-js'
import { getNavigableSubjectsForSite, type NavigableSubjectSummary } from '../lib/db/canonical-subject-life'
import { isOperationalSubject } from '../lib/subjects/kind'
import { buildSiteSubjectCells, cellDeltaTransition } from '../lib/documents/site-occurrence-timeline'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const TARGET = /bella|ocef|petro/i
const CLOSED = new Set(['done', 'cancelled', 'not_applicable'])
const OPEN_NAV = new Set(['open', 'in_progress', 'still_open', 'non_compliant', 'planned', 'awaiting_validation', 'field_checked'])
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const TEMOINS: Record<string, string> = {
  '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9': 'A électrique', 'b78526f9-9dc6-43f7-8edb-e4278f207988': 'B cuisson',
  '22bef24e-3a1a-4566-beca-c5a5c845dd1d': 'C nettoyage', '75da7744-287d-47fd-80d8-e62ea1660ca1': 'D flux',
  'cc12fce6-8780-4f93-88a1-21905a37325b': 'E éclairage',
}
function pad(s: string, n: number): string { return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length) }

// Réplique EXACTE de computeAttentionSignals, mais avec `isOperational` paramétrable (pour simuler l'après).
// STAGNATION inchangée : on lit s.isStagnant tel que le serveur le calcule aujourd'hui.
function attentionReasons(s: NavigableSubjectSummary, isOperational: boolean): string[] {
  const isClosed = CLOSED.has(s.currentStatus ?? '')
  if (isClosed || !isOperational) return []
  const r: string[] = []
  if (s.activeObjects.total > 0) r.push('open_objects')
  if (s.currentStatus === 'non_compliant') r.push('non_conformity')
  if (s.kind === 'reservation') r.push('reservation')
  if (s.currentStatus === 'awaiting_validation') r.push('awaiting')
  if (s.isStagnant) r.push('stagnant')
  return r
}
// Réplique de navSortPriority (bucket grille), isOperational paramétrable.
function bucket(s: NavigableSubjectSummary, isOperational: boolean): 0 | 1 | 2 | 3 {
  if (!isOperational) return 2
  const isOpen = OPEN_NAV.has(s.currentStatus ?? '')
  if (s.isStagnant && isOpen) return 0
  if (!s.isStagnant && isOpen) return 1
  if (CLOSED.has(s.currentStatus ?? '')) return 3
  return 2
}
const BUCKET_NAME = ['à-surveiller', 'en-mouvement', 'informatif', 'clos']

async function resolveSites() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const matched = ((sites ?? []) as Array<{ id: string; name: string }>).filter((s) => TARGET.test(s.name))
  const out: Array<{ id: string; name: string }> = []
  for (const s of matched) {
    const { count } = await sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('site_id', s.id)
    if ((count ?? 0) > 0) out.push(s)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
  console.log('║  #228 — SIMULATION READ-ONLY : opérationnel = kind durable stocké                ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  console.log('AVANT = isOperationalSubject(kind calculé)   APRÈS = (kind stocké ≠ actor)')
  console.log('STAGNATION_INELIGIBLE INCHANGÉE → aucun nouveau stagnant simulé ici (2e lot dédié).\n')

  const sites = await resolveSites()
  const rows: string[][] = []
  const bellaDetail: Array<{ label: string; cs: string; stored: string; calc: string; tri: string; opAv: boolean; opAp: boolean; reasonsAv: string[]; reasonsAp: string[] }> = []

  for (const site of sites) {
    const nav = await getNavigableSubjectsForSite(site.id)
    if (nav.length === 0) continue
    const csIds = nav.map((s) => s.canonicalSubjectId)
    const stored = new Map<string, string>()
    for (let i = 0; i < csIds.length; i += 300) {
      const { data } = await sb.from('canonical_subject').select('id, kind').in('id', csIds.slice(i, i + 300))
      for (const r of (data ?? []) as Array<{ id: string; kind: string }>) stored.set(r.id, r.kind)
    }
    // familles d'occurrences par cs (pour "knowledge pur")
    const { data: occRows } = await sb.from('canonical_subject_occurrence').select('canonical_subject_id, state_key')
      .eq('site_id', site.id).eq('source_kind', 'historical_pdf').not('validation_status', 'in', '("rejected","source_superseded")').limit(100000)
    const famByCs = new Map<string, Set<string>>()
    for (const o of (occRows ?? []) as Array<{ canonical_subject_id: string; state_key: string }>) {
      const set = famByCs.get(o.canonical_subject_id) ?? new Set(); set.add(o.state_key); famByCs.set(o.canonical_subject_id, set)
    }
    // reopened (dernière transition Chronologie = réouvert)
    const reopened = new Set<string>()
    const view = await buildSiteSubjectCells(site.id)
    for (const row of view.rows) {
      const firstIdx = row.cells.findIndex((c) => c !== null)
      let lastIdx = -1; for (let i = row.cells.length - 1; i >= 0; i--) if (row.cells[i]) { lastIdx = i; break }
      if (lastIdx >= 0 && cellDeltaTransition(row.cells[lastIdx]!, lastIdx === firstIdx) === 'réouvert') reopened.add(row.canonicalSubjectId)
    }

    const opAvant = (s: NavigableSubjectSummary) => isOperationalSubject(s.kind) && !CLOSED.has(s.currentStatus ?? '')
    const opApres = (s: NavigableSubjectSummary) => (stored.get(s.canonicalSubjectId) ?? 'business_subject') !== 'actor' && !CLOSED.has(s.currentStatus ?? '')

    const eligAv = nav.filter(opAvant), eligAp = nav.filter(opApres)
    const flip = nav.filter((s) => !opAvant(s) && opApres(s))
    const actorsIncluded = eligAp.filter((s) => (stored.get(s.canonicalSubjectId) ?? '') === 'actor')
    const attnAv = nav.filter((s) => attentionReasons(s, opAvant(s)).length > 0)
    const attnAp = nav.filter((s) => attentionReasons(s, opApres(s)).length > 0)
    const stagAv = nav.filter((s) => s.isStagnant && opAvant(s))
    const stagAp = nav.filter((s) => s.isStagnant && opApres(s))
    // knowledge pur qui bascule opérationnel MAIS reste calme (0 raison)
    const flipCalm = flip.filter((s) => {
      const fams = famByCs.get(s.canonicalSubjectId) ?? new Set()
      const pureKnowledge = fams.size > 0 && [...fams].every((f) => f === 'knowledge_fact')
      return pureKnowledge && attentionReasons(s, true).length === 0
    })
    const flipWithSignal = flip.filter((s) => attentionReasons(s, true).length > 0)
    const openObj = flip.filter((s) => s.activeObjects.total > 0)
    const openState = flip.filter((s) => s.currentTriState === 'open')
    const reopenedFlip = flip.filter((s) => reopened.has(s.canonicalSubjectId))

    // buckets grille AVANT/APRÈS
    const bAv = [0, 0, 0, 0], bAp = [0, 0, 0, 0]
    for (const s of nav) { bAv[bucket(s, opAvant(s))]++; bAp[bucket(s, opApres(s))]++ }

    console.log(`── ${site.name} [${site.id.slice(0, 8)}] — ${nav.length} sujets navigables`)
    console.log(`   opérationnel-éligible : AVANT ${eligAv.length} → APRÈS ${eligAp.length}   (flip informatif→opérationnel : ${flip.length})`)
    console.log(`   grille buckets AVANT : ${bAv.map((n, i) => `${BUCKET_NAME[i]}=${n}`).join(' ')}`)
    console.log(`   grille buckets APRÈS : ${bAp.map((n, i) => `${BUCKET_NAME[i]}=${n}`).join(' ')}`)
    console.log(`   sujets avec ≥1 signal d'attention (SubjectCard) : AVANT ${attnAv.length} → APRÈS ${attnAp.length}`)
    console.log(`   stagnants (règle inchangée)   : AVANT ${stagAv.length} → APRÈS ${stagAp.length}`)
    console.log(`   acteurs inclus par erreur APRÈS : ${actorsIncluded.length}`)
    console.log(`   flip → avec vrai signal opérationnel : ${flipWithSignal.length}  · knowledge pur restant CALME : ${flipCalm.length}`)
    console.log(`   flip → objet ouvert : ${openObj.length}  · état open : ${openState.length}  · reopened : ${reopenedFlip.length}  · doublon potentiel (objet présent) : ${openObj.length}`)
    console.log('')
    rows.push([site.name.slice(0, 22), `${eligAv.length}→${eligAp.length}`, `${flip.length}`, `${attnAv.length}→${attnAp.length}`, `${stagAv.length}→${stagAp.length}`, `${actorsIncluded.length}`, `${flipWithSignal.length}`, `${flipCalm.length}`])

    if (site.id === BELLA) {
      for (const [cs, name] of Object.entries(TEMOINS)) {
        const s = nav.find((x) => x.canonicalSubjectId === cs); if (!s) continue
        bellaDetail.push({ label: name, cs, stored: stored.get(cs) ?? '?', calc: s.kind ?? 'null', tri: s.currentTriState, opAv: opAvant(s), opAp: opApres(s), reasonsAv: attentionReasons(s, opAvant(s)), reasonsAp: attentionReasons(s, opApres(s)) })
      }
      // acteurs Bella (kind stocké=actor)
      const actors = nav.filter((s) => (stored.get(s.canonicalSubjectId) ?? '') === 'actor')
      for (const a of actors.slice(0, 6)) bellaDetail.push({ label: `[ACTEUR] ${a.title.slice(0, 22)}`, cs: a.canonicalSubjectId, stored: 'actor', calc: a.kind ?? 'null', tri: a.currentTriState, opAv: opAvant(a), opAp: opApres(a), reasonsAv: attentionReasons(a, opAvant(a)), reasonsAp: attentionReasons(a, opApres(a)) })
      // 1 knowledge pur (business, familles ⊆ knowledge_fact, 0 objet) qui reste calme
      const pureEx = nav.find((s) => {
        const fams = famByCs.get(s.canonicalSubjectId) ?? new Set()
        return (stored.get(s.canonicalSubjectId) ?? '') === 'business_subject' && fams.size > 0 && [...fams].every((f) => f === 'knowledge_fact') && s.activeObjects.total === 0 && attentionReasons(s, true).length === 0
      })
      if (pureEx) bellaDetail.push({ label: `[KNOW-PUR] ${pureEx.title.slice(0, 20)}`, cs: pureEx.canonicalSubjectId, stored: 'business_subject', calc: pureEx.kind ?? 'null', tri: pureEx.currentTriState, opAv: opAvant(pureEx), opAp: opApres(pureEx), reasonsAv: attentionReasons(pureEx, opAvant(pureEx)), reasonsAp: attentionReasons(pureEx, opApres(pureEx)) })
    }
  }

  console.log('════════════════════════════════════════════════════════════════════════════════')
  console.log('SYNTHÈSE  (élig=opérationnel-éligible · attn=sujets avec signal · stag=stagnants)')
  console.log('════════════════════════════════════════════════════════════════════════════════')
  console.log(`${pad('Chantier', 24)}${pad('élig', 12)}${pad('flip', 6)}${pad('attn', 12)}${pad('stag', 10)}${pad('actErr', 8)}${pad('flip+sig', 9)}calmes`)
  for (const r of rows) console.log(`${pad(r[0], 24)}${pad(r[1], 12)}${pad(r[2], 6)}${pad(r[3], 12)}${pad(r[4], 10)}${pad(r[5], 8)}${pad(r[6], 9)}${r[7]}`)

  console.log('\n════════════════════════════════════════════════════════════════════════════════')
  console.log('BELLA — témoins obligatoires (opérationnel AVANT→APRÈS, signaux d\'attention)')
  console.log('════════════════════════════════════════════════════════════════════════════════')
  console.log(`${pad('Sujet', 30)}${pad('stocké', 16)}${pad('calculé', 14)}${pad('tri', 9)}${pad('op AV→AP', 12)}attention AV→AP`)
  for (const d of bellaDetail) {
    console.log(`${pad(d.label, 30)}${pad(d.stored, 16)}${pad(d.calc, 14)}${pad(d.tri, 9)}${pad(`${d.opAv ? 'oui' : 'non'}→${d.opAp ? 'oui' : 'non'}`, 12)}[${d.reasonsAv.join(',') || '∅'}]→[${d.reasonsAp.join(',') || '∅'}]`)
  }
  console.log('\nCritère de sécurité : « flip » nombreux mais « attn APRÈS » ne doit croître que des sujets à VRAI signal ;')
  console.log('acteurs inclus par erreur = 0 ; knowledge purs = calmes (∅→∅). HARD STOP, aucun code moteur.')
}
main().catch((e) => { console.error(e); process.exit(1) })
