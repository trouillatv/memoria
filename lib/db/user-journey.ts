// Analyse d'usage par personne — OBSERVATION PRODUIT, jamais évaluation RH.
//
// Doctrine (ouverture encadrée, board 2026-06-23) :
//   - Décrit l'usage de l'OUTIL (quels menus, quel parcours), pas la personne.
//   - Aucune note, aucun « temps passé » mis en avant, aucune mise en regard
//     d'autres comptes. La consultation de cette vue est elle-même auditée
//     (tripwire) côté page.
//   - 100 % déterministe : on regroupe et on compte des événements déjà tracés
//     (activity_logs : page views + actions). Aucun LLM.
//
// Réutilise activity_logs (entity_type='page', action='view', metadata.route)
// alimenté par logPageViewAction. Aucune migration.

import { createAdminClient } from '@/lib/supabase/admin'
import { NAV } from '@/components/layout/nav-items'
import type { UserRole } from '@/types/db'

export interface JourneyEvent {
  at: string                    // ISO
  kind: 'page' | 'action'
  label: string                 // libellé lisible
  isReturn: boolean             // page déjà vue plus tôt dans la même session
  device: string | null
}

export interface JourneySession {
  startAt: string
  endAt: string
  events: JourneyEvent[]
}

export interface HeatmapEntry {
  label: string
  count: number
  pct: number
}

export interface FrictionSignal {
  sessionStartAt: string
  label: string
  repeats: number
  windowMinutes: number
}

export interface UserJourney {
  totalEvents: number
  firstAt: string | null
  lastAt: string | null
  sessions: JourneySession[]      // plus récente d'abord
  heatmapUsed: HeatmapEntry[]     // pages les plus ouvertes (desc)
  neverOpened: string[]           // menus cœur jamais ouverts sur la période
  frictions: FrictionSignal[]
}

// ── Nommage des routes ────────────────────────────────────────────────────

// Détail (routes dynamiques /xxx/<id>/…) → libellé lisible. Ordre = priorité.
const ROUTE_PATTERNS: Array<[RegExp, string]> = [
  [/^\/sites\/[^/]+\/subjects/, 'Sujets'],
  [/^\/sites\/[^/]+\/obligations/, 'Obligations'],
  [/^\/sites\/[^/]+\/preuves/, 'Dossier de preuve'],
  [/^\/sites\/[^/]+\/livraisons/, 'Livraisons'],
  [/^\/sites\/[^/]+\/reserves/, 'Points à lever'],
  [/^\/sites\/[^/]+\/journal/, 'Journal'],
  [/^\/sites\/[^/]+\/scopes/, 'Sous-périmètres'],
  [/^\/sites\/[^/]+\/qr/, 'QR chantier'],
  [/^\/sites\/[^/]+$/, 'Site (fiche)'],
  [/^\/meetings\/[^/]+\/pv\/validation/, 'Validation PV'],
  [/^\/meetings\/[^/]+\/briefing/, 'Briefing réunion'],
  [/^\/meetings\/[^/]+$/, 'Réunion (fiche)'],
  [/^\/tenders\/[^/]+\/engagements/, 'Engagements'],
  [/^\/tenders\/[^/]+\/audit/, 'Audit documentaire'],
  [/^\/tenders\/[^/]+\/convert/, 'Conversion en contrat'],
  [/^\/tenders\/[^/]+$/, 'Dossier de démarrage (fiche)'],
  [/^\/contracts\/[^/]+\/rapport-mensuel/, 'Rapport mensuel'],
  [/^\/contracts\/[^/]+$/, 'Contrat (fiche)'],
  [/^\/clients\/[^/]+$/, 'Client (fiche)'],
  [/^\/equipes\/[^/]+$/, 'Équipe (fiche)'],
  [/^\/intervenants\/[^/]+$/, 'Intervenant (fiche)'],
  [/^\/handovers\/[^/]+$/, 'Passation (fiche)'],
  [/^\/preuves\/[^/]+$/, 'Preuve (fiche)'],
  [/^\/documents\/[^/]+$/, 'Document (fiche)'],
]

