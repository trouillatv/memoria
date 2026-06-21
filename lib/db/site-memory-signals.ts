// MÉMOIRE CHANTIER — bibliothèque de DÉTECTEURS déterministes (Vincent 2026-06-21).
// « Préparer la réunion » : MemorIA dit ce qui traîne AVANT la réunion — ce qu'un
// humain ne fait jamais de façon fiable. 100 % déterministe (zéro IA, zéro LLM) :
// chaque détecteur = une fonction pure mémoire → MemorySignal[]. Réutilisable plus
// tard par la recherche (P3) et les détecteurs avancés (P4) — pas un truc jetable.
//
// Garde-fous (discipline d'apparition) : on ne lève un signal que s'il appelle une
// ACTION ; wording DESCRIPTIF, calme (pas d'alerte rouge) ; « acteur absent » porte
// sur une ENTREPRISE externe (fiabilité chantier), jamais une personne interne ;
// chaque signal est EXPLICABLE (champ `source`).
import { createAdminClient } from '@/lib/supabase/admin'
import { detectNeglectedObligations } from '@/lib/db/obligations'

export type SignalKind = 'actor_congestion' | 'recurring_topic' | 'action_overdue' | 'decision_unapplied' | 'actor_absent' | 'reserve_open' | 'obligation_neglected'

export interface SignalItem {
  id: string
  label: string
  meta?: string | null
  // CONTEXTE / HISTORIQUE déterministe (Vincent P3) : « ouvert depuis 72 j », origine,
  // dernière échéance annoncée. Raconte l'histoire de l'élément, sans LLM.
  context?: string[]
}
export interface MemorySignal {
  kind: SignalKind
  title: string            // « 3 actions en retard »
  items: SignalItem[]      // le détail actionnable
  source: string           // explicabilité : « d'où ça vient »
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
function ddmmyyyy(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}
function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86400000)
}
function daysSince(iso: string | null, asOf: string): number | null {
  if (!iso) return null
  const d = daysBetween(iso, asOf)
  return d >= 0 ? d : null
}

/** ACTIONS EN RETARD : ouvertes dont l'échéance est dépassée. */
export async function detectOverdueActions(siteId: string, asOf = todayIso()): Promise<MemorySignal | null> {
  const { data } = await createAdminClient()
    .from('site_actions')
    .select('id, title, assigned_to, due_date, status, created_at')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .not('due_date', 'is', null)
    .lte('due_date', asOf)
    .order('due_date', { ascending: true })
  const rows = data ?? []
  if (rows.length === 0) return null
  return {
    kind: 'action_overdue',
    title: `${rows.length} action${rows.length > 1 ? 's' : ''} en retard`,
    items: rows.map((a) => {
      const due = a.due_date as string
      const lateBy = daysBetween(due, asOf)
      const openSince = daysSince(a.created_at as string | null, asOf)
      return {
        id: a.id as string,
        label: a.title as string,
        meta: [a.assigned_to as string | null, `échéance ${ddmmyyyy(due)}`].filter(Boolean).join(' · '),
        context: [
          lateBy > 0 ? `En retard de ${lateBy} j (dernière échéance annoncée : ${ddmmyyyy(due)})` : null,
          openSince != null ? `Ouverte depuis ${openSince} j` : null,
        ].filter((x): x is string => !!x),
      }
    }),
    source: 'Actions ouvertes (site_actions) dont l’échéance est passée.',
  }
}

/** DÉCISIONS JAMAIS APPLIQUÉES : actées, mais échéance dépassée — ou actées depuis
 *  longtemps (> seuil) sans passer « appliquée ». */
