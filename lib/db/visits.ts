// lib/db/visits.ts
// Visites terrain (mig 162). Une visite = un site_report orienté objectif.
//
// Règle produit : aucune info métier n'est obligatoire — DÉDUIRE avant de
// demander. MVP = friction zéro : on démarre en 1 clic (AUCUNE question au
// départ), on capture, on clôture. objectif / sujet / résultat / résolution
// sont FACULTATIFS, montrés à la clôture (manuels au MVP ; alimentés par l'IA
// plus tard, sans changer le flux). Pas d'IA de détection dans ce slice.
//
// Marqueur : `origin` non-null distingue une visite d'une réunion classique.
// La visite est une LENTILLE sur la mémoire du SITE, pas un conteneur : les
// objets produits s'attachent au site et citent le report.
// Invariant : un résultat qualifie le LIEU/OUVRAGE/SUJET, jamais la personne.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { getOpenDossierIdForSite } from '@/lib/db/dossiers'
import { listVisitCaptures, getVisitCapturePreviewUrls, type VisitCaptureKind } from '@/lib/db/visit-captures'
import { buildSiteMemorySignals, buildSuggestedQuestions, type MemorySignal, type SuggestedQuestion } from '@/lib/db/site-memory-signals'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import type {
  DbSiteReport,
  VisitMotive,
  VisitOrigin,
  VisitOutcome,
  VisitResolution,
} from '@/types/db'
import { VISIT_PROOF_MOTIVES } from '@/types/db'

/** Un motif « preuve » routera vers le rail intervention (signature) — cran 2. */
export function isProofMotive(motive: VisitMotive): boolean {
  return VISIT_PROOF_MOTIVES.includes(motive)
}

// ── Démarrage (zéro question) ────────────────────────────────────────────────

export interface CreateVisitInput {
  siteId: string
  origin?: VisitOrigin
  createdBy: string | null
}

/**
 * Démarre une visite terrain : insère un site_report avec `origin` (marqueur) et
 * `started_at = now()`. Rien d'autre n'est demandé. Le tenant est résolu depuis
 * le site. Retourne l'id du report créé.
 */
