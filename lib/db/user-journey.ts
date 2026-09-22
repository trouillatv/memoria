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
//
// Résolution des routes /sites/* et /m/* (GO Thread C, 2026-09-22) :
//   - Parse structurel du pathname (surface/siteId/viewKey/entityType/entityId),
//     puis résolution BATCHÉE des identifiants uniques (une requête par table,
//     jamais une par événement — une session peut compter ~100 événements).
//   - Le libellé résolu (nom de chantier, titre d'action…) est celui ACTUEL en
//     base : il peut différer de celui affiché au moment de la visite. Assumé.
//   - Si l'objet n'est plus résolvable (supprimé, id historique orphelin) :
//     libellé de repli « <Type> introuvable · <id court>… », la ligne n'est
//     jamais supprimée. Aucun contexte n'est inventé au-delà de ce que le
//     pathname porte réellement.
//   - Les onglets desktop sans route dédiée (Visites, Chronologie, Planning,
//     Documents, Intervenants, Explorer — cf. SiteTabsNav.tsx) naviguent par
//     ?tab=…. FIX_REQUIRED Thread C (GO Vincent 2026-09-22) : PageViewLogger/
//     logPageViewAction capturent désormais tab/plantab (whitelist de vues,
//     jamais toute la query string — cf. page-view-action.ts) et
//     parseSiteOrMobileRoute les exploite pour résoudre le VRAI onglet sur
//     la racine /sites/<id> à partir de MAINTENANT. Forward-only assumé : les
//     événements historiques déjà collectés sans ce champ restent résolus en
//     « Aujourd'hui » (Aperçu), aucune reconstruction rétroactive.

import { createAdminClient } from '@/lib/supabase/admin'
import { NAV } from '@/components/layout/nav-items'
import type { UserRole } from '@/types/db'