export async function detectUnappliedDecisions(siteId: string, asOf = todayIso(), staleDays = 30): Promise<MemorySignal | null> {
  const { data } = await createAdminClient()
    .from('site_decisions')
    .select('id, titre, sujet, statut, echeance, date_decision')
    .eq('site_id', siteId)
    .eq('statut', 'actee')
    .order('date_decision', { ascending: true })
  const rows = (data ?? []).filter((d) => {
    const ech = d.echeance as string | null
    if (ech) return ech <= asOf // échéance d'application dépassée
    const dd = d.date_decision as string | null
    return dd ? daysBetween(dd, asOf) >= staleDays : false // actée et vieille sans suite
  })
  if (rows.length === 0) return null
  return {
    kind: 'decision_unapplied',
    title: `${rows.length} décision${rows.length > 1 ? 's' : ''} jamais appliquée${rows.length > 1 ? 's' : ''}`,
    items: rows.map((d) => {
      const ech = d.echeance as string | null
      const dd = d.date_decision as string | null
      const ageD = daysSince(dd, asOf)
      const age = ageD != null ? `prise il y a ${ageD} j` : null
      return {
        id: d.id as string,
        label: d.titre as string,
        meta: [d.sujet as string | null, ech ? `échéance ${ddmmyyyy(ech)}` : age].filter(Boolean).join(' · '),
        context: [
          dd ? `Actée le ${ddmmyyyy(dd)}${ageD != null ? ` (il y a ${ageD} j)` : ''}, jamais passée « appliquée »` : null,
          ech ? `Échéance d'application : ${ddmmyyyy(ech)}${ech <= asOf ? ` — dépassée de ${daysBetween(ech, asOf)} j` : ''}` : null,
        ].filter((x): x is string => !!x),
      }
    }),
    source: 'Décisions actées (site_decisions) jamais passées « appliquée », échéance ou ancienneté dépassée.',
  }
}

/** RÉSERVES OUVERTES : dressées, pas encore levées. */
export async function detectOpenReserves(siteId: string, asOf = todayIso()): Promise<MemorySignal | null> {
  const { data } = await createAdminClient()
    .from('site_reserve')
    .select('id, label, location, issued_on, status')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .order('issued_on', { ascending: true })
  const rows = data ?? []
  if (rows.length === 0) return null
  return {
    kind: 'reserve_open',
    title: `${rows.length} réserve${rows.length > 1 ? 's' : ''} ouverte${rows.length > 1 ? 's' : ''}`,
    items: rows.map((r) => {
      const issued = r.issued_on as string | null
      const openSince = daysSince(issued, asOf)
      return {
        id: r.id as string,
        label: r.label as string,
        meta: [r.location as string | null, issued ? `émise le ${ddmmyyyy(issued)}` : null].filter(Boolean).join(' · '),
        context: [
          openSince != null ? `Ouverte depuis ${openSince} j (émise le ${ddmmyyyy(issued)})` : null,
          r.location ? `Localisation : ${r.location as string}` : null,
        ].filter((x): x is string => !!x),
      }
    }),
    source: 'Réserves non levées (site_reserve, status « open »).',
  }
}

/** ENGORGEMENT / CONCENTRATION (Vincent 2026-06-21) — le seul détecteur qui ANTICIPE.
 *  Les problèmes de chantier se concentrent souvent autour d'UN acteur. Si une
 *  entreprise (responsable des actions ouvertes) concentre ≥ seuil du total, on le
 *  dit AVANT la réunion : « cette réunion va surtout parler de X ». Déterministe :
 *  actions ouvertes groupées par responsable. */
export async function detectActorCongestion(siteId: string, minActions = 4, shareThreshold = 0.4, asOf = todayIso()): Promise<MemorySignal | null> {
  const { data } = await createAdminClient()
    .from('site_actions')
    .select('id, assigned_to, due_date, status')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .not('assigned_to', 'is', null)
  const rows = data ?? []
  if (rows.length < minActions) return null
  const byActor = new Map<string, { actor: string; total: number; overdue: number }>()
  for (const a of rows) {
    const actor = (a.assigned_to as string).trim()
    if (!actor) continue
    const g = byActor.get(actor.toLowerCase()) ?? { actor, total: 0, overdue: 0 }
    g.total++
    if (a.due_date && (a.due_date as string) <= asOf) g.overdue++
    byActor.set(actor.toLowerCase(), g)
  }
  const total = rows.length
  const flagged = [...byActor.values()].filter((g) => g.total / total >= shareThreshold).sort((a, b) => b.total - a.total)
  if (flagged.length === 0) return null
  return {
    kind: 'actor_congestion',
    title: `Concentration des sujets ouverts`,
    items: flagged.map((g) => ({
      id: g.actor,
      label: g.actor,
      meta: `${Math.round((g.total / total) * 100)} % des actions ouvertes du chantier · ${g.total} action${g.total > 1 ? 's' : ''}${g.overdue ? `, ${g.overdue} en retard` : ''}`,
    })),
    source: 'Actions ouvertes (site_actions) groupées par responsable : un acteur ≥ 40 % du total.',
  }
}