export async function createVisit(input: CreateVisitInput): Promise<string> {
  const supabase = createAdminClient()

  const { data: site } = await supabase
    .from('sites')
    .select('tenant_id')
    .eq('id', input.siteId)
    .maybeSingle()
  const tenantId = (site as { tenant_id: string } | null)?.tenant_id
  if (!tenantId) throw new Error('Site introuvable ou sans tenant')

  const orgId = await getOrgId()
  // Rattache la visite au dossier d'opération ouvert du lieu (null si lieu legacy).
  const dossierId = await getOpenDossierIdForSite(input.siteId).catch(() => null)

  const { data, error } = await supabase
    .from('site_reports')
    .insert({
      type: 'site',
      site_id: input.siteId,
      dossier_id: dossierId,
      tenant_id: tenantId,
      organization_id: orgId,
      status: 'draft',
      created_by: input.createdBy,
      origin: input.origin ?? 'spontaneous',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

// ── Briefing à l'ouverture : prepare(scope) ──────────────────────────────────

export interface VisitBriefing {
  signals: MemorySignal[]
  questions: SuggestedQuestion[]
}

/**
 * prepare(scope) — pour l'instant le scope { site }. Réutilise tel quel le
 * moteur de détecteurs déterministes (site-memory-signals). Le briefing ciblé
 * par sujet (scope { site, subject }) viendra plus tard.
 */
export async function prepareVisitBriefing(siteId: string): Promise<VisitBriefing> {
  const signals = await buildSiteMemorySignals(siteId)
  return { signals, questions: buildSuggestedQuestions(signals) }
}

// ── Clôture (tout facultatif) ────────────────────────────────────────────────

export interface CloseVisitInput {
  reportId: string
  motive?: VisitMotive | null
  objective?: string | null
  /** Le SUJET concerné. */
  targetSubjectId?: string | null
  /** État de l'OUVRAGE/ZONE — jamais de la personne. */
  outcome?: VisitOutcome | null
  /** Le sujet est-il traité ? Orthogonal à outcome. */
  resolution?: VisitResolution | null
}

/**
 * Termine une visite SUR LE TERRAIN : pose seulement `ended_at`. Aucun champ
 * métier — « il repart, fin ». La réflexion (objectif/résultat/résolution) se
 * fait au bureau, dans le Débrief. N'écrase pas un `ended_at` déjà posé.
 */
export async function endVisit(reportId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_reports')
    .update({ ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', reportId)
    .is('ended_at', null)
  if (error) throw error
}

/**
 * Enregistre la cristallisation d'une visite DEPUIS LE DÉBRIEF (desktop) : les
 * champs métier validés par l'humain. Ne touche pas à `ended_at` (posé au
 * terrain par endVisit). Ne touche pas au pipeline de transcription/analyse.
 */
export async function closeVisit(input: CloseVisitInput): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('site_reports')
    .update({
      visit_motive: input.motive ?? null,
      objective: input.objective ?? null,
      target_subject_id: input.targetSubjectId ?? null,
      outcome: input.outcome ?? null,
      resolution: input.resolution ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.reportId)
  if (error) throw error
}

// ── Lecture ──────────────────────────────────────────────────────────────────

/** Liste les visites d'un site (les plus récentes d'abord). */
export async function listSiteVisits(siteId: string, limit = 50): Promise<DbSiteReport[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_reports')
    .select('*')
    .eq('site_id', siteId)
    .not('origin', 'is', null)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as DbSiteReport[]
}

/** La visite ouverte (non terminée) d'un site, s'il y en a une. */
export async function getActiveVisit(siteId: string): Promise<DbSiteReport | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_reports')
    .select('*')
    .eq('site_id', siteId)
    .not('origin', 'is', null)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as DbSiteReport | null) ?? null
}

/**
 * Les visites OUVERTES (non terminées) démarrées par l'agent, tous sites
 * confondus — pour la carte « Visite en cours » de l'accueil (Lot A). Une visite
 * est un objet vivant : on doit pouvoir la REPRENDRE sans la chercher. Renvoie de
 * quoi peindre la carte (lieu, ancienneté, nombre de captures déjà au panier).
 * Le « N en attente d'envoi » est un état CLIENT (file IndexedDB), ajouté à l'UI.
 */
export interface ActiveVisitSummary {
  reportId: string
  siteId: string
  siteName: string
  startedAt: string | null
  /** Total des captures CONFIRMÉES (en base) — distinct des « en attente » (file client). */
  captureCount: number
  /** Répartition par type : l'agent reconnaît sa visite (« la grosse, 42 photos »). */
  kinds: { photo: number; video: number; vocal: number; note: number; verification: number; position: number }
  /** Marquées ⭐ « important » — raconte mieux la visite que le seul volume. */
  starred: number
  /** ❓ « à vérifier » posées pendant la visite (captured_knowledge, kind=question). */
  questions: number
  /** Le DERNIER élément capturé — « où je me suis arrêté » (façon Google Docs). */
  lastCapture: { kind: VisitCaptureKind; label: string; starred: boolean } | null
  /** Horodatage de la capture la plus récente (fallback started_at) — « dernière
   *  activité » : aide l'agent qui revient à reconnaître SA visite d'un coup d'œil. */
  lastActivityAt: string | null
}

function lastCaptureLabel(kind: VisitCaptureKind, body: string | null, subjectName: string | null): string {
  const clip = (s: string) => (s.length > 48 ? s.slice(0, 47).trimEnd() + '…' : s)
  switch (kind) {
    case 'photo': return 'Photo'
    case 'video': return 'Vidéo'
    case 'vocal': return body?.trim() ? clip(body.trim()) : 'Mémo vocal'
    case 'note': return body?.trim() ? clip(body.trim()) : 'Note'
    case 'verification': return subjectName ?? 'Point suivi vérifié'
    case 'position': return 'Position enregistrée'
  }
}

export async function listActiveVisitsForUser(userId: string, limit = 5): Promise<ActiveVisitSummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_reports')
    .select('id, site_id, started_at')
    .eq('created_by', userId)
    .not('origin', 'is', null)
    .is('ended_at', null)
    .not('site_id', 'is', null)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; site_id: string; started_at: string | null }>
  if (rows.length === 0) return []

  // Noms de sites + compteurs de captures, batchés.
  const siteIds = [...new Set(rows.map((r) => r.site_id))]
  const { data: sites } = await supabase.from('sites').select('id, name').in('id', siteIds)
  const nameById = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]))

  return Promise.all(
    rows.map(async (r) => {
      const [{ data: tallyRows }, { data: last }, { count: questionCount }] = await Promise.all([
        // Tally : type + ⭐ en un seul select léger (pas de body).
        supabase
          .from('visit_capture')
          .select('kind, starred')
          .eq('report_id', r.id)
          .neq('status', 'discarded'),
        // Dernier élément : « où je me suis arrêté » (avec le libellé).
        supabase
          .from('visit_capture')
          .select('kind, body, subject_id, starred, created_at')
          .eq('report_id', r.id)
          .neq('status', 'discarded')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        // ❓ « à vérifier » posées pendant la visite.
        supabase
          .from('captured_knowledge')
          .select('id', { count: 'exact', head: true })
          .eq('source_id', r.id)
          .eq('kind', 'question')
          .eq('status', 'active'),
      ])

      const kinds = { photo: 0, video: 0, vocal: 0, note: 0, verification: 0, position: 0 }
      let starred = 0
      for (const row of (tallyRows ?? []) as Array<{ kind: keyof typeof kinds; starred: boolean }>) {
        if (row.kind in kinds) kinds[row.kind]++
        if (row.starred) starred++
      }

      const lastRow = last as { kind: VisitCaptureKind; body: string | null; subject_id: string | null; starred: boolean; created_at: string } | null
      let lastCapture: ActiveVisitSummary['lastCapture'] = null
      if (lastRow) {
        // Nom du point suivi seulement si le dernier geste est une vérification.
        let subjectName: string | null = null
        if (lastRow.kind === 'verification' && lastRow.subject_id) {
          const { data: subj } = await supabase.from('subjects').select('name').eq('id', lastRow.subject_id).maybeSingle()
          subjectName = (subj as { name: string } | null)?.name ?? null
        }
        lastCapture = {
          kind: lastRow.kind,
          label: lastCaptureLabel(lastRow.kind, lastRow.body, subjectName),
          starred: lastRow.starred,
        }
      }

      return {
        reportId: r.id,
        siteId: r.site_id,
        siteName: nameById.get(r.site_id) ?? 'Chantier',
        startedAt: r.started_at,
        captureCount: (tallyRows ?? []).length,
        kinds,
        starred,
        questions: questionCount ?? 0,
        lastCapture,
        lastActivityAt: lastRow?.created_at ?? r.started_at,
      }
    }),
  )
}

