/**
 * #227 — AUDIT READ-ONLY de l'Aperçu (deriveSiteAttentionItems) vs états canonical.
 *
 * Ne modifie AUCUN code de production, AUCUNE règle d'attention, AUCUN seuil. N'injecte rien dans le
 * moteur. Sur Bella / OCEF / PETRO : mesure ce que l'Aperçu montre aujourd'hui, puis SIMULE séparément
 * ce que produiraient les occurrences canonical selon 3 scénarios :
 *   (1) reopened uniquement        — sujet dont la dernière transition observée = réouvert (résolu→ouvert)
 *   (2) open uniquement            — sujet dont la dernière preuve d'état = ouvert (currentTriState=open)
 *   (3) reopened OR open           — union (= open, reopened ⊆ open ; on isole open-non-reopened)
 *
 * Pour chaque scénario : candidats, déjà couverts par un item d'attention, réellement nouveaux, raison
 * d'absence, âge / dernier changement significatif, objets liés (action/réserve/deadline), exemples
 * nominaux. Classification INFORMATIVE (jamais de conclusion auto qu'un open doit devenir une attention) :
 *   RÉOUVERTURE_FORTE — résolu puis explicitement rouvert (candidat le plus fort)
 *   DOUBLON           — déjà représenté par un objet métier (action/réserve/deadline actif)
 *   OPEN_NU           — open sans objet ni couverture → le couple {âge, dernier changement} laissé au
 *                       lecteur pour trancher trou fonctionnel vs bruit potentiel (aucun seuil appliqué)
 *
 * READ-ONLY. HARD STOP après résultats. Exécuter :
 *   npx tsx --env-file=.env.local scripts/p1-227-apercu-audit.ts
 */
import { createClient } from '@supabase/supabase-js'
import { deriveSiteAttentionItems } from '../lib/knowledge/site-attention-items'
import { getNavigableSubjectsForSite } from '../lib/db/canonical-subject-life'
import { buildSiteSubjectCells, cellDeltaTransition } from '../lib/documents/site-occurrence-timeline'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const TARGET = /bella|ocef|petro/i
// Familles JAMAIS opérationnelles pour l'Aperçu (OPERATIONAL_EXCLUDED_FAMILIES du moteur). On NE pré-filtre
// PAS par kind : on rapporte le kind et on marque l'exclusion — l'exclusion elle-même est un résultat d'audit.
const EXCLUDED_KINDS = new Set(['person', 'company', 'knowledge_fact'])

function pad(s: string, n: number): string { return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length) }
function short(id: string): string { return id.slice(0, 8) }

async function resolveSites(): Promise<Array<{ id: string; name: string; histOcc: number; totalOcc: number }>> {
  const { data: sites } = await sb.from('sites').select('id, name')
  const matched = ((sites ?? []) as Array<{ id: string; name: string }>).filter((s) => TARGET.test(s.name))
  const out: Array<{ id: string; name: string; histOcc: number; totalOcc: number }> = []
  for (const s of matched) {
    const { count: h } = await sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('site_id', s.id).eq('source_kind', 'historical_pdf')
    const { count: t } = await sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('site_id', s.id)
    out.push({ id: s.id, name: s.name, histOcc: h ?? 0, totalOcc: t ?? 0 })
  }
  // On ne garde que les sites qui ont RÉELLEMENT des sujets canonical (sinon rien à auditer).
  return out.filter((s) => s.totalOcc > 0).sort((a, b) => a.name.localeCompare(b.name))
}