/** SUJETS RÉCURRENTS NON RÉSOLUS (Vincent : « ce qui va forcément revenir demain »).
 *  Un `sujet` (clé human de site_decisions) discuté dans ≥N réunions distinctes et
 *  jamais clôturé (aucune décision « appliquée »). Déterministe — dépend du remplissage
 *  du champ `sujet` (qu'on encourage). Le plus tourné vers l'AVENIR des détecteurs. */
export async function detectRecurringTopics(siteId: string, threshold = 2): Promise<MemorySignal | null> {
  const { data } = await createAdminClient()
    .from('site_decisions')
    .select('id, sujet, statut, date_decision, report_id')
    .eq('site_id', siteId)
    .not('sujet', 'is', null)
  const groups = new Map<string, { sujet: string; reports: Set<string>; resolved: boolean; lastDate: string | null }>()
  for (const d of data ?? []) {
    const raw = ((d.sujet as string | null) ?? '').trim()
    if (!raw) continue
    const key = raw.toLowerCase()
    const g = groups.get(key) ?? { sujet: raw, reports: new Set<string>(), resolved: false, lastDate: null }
    if (d.report_id) g.reports.add(d.report_id as string)
    if (d.statut === 'appliquee') g.resolved = true
    const dd = d.date_decision as string | null
    if (dd && (!g.lastDate || dd > g.lastDate)) g.lastDate = dd
    groups.set(key, g)
  }
  const flagged = [...groups.values()].filter((g) => g.reports.size >= threshold && !g.resolved)
  if (flagged.length === 0) return null
  return {
    kind: 'recurring_topic',
    title: `${flagged.length} sujet${flagged.length > 1 ? 's' : ''} récurrent${flagged.length > 1 ? 's' : ''} non résolu${flagged.length > 1 ? 's' : ''}`,
    items: flagged.map((g) => ({
      id: g.sujet,
      label: g.sujet,
      meta: `discuté dans ${g.reports.size} réunions${g.lastDate ? ` · dernière le ${ddmmyyyy(g.lastDate)}` : ''} · toujours non résolu`,
    })),
    source: 'Sujets (site_decisions.sujet) revenant dans ≥2 réunions sans décision « appliquée ».',
  }
}

/** ACTEUR ABSENT DEPUIS N CR — CONTEXTUALISÉ (Vincent : sinon = bruit). Une ENTREPRISE
 *  en AN sur les N derniers CR consécutifs N'EST un signal QUE si elle a aussi des
 *  ACTIONS OUVERTES qui lui sont attribuées (sinon : lot fini / hors phase = pas un
 *  problème). Descriptif, niveau organisme — jamais une personne interne. */
export async function detectRepeatedAbsences(siteId: string, threshold = 3, windowSize = 8): Promise<MemorySignal | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('site_reports')
    .select('id, participants, created_at')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(windowSize)
  const reports = data ?? []
  if (reports.length < threshold) return null
  // Pour chaque organisme, longueur de la série d'AN consécutifs en partant du + récent.
  const streak = new Map<string, number>()
  const broken = new Set<string>()
  for (const rep of reports) {
    const parts = (rep.participants ?? []) as { role?: string | null; presence?: string | null }[]
    const seen = new Map<string, string>()
    for (const p of parts) {
      const org = (p.role ?? '').trim()
      if (org) seen.set(org, p.presence ?? 'P')
    }
    for (const [org, pres] of seen) {
      if (broken.has(org)) continue
      if (pres === 'AN') streak.set(org, (streak.get(org) ?? 0) + 1)
      else broken.add(org)
    }
  }
  const candidates = [...streak.entries()].filter(([org, n]) => !broken.has(org) && n >= threshold)
  if (candidates.length === 0) return null
  // Contextualisation : ne garder que les entreprises avec des actions OUVERTES attribuées.
  const { data: openActions } = await sb
    .from('site_actions')
    .select('id, title, assigned_to')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .not('assigned_to', 'is', null)
  const norm = (s: string) => s.toLowerCase().trim()
  const flagged = candidates
    .map(([org, n]) => {
      const acts = (openActions ?? []).filter((a) => norm(a.assigned_to as string).includes(norm(org)) || norm(org).includes(norm(a.assigned_to as string)))
      return { org, n, acts }
    })
    .filter((x) => x.acts.length > 0)
  if (flagged.length === 0) return null
  return {
    kind: 'actor_absent',
    title: `${flagged.length} entreprise${flagged.length > 1 ? 's' : ''} absente${flagged.length > 1 ? 's' : ''} avec des actions en attente`,
    items: flagged.map((f) => ({
      id: f.org,
      label: f.org,
      meta: `absente des ${f.n} dernières réunions · ${f.acts.length} action(s) ouverte(s) : ${f.acts.map((a) => a.title as string).join(', ')}`,
    })),
    source: 'AN consécutif ≥ seuil ET ≥1 action ouverte attribuée (sinon : bruit, lot fini / hors phase).',
  }
}