/** Une visite par son id. */
export async function getVisit(reportId: string): Promise<DbSiteReport | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_reports')
    .select('*')
    .eq('id', reportId)
    .not('origin', 'is', null)
    .maybeSingle()
  if (error) throw error
  return (data as DbSiteReport | null) ?? null
}

export interface VisitWithCounts {
  visit: DbSiteReport
  photos: number
  notes: number
  reserves: number
  actions: number
}

/**
 * Visites d'un site avec compteurs de captures, rattachées par FENÊTRE
 * TEMPORELLE (la visite est une lentille : ce qui a été capturé sur le site
 * entre started_at et ended_at lui appartient). Pas de jointure report_id.
 */
export async function listSiteVisitsWithCounts(siteId: string, limit = 50): Promise<VisitWithCounts[]> {
  const supabase = createAdminClient()
  const visits = await listSiteVisits(siteId, limit)

  return Promise.all(
    visits.map(async (visit) => {
      const from = visit.started_at ?? visit.created_at
      const to = visit.ended_at ?? new Date().toISOString()
      const countIn = async (table: string): Promise<number> => {
        const { count } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('site_id', siteId)
          .gte('created_at', from)
          .lte('created_at', to)
        return count ?? 0
      }
      const [notes, reserves, actions, photos] = await Promise.all([
        countIn('site_notes'),
        countIn('site_reserve'),
        countIn('site_actions'),
        // Pièces jointes du report de la visite (photos/fichiers captés via le CR).
        supabase
          .from('site_report_attachments')
          .select('id', { count: 'exact', head: true })
          .eq('report_id', visit.id)
          .then(({ count }) => count ?? 0),
      ])
      return { visit, photos, notes, reserves, actions }
    }),
  )
}