// href exact → label (depuis la nav officielle).
const EXACT_LABEL = new Map<string, string>(NAV.map((n) => [n.href, n.label]))

// Top-niveau (1er segment) → libellé de section, pour la heatmap.
const TOP_LABEL = new Map<string, string>()
for (const n of NAV) {
  const seg = n.href.split('/')[1] ?? ''
  if (seg && !TOP_LABEL.has(seg)) TOP_LABEL.set(seg, n.label)
}
TOP_LABEL.set('account', 'Mon compte')
TOP_LABEL.set('comprendre', 'Guides')

function labelForRoute(route: string): string {
  const clean = route.split('?')[0] ?? route
  const exact = EXACT_LABEL.get(clean)
  if (exact) return exact
  for (const [re, label] of ROUTE_PATTERNS) if (re.test(clean)) return label
  const seg = clean.split('/')[1] ?? ''
  return TOP_LABEL.get(seg) ?? clean
}

function topLabelForRoute(route: string): string {
  const clean = route.split('?')[0] ?? route
  const seg = clean.split('/')[1] ?? ''
  return TOP_LABEL.get(seg) ?? (seg ? `/${seg}` : 'Accueil')
}

// Événement non-page (création, ouverture…) → phrase descriptive sobre.
const ENTITY_FR: Record<string, string> = {
  site: 'un chantier',
  contract: 'un contrat',
  meeting: 'une réunion',
  intervention: 'une intervention',
  action: 'une action',
  user: 'une fiche personne',
  tender: 'un dossier de démarrage',
  feedback: 'un retour',
}
function labelForAction(entityType: string, action: string): string {
  const what = ENTITY_FR[entityType] ?? entityType
  if (entityType === 'feedback' && action === 'created') return 'A envoyé un retour (bouton feedback)'
  if (action === 'created') return `A créé ${what}`
  if (action === 'opened') return `A ouvert ${what}`
  if (action === 'updated') return `A modifié ${what}`
  if (action === 'deleted') return `A retiré ${what}`
  return `${action} · ${what}`
}

// ── Constantes de calcul ──────────────────────────────────────────────────

const SESSION_GAP_MIN = 30          // au-delà → nouvelle session
const FRICTION_REPEATS = 4          // même page N fois…
const FRICTION_WINDOW_MIN = 5       // …dans une fenêtre de M minutes

// Menus cœur attendus pour un rôle (hors guides/admin) — base du « jamais ouvert ».
function coreMenusFor(role: UserRole): Array<{ seg: string; label: string }> {
  return NAV.filter(
    (n) =>
      n.roles.includes(role) &&
      !n.href.startsWith('/comprendre') &&
      n.href !== '/manuel' &&
      !n.href.startsWith('/admin'),
  ).map((n) => ({ seg: n.href.split('/')[1] ?? '', label: n.label }))
}

// ── Helper principal ──────────────────────────────────────────────────────