/** Tous les signaux « Préparer la réunion » d'un site (détecteurs ACTIFS).
 *
 *  NOTE V1 (Vincent 2026-06-21) : `detectRecurringTopics` est VOLONTAIREMENT exclu —
 *  basé sur le texte libre `site_decisions.sujet`, il fragmente (« DOE » / « DOE lot
 *  CFO » = 2 sujets) et rate les vrais récurrents → bruit/faux négatifs. La fonction
 *  reste pour une V2 fondée sur des OBJETS RÉOUVERTS (actions/décisions/réserves
 *  rouvertes), qui demande un historique de statut (à instrumenter). Une réunion mal
 *  détectée est gênante ; une réunion perdue est catastrophique → priorité ailleurs. */
export async function buildSiteMemorySignals(siteId: string, asOf = todayIso()): Promise<MemorySignal[]> {
  const [congestion, obligations, overdue, decisions, absences, reserves] = await Promise.all([
    detectActorCongestion(siteId, 4, 0.4, asOf), // en TÊTE : le seul qui anticipe « où ça va se concentrer »
    detectNeglectedObligations(siteId),          // obligations prescriptives négligées (DOE, journal photo…)
    detectOverdueActions(siteId, asOf),
    detectUnappliedDecisions(siteId, asOf),
    detectRepeatedAbsences(siteId),
    detectOpenReserves(siteId, asOf),
  ])
  return [congestion, obligations, overdue, decisions, absences, reserves].filter((s): s is MemorySignal => s !== null)
}

export interface SuggestedQuestion { question: string; why: string | null }

/** QUESTIONS À POSER (Vincent : « probablement ce qu'Émeline utilisera le plus »).
 *  Déterministe : signal mémoire → question associée + son POURQUOI (Vincent : sinon
 *  ça ressemble à un assistant qui balance des questions sans justification). AUCUN
 *  LLM créatif — gabarit par type, appliqué aux items réels ; `why` = la donnée qui
 *  a déclenché le signal (échéance, ancienneté…). Cap à quelques-unes par type. */
export function buildSuggestedQuestions(signals: MemorySignal[], perKind = 3): SuggestedQuestion[] {
  const out: SuggestedQuestion[] = []
  for (const s of signals) {
    for (const it of s.items.slice(0, perKind)) {
      const why = it.meta ?? s.source
      let question = ''
      switch (s.kind) {
        case 'actor_congestion': question = `La réunion va beaucoup tourner autour de ${it.label} — prévoir un point dédié ?`; break
        case 'recurring_topic': question = `Le sujet « ${it.label} » revient depuis plusieurs réunions — peut-on le clôturer ?`; break
        case 'action_overdue': question = `Où en est l'action « ${it.label} » ?`; break
        case 'decision_unapplied': question = `La décision « ${it.label} » a-t-elle été appliquée ?`; break
        case 'actor_absent': question = `${it.label} est absente — qui reprend ses actions en attente ?`; break
        case 'reserve_open': question = `La réserve « ${it.label} » est-elle levée ?`; break
        case 'obligation_neglected': question = `Obligation « ${it.label} » — où en est-on ? (à rappeler à ${it.meta ?? 'l\'entreprise'})`; break
      }
      if (question) out.push({ question, why })
    }
  }
  return out
}