/**
 * La DERNIÈRE visite TERMINÉE d'un site, avec ses compteurs (photos / réserves /
 * notes / actions) — pour la carte « Dernière visite » du terrain. Compteurs par
 * FENÊTRE TEMPORELLE (même règle que listSiteVisitsWithCounts). `null` s'il n'y a
 * aucune visite terminée. On EXCLUT la visite en cours (ended_at null).
 */
export interface LastVisitCard {
  reportId: string
  startedAt: string | null
  endedAt: string | null
  photos: number
  reserves: number
  notes: number
  actions: number
}

export async function getLastEndedVisitForSite(siteId: string): Promise<LastVisitCard | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_reports')
    .select('id, started_at, ended_at, created_at')
    .eq('site_id', siteId)
    .not('origin', 'is', null)
    .not('ended_at', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const visit = data as { id: string; started_at: string | null; ended_at: string | null; created_at: string } | null
  if (!visit) return null

  const from = visit.started_at ?? visit.created_at
  const to = visit.ended_at ?? new Date().toISOString()
  const countIn = async (table: string): Promise<number> => {
    const { count } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .gte('created_at', from)
      .lte('created_at', to)
    return count ?? 0
  }
  const [notes, reserves, actions, photos] = await Promise.all([
    countIn('site_notes'),
    countIn('site_reserve'),
    countIn('site_actions'),
    supabase
      .from('site_report_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('report_id', visit.id)
      .then(({ count }) => count ?? 0),
  ])
  return { reportId: visit.id, startedAt: visit.started_at, endedAt: visit.ended_at, photos, reserves, notes, actions }
}

// ── Historique UTILE du chantier courant (V2 bornée — PAS de cross-chantier) ─

function frDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export interface SiteHistorySummary {
  text: string             // CONTEXTE MÉTIER CONDENSÉ (digests, pas listes brutes)
  subjectDigests: string[] // un digest court par sujet ouvert — l'Agent 1 choisit
}

function ageDaysFrom(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso).getTime()
  return isNaN(d) ? null : Math.max(0, Math.round((Date.now() - d) / 86400000))
}

/**
 * Contexte métier CONDENSÉ du chantier courant pour l'Agent 1 (V2.1). On ne donne
 * PAS des listes brutes mais des DIGESTS : « 5 actions ouvertes, 2 en retard, la
 * plus ancienne 87 j ». Les sujets ouverts sont donnés avec un digest (ancienneté
 * + activité) pour que l'Agent 1 IDENTIFIE LUI-MÊME le sujet concerné (sémantique,
 * pas un match de chaîne). Lecture seule. Aucune comparaison inter-chantiers (V3).
 */