export interface JourneyEvent {
  at: string                    // ISO
  kind: 'page' | 'action'
  label: string                 // libellé lisible (contexte métier résolu)
  isReturn: boolean             // page déjà vue plus tôt dans la même session
  device: string | null
  rawRoute: string | null       // route brute (détail secondaire, jamais affiché en premier)
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
  key: string              // identité stable de regroupement (frictionType|siteId|vue) — interne, pas affichée
  label: string             // contexte métier résolu (chantier · vue/objet)
  totalOccurrences: number  // somme des répétitions détectées, tous groupes confondus — ne perd pas le compte réel
  sessionCount: number      // nombre de sessions distinctes où le motif est apparu
  examples: string[]        // jusqu'à 3 horodatages représentatifs (ISO)
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

// ── Nommage des routes hors module chantier (inchangé) ────────────────────

// Détail (routes dynamiques /xxx/<id>/…) → libellé lisible. Ordre = priorité.
const ROUTE_PATTERNS: Array<[RegExp, string]> = [
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
TOP_LABEL.set('sites', 'Chantiers')
TOP_LABEL.set('m', 'Chantiers')

function legacyLabelForRoute(clean: string): string {
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

// ── Parse structurel des routes chantier (/sites/* desktop, /m/* mobile) ──

type EntityType =
  | 'tracked_point' | 'canonical_subject' | 'site_action' | 'site_report'
  | 'site_reserve' | 'site_decision' | 'document' | 'company' | 'contact'
  | 'subject_thread' | 'visit_capture'

interface ParsedSiteRoute {
  siteId: string | null       // connu depuis le chemin ; null pour /m/visite/* (dérivé ensuite via site_report.site_id)
  viewKey: string | null
  entityType: EntityType | null
  entityId: string | null
  subKey: string | null       // sous-page d'une visite mobile (cr/comprehension/recap/pdf)
}

const VIEW_LABEL_FR: Record<string, string> = {
  apercu: "Aujourd'hui", points: 'Points', visites: 'Visites', chronologie: 'Chronologie',
  historique: 'Suivi', planning: 'Planning', reserves: 'Réserves', actions: 'Actions',
  'documents-preuves': 'Documents', intervenants: 'Intervenants', memoire: 'Mémoire', explorer: 'Explorer',
  sujets: 'Sujets', subjects: 'Sujets', carte: 'Carte', terrain: 'Terrain', photos: 'Photos',
  reunions: 'Réunions', frise: 'Frise', documents: 'Documents', patrimoine: 'Patrimoine',
  evolution: 'Évolution', 'besoin-de-toi': 'Besoin de toi', prepare: 'Préparation',
  obligations: 'Obligations', preuves: 'Dossier de preuve', livraisons: 'Livraisons', journal: 'Journal',
  scopes: 'Sous-périmètres', qr: 'QR chantier', ao: "Appel d'offres", chronicle: 'Chronique',
  recit: 'Récit', reprise: 'Reprise', roulements: 'Roulements',
}

const ENTITY_TYPE_LABEL_FR: Record<EntityType, string> = {
  tracked_point: 'Point', canonical_subject: 'Sujet', site_action: 'Action', site_report: 'Visite',
  site_reserve: 'Réserve', site_decision: 'Décision', document: 'Document', company: 'Entreprise',
  contact: 'Intervenant', subject_thread: 'Sujet', visit_capture: 'Observation',
}

// Onglets desktop de /sites/[id] atteignables UNIQUEMENT par ?tab=… (pas de
// pathSuffix dédié dans SiteTabsNav.tsx) — seules valeurs que le paramètre
// whitelisté `tab` peut légitimement prendre sur la racine du chantier. À
// tenir manuellement synchronisé avec SiteTabsNav.tsx si de nouveaux onglets
// perdent/gagnent leur route dédiée (même logique de table manuelle que
// VIEW_LABEL_FR ci-dessus).
const SITE_QUERY_TAB_VIEWS = new Set([
  'visites', 'chronologie', 'planning', 'documents-preuves', 'intervenants', 'explorer',
])

// Ordre = du plus spécifique au plus générique (un motif générique matché en
// premier empêcherait jamais d'atteindre les motifs détaillés placés après).
// `navTab` (optionnel) = valeur whitelistée du paramètre ?tab=… capturée par
// logPageViewAction pour les événements FUTURS uniquement (undefined pour les
// événements historiques déjà collectés sans ce champ).
export function parseSiteOrMobileRoute(clean: string, navTab?: string | null): ParsedSiteRoute | null {
  let m: RegExpMatchArray | null

  // Mobile — fiches d'entité du chantier
  if ((m = clean.match(/^\/m\/site\/([^/]+)\/point\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'tracked_point', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/m\/site\/([^/]+)\/action\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'site_action', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/m\/site\/([^/]+)\/sujets\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'canonical_subject', entityId: m[2]!, subKey: null }
  // Mobile — onglets du chantier (route réelle par segment, jamais par query)
  if ((m = clean.match(/^\/m\/site\/([^/]+)\/([a-z-]+)/)))
    return { siteId: m[1]!, viewKey: m[2]!, entityType: null, entityId: null, subKey: null }
  if ((m = clean.match(/^\/m\/site\/([^/]+)$/)))
    return { siteId: m[1]!, viewKey: 'apercu', entityType: null, entityId: null, subKey: null }

  // Mobile — visite (pas de siteId dans le chemin : dérivé via site_reports.site_id)
  if ((m = clean.match(/^\/m\/visite\/([^/]+)\/cr/)))
    return { siteId: null, viewKey: null, entityType: 'site_report', entityId: m[1]!, subKey: 'cr' }
  if ((m = clean.match(/^\/m\/visite\/([^/]+)\/comprehension/)))
    return { siteId: null, viewKey: null, entityType: 'site_report', entityId: m[1]!, subKey: 'comprehension' }
  if ((m = clean.match(/^\/m\/visite\/([^/]+)\/recap/)))
    return { siteId: null, viewKey: null, entityType: 'site_report', entityId: m[1]!, subKey: 'recap' }
  if ((m = clean.match(/^\/m\/visite\/([^/]+)\/pdf/)))
    return { siteId: null, viewKey: null, entityType: 'site_report', entityId: m[1]!, subKey: 'pdf' }
  if ((m = clean.match(/^\/m\/visite\/([^/]+)$/)))
    return { siteId: null, viewKey: null, entityType: 'site_report', entityId: m[1]!, subKey: null }

  // Desktop — fiches d'entité du chantier (plus spécifique que les vues liste)
  if ((m = clean.match(/^\/sites\/([^/]+)\/action\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'site_action', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/point\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'tracked_point', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/reunion\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'site_report', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/reserve\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'site_reserve', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/decision\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'site_decision', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/observation\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'visit_capture', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/document\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'document', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/entreprise\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'company', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/intervenant\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'contact', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/historique\/sujets\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'canonical_subject', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/historique\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'subject_thread', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/subjects\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'canonical_subject', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/visites\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: null, entityType: 'site_report', entityId: m[2]!, subKey: null }
  if ((m = clean.match(/^\/sites\/([^/]+)\/roulements\/([^/]+)/)))
    return { siteId: m[1]!, viewKey: 'roulements', entityType: null, entityId: null, subKey: null }

  // Desktop — vues liste à route dédiée
  const LIST_VIEWS = [
    'points', 'reserves', 'actions', 'memoire', 'historique', 'subjects',
    'obligations', 'preuves', 'livraisons', 'journal', 'scopes', 'qr',
    'ao', 'carte', 'chronicle', 'documents', 'photos', 'recit', 'reprise', 'roulements', 'reunions',
  ]
  for (const v of LIST_VIEWS) {
    if ((m = clean.match(new RegExp(`^/sites/([^/]+)/${v}(?:/|$)`))))
      return { siteId: m[1]!, viewKey: v, entityType: null, entityId: null, subKey: null }
  }

  // Desktop — racine du chantier, y compris les onglets ?tab=… : si `navTab`
  // est whitelisté et connu (événement FUTUR capturé par le fix Thread C),
  // on résout le vrai onglet ; sinon repli sur l'Aperçu (événements historiques).
  if ((m = clean.match(/^\/sites\/([^/]+)$/))) {
    const viewKey = navTab && SITE_QUERY_TAB_VIEWS.has(navTab) ? navTab : 'apercu'
    return { siteId: m[1]!, viewKey, entityType: null, entityId: null, subKey: null }
  }

  return null
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function fmtDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Pacific/Noumea' })
}

const SUBKEY_LABEL_FR: Record<string, string> = {
  cr: 'Compte rendu',
  comprehension: 'Compréhension',
  recap: 'Récap',
  pdf: 'Export PDF',
}

// ── Résolution batchée (une requête par table, jamais par événement) ──────

interface EntityRow {
  label: string | null
  siteId: string | null   // pour dériver le chantier quand il n'est pas dans le chemin (site_report)
}

async function resolveEntityLabels(
  supabase: ReturnType<typeof createAdminClient>,
  idsByType: Map<EntityType, Set<string>>,
): Promise<Map<EntityType, Map<string, EntityRow>>> {
  const out = new Map<EntityType, Map<string, EntityRow>>()
  const chunk = <T,>(arr: T[], size = 200): T[][] => {
    const chunks: T[][] = []
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
    return chunks
  }

  async function run(type: EntityType, table: string, cols: string, mapRow: (r: Record<string, unknown>) => EntityRow) {
    const ids = Array.from(idsByType.get(type) ?? [])
    if (!ids.length) return
    const byId = new Map<string, EntityRow>()
    for (const c of chunk(ids)) {
      const { data } = await supabase.from(table).select(cols).in('id', c)
      for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        byId.set(String(row.id), mapRow(row))
      }
    }
    out.set(type, byId)
  }

  await Promise.all([
    run('tracked_point', 'tracked_point', 'id, label, site_id', (r) => ({ label: r.label as string | null, siteId: r.site_id as string | null })),
    run('canonical_subject', 'canonical_subject', 'id, label, site_id', (r) => ({ label: r.label as string | null, siteId: r.site_id as string | null })),
    run('site_action', 'site_actions', 'id, title, site_id', (r) => ({ label: r.title as string | null, siteId: r.site_id as string | null })),
    run('site_report', 'site_reports', 'id, title, started_at, created_at, site_id', (r) => ({
      label: (r.title as string | null) ?? `Visite du ${fmtDateFr((r.started_at as string | null) ?? (r.created_at as string))}`,
      siteId: r.site_id as string | null,
    })),
    run('site_reserve', 'site_reserve', 'id, label, site_id', (r) => ({ label: r.label as string | null, siteId: r.site_id as string | null })),
    run('site_decision', 'site_decisions', 'id, titre, site_id', (r) => ({ label: r.titre as string | null, siteId: r.site_id as string | null })),
    run('document', 'documents', 'id, filename, site_id', (r) => ({ label: r.filename as string | null, siteId: r.site_id as string | null })),
    run('company', 'companies', 'id, name, short_name', (r) => ({ label: (r.name as string | null) ?? (r.short_name as string | null), siteId: null })),
    run('contact', 'company_contacts', 'id, full_name', (r) => ({ label: r.full_name as string | null, siteId: null })),
    run('visit_capture', 'visit_capture', 'id, body, site_id', (r) => {
      const body = (r.body as string | null)?.trim() ?? null
      return { label: body ? (body.length > 60 ? `${body.slice(0, 60)}…` : body) : null, siteId: r.site_id as string | null }
    }),
  ])

  // subject_thread : pas de libellé propre → autorité = canonical_subject.label via subject_thread_identity
  const threadIds = Array.from(idsByType.get('subject_thread') ?? [])
  if (threadIds.length) {
    const byThread = new Map<string, EntityRow>()
    const csIds = new Map<string, string>() // thread_id -> canonical_subject_id
    for (const c of chunk(threadIds)) {
      const { data } = await supabase.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').in('subject_thread_id', c)
      for (const row of data ?? []) if (row.canonical_subject_id) csIds.set(row.subject_thread_id, row.canonical_subject_id)
    }
    const uniqueCs = Array.from(new Set(csIds.values()))
    const csLabel = new Map<string, EntityRow>()
    for (const c of chunk(uniqueCs)) {
      const { data } = await supabase.from('canonical_subject').select('id, label, site_id').in('id', c)
      for (const row of data ?? []) csLabel.set(row.id, { label: row.label, siteId: row.site_id })
    }
    for (const [threadId, csId] of csIds) {
      const resolved = csLabel.get(csId)
      if (resolved) byThread.set(threadId, resolved)
    }
    out.set('subject_thread', byThread)
  }

  return out
}

interface PendingEvent {
  ts: number
  at: string
  device: string | null
  parsed: ParsedSiteRoute
  rawRoute: string
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

  // 1) Première passe : événements normalisés. Les pages /sites|/m sont mises
  //    de côté (pending) le temps de la résolution batchée ; les autres routes
  //    et les actions sont étiquetées immédiatement (aucune donnée à joindre).
  const events: Array<{ ts: number; at: string; kind: 'page' | 'action'; label: string | null; device: string | null; rawRoute: string | null; pending: PendingEvent | null }> = []
  const idsByType = new Map<EntityType, Set<string>>()
  const pathSiteIds = new Set<string>()

  for (const l of logs) {
    const ts = new Date(l.created_at).getTime()
    if (l.entity_type === 'page' && l.action === 'view') {
      const route = String(l.metadata?.route ?? '')
      if (!route) continue
      const clean = route.split('?')[0] ?? route
      const navTab = typeof l.metadata?.tab === 'string' ? l.metadata.tab : null
      const parsed = parseSiteOrMobileRoute(clean, navTab)
      if (parsed) {
        if (parsed.siteId) pathSiteIds.add(parsed.siteId)
        if (parsed.entityType && parsed.entityId) {
          const set = idsByType.get(parsed.entityType) ?? new Set<string>()
          set.add(parsed.entityId)
          idsByType.set(parsed.entityType, set)
        }
        events.push({
          ts, at: l.created_at, kind: 'page', label: null,
          device: (l.metadata?.device as string) ?? null,
          rawRoute: clean,
          pending: { ts, at: l.created_at, device: (l.metadata?.device as string) ?? null, parsed, rawRoute: clean },
        })
      } else {
        events.push({
          ts, at: l.created_at, kind: 'page', label: legacyLabelForRoute(clean),
          device: (l.metadata?.device as string) ?? null, rawRoute: clean, pending: null,
        })
      }
    } else if (['created', 'opened', 'updated', 'deleted'].includes(l.action)) {
      events.push({
        ts, at: l.created_at, kind: 'action', label: labelForAction(l.entity_type, l.action),
        device: null, rawRoute: null, pending: null,
      })
    }
  }

  // 2) Résolution batchée : entités uniques, puis chantiers (chemin + dérivés
  //    des entités résolues, ex. site_report.site_id pour les visites mobiles).
  const resolved = await resolveEntityLabels(supabase, idsByType)
  for (const e of events) {
    if (!e.pending) continue
    const row = e.pending.parsed.entityType && e.pending.parsed.entityId
      ? resolved.get(e.pending.parsed.entityType)?.get(e.pending.parsed.entityId)
      : undefined
    if (row?.siteId) pathSiteIds.add(row.siteId)
  }
  const siteNameById = new Map<string, string>()
  if (pathSiteIds.size) {
    const ids = Array.from(pathSiteIds)
    for (let i = 0; i < ids.length; i += 200) {
      const { data: siteRows } = await supabase.from('sites').select('id, name').in('id', ids.slice(i, i + 200))
      for (const s of siteRows ?? []) siteNameById.set(s.id, s.name)
    }
  }

  // 3) Deuxième passe : synthèse du libellé final pour les événements en attente.
  const groupKeys = new Map<number, string>() // index dans `events` -> clé de friction (pour l'étape 5)
  // Libellé à afficher pour la friction (peut différer du libellé d'affichage
  // de l'événement : un groupe de friction sur une fiche d'entité couvre TOUTES
  // les instances de ce type sur ce chantier, jamais une instance précise — le
  // libellé affiché doit rester générique pour ne pas laisser croire qu'on a
  // rouvert 59 fois LE MÊME Point alors que ce sont 59 fiches Point distinctes.
  const groupLabels = new Map<number, string>()
  events.forEach((e, i) => {
    if (!e.pending) return
    const p = e.pending.parsed
    const entityRow = p.entityType && p.entityId ? resolved.get(p.entityType)?.get(p.entityId) : undefined
    const effectiveSiteId = p.siteId ?? entityRow?.siteId ?? null
    const siteName = effectiveSiteId ? (siteNameById.get(effectiveSiteId) ?? 'Chantier introuvable') : null

    let detail: string | null = null
    let frictionDetail: string | null = null
    if (p.entityType) {
      const typeWord = ENTITY_TYPE_LABEL_FR[p.entityType]
      if (entityRow?.label) {
        detail = p.entityType === 'site_report' ? entityRow.label : `${typeWord} : ${entityRow.label}`
      } else {
        detail = `${typeWord} introuvable · ${shortId(p.entityId!)}`
      }
      if (p.subKey) detail = `${detail} · ${SUBKEY_LABEL_FR[p.subKey] ?? p.subKey}`
      frictionDetail = `${typeWord} (fiche)`
    } else if (p.viewKey) {
      detail = VIEW_LABEL_FR[p.viewKey] ?? p.viewKey
      frictionDetail = detail
    }

    e.label = [siteName, detail].filter(Boolean).join(' · ') || e.rawRoute!
    groupLabels.set(i, [siteName, frictionDetail].filter(Boolean).join(' · ') || e.label)

    // Clé de friction (P1) : type de motif + chantier + vue/type d'objet — jamais
    // l'id précis d'une instance, pour capter « on boucle sur les fiches Point de
    // ce chantier », pas « on rouvre le même Point ».
    groupKeys.set(i, `repeat_view|${effectiveSiteId ?? 'none'}|${p.viewKey ?? p.entityType ?? 'none'}`)
  })
  // Routes hors module chantier : la clé de friction reste le libellé lui-même
  // (pas d'ambiguïté cross-chantier possible sur ces routes).
  events.forEach((e, i) => {
    if (e.kind === 'page' && !groupKeys.has(i)) {
      groupKeys.set(i, `repeat_view|legacy|${e.label}`)
      groupLabels.set(i, e.label ?? e.rawRoute ?? '')
    }
  })

  const finalEvents = events.map((e) => ({ ts: e.ts, at: e.at, kind: e.kind, label: e.label!, device: e.device, rawRoute: e.rawRoute }))

  // 4) Sessions (coupure au-delà de SESSION_GAP_MIN).
  const sessions: JourneySession[] = []
  let current: typeof finalEvents = []
  const gapMs = SESSION_GAP_MIN * 60 * 1000
  for (const e of finalEvents) {
    const prev = current[current.length - 1]
    if (prev && e.ts - prev.ts > gapMs) {
      sessions.push(finalizeSession(current))
      current = []
    }
    current.push(e)
  }
  if (current.length) sessions.push(finalizeSession(current))

  // 5) Heatmap (pages les plus ouvertes, par section top-niveau) — inchangé.
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

  // 6) Menus cœur jamais ouverts (sur la période) — inchangé.
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

  // 7) Friction : même motif (clé structurée) ≥ FRICTION_REPEATS fois dans une
  //    fenêtre glissante, PAR SESSION, puis agrégée par clé sur toute la période
  //    (un compteur total + N sessions distinctes, jamais N lignes quasi-identiques).
  const byKey = new Map<string, { label: string; totalOccurrences: number; sessions: Set<string>; examples: string[] }>()
  for (const s of sessions.slice().reverse()) { // ordre chronologique pour les exemples
    const byLabelTimes = new Map<string, { key: string; label: string; times: number[] }>()
    for (const e of s.events) {
      if (e.kind !== 'page') continue
      const meta = frictionMetaForEvent(groupKeys, groupLabels, finalEvents, e)
      const g = byLabelTimes.get(meta.key) ?? { key: meta.key, label: meta.label, times: [] }
      g.times.push(new Date(e.at).getTime())
      byLabelTimes.set(meta.key, g)
    }
    for (const g of byLabelTimes.values()) {
      const best = maxInWindow(g.times, FRICTION_WINDOW_MIN * 60 * 1000)
      if (best >= FRICTION_REPEATS) {
        const acc = byKey.get(g.key) ?? { label: g.label, totalOccurrences: 0, sessions: new Set<string>(), examples: [] }
        acc.totalOccurrences += best
        acc.sessions.add(s.startAt)
        if (acc.examples.length < 3) acc.examples.push(s.startAt)
        byKey.set(g.key, acc)
      }
    }
  }
  const frictions: FrictionSignal[] = Array.from(byKey.entries()).map(([key, v]) => ({
    key,
    label: v.label,
    totalOccurrences: v.totalOccurrences,
    sessionCount: v.sessions.size,
    examples: v.examples,
    windowMinutes: FRICTION_WINDOW_MIN,
  })).sort((a, b) => b.totalOccurrences - a.totalOccurrences)

  return {
    totalEvents: finalEvents.length,
    firstAt: finalEvents[0]?.at ?? null,
    lastAt: finalEvents[finalEvents.length - 1]?.at ?? null,
    sessions: sessions.reverse(), // plus récente d'abord
    heatmapUsed,
    neverOpened,
    frictions,
  }
}

// Retrouve la clé + le libellé de friction d'un événement de session déjà
// finalisé (par horodatage + libellé, stable car un événement source
// n'apparaît qu'une fois). Le libellé de friction peut différer du libellé
// d'affichage (cf. groupLabels ci-dessus).
function frictionMetaForEvent(
  groupKeys: Map<number, string>,
  groupLabels: Map<number, string>,
  finalEvents: Array<{ at: string; label: string }>,
  e: { at: string; label: string },
): { key: string; label: string } {
  const i = finalEvents.findIndex((f) => f.at === e.at && f.label === e.label)
  const key = i >= 0 ? groupKeys.get(i) : undefined
  if (key) return { key, label: groupLabels.get(i) ?? e.label }
  return { key: `repeat_view|legacy|${e.label}`, label: e.label }
}

// Marque les retours (page déjà vue dans la session) et fige les bornes.
function finalizeSession(evts: Array<{ at: string; kind: 'page' | 'action'; label: string; device: string | null; rawRoute: string | null }>): JourneySession {
  const seen = new Set<string>()
  const events: JourneyEvent[] = evts.map((e) => {
    const isReturn = e.kind === 'page' && seen.has(e.label)
    if (e.kind === 'page') seen.add(e.label)
    return { at: e.at, kind: e.kind, label: e.label, isReturn, device: e.device, rawRoute: e.rawRoute }
  })
  return {
    startAt: evts[0]!.at,
    endAt: evts[evts.length - 1]!.at,
    events,
  }
}

// Nombre max d'occurrences dans une fenêtre glissante (timestamps triés asc).
function maxInWindow(times: number[], windowMs: number): number {
  const sorted = times.slice().sort((a, b) => a - b)
  let best = 0
  let lo = 0
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi]! - sorted[lo]! > windowMs) lo++
    best = Math.max(best, hi - lo + 1)
  }
  return best
}