interface RawLog {
  entity_type: string
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export async function getUserJourney(
  userId: string,
  opts: { days?: number; role?: UserRole } = {},
): Promise<UserJourney> {
  const days = opts.days ?? 21
  const role = opts.role ?? 'manager'
  const supabase = createAdminClient()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('activity_logs')
    .select('entity_type, action, metadata, created_at')
    .eq('user_id', userId)              // ← scope strict : UNE personne, jamais d'autres
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(3000)

  const logs = (data ?? []) as RawLog[]

  // 1) Événements normalisés (pages + actions ; on ignore le bruit interne).
  const events: Array<JourneyEvent & { ts: number }> = []
  for (const l of logs) {
    const ts = new Date(l.created_at).getTime()
    if (l.entity_type === 'page' && l.action === 'view') {
      const route = String(l.metadata?.route ?? '')
      if (!route) continue
      events.push({
        ts,
        at: l.created_at,
        kind: 'page',
        label: labelForRoute(route),
        isReturn: false,
        device: (l.metadata?.device as string) ?? null,
      })
    } else if (['created', 'opened', 'updated', 'deleted'].includes(l.action)) {
      events.push({
        ts,
        at: l.created_at,
        kind: 'action',
        label: labelForAction(l.entity_type, l.action),
        isReturn: false,
        device: null,
      })
    }
  }

  // 2) Sessions (coupure au-delà de SESSION_GAP_MIN).
  const sessions: JourneySession[] = []
  let current: Array<JourneyEvent & { ts: number }> = []
  const gapMs = SESSION_GAP_MIN * 60 * 1000
  for (const e of events) {
    const prev = current[current.length - 1]
    if (prev && e.ts - prev.ts > gapMs) {
      sessions.push(finalizeSession(current))
      current = []
    }
    current.push(e)
  }
  if (current.length) sessions.push(finalizeSession(current))

  // 3) Heatmap (pages les plus ouvertes, par section top-niveau).
  const pageEvents = logs.filter((l) => l.entity_type === 'page' && l.action === 'view')
  const counts = new Map<string, number>()
  for (const l of pageEvents) {
    const route = String(l.metadata?.route ?? '')
    if (!route) continue
    const label = topLabelForRoute(route)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const totalPages = pageEvents.length
  const heatmapUsed: HeatmapEntry[] = [...counts.entries()]
    .map(([label, count]) => ({ label, count, pct: totalPages ? Math.round((count / totalPages) * 100) : 0 }))
    .sort((a, b) => b.count - a.count)

  // 4) Menus cœur jamais ouverts (sur la période).
  const visitedSegs = new Set(
    pageEvents
      .map((l) => String(l.metadata?.route ?? '').split('/')[1] ?? '')
      .filter(Boolean),
  )
  const seenLabels = new Set<string>()
  const neverOpened: string[] = []
  for (const m of coreMenusFor(role)) {
    if (!m.seg || visitedSegs.has(m.seg) || seenLabels.has(m.label)) continue
    seenLabels.add(m.label)
    neverOpened.push(m.label)
  }

  // 5) Friction : même page ≥ FRICTION_REPEATS fois dans une fenêtre glissante.
  const frictions: FrictionSignal[] = []
  for (const s of sessions) {
    const byLabel = new Map<string, number[]>()
    for (const e of s.events) {
      if (e.kind !== 'page') continue
      const arr = byLabel.get(e.label) ?? []
      arr.push(new Date(e.at).getTime())
      byLabel.set(e.label, arr)
    }
    for (const [label, times] of byLabel) {
      const best = maxInWindow(times, FRICTION_WINDOW_MIN * 60 * 1000)
      if (best >= FRICTION_REPEATS) {
        frictions.push({
          sessionStartAt: s.startAt,
          label,
          repeats: best,
          windowMinutes: FRICTION_WINDOW_MIN,
        })
      }
    }
  }

  return {
    totalEvents: events.length,
    firstAt: events[0]?.at ?? null,
    lastAt: events[events.length - 1]?.at ?? null,
    sessions: sessions.reverse(), // plus récente d'abord
    heatmapUsed,
    neverOpened,
    frictions,
  }
}

// Marque les retours (page déjà vue dans la session) et fige les bornes.
function finalizeSession(evts: Array<JourneyEvent & { ts: number }>): JourneySession {
  const seen = new Set<string>()
  const events: JourneyEvent[] = evts.map((e) => {
    const isReturn = e.kind === 'page' && seen.has(e.label)
    if (e.kind === 'page') seen.add(e.label)
    return { at: e.at, kind: e.kind, label: e.label, isReturn, device: e.device }
  })
  return {
    startAt: evts[0]!.at,
    endAt: evts[evts.length - 1]!.at,
    events,
  }
}

// Nombre max d'occurrences dans une fenêtre glissante (timestamps triés asc).
function maxInWindow(times: number[], windowMs: number): number {
  let best = 0
  let lo = 0
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi]! - times[lo]! > windowMs) lo++
    best = Math.max(best, hi - lo + 1)
  }
  return best
}