export async function gatherSiteHistory(siteId: string, excludeReportId: string): Promise<SiteHistorySummary> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const [meetings, visits, openActions, reserves, decisions, obligations, subjects] = await Promise.all([
    supabase.from('site_reports').select('title, created_at').eq('site_id', siteId).is('origin', null).order('created_at', { ascending: false }).limit(3),
    supabase.from('site_reports').select('objective, outcome, started_at, created_at').eq('site_id', siteId).not('origin', 'is', null).neq('id', excludeReportId).order('started_at', { ascending: false }).limit(5),
    listOpenSiteActions({ siteIds: [siteId] }).catch(() => []),
    supabase.from('site_reserve').select('label, created_at').eq('site_id', siteId).eq('status', 'open').order('created_at', { ascending: true }).limit(20),
    supabase.from('site_decisions').select('titre, created_at').eq('site_id', siteId).order('created_at', { ascending: false }).limit(5),
    supabase.from('site_obligation').select('label, status').eq('site_id', siteId).in('status', ['a_produire', 'en_cours']).limit(8),
    supabase.from('subjects').select('id, name, created_at').eq('site_id', siteId).neq('status', 'closed').order('created_at', { ascending: false }).limit(8),
  ])

  const lines: string[] = []

  const mRows = (meetings.data ?? []) as Array<{ title: string | null; created_at: string }>
  if (mRows.length) lines.push(`Réunions récentes : ${mRows.length} (dernière le ${frDate(mRows[0].created_at)}${mRows[0].title ? ` — ${mRows[0].title}` : ''}).`)

  const vRows = (visits.data ?? []) as Array<{ objective: string | null; outcome: string | null; started_at: string | null; created_at: string }>
  if (vRows.length) { const l = vRows[0]; lines.push(`Visites récentes : ${vRows.length} (dernière le ${frDate(l.started_at ?? l.created_at)}${l.objective ? ` : ${l.objective}` : ''}${l.outcome ? ` → ${OUTCOME_FR[l.outcome] ?? l.outcome}` : ''}).`) }

  const aRows = openActions as Array<{ title: string; due_date: string | null; created_at: string }>
  if (aRows.length) {
    const overdue = aRows.filter((a) => a.due_date && a.due_date < today).length
    const oldest = aRows.reduce((o, a) => (new Date(a.created_at) < new Date(o.created_at) ? a : o), aRows[0])
    lines.push(`Actions ouvertes : ${aRows.length}${overdue ? `, dont ${overdue} en retard` : ''}. Plus ancienne : « ${oldest.title} » (${ageDaysFrom(oldest.created_at)} j).`)
  }

  const rRows = (reserves.data ?? []) as Array<{ label: string; created_at: string }>
  if (rRows.length) lines.push(`Réserves ouvertes : ${rRows.length}. Plus ancienne : « ${rRows[0].label} » (${ageDaysFrom(rRows[0].created_at)} j).`)

  const dRows = (decisions.data ?? []) as Array<{ titre: string }>
  if (dRows.length) lines.push(`Décisions récentes : ${dRows.length} (dernière : « ${dRows[0].titre} »).`)

  const oRows = (obligations.data ?? []) as Array<{ label: string }>
  if (oRows.length) lines.push(`Obligations ouvertes : ${oRows.map((o) => o.label).join(', ')}.`)

  // Digest par sujet ouvert (compteurs batchés) → l'Agent 1 identifie le concerné.
  const subjRows = (subjects.data ?? []) as Array<{ id: string; name: string; created_at: string | null }>
  let subjectDigests: string[] = []
  if (subjRows.length) {
    const ids = subjRows.map((s) => s.id)
    const [sa, sr, sd] = await Promise.all([
      supabase.from('site_actions').select('subject_id').in('subject_id', ids).eq('status', 'open'),
      supabase.from('site_reserve').select('subject_id').in('subject_id', ids).eq('status', 'open'),
      supabase.from('site_decisions').select('subject_id').in('subject_id', ids),
    ])
    const countBy = (rows: Array<{ subject_id: string | null }>) => {
      const m = new Map<string, number>()
      for (const r of rows) if (r.subject_id) m.set(r.subject_id, (m.get(r.subject_id) ?? 0) + 1)
      return m
    }
    const ca = countBy((sa.data ?? []) as Array<{ subject_id: string | null }>)
    const cr = countBy((sr.data ?? []) as Array<{ subject_id: string | null }>)
    const cd = countBy((sd.data ?? []) as Array<{ subject_id: string | null }>)
    subjectDigests = subjRows.map((s) => {
      const age = ageDaysFrom(s.created_at)
      const parts: string[] = []
      if (age != null) parts.push(`ouvert depuis ${age} j`)
      if (cd.get(s.id)) parts.push(`${cd.get(s.id)} décision(s)`)
      if (ca.get(s.id)) parts.push(`${ca.get(s.id)} action(s) ouverte(s)`)
      if (cr.get(s.id)) parts.push(`${cr.get(s.id)} réserve(s)`)
      return `${s.name}${parts.length ? ` — ${parts.join(' · ')}` : ''}`
    })
  }

  return { text: lines.join('\n'), subjectDigests }
}