async function auditSite(site: { id: string; name: string; histOcc: number; totalOcc: number }) {
  console.log('\n════════════════════════════════════════════════════════════════════════════════')
  console.log(`CHANTIER : ${site.name}  [${short(site.id)}]`)
  console.log(`  corpus : ${site.histOcc} occurrences PV historiques · ${site.totalOcc} occurrences totales${site.histOcc === 0 ? '  ⚠ AUCUN CORPUS PV — reopened/open dérivés uniquement du natif (pas de trajectoire inter-PV)' : ''}`)
  console.log('════════════════════════════════════════════════════════════════════════════════')

  // ── État actuel de l'Aperçu ────────────────────────────────────────────────
  const attention = await deriveSiteAttentionItems(site.id)
  const coveredCs = new Set<string>()
  const bySignal = new Map<string, number>()
  for (const it of attention) {
    bySignal.set(it.signal, (bySignal.get(it.signal) ?? 0) + 1)
    const metaCs = (it.metadata as { canonicalSubjectId?: string } | undefined)?.canonicalSubjectId
    if (typeof metaCs === 'string') coveredCs.add(metaCs)
    const m = it.href.match(/sujets\/([0-9a-f-]{36})/)
    if (m) coveredCs.add(m[1])
  }
  console.log(`Aperçu ACTUEL : ${attention.length} items — ${[...bySignal].map(([s, n]) => `${s}:${n}`).join(', ') || '(aucun)'}`)
  console.log(`               sujets canonical couverts par un item : ${coveredCs.size}`)

  // ── Source de vérité : summaries + transitions cellulaires ───────────────────
  const nav = await getNavigableSubjectsForSite(site.id)
  const view = await buildSiteSubjectCells(site.id)

  // reopened = « ACTUELLEMENT rouvert » : la DERNIÈRE transition Chronologie (cellDeltaTransition sur la
  // dernière cellule non-null, contrat P0-2c) === 'réouvert'. Identique au chronoLast de la sonde P0-3.
  // (Un sujet rouvert PUIS re-résolu plus tard n'est donc pas compté : il est résolu maintenant.)
  const reopenedCs = new Set<string>()
  for (const row of view.rows) {
    const firstIdx = row.cells.findIndex((c) => c !== null)
    let lastIdx = -1
    for (let i = row.cells.length - 1; i >= 0; i--) { if (row.cells[i] !== null) { lastIdx = i; break } }
    if (lastIdx < 0) continue
    if (cellDeltaTransition(row.cells[lastIdx]!, lastIdx === firstIdx) === 'réouvert') reopenedCs.add(row.canonicalSubjectId)
  }

  // ── Ensembles candidats — TOUS les sujets (kind rapporté, PAS pré-filtré) ────
  const openSet = nav.filter((s) => s.currentTriState === 'open')
  const reopenedSet = nav.filter((s) => reopenedCs.has(s.canonicalSubjectId))
  const kindExcl = (s: (typeof nav)[number]) => EXCLUDED_KINDS.has(s.kind ?? '')

  console.log(`\nCandidats (tous kinds) : ${nav.length} sujets navigables`)
  console.log(`  · open (currentTriState=open)              : ${openSet.length}  (dont kind exclu attention : ${openSet.filter(kindExcl).length})`)
  console.log(`  · reopened (transition Chronologie réouvert) : ${reopenedSet.length}  (dont kind exclu attention : ${reopenedSet.filter(kindExcl).length})`)

  const classify = (s: (typeof nav)[number]): string => {
    if (reopenedCs.has(s.canonicalSubjectId)) return 'RÉOUVERTURE_FORTE'
    if (s.activeObjects.total > 0) return 'DOUBLON'
    return 'OPEN_NU'
  }

  const unionByCs = new Map<string, (typeof nav)[number]>()
  for (const s of [...reopenedSet, ...openSet]) unionByCs.set(s.canonicalSubjectId, s)
  const scenarios: Array<{ key: string; set: typeof nav }> = [
    { key: '(1) reopened uniquement', set: reopenedSet },
    { key: '(2) open uniquement', set: openSet },
    { key: '(3) reopened OR open', set: [...unionByCs.values()] }, // union dédupliquée
  ]

  for (const sc of scenarios) {
    const cand = sc.set
    const already = cand.filter((s) => coveredCs.has(s.canonicalSubjectId))
    const fresh = cand.filter((s) => !coveredCs.has(s.canonicalSubjectId))
    const tally = new Map<string, number>()
    for (const s of fresh) { const c = classify(s); tally.set(c, (tally.get(c) ?? 0) + 1) }
    const kindExclFresh = fresh.filter(kindExcl).length
    console.log(`\n  ▸ Scénario ${sc.key}`)
    console.log(`      candidats=${cand.length}  déjà couverts=${already.length}  réellement nouveaux=${fresh.length}  (dont bloqués par kind exclu : ${kindExclFresh})`)
    console.log(`      classification des nouveaux : ${[...tally].map(([k, n]) => `${k}:${n}`).join('  ') || '—'}`)
    const cap = sc.key.startsWith('(1)') ? fresh.length : Math.min(fresh.length, 16)
    for (const s of fresh.slice(0, cap)) {
      const cls = classify(s)
      const obj = `A${s.activeObjects.actionsOpen}/R${s.activeObjects.reservesOpen}/D${s.activeObjects.deadlinesActive}`
      const kx = kindExcl(s) ? ` ✗kind=${s.kind}` : ` kind=${s.kind}`
      const absence = kindExcl(s)
        ? `EXCLU par kind=${s.kind} (jamais opérationnel) — cause première d'absence`
        : (s.activeObjects.total > 0
            ? 'objet métier présent mais non remonté comme attention'
            : (s.isStagnant ? 'stagnant mais non capté' : 'aucun objet matérialisé + non stagnant → hors filtre actuel'))
      console.log(`        - [${cls}]${kx} ${pad(s.title, 44)} tri=${pad(s.currentTriState, 8)} lastChg=${s.lastMeaningfulChangeAt ?? 'null'} stagn=${s.stagnationDays}j obj=${obj}`)
      console.log(`            absence: ${absence}`)
    }
    if (fresh.length > cap) console.log(`        … +${fresh.length - cap} autres nouveaux non listés`)
  }
}

async function main() {
  const sites = await resolveSites()
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
  console.log('║  #227 — AUDIT READ-ONLY Aperçu vs états canonical · Bella / OCEF / PETRO         ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  console.log(`Sites ciblés (${sites.length}) : ${sites.map((s) => `${s.name}[${short(s.id)}]`).join('  ·  ')}`)
  console.log('RAPPEL : aucune conclusion auto « open ⇒ attention ». Classification informative ; le couple')
  console.log('         {âge, dernier changement} d\'un OPEN_NU est laissé au lecteur (trou vs bruit). HARD STOP après.')
  for (const s of sites) await auditSite(s)
  console.log('\n════════════════════════════════════════════════════════════════════════════════')
  console.log('FIN AUDIT — READ-ONLY. Aucun correctif appliqué. HARD STOP.')
}
main().catch((e) => { console.error(e); process.exit(1) })