// ── Contexte du Débrief (rassemblement par fenêtre temporelle) ───────────────

export interface VisitDebriefContext {
  visit: DbSiteReport
  capturedText: string | null
  transcript: string | null
  attachmentNames: string[]
  capturedNotes: string[]
  capturedActions: Array<{ title: string; corps_etat: string | null }>
  capturedReserves: Array<{ label: string; location: string | null }>
  /** Contexte site : détecteurs déterministes (obligations, réserves, retards…). */
  signals: MemorySignal[]
  /** Sujets ouverts du site, pour rattacher la visite (Agent 2 — index). */
  openSubjects: Array<{ id: string; name: string }>
  /** V2.1 — contexte métier CONDENSÉ du chantier (digests, pas listes brutes). */
  history: string
  /** V2.1 — digest court par sujet ouvert ; l'Agent 1 identifie le concerné. */
  subjectDigests: string[]
}

/**
 * Rassemble TOUT ce qui nourrit le Débrief : les captures de la visite (fenêtre
 * temporelle + pièces du report) + le contexte mémoire du site (signaux, sujets).
 * Lecture seule — n'écrit rien.
 */
export async function gatherVisitDebriefContext(reportId: string): Promise<VisitDebriefContext | null> {
  const supabase = createAdminClient()
  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id) return null
  const siteId = visit.site_id
  const from = visit.started_at ?? visit.created_at
  const to = visit.ended_at ?? new Date().toISOString()

  const [attachmentsRes, notesRes, actionsRes, reservesRes, subjectsRes, signals] = await Promise.all([
    supabase.from('site_report_attachments').select('filename, kind').eq('report_id', reportId),
    supabase.from('site_notes').select('body, created_at').eq('site_id', siteId).is('deleted_at', null).gte('created_at', from).lte('created_at', to).order('created_at', { ascending: true }),
    supabase.from('site_actions').select('title, corps_etat, created_at').eq('site_id', siteId).gte('created_at', from).lte('created_at', to).order('created_at', { ascending: true }),
    supabase.from('site_reserve').select('label, location, created_at').eq('site_id', siteId).gte('created_at', from).lte('created_at', to).order('created_at', { ascending: true }),
    supabase.from('subjects').select('id, name').eq('site_id', siteId).neq('status', 'closed').limit(40),
    buildSiteMemorySignals(siteId),
  ])

  const transcript = visit.transcript_corrected ?? visit.transcript_raw
  const capturedNotes = ((notesRes.data ?? []) as Array<{ body: string }>).map((n) => n.body)
  const openSubjects = ((subjectsRes.data ?? []) as Array<{ id: string; name: string }>).map((s) => ({ id: s.id, name: s.name }))

  // V2.1 — contexte métier condensé du chantier courant.
  const history = await gatherSiteHistory(siteId, reportId)

  return {
    visit,
    capturedText: visit.text_input,
    transcript,
    attachmentNames: ((attachmentsRes.data ?? []) as Array<{ filename: string | null }>).map((a) => a.filename ?? 'pièce').slice(0, 40),
    capturedNotes,
    capturedActions: ((actionsRes.data ?? []) as Array<{ title: string; corps_etat: string | null }>).map((a) => ({ title: a.title, corps_etat: a.corps_etat })),
    capturedReserves: ((reservesRes.data ?? []) as Array<{ label: string; location: string | null }>).map((r) => ({ label: r.label, location: r.location })),
    signals,
    openSubjects,
    history: history.text,
    subjectDigests: history.subjectDigests,
  }
}

// ── CR comme PROJECTION du Débrief (déterministe, zéro IA, zéro fait inventé) ─

const OUTCOME_FR: Record<string, string> = {
  ras: 'RAS', conforme: 'Conforme', conforme_reserves: 'Conforme avec réserves',
  non_conforme: 'Non conforme', a_revoir: 'À revoir', info: 'Information uniquement',
}
const RESOLUTION_FR: Record<string, string> = {
  resolue: 'Résolue', a_suivre: 'À suivre', recontrole: 'Recontrôle nécessaire',
}
const ORIGIN_FR: Record<string, string> = {
  planned: 'Visite planifiée', spontaneous: 'Visite spontanée', qr: 'Visite (QR)', gps: 'Visite (sur place)',
}

/**
 * Le CR d'une visite comme DONNÉES structurées — source de vérité unique pour
 * les deux sorties (markdown côté bureau, PDF côté terrain). PROJECTION
 * déterministe des éléments DÉJÀ VALIDÉS + des captures de la fenêtre. Aucun
 * appel IA, aucun fait nouveau.
 */
export interface VisitCrDoc {
  siteName: string
  clientName: string | null
  /** Ex. « 5 juillet 2026, 10:42 ». */
  dateLabel: string
  /** Ex. « Visite spontanée ». */
  typeLabel: string
  durationLabel: string | null
  objective: string | null
  subjectName: string | null
  /** Constats = ce qui a été noté/dit pendant la visite (notes + vocaux + site_notes). */
  constats: string[]
  reserves: Array<{ label: string; location: string | null }>
  actions: Array<{ title: string; corps_etat: string | null }>
  /** URLs signées des photos captées — embarquées dans le PDF (le CR terrain
   *  DOIT montrer les photos, sinon il paraît vide). */
  photos: string[]
  /** Combien de vidéos/vocaux captés (non embarqués, mentionnés). */
  videoCount: number
  vocalCount: number
  outcomeLabel: string | null
  resolutionLabel: string | null
}

/** Rassemble le CR d'une visite en données structurées. `null` si introuvable. */
export async function buildVisitCrDoc(reportId: string): Promise<VisitCrDoc | null> {
  const ctx = await gatherVisitDebriefContext(reportId)
  if (!ctx) return null
  const { visit } = ctx
  const supabase = createAdminClient()

  const { data: site } = await supabase
    .from('sites')
    .select('name, clients(name)')
    .eq('id', visit.site_id!)
    .maybeSingle()
  const siteName = (site as { name: string } | null)?.name ?? 'Chantier'
  const clientRel = (site as { clients?: { name: string } | { name: string }[] | null } | null)?.clients
  const clientName = Array.isArray(clientRel) ? clientRel[0]?.name ?? null : clientRel?.name ?? null
  const subjectName = visit.target_subject_id
    ? ctx.openSubjects.find((s) => s.id === visit.target_subject_id)?.name ?? null
    : null

  const startIso = visit.started_at ?? visit.created_at
  const dateLabel = new Date(startIso).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const durMins = visit.started_at && visit.ended_at
    ? Math.max(0, Math.round((new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60000))
    : null
  const durationLabel = durMins == null ? null : durMins < 60 ? `${durMins} min` : `${Math.floor(durMins / 60)} h ${durMins % 60} min`

  // Le CR se génère au TEMPS 2, avant que le bureau ne matérialise notes/réserves.
  // Il doit donc refléter les CAPTURES elles-mêmes (photos, notes, vocaux), sinon
  // il paraît vide. On lit le panier de la visite en plus du contexte bureau.
  const captures = (await listVisitCaptures(reportId).catch(() => []))
    .filter((c) => c.status !== 'discarded')
  const noteBodies = captures
    .filter((c) => c.kind === 'note' && c.body?.trim())
    .map((c) => c.body!.trim())
  const vocalBodies = captures
    .filter((c) => c.kind === 'vocal' && c.body?.trim())
    .map((c) => `« ${c.body!.trim()} »`)
  const photoCaptures = captures.filter((c) => c.kind === 'photo')
  const videoCount = captures.filter((c) => c.kind === 'video').length
  const vocalCount = captures.filter((c) => c.kind === 'vocal').length

  // Photos : URLs signées, embarquées dans le PDF (borné pour rester léger).
  const previews: Record<string, { url: string; mime: string | null }> =
    await getVisitCapturePreviewUrls(photoCaptures.slice(0, 24)).catch(() => ({}))
  const photos = photoCaptures
    .map((c) => previews[c.id]?.url)
    .filter((u): u is string => !!u)

  // Constats = notes bureau (site_notes) + notes/vocaux du terrain, dédupliqués.
  const seen = new Set<string>()
  const constats = [...ctx.capturedNotes, ...noteBodies, ...vocalBodies].filter((t) => {
    const k = t.trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })

  return {
    siteName,
    clientName,
    dateLabel,
    typeLabel: ORIGIN_FR[visit.origin ?? ''] ?? 'Visite',
    durationLabel,
    objective: visit.objective?.trim() || null,
    subjectName,
    constats,
    reserves: ctx.capturedReserves,
    actions: ctx.capturedActions,
    photos,
    videoCount,
    vocalCount,
    outcomeLabel: visit.outcome ? OUTCOME_FR[visit.outcome] ?? visit.outcome : null,
    resolutionLabel: visit.resolution ? RESOLUTION_FR[visit.resolution] ?? visit.resolution : null,
  }
}

/**
 * Assemble le CR d'une visite en markdown. Projection du même `VisitCrDoc` que le
 * PDF (source de vérité unique). Régénérable à volonté.
 */
export async function buildVisitCr(reportId: string): Promise<string | null> {
  const doc = await buildVisitCrDoc(reportId)
  if (!doc) return null

  const lines: string[] = []
  lines.push(`# Compte-rendu de visite — ${doc.siteName}`)
  lines.push('')
  lines.push(`**Date :** ${doc.dateLabel}`)
  lines.push(`**Type :** ${doc.typeLabel}`)
  if (doc.durationLabel) lines.push(`**Durée :** ${doc.durationLabel}`)
  lines.push('')

  lines.push('## Objet de la visite')
  lines.push(doc.objective || '_Non précisé._')
  if (doc.subjectName) lines.push(`Sujet : **${doc.subjectName}**`)
  lines.push('')

  lines.push('## Constats')
  if (doc.constats.length > 0) doc.constats.forEach((n) => lines.push(`- ${n}`))
  else lines.push('_Aucune note saisie pendant la visite._')
  lines.push('')

  if (doc.reserves.length > 0) {
    lines.push('## Réserves relevées')
    doc.reserves.forEach((r) => lines.push(`- ${r.label}${r.location ? ` (${r.location})` : ''}`))
    lines.push('')
  }

  if (doc.actions.length > 0) {
    lines.push('## Actions')
    doc.actions.forEach((a) => lines.push(`- ${a.corps_etat ? `(${a.corps_etat}) ` : ''}${a.title}`))
    lines.push('')
  }

  // Médias captés — le CR terrain doit refléter ce qui a été ramené.
  const mediaParts = [
    doc.photos.length > 0 ? `${doc.photos.length} photo${doc.photos.length > 1 ? 's' : ''}` : null,
    doc.videoCount > 0 ? `${doc.videoCount} vidéo${doc.videoCount > 1 ? 's' : ''}` : null,
    doc.vocalCount > 0 ? `${doc.vocalCount} vocal${doc.vocalCount > 1 ? 'aux' : ''}` : null,
  ].filter(Boolean)
  if (mediaParts.length > 0) {
    lines.push('## Médias')
    lines.push(`${mediaParts.join(' · ')} (voir le PDF ou la visite pour les images).`)
    lines.push('')
  }

  lines.push('## Bilan')
  lines.push(`**Résultat :** ${doc.outcomeLabel ?? '_non précisé_'}`)
  lines.push(`**Suivi :** ${doc.resolutionLabel ?? '_non précisé_'}`)
  lines.push('')
  lines.push('---')
  lines.push('_Compte-rendu généré depuis le Débrief MemorIA — projection des éléments validés._')

  return lines.join('\n')
}
