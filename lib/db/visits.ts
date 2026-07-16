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
import { listVisitCaptures, getVisitCapturePreviewUrls, listSiteViewpointRows, type VisitCaptureKind, type CaptureTriageIntent, type VisitCaptureRow } from '@/lib/db/visit-captures'
import { groupViewpointChains, sampleSerie } from '@/lib/visits/viewpoints'
import { listDecisionsBySite } from '@/lib/db/site-decisions'
import { buildSiteMemorySignals, buildSuggestedQuestions, detectRecurringTopics, detectOverdueActions, type MemorySignal, type SuggestedQuestion } from '@/lib/db/site-memory-signals'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { getSiteReserves } from '@/lib/db/site-reserve'
import { runVisitSummary } from '@/services/ai/visit-summary'
import { detectVisitSuites } from '@/services/ai/visit-suites'
import { listProposals, bulkInsertProposals } from '@/lib/db/site-reports'
import { toProposalRows, proposalVisitKind, proposalCaptureId, proposalExcerpt } from '@/lib/visits/suite-proposals'
import { visitIntentLabel } from '@/lib/field/visit-intents'
import { listSubjectsBySite } from '@/lib/db/subjects'
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
  /** Porte d'entrée (mig 184). NULL/absent = direct terrain ; 'whatsapp_zip' /
   *  'upload' / … = import. Le pipeline aval est identique. */
  source?: string | null
  /** Début RÉEL de la session (import : 1ʳᵉ capture du lot). Défaut : now(). */
  startedAt?: string | null
  /** INTENTION de la visite (mig 186 : premiere / avancement / previsite_ao / …).
   *  Même moteur ; l'intention spécialisera libellés, CR, questions de fin. */
  motive?: string | null
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
      source: input.source ?? null,
      visit_motive: input.motive ?? null,
      // Objet PRÉ-REMPLI pour une première visite (éditable) : MemorIA comprend
      // d'emblée le contexte. Dans ~80 % des cas l'agent ne le changera pas.
      objective: input.motive === 'premiere' ? "Créer l'état initial du chantier" : null,
      started_at: input.startedAt ?? new Date().toISOString(),
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
 * REPREND une visite terminée : efface `ended_at` → elle redevient LA visite en
 * cours du site (getActiveVisit la retrouve), avec toutes ses captures et leurs
 * tags intacts. « Une visite n'est jamais figée » : erreur, interruption, oubli
 * → on reprend exactement où on en était. Ne touche à aucun champ métier.
 */
export async function reopenVisit(reportId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_reports')
    .update({ ended_at: null, updated_at: new Date().toISOString() })
    .eq('id', reportId)
  if (error) throw error
}

/**
 * SUPPRIME (soft) une visite non concluante : pose `deleted_at`. Elle disparaît
 * de « Reprendre mon travail », de la liste des visites et n'est plus ouvrable.
 * Réversible (deleted_at → null) ; on ne touche ni aux captures ni aux suites déjà
 * matérialisées (mais une visite « non concluante » n'en a normalement pas).
 * Le garde-fou « c'est bien une visite » est fait EN AMONT (deleteVisitAction via
 * getVisit, qui exige origin non-null). On ne le remet PAS sur l'UPDATE : un filtre
 * supplémentaire pouvait matcher 0 ligne SANS erreur (suppression silencieusement
 * sans effet, puis réapparition au rafraîchissement). On VÉRIFIE l'écriture.
 */
export async function deleteVisit(reportId: string): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_reports')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', reportId)
    .select('id')
  if (error) throw error
  return (data ?? []).length
}

/**
 * Clôture DÉFINITIVE d'une visite — le cœur testable de « Terminer la visite ».
 * Règle produit : « non trié = gardé en mémoire » (rien n'est jamais perdu).
 *
 * Deux écritures, pas de transaction : l'ORDRE fait le filet. Les captures
 * d'abord, ended_at ensuite — si la seconde échoue, ended_at reste null et la
 * visite reste dans « Reprendre mon travail » (visible, reprenable, jamais
 * perdue). Chaque écriture est VÉRIFIÉE (Supabase retourne ses erreurs, il ne
 * les lance pas) : jamais ok:true sans preuve. Idempotente : un second appel
 * ne modifie rien et retourne un succès cohérent (les tris explicites — intent
 * posé, statut kept — ne sont JAMAIS écrasés : seul status='captured' bascule).
 */
export async function finalizeVisit(reportId: string): Promise<{ ok: boolean; error?: string }> {
  const visit = await getVisit(reportId)
  if (!visit) return { ok: false, error: 'Visite introuvable' }
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  // 1. Captures encore « à trier » → gardées en mémoire (défaut non destructif).
  //    0 ligne modifiée = légitime (tout était déjà trié), pas un échec.
  const { error: capErr } = await supabase
    .from('visit_capture')
    .update({ status: 'kept', triage_intent: null, updated_at: now })
    .eq('report_id', reportId)
    .eq('status', 'captured')
  if (capErr) {
    return { ok: false, error: 'Les captures n’ont pas pu être gardées en mémoire — réessayez.' }
  }

  // 2. La visite doit être terminée (ended_at posé) — au cas où on arrive ici
  //    sans être passé par « Terminer » du panier.
  if (!visit.ended_at) {
    const { data: endedRows, error: endErr } = await supabase
      .from('site_reports')
      .update({ ended_at: now, updated_at: now })
      .eq('id', reportId)
      .is('ended_at', null)
      .select('id')
    if (endErr) {
      return { ok: false, error: 'La fin de visite n’a pas pu être enregistrée — réessayez.' }
    }
    if (!endedRows || endedRows.length === 0) {
      // 0 ligne : soit ended_at vient d'être posé ailleurs (course bénigne),
      // soit la ligne a disparu. On relit pour trancher — jamais de succès
      // déclaré sans preuve.
      const fresh = await getVisit(reportId)
      if (!fresh?.ended_at) {
        return { ok: false, error: 'La fin de visite n’a pas pu être enregistrée — réessayez.' }
      }
    }
  }
  return { ok: true }
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
    .is('deleted_at', null)
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
    .is('deleted_at', null)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as DbSiteReport | null) ?? null
}

/**
 * La visite qu'on VIENT de démarrer, retrouvée par son id (porté dans l'URL
 * `?live=`). Sert de repli DÉTERMINISTE au « swap » fiche → panier : `getActiveVisit`
 * dépend d'une relecture qui peut arriver une fraction de seconde après l'insert
 * (cache de route, timing) ; quand on connaît déjà l'id du report tout juste créé,
 * on l'ouvre directement. Ne filtre PAS `deleted_at` (une visite qu'on démarre à
 * l'instant n'est pas supprimée), juste : bon site, c'est bien une visite (origin),
 * non terminée. Renvoie null si l'id ne correspond pas (ex. déjà clôturée).
 */
export async function getStartedVisitById(reportId: string, siteId: string): Promise<DbSiteReport | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_reports')
    .select('*')
    .eq('id', reportId)
    .eq('site_id', siteId)
    .not('origin', 'is', null)
    .is('ended_at', null)
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
    .is('deleted_at', null)
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
    .is('deleted_at', null)
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
    .is('deleted_at', null)
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

/**
 * L'IMPACT d'une visite sur la mémoire du chantier — « en quoi le chantier est-il
 * différent maintenant ? », pour l'écran de fin. Pas un inventaire d'objets : une
 * lecture métier, orientée CONSÉQUENCE (points de vigilance, réserve à traiter,
 * suivi enrichi). Truthful et borné : au temps 2 (la voiture) les réserves/actions
 * ne sont matérialisées QUE si elles ont déjà été créées ; sinon on met en avant
 * l'apport mémoire (photos/notes) et les sujets touchés. Lecture seule.
 */
export interface VisitImpact {
  /** Ajouté pendant la visite (fenêtre temporelle). */
  added: { photos: number; notes: number; reserves: number; actions: number }
  /** Noms des sujets touchés pendant la visite (points de vigilance mis à jour). */
  touchedSubjects: string[]
}

export async function buildVisitImpact(reportId: string): Promise<VisitImpact | null> {
  const supabase = createAdminClient()
  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id) return null
  const siteId = visit.site_id
  const from = visit.started_at ?? visit.created_at
  const to = visit.ended_at ?? new Date().toISOString()

  const countWindow = async (table: string): Promise<number> => {
    const { count } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .gte('created_at', from)
      .lte('created_at', to)
    return count ?? 0
  }

  const [captureRes, reserves, actions, touchedRes] = await Promise.all([
    supabase.from('visit_capture').select('kind').eq('report_id', reportId).neq('status', 'discarded'),
    countWindow('site_reserve'),
    countWindow('site_actions'),
    supabase.from('visit_capture').select('subject_id').eq('report_id', reportId).not('subject_id', 'is', null).neq('status', 'discarded'),
  ])

  const kinds = (captureRes.data ?? []) as Array<{ kind: string }>
  const photos = kinds.filter((k) => k.kind === 'photo').length
  const notes = kinds.filter((k) => k.kind === 'note').length

  const subjectIds = [...new Set(
    ((touchedRes.data ?? []) as Array<{ subject_id: string | null }>).map((r) => r.subject_id).filter((x): x is string => !!x),
  )]
  let touchedSubjects: string[] = []
  if (subjectIds.length > 0) {
    const { data: subs } = await supabase.from('subjects').select('name').in('id', subjectIds).limit(4)
    touchedSubjects = ((subs ?? []) as Array<{ name: string }>).map((s) => s.name)
  }

  return {
    added: { photos, notes, reserves, actions },
    touchedSubjects,
  }
}

// ── Suites à matérialiser au débrief (tags Action/Réserve → objets chantier) ─

// ── « Voir la visite » : Évolution + Patrimoine (mémoire du chantier) ─────────
// La page de consultation devient 4 onglets (Cette visite / Évolution / Histoire /
// Mémoire). Ces deux assembleurs nourrissent Évolution et le pied de Mémoire.
// 100 % déterministe (aucune IA) : diffs et compteurs.

export interface VisitEvolution {
  /** Y a-t-il une visite précédente à comparer ? Non → « point de référence ». */
  hasPrev: boolean
  prevDateLabel: string | null
  resolvedReserves: Array<{ label: string; location: string | null }>
  newReserves: Array<{ label: string; location: string | null }>
  recurring: Array<{ label: string; detail: string | null }>
  addedPhotos: number
}

/** Le DIFF depuis la dernière visite : réserves levées / nouvelles, récurrences,
 *  photos ajoutées. « Ce n'est plus la visite, c'est le diff. » */
export async function buildVisitEvolution(reportId: string, siteId: string): Promise<VisitEvolution> {
  const empty: VisitEvolution = { hasPrev: false, prevDateLabel: null, resolvedReserves: [], newReserves: [], recurring: [], addedPhotos: 0 }
  const supabase = createAdminClient()

  const { data: cur } = await supabase.from('site_reports').select('started_at, created_at').eq('id', reportId).maybeSingle()
  const curRow = cur as { started_at: string | null; created_at: string } | null
  const curStart = curRow?.started_at ?? curRow?.created_at ?? new Date().toISOString()

  // Visite TERMINÉE juste avant la courante (la borne du diff).
  const { data: prev } = await supabase
    .from('site_reports')
    .select('id, started_at, ended_at, created_at')
    .eq('site_id', siteId)
    .not('origin', 'is', null)
    .not('ended_at', 'is', null)
    .neq('id', reportId)
    .lt('ended_at', curStart)
    .order('ended_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const prevVisit = prev as { id: string; started_at: string | null; ended_at: string | null; created_at: string } | null
  if (!prevVisit) return empty
  const since = prevVisit.ended_at ?? prevVisit.started_at ?? prevVisit.created_at
  const prevDateLabel = new Date(since).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })

  const [{ data: resRows }, photosRes, rec] = await Promise.all([
    supabase.from('site_reserve').select('label, location, status, created_at, lifted_at').eq('site_id', siteId),
    supabase.from('visit_capture').select('id', { count: 'exact', head: true })
      .eq('site_id', siteId).eq('kind', 'photo').neq('status', 'discarded').gt('created_at', since),
    detectRecurringTopics(siteId).catch(() => null),
  ])
  const rows = (resRows ?? []) as Array<{ label: string; location: string | null; status: string; created_at: string; lifted_at: string | null }>
  const resolvedReserves = rows.filter((r) => r.status === 'lifted' && r.lifted_at && r.lifted_at > since).slice(0, 10).map((r) => ({ label: r.label, location: r.location }))
  const newReserves = rows.filter((r) => r.created_at > since).slice(0, 10).map((r) => ({ label: r.label, location: r.location }))
  const recurring = rec ? rec.items.slice(0, 5).map((i) => ({ label: i.label, detail: i.meta ?? i.context?.[0] ?? null })) : []

  return { hasPrev: true, prevDateLabel, resolvedReserves, newReserves, recurring, addedPhotos: photosRes.count ?? 0 }
}

export interface SitePatrimoine {
  firstVisitLabel: string | null
  photos: number
  visits: number
  meetings: number
  actions: number
  reserves: number
  subjects: number
}

/** Le PATRIMOINE du chantier — « depuis la première visite : N photos · N visites
 *  · N réunions · N actions · N réserves · N sujets ». Présenté comme un patrimoine
 *  accumulé (« ce chantier apprend »), pas des KPI. Comptes RÉELS, déterministes —
 *  on n'affiche que ce qui a une source propre (entreprises/personnes = participants
 *  JSON, zones sensibles = non captées : volontairement absents). */
export async function buildSitePatrimoine(siteId: string): Promise<SitePatrimoine> {
  const supabase = createAdminClient()
  const [visitsRes, meetingsRes, photosRes, actionsRes, reservesRes, subjectsRes, firstRes] = await Promise.all([
    supabase.from('site_reports').select('id', { count: 'exact', head: true }).eq('site_id', siteId).not('origin', 'is', null),
    supabase.from('site_reports').select('id', { count: 'exact', head: true }).eq('site_id', siteId).is('origin', null).neq('status', 'draft'),
    supabase.from('visit_capture').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('kind', 'photo').neq('status', 'discarded'),
    supabase.from('site_actions').select('id', { count: 'exact', head: true }).eq('site_id', siteId),
    supabase.from('site_reserve').select('id', { count: 'exact', head: true }).eq('site_id', siteId),
    supabase.from('subjects').select('id', { count: 'exact', head: true }).eq('site_id', siteId).neq('status', 'closed'),
    supabase.from('site_reports').select('started_at, created_at').eq('site_id', siteId).not('origin', 'is', null).order('started_at', { ascending: true, nullsFirst: false }).limit(1).maybeSingle(),
  ])
  const first = firstRes.data as { started_at: string | null; created_at: string } | null
  const firstIso = first?.started_at ?? first?.created_at ?? null
  return {
    firstVisitLabel: firstIso ? new Date(firstIso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null,
    photos: photosRes.count ?? 0,
    visits: visitsRes.count ?? 0,
    meetings: meetingsRes.count ?? 0,
    actions: actionsRes.count ?? 0,
    reserves: reservesRes.count ?? 0,
    subjects: subjectsRes.count ?? 0,
  }
}

export interface SiteImportantEvidence {
  /** Photos marquées ⭐ (clés) — les preuves à retrouver vite. */
  photos: Array<{ id: string; url: string; reportId: string }>
  /** Décisions distillées + lien vers LEUR source (visite ou réunion). */
  decisions: Array<{ id: string; titre: string; impact: string | null; href: string | null }>
}

/**
 * « Preuves importantes » du Patrimoine : ce qui mérite d'être retrouvé vite.
 * Aucune nouvelle logique métier — on EXPOSE proprement des données déjà là :
 * photos clés (⭐) et décisions distillées, chacune ouvrant sa source. Section
 * masquée par l'appelant si tout est vide.
 */
export async function buildSiteImportantEvidence(siteId: string): Promise<SiteImportantEvidence> {
  const supabase = createAdminClient()

  // ⭐ Photos favorites (clés) — les plus récentes d'abord.
  const { data: photoRows } = await supabase
    .from('visit_capture')
    .select('id, report_id, site_id, kind, status, body, transcript_status, attachment_id, subject_id, triage_intent, suite_status, starred, client_uuid, lat, lng, captured_at, created_at')
    .eq('site_id', siteId).eq('kind', 'photo').eq('starred', true).neq('status', 'discarded')
    .order('created_at', { ascending: false }).limit(8)
  const photoCaptures = (photoRows ?? []) as VisitCaptureRow[]
  const previews = await getVisitCapturePreviewUrls(photoCaptures).catch(() => ({} as Record<string, { url: string; mime: string | null }>))
  const photos = photoCaptures
    .map((c) => ({ id: c.id, url: previews[c.id]?.url, reportId: c.report_id }))
    .filter((p): p is { id: string; url: string; reportId: string } => !!p.url)

  // Décisions distillées + lien vers leur source (origine → visite / réunion).
  const decisionsAll = await listDecisionsBySite(siteId).catch(() => [])
  const recent = decisionsAll.slice(0, 6)
  const reportIds = [...new Set(recent.map((d) => d.reportId).filter((x): x is string => !!x))]
  const originById = new Map<string, string | null>()
  if (reportIds.length) {
    const { data: reps } = await supabase.from('site_reports').select('id, origin').in('id', reportIds)
    for (const r of (reps ?? []) as Array<{ id: string; origin: string | null }>) originById.set(r.id, r.origin)
  }
  const decisions = recent.map((d) => ({
    id: d.id,
    titre: d.titre,
    impact: d.impact,
    href: d.reportId && originById.has(d.reportId)
      ? (originById.get(d.reportId) ? `/m/visite/${d.reportId}/recap` : `/m/reunion/${d.reportId}`)
      : null,
  }))

  return { photos, decisions }
}

// ── « État du chantier » : le résumé qui se lit en 10 secondes (fiche chantier) ─
// « 2 actions en retard · dernière visite il y a 3 jours · aucune réunion planifiée
// · 1 réserve ouverte · +12 photos depuis la dernière visite. » Déterministe.

export type SiteStatusTone = 'alert' | 'warn' | 'info'
export type SiteStatusMetric = 'actions' | 'reserves' | 'lastVisit' | 'nextMeeting'
/** Une cellule de la grille « État du chantier » : la santé en 4 chiffres, chacun
 *  cliquable vers son détail. `value` peut être un nombre (« 9 ») ou une date. */
export interface SiteStatusCell {
  key: SiteStatusMetric
  value: string
  label: string
  tone: SiteStatusTone
  href?: string
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export async function buildSiteStatusSummary(siteId: string): Promise<SiteStatusCell[]> {
  const supabase = createAdminClient()
  const [overdue, lastVisit, reserves, meeting, openActionsAll] = await Promise.all([
    detectOverdueActions(siteId).catch(() => null),
    getLastEndedVisitForSite(siteId).catch(() => null),
    getSiteReserves(siteId).catch(() => []),
    supabase
      .from('site_reports')
      .select('next_meeting_at')
      .eq('site_id', siteId)
      .not('next_meeting_at', 'is', null)
      .gte('next_meeting_at', new Date().toISOString())
      .order('next_meeting_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    listOpenSiteActions({ siteIds: [siteId] }).catch(() => []),
  ])

  const overdueN = overdue ? overdue.items.length : 0
  const openActionsN = openActionsAll.length
  const openReserves = (reserves as Array<{ status: string }>).filter((r) => r.status === 'open').length
  const lastIso = lastVisit ? (lastVisit.endedAt ?? lastVisit.startedAt) : null
  const nextMeeting = (meeting.data as { next_meeting_at: string } | null)?.next_meeting_at

  // Toujours 4 cellules (grille stable) ; « colonne vide » → « 0 » ou « Aucune ».
  return [
    {
      key: 'actions',
      value: String(openActionsN),
      label: openActionsN === 1 ? 'Action ouverte' : 'Actions ouvertes',
      tone: overdueN > 0 ? 'alert' : openActionsN > 0 ? 'warn' : 'info',
      href: openActionsN > 0 ? `/m/actions?site=${siteId}` : undefined,
    },
    {
      key: 'reserves',
      value: String(openReserves),
      label: openReserves === 1 ? 'Réserve' : 'Réserves',
      tone: openReserves > 0 ? 'warn' : 'info',
      href: openReserves > 0 ? `/m/site/${siteId}#reste-a-faire` : undefined,
    },
    {
      key: 'lastVisit',
      value: lastIso ? shortDate(lastIso) : 'Aucune',
      label: 'Dernière visite',
      tone: 'info',
      href: lastIso ? `/m/site/${siteId}/visites` : undefined,
    },
    {
      key: 'nextMeeting',
      value: nextMeeting ? shortDate(nextMeeting) : 'Aucune',
      label: 'Prochaine réunion',
      tone: 'info',
      href: `/m/site/${siteId}/reunions`,
    },
  ]
}

// ── « Chantiers récents » : les 3 derniers dossiers ouverts (accueil, sobre) ──
// Pas besoin d'aller dans « Chantiers » à chaque fois : les 3 derniers, une ligne
// chacun (nom · dernière activité · actions/réserves ouvertes). Zéro image.

export interface RecentSiteItem {
  siteId: string
  name: string
  lastActivityLabel: string | null
  openActions: number
  openReserves: number
}

function relativeDayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = d.getTime()
  if (Number.isNaN(t)) return ''
  if (t >= startToday) return "Aujourd'hui"
  if (t >= startToday - 86400000) return 'Hier'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export async function listRecentSitesForUser(userId: string, limit = 3): Promise<RecentSiteItem[]> {
  const supabase = createAdminClient()
  const { data: reps } = await supabase
    .from('site_reports')
    .select('site_id, created_at, started_at, ended_at')
    .eq('created_by', userId)
    .not('site_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(40)
  const rows = (reps ?? []) as Array<{ site_id: string; created_at: string; started_at: string | null; ended_at: string | null }>
  const order: string[] = []
  const lastBySite = new Map<string, string>()
  for (const r of rows) {
    if (!lastBySite.has(r.site_id)) {
      lastBySite.set(r.site_id, r.ended_at ?? r.started_at ?? r.created_at)
      order.push(r.site_id)
    }
    if (order.length >= limit) break
  }
  if (order.length === 0) return []

  const [{ data: sites }, openActions, { data: reserveRows }] = await Promise.all([
    supabase.from('sites').select('id, name').in('id', order),
    listOpenSiteActions({ siteIds: order }).catch(() => []),
    supabase.from('site_reserve').select('site_id, status').in('site_id', order),
  ])
  const nameById = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]))
  const actionsBySite = new Map<string, number>()
  for (const a of openActions as Array<{ site_id: string }>) actionsBySite.set(a.site_id, (actionsBySite.get(a.site_id) ?? 0) + 1)
  const reservesBySite = new Map<string, number>()
  for (const r of (reserveRows ?? []) as Array<{ site_id: string; status: string }>) {
    if (r.status === 'open') reservesBySite.set(r.site_id, (reservesBySite.get(r.site_id) ?? 0) + 1)
  }

  return order.map((siteId) => ({
    siteId,
    name: nameById.get(siteId) ?? 'Chantier',
    lastActivityLabel: relativeDayLabel(lastBySite.get(siteId) ?? ''),
    openActions: actionsBySite.get(siteId) ?? 0,
    openReserves: reservesBySite.get(siteId) ?? 0,
  }))
}

// ── « Récent » : dernière visite + dernier compte-rendu de l'agent (accueil) ──
// La feuille de journée se termine par un « Récent » narratif : ce que j'ai fait
// en dernier, pour y revenir vite. On ne montre QUE ce qui existe (pas de « dernier
// chantier consulté » : aucun suivi de consultation en base).

export interface RecentActivityItem { reportId: string; label: string; sub: string }

export async function getRecentActivityForUser(userId: string): Promise<RecentActivityItem[]> {
  const supabase = createAdminClient()
  const [visitRes, crRes] = await Promise.all([
    supabase.from('site_reports').select('id, site_id, started_at, ended_at, created_at')
      .eq('created_by', userId).not('origin', 'is', null).not('site_id', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('site_reports').select('id, site_id, title, created_at')
      .eq('created_by', userId).is('origin', null).neq('status', 'draft').not('site_id', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const v = visitRes.data as { id: string; site_id: string; started_at: string | null; ended_at: string | null; created_at: string } | null
  const cr = crRes.data as { id: string; site_id: string; title: string | null; created_at: string } | null

  const ids = [v?.site_id, cr?.site_id].filter((x): x is string => !!x)
  const nameById = new Map<string, string>()
  if (ids.length) {
    const { data } = await supabase.from('sites').select('id, name').in('id', [...new Set(ids)])
    for (const s of (data ?? []) as Array<{ id: string; name: string }>) nameById.set(s.id, s.name)
  }

  const items: RecentActivityItem[] = []
  if (v) items.push({ reportId: v.id, label: `Dernière visite — ${nameById.get(v.site_id) ?? 'Chantier'}`, sub: relativeDayLabel(v.ended_at ?? v.started_at ?? v.created_at) })
  if (cr) items.push({ reportId: cr.id, label: cr.title?.trim() || `Compte-rendu — ${nameById.get(cr.site_id) ?? 'Chantier'}`, sub: relativeDayLabel(cr.created_at) })
  return items
}

// ── Fiche chantier : « Dernière activité » (visites + réunions + interventions) ─
// La fiche doit montrer ce qui s'est passé récemment sur CE chantier, tous types
// confondus, du plus récent au plus ancien. Déterministe.

export type SiteActivityKind = 'visit' | 'meeting' | 'intervention'
export interface SiteActivityItem {
  kind: SiteActivityKind
  label: string
  dateLabel: string
  at: string
  href: string
  /** id du report/intervention — sert à enrichir (photos, décisions). */
  reportId: string | null
  /** Détail déterministe : « 24 photos », « 5 décisions »… (null si aucun). */
  detail: string | null
}

export async function getSiteRecentActivity(siteId: string, limit = 6): Promise<SiteActivityItem[]> {
  const supabase = createAdminClient()
  const [repsRes, missionsRes] = await Promise.all([
    supabase.from('site_reports').select('id, title, origin, started_at, ended_at, created_at')
      .eq('site_id', siteId).neq('status', 'draft').order('created_at', { ascending: false }).limit(8),
    supabase.from('missions').select('id, name').eq('site_id', siteId).is('deleted_at', null),
  ])
  const missionRows = (missionsRes.data ?? []) as Array<{ id: string; name: string }>
  const missionName = new Map(missionRows.map((m) => [m.id, m.name]))

  let intv: Array<{ id: string; scheduled_at: string; scheduled_for: string | null; mission_id: string }> = []
  if (missionRows.length) {
    const { data } = await supabase.from('interventions')
      .select('id, scheduled_at, scheduled_for, mission_id')
      .in('mission_id', missionRows.map((m) => m.id))
      .order('scheduled_at', { ascending: false }).limit(8)
    intv = (data ?? []) as typeof intv
  }

  const items: SiteActivityItem[] = []
  for (const r of (repsRes.data ?? []) as Array<{ id: string; title: string | null; origin: string | null; started_at: string | null; ended_at: string | null; created_at: string }>) {
    const at = r.ended_at ?? r.started_at ?? r.created_at
    items.push(r.origin
      ? { kind: 'visit', label: 'Visite', dateLabel: relativeDayLabel(at), at, href: `/m/visite/${r.id}/recap`, reportId: r.id, detail: null }
      : { kind: 'meeting', label: r.title?.trim() || 'Réunion', dateLabel: relativeDayLabel(at), at, href: `/m/reunion/${r.id}`, reportId: r.id, detail: null })
  }
  for (const i of intv) {
    const at = i.scheduled_for ? `${i.scheduled_for}T12:00:00Z` : i.scheduled_at
    items.push({ kind: 'intervention', label: missionName.get(i.mission_id) ?? 'Intervention', dateLabel: relativeDayLabel(at), at, href: `/m/intervention/${i.id}`, reportId: null, detail: null })
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const shown = items.slice(0, limit)

  // Enrichissement déterministe des SEULS éléments affichés : photos d'une
  // visite, décisions d'une réunion. Compté sur les objets réels, zéro IA.
  await Promise.all(shown.map(async (it) => {
    if (it.kind === 'visit' && it.reportId) {
      const { count } = await supabase.from('visit_capture').select('id', { count: 'exact', head: true })
        .eq('report_id', it.reportId).eq('kind', 'photo').is('hidden_at', null)
      if (count && count > 0) it.detail = `${count} photo${count > 1 ? 's' : ''}`
    } else if (it.kind === 'meeting' && it.reportId) {
      const { count } = await supabase.from('site_decisions').select('id', { count: 'exact', head: true })
        .eq('report_id', it.reportId)
      if (count && count > 0) it.detail = `${count} décision${count > 1 ? 's' : ''}`
    }
  }))
  return shown
}

// ── Fiche chantier : « Toutes les visites » (route /m/site/[id]/visites) ────────
// Une seule question métier : « montre-moi toutes les visites de ce chantier ».
// Liste chronologique déterministe. Réutilise site_reports + visit_capture.

const VISIT_TYPE_LABEL: Record<string, string> = {
  planned: 'Planifiée',
  spontaneous: 'Visite',
  qr: 'QR',
  gps: 'GPS',
  import: 'Import',
}

export interface SiteVisitListItem {
  id: string
  at: string
  dateLabel: string
  typeLabel: string
  /** Contexte AO : le chantier est en phase Prospect/AO → « pré-visite » (pas un
   *  nouveau type d'objet, juste le vocabulaire du contexte). */
  isPrevisite: boolean
  /** Objet de la visite s'il a été saisi — le vrai « de quoi ça parlait ». */
  objective: string | null
  authorName: string | null
  photos: number
  observations: number
  inProgress: boolean
  href: string
}

export async function listSiteVisitsForMobile(siteId: string, limit = 50): Promise<SiteVisitListItem[]> {
  const supabase = createAdminClient()
  const { data: rows } = await supabase
    .from('site_reports')
    .select('id, origin, visit_motive, objective, started_at, ended_at, created_at, created_by')
    .eq('site_id', siteId)
    .not('origin', 'is', null)
    .is('deleted_at', null)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  const reps = (rows ?? []) as Array<{ id: string; origin: string | null; visit_motive: string | null; objective: string | null; started_at: string | null; ended_at: string | null; created_at: string; created_by: string | null }>
  if (reps.length === 0) return []

  // Contexte AO du chantier : si son dossier est en phase prospect/AO, ses visites
  // sont des « pré-visites AO ». Aucune donnée nouvelle — on lit la phase du dossier.
  const aoContext = await isSiteInAoPhase(siteId)

  const authorById = await resolveAuthorNames(reps.map((r) => r.created_by))

  // Photos + observations capturées pendant la visite (visit_capture par report) —
  // pour que la ligne RACONTE ce qui s'est passé, pas juste une date.
  const countsByReport = new Map<string, { photos: number; observations: number }>()
  await Promise.all(
    reps.map(async (r) => {
      const [photosRes, obsRes] = await Promise.all([
        supabase.from('visit_capture').select('id', { count: 'exact', head: true })
          .eq('report_id', r.id).eq('kind', 'photo').is('hidden_at', null),
        supabase.from('visit_capture').select('id', { count: 'exact', head: true })
          .eq('report_id', r.id).in('kind', ['note', 'vocal', 'verification']).is('hidden_at', null),
      ])
      countsByReport.set(r.id, { photos: photosRes.count ?? 0, observations: obsRes.count ?? 0 })
    }),
  )

  return reps.map((r) => {
    const at = r.started_at ?? r.created_at
    const c = countsByReport.get(r.id) ?? { photos: 0, observations: 0 }
    return {
      id: r.id,
      at,
      dateLabel: relativeDayLabel(at),
      // Priorité à l'INTENTION explicite (mig 186) ; sinon contexte AO du dossier ;
      // sinon le type dérivé de l'origine.
      typeLabel: visitIntentLabel(r.visit_motive) ?? (aoContext ? 'Pré-visite AO' : VISIT_TYPE_LABEL[r.origin ?? ''] ?? 'Visite'),
      isPrevisite: r.visit_motive === 'previsite_ao' || (!r.visit_motive && aoContext),
      objective: r.objective?.trim() || null,
      authorName: r.created_by ? authorById.get(r.created_by) ?? null : null,
      photos: c.photos,
      observations: c.observations,
      inProgress: !r.ended_at,
      href: `/m/visite/${r.id}/recap`,
    }
  })
}

/** Le chantier est-il en contexte AO (dossier en phase prospect/en_ao) ? Sert à
 *  adapter le VOCABULAIRE (« pré-visite »), sans créer de nouveau type d'objet. */
export async function isSiteInAoPhase(siteId: string): Promise<boolean> {
  const dossierId = await getOpenDossierIdForSite(siteId).catch(() => null)
  if (!dossierId) return false
  const supabase = createAdminClient()
  const { data } = await supabase.from('dossiers').select('phase').eq('id', dossierId).maybeSingle()
  const phase = (data as { phase: string } | null)?.phase
  return phase === 'prospect' || phase === 'en_ao'
}

// ── Fiche chantier : « Toutes les réunions » (route /m/site/[id]/reunions) ──────
// Question métier unique : « montre-moi toutes les réunions de ce chantier ».
// Réunion / CR = site_report SANS origin. Ouvre le compte-rendu.

export interface SiteMeetingListItem {
  id: string
  at: string
  dateLabel: string
  title: string
  authorName: string | null
  decisions: number
  href: string
}

export async function listSiteMeetingsForMobile(siteId: string, limit = 50): Promise<SiteMeetingListItem[]> {
  const supabase = createAdminClient()
  const { data: rows } = await supabase
    .from('site_reports')
    .select('id, title, started_at, created_at, created_by')
    .eq('site_id', siteId)
    .is('origin', null)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(limit)
  const reps = (rows ?? []) as Array<{ id: string; title: string | null; started_at: string | null; created_at: string; created_by: string | null }>
  if (reps.length === 0) return []

  const authorById = await resolveAuthorNames(reps.map((r) => r.created_by))

  // Décisions prises dans chaque réunion — pour que la ligne dise ce qui en est
  // sorti, pas seulement une date.
  const decisionsByReport = new Map<string, number>()
  await Promise.all(
    reps.map(async (r) => {
      const { count } = await supabase.from('site_decisions').select('id', { count: 'exact', head: true }).eq('report_id', r.id)
      decisionsByReport.set(r.id, count ?? 0)
    }),
  )

  return reps.map((r) => {
    const at = r.started_at ?? r.created_at
    return {
      id: r.id,
      at,
      dateLabel: relativeDayLabel(at),
      title: r.title?.trim() || 'Réunion',
      authorName: r.created_by ? authorById.get(r.created_by) ?? null : null,
      decisions: decisionsByReport.get(r.id) ?? 0,
      href: `/m/reunion/${r.id}`,
    }
  })
}

// Résout des noms d'auteur (prénom) depuis des ids users. Une seule requête.
async function resolveAuthorNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  const out = new Map<string, string>()
  if (uniq.length === 0) return out
  const supabase = createAdminClient()
  const { data } = await supabase.from('users').select('id, full_name').in('id', uniq)
  for (const u of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    const first = (u.full_name ?? '').trim().split(/\s+/)[0]
    if (first) out.set(u.id, first)
  }
  return out
}

// ── Fiche chantier : « Depuis votre dernière visite » (résumé déterministe) ────
// Micro-fonction Phase 2 : quand on rouvre un chantier, dire en une ligne ce qui
// a bougé DEPUIS la dernière visite terminée. 100 % déterministe (compte des
// objets réels, aucun LLM). Renvoie null s'il n'y a pas de visite passée ou si
// rien n'a changé (silence positif).

export interface SinceLastVisitSummary {
  at: string
  dateLabel: string
  /** Jours écoulés depuis cette visite — « il y a 18 j », le temps du récit. */
  daysAgo: number
  /** true = la référence est VOTRE dernière visite (récit personnel) ;
   *  false = celle du chantier (vous n'y êtes jamais venu / repli). */
  personal: boolean
  actionsDone: number
  newReserves: number
  /** Réserves LEVÉES depuis — le chantier avance, pas seulement il s'alourdit. */
  liftedReserves: number
  meetings: number
  newPhotos: number
  /** « Vous étiez reparti avec un doute — il existe toujours. » : questions
   *  « à vérifier » posées AVANT/PENDANT cette visite, toujours actives (max 2). */
  doubts: string[]
  total: number
}

export async function buildSinceLastVisitSummary(siteId: string, userId: string | null = null): Promise<SinceLastVisitSummary | null> {
  const supabase = createAdminClient()
  // LE récit est personnel : « depuis MA dernière visite », pas celle du
  // chantier (à 25 visites sur 6 mois, à plusieurs, la nuance change tout).
  // Repli sur la dernière visite du site si cette personne n'y est jamais venue.
  let ref: string | null = null
  let personal = false
  if (userId) {
    const { data: mine } = await supabase
      .from('site_reports')
      .select('ended_at')
      .eq('site_id', siteId)
      .eq('created_by', userId)
      .not('origin', 'is', null)
      .not('ended_at', 'is', null)
      .is('deleted_at', null)
      .order('ended_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    ref = (mine as { ended_at: string | null } | null)?.ended_at ?? null
    personal = !!ref
  }
  if (!ref) {
    const { data: last } = await supabase
      .from('site_reports')
      .select('ended_at')
      .eq('site_id', siteId)
      .not('origin', 'is', null)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    ref = (last as { ended_at: string | null } | null)?.ended_at ?? null
  }
  if (!ref) return null

  const { data: missions } = await supabase.from('missions').select('id').eq('site_id', siteId).is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id as string)

  const [actionsRes, reservesRes, liftedRes, meetingsRes, capPhotosRes, doubtsRes] = await Promise.all([
    // Actions RÉELLEMENT terminées depuis la visite (done_at postérieur).
    supabase.from('site_actions').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'done').gt('done_at', ref),
    // Réserves ouvertes depuis (création postérieure).
    supabase.from('site_reserve').select('id', { count: 'exact', head: true }).eq('site_id', siteId).gt('created_at', ref),
    // Réserves LEVÉES depuis — la bonne nouvelle du récit.
    supabase.from('site_reserve').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'lifted').gt('lifted_at', ref),
    // Réunions/CR tenus depuis.
    supabase.from('site_reports').select('id', { count: 'exact', head: true }).eq('site_id', siteId).is('origin', null).neq('status', 'draft').gt('created_at', ref),
    // Photos captées depuis (chemin mobile), hors captures masquées.
    supabase.from('visit_capture').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('kind', 'photo').is('hidden_at', null).gt('created_at', ref),
    // Le doute d'alors, toujours ouvert : questions « à vérifier » posées au plus
    // tard À cette visite, encore actives aujourd'hui.
    supabase.from('captured_knowledge').select('title').eq('site_id', siteId).eq('kind', 'question').eq('status', 'active').lte('created_at', ref).order('created_at', { ascending: false }).limit(2),
  ])

  // Photos d'intervention postérieures à la visite (le chantier bouge entre deux visites).
  let intvPhotos = 0
  if (missionIds.length > 0) {
    const { data: intv } = await supabase.from('interventions').select('id').in('mission_id', missionIds)
    const intvIds = (intv ?? []).map((i) => i.id as string)
    if (intvIds.length > 0) {
      const { count } = await supabase.from('intervention_photos').select('id', { count: 'exact', head: true }).in('intervention_id', intvIds).gt('taken_at', ref)
      intvPhotos = count ?? 0
    }
  }

  const actionsDone = actionsRes.count ?? 0
  const newReserves = reservesRes.count ?? 0
  const liftedReserves = liftedRes.count ?? 0
  const meetings = meetingsRes.count ?? 0
  const newPhotos = (capPhotosRes.count ?? 0) + intvPhotos
  const doubts = ((doubtsRes.data ?? []) as Array<{ title: string }>)
    .map((d) => d.title?.trim())
    .filter((t): t is string => !!t)
  const total = actionsDone + newReserves + liftedReserves + meetings + newPhotos
  // Silence positif — SAUF si un doute d'alors existe toujours : ça, ça se dit.
  if (total === 0 && doubts.length === 0) return null
  const daysAgo = Math.max(0, Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000))
  return { at: ref, dateLabel: relativeDayLabel(ref), daysAgo, personal, actionsDone, newReserves, liftedReserves, meetings, newPhotos, doubts, total }
}

// ── Fiche chantier : « Mémoire » — le cumul DEPUIS LA CRÉATION ─────────────────
// Le chantier « parle » : combien de visites, de photos, d'actions, de réserves
// il a accumulé depuis son premier jour. Déterministe (comptes bruts), zéro IA.

export interface SiteEvolutionLine { text: string; tone: 'ok' | 'warn' }
export interface SiteMemorySnapshot {
  visits: number
  photos: number
  actions: number
  reserves: number
  /** « mars 2026 » — le mois du premier jalon (null si aucune visite). */
  sinceLabel: string | null
  /** Dernière évolution : quelques sujets résolus (✓) / encore actifs (⚠). */
  evolution: SiteEvolutionLine[]
}

export async function getSiteMemorySnapshot(siteId: string): Promise<SiteMemorySnapshot> {
  const supabase = createAdminClient()
  const [visitsRes, capPhotosRes, actionsRes, reservesRes, firstRes, missionsRes] = await Promise.all([
    supabase.from('site_reports').select('id', { count: 'exact', head: true }).eq('site_id', siteId).not('origin', 'is', null).neq('status', 'draft'),
    supabase.from('visit_capture').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('kind', 'photo').is('hidden_at', null),
    supabase.from('site_actions').select('id', { count: 'exact', head: true }).eq('site_id', siteId),
    supabase.from('site_reserve').select('id', { count: 'exact', head: true }).eq('site_id', siteId),
    supabase.from('site_reports').select('started_at, created_at').eq('site_id', siteId).not('origin', 'is', null).neq('status', 'draft').order('started_at', { ascending: true, nullsFirst: false }).limit(1).maybeSingle(),
    supabase.from('missions').select('id').eq('site_id', siteId).is('deleted_at', null),
  ])

  // Photos d'intervention (le chantier vit aussi hors visites).
  let intvPhotos = 0
  const missionIds = ((missionsRes.data ?? []) as Array<{ id: string }>).map((m) => m.id)
  if (missionIds.length > 0) {
    const { data: intv } = await supabase.from('interventions').select('id').in('mission_id', missionIds)
    const intvIds = ((intv ?? []) as Array<{ id: string }>).map((i) => i.id)
    if (intvIds.length > 0) {
      const { count } = await supabase.from('intervention_photos').select('id', { count: 'exact', head: true }).in('intervention_id', intvIds)
      intvPhotos = count ?? 0
    }
  }

  const first = firstRes.data as { started_at: string | null; created_at: string } | null
  const firstIso = first?.started_at ?? first?.created_at ?? null
  const sinceLabel = firstIso
    ? new Date(firstIso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Pacific/Noumea' })
    : null

  // Dernière évolution — les sujets récemment actifs : ✓ résolus (closed) ou
  // ⚠ encore actifs (open avec réserves/actions en retard). Max 3, du plus récent.
  const evolution: SiteEvolutionLine[] = []
  const subjects = await listSubjectsBySite(siteId).catch(() => [])
  const recent = [...subjects].sort((a, b) => ((a.lastActivity ?? '') < (b.lastActivity ?? '') ? 1 : -1))
  for (const s of recent) {
    if (evolution.length >= 3) break
    if (s.status === 'closed') {
      evolution.push({ text: `${s.name} résolu`, tone: 'ok' })
    } else if (s.status === 'open' && (s.openReserves > 0 || s.lateActions > 0)) {
      const bits = [
        s.openReserves > 0 ? `${s.openReserves} réserve${s.openReserves > 1 ? 's' : ''}` : null,
        s.lateActions > 0 ? `${s.lateActions} action${s.lateActions > 1 ? 's' : ''} en retard` : null,
      ].filter(Boolean).join(' · ')
      evolution.push({ text: `${s.name} — ${bits}`, tone: 'warn' })
    }
  }

  return {
    visits: visitsRes.count ?? 0,
    photos: (capPhotosRes.count ?? 0) + intvPhotos,
    actions: actionsRes.count ?? 0,
    reserves: reservesRes.count ?? 0,
    sinceLabel,
    evolution,
  }
}

// ── Récap · onglet « Évolution » : ce que CETTE visite a PRODUIT ──────────────
// « Qu'a apporté cette visite au chantier ? » On raconte la valeur créée (preuves,
// constats, impact, mémoire), pas un dump de compteurs. Précis à CETTE visite
// (visit_capture par report_id). Ne peut jamais être « vide » : une visite produit
// toujours au minimum une entrée d'historique + un compte-rendu.

export interface VisitProduction {
  photos: number
  vocals: number
  videos: number
  notes: number
  verifications: number
  positions: number
  reservesCreated: number
  actionsCreated: number
  totalCaptures: number
  /** Contexte AO — bascule la dernière ligne de l'encart (terrain → bureau). */
  isAo: boolean
}

export async function buildVisitProduction(reportId: string, isAo: boolean): Promise<VisitProduction> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('visit_capture')
    .select('kind, triage_intent')
    .eq('report_id', reportId)
    .is('hidden_at', null)
  const rows = (data ?? []) as Array<{ kind: string; triage_intent: string | null }>
  const byKind = (k: string) => rows.filter((r) => r.kind === k).length
  return {
    photos: byKind('photo'),
    vocals: byKind('vocal'),
    videos: byKind('video'),
    notes: byKind('note'),
    verifications: byKind('verification'),
    positions: byKind('position'),
    reservesCreated: rows.filter((r) => r.triage_intent === 'reserve').length,
    actionsCreated: rows.filter((r) => r.triage_intent === 'action').length,
    totalCaptures: rows.length,
    isAo,
  }
}

// ── « Reprendre mon travail » : le TRI RESTANT (pile de travail de l'accueil) ──
// Le geste QUOTIDIEN n'est pas de démarrer une visite, c'est de reprendre ce qui
// n'est pas fini. Ici : les visites TERMINÉES de l'agent qui ont encore des
// captures non triées (status='captured'). Les visites EN COURS, elles, sont
// gérées par listActiveVisitsForUser.

export interface PendingTriageItem {
  reportId: string
  siteId: string
  siteName: string
  remaining: number
  endedAt: string | null
}

export async function listPendingTriageForUser(userId: string, limit = 8): Promise<PendingTriageItem[]> {
  const supabase = createAdminClient()
  const { data: rows } = await supabase
    .from('site_reports')
    .select('id, site_id, ended_at')
    .eq('created_by', userId)
    .not('origin', 'is', null)
    .is('deleted_at', null)
    .not('ended_at', 'is', null)
    .not('site_id', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(30)
  const reps = (rows ?? []) as Array<{ id: string; site_id: string; ended_at: string | null }>
  if (reps.length === 0) return []

  const siteIds = [...new Set(reps.map((r) => r.site_id))]
  const { data: sites } = await supabase.from('sites').select('id, name').in('id', siteIds)
  const nameById = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]))

  const out: PendingTriageItem[] = []
  for (const r of reps) {
    const { count } = await supabase
      .from('visit_capture')
      .select('id', { count: 'exact', head: true })
      .eq('report_id', r.id)
      .eq('status', 'captured')
    if ((count ?? 0) > 0) {
      out.push({ reportId: r.id, siteId: r.site_id, siteName: nameById.get(r.site_id) ?? 'Chantier', remaining: count ?? 0, endedAt: r.ended_at })
      if (out.length >= limit) break
    }
  }
  return out
}

/**
 * Une SUITE proposée au débrief : une capture taguée ✅ Action / ⚠️ Réserve (écran
 * 2), pas encore matérialisée (`suite_status` null). MemorIA PROPOSE ; l'humain
 * valide/modifie/ignore. `similar` = objets ouverts du chantier proches (dédup :
 * « existe déjà, mettre à jour ? »).
 */
export interface VisitSuiteProposal {
  /** Identifiant UNIQUE de la proposition : `captureId` pour un tag, id de la
   *  ligne site_report_proposals pour une détection IA (persistée, mig 194). */
  id: string
  captureId: string
  kind: 'action' | 'reserve' | 'surveiller'
  text: string
  similar: Array<{ id: string; label: string }>
  /** 'tag' = décidé au tri (photo/vidéo taguée) ; 'ai' = compris par MemorIA
   *  depuis un vocal/une note. */
  source: 'tag' | 'ai'
  /** Extrait source (vocal/note) pour le contexte quand c'est MemorIA qui propose. */
  excerpt?: string | null
  /** Ligne site_report_proposals correspondante (source 'ai' uniquement) — le
   *  cycle proposed→accepted/rejected vit là, comme pour une réunion. */
  proposalId?: string
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}
function similarTitles(a: string, b: string): boolean {
  const wa = new Set(normalizeTitle(a).split(' ').filter((w) => w.length > 2))
  const wb = new Set(normalizeTitle(b).split(' ').filter((w) => w.length > 2))
  if (wa.size === 0 || wb.size === 0) return false
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter) >= 0.5
}

export async function gatherVisitSuites(reportId: string): Promise<VisitSuiteProposal[]> {
  const captures = await listVisitCaptures(reportId).catch(() => [])
  const pending = captures.filter(
    (c) => c.status === 'kept'
      && (c.triage_intent === 'action' || c.triage_intent === 'reserve')
      && c.suite_status == null,
  )
  if (pending.length === 0) return []
  const siteId = pending[0].site_id

  const [openActions, reserves] = await Promise.all([
    listOpenSiteActions({ siteIds: [siteId] }).catch(() => []),
    getSiteReserves(siteId).catch(() => []),
  ])
  const actionPool = (openActions as Array<{ id: string; title: string }>).map((a) => ({ id: a.id, label: a.title }))
  const reservePool = (reserves as Array<{ id: string; label: string; status: string }>)
    .filter((r) => r.status === 'open')
    .map((r) => ({ id: r.id, label: r.label }))

  return pending.map((c) => {
    const kind = c.triage_intent === 'reserve' ? ('reserve' as const) : ('action' as const)
    // Titre = le commentaire de la capture. VIDE s'il n'y en a pas — l'écran
    // demandera alors de NOMMER la suite (au lieu d'afficher un faux « à préciser »
    // qui donne l'impression d'une tâche vide inventée). Cf. retour terrain.
    const text = c.body?.trim() || ''
    const pool = kind === 'action' ? actionPool : reservePool
    const similar = pool.filter((o) => similarTitles(o.label, text)).slice(0, 3)
    return { id: c.id, captureId: c.id, kind, text, similar, source: 'tag' as const, excerpt: null }
  })
}

/**
 * « MemorIA a compris votre visite » — suites détectées depuis le TEXTE (vocaux +
 * notes) par l'IA, désormais PERSISTÉES dans site_report_proposals (mig 194) —
 * le même pipeline que la réunion : détection UNE fois par capture, propositions
 * stables et auditables, cycle proposed→accepted/rejected. Avant : re-détection
 * (et re-facturation LLM) à chaque ouverture du Débrief, formulations instables,
 * et accepter UNE suite d'un vocal en faisait disparaître les autres.
 * MemorIA propose ; l'humain décide — rien n'est créé ici.
 */
export async function gatherVisitTextSuites(reportId: string, userId: string | null = null): Promise<VisitSuiteProposal[]> {
  const captures = await listVisitCaptures(reportId).catch(() => [])
  const supabase = createAdminClient()

  // 0. Propositions déjà persistées — la double garde d'idempotence : même si le
  //    marquage 'analyzed' échoue (migration 194 pas encore appliquée), une
  //    capture couverte par une proposition n'est JAMAIS re-détectée (sinon
  //    chaque ouverture du Débrief dupliquerait les propositions).
  const existingProposals = await listProposals(reportId).catch(() => [])
  const coveredCaptureIds = new Set(
    existingProposals
      .filter((p) => proposalVisitKind(p.payload) !== null)
      .map((p) => proposalCaptureId(p.payload))
      .filter((id): id is string => !!id),
  )

  // 1. Captures texte jamais passées à l'IA (suite_status null, non couvertes) —
  //    détection puis persistance. Échec IA (null) → on ne marque RIEN, retry plus tard.
  const textCaps = captures.filter(
    (c) => c.status !== 'discarded'
      && c.suite_status == null
      && !coveredCaptureIds.has(c.id)
      && (c.kind === 'vocal' || c.kind === 'note')
      && !!c.body?.trim()
      && c.triage_intent !== 'action' && c.triage_intent !== 'reserve',
  )
  if (textCaps.length > 0) {
    const siteId = textCaps[0].site_id
    const { data: site } = await supabase.from('sites').select('name').eq('id', siteId).maybeSingle()
    const detected = await detectVisitSuites({
      siteName: (site as { name: string } | null)?.name ?? 'Chantier',
      items: textCaps.map((c) => ({ id: c.id, text: c.body!.trim() })),
      userId,
    }).catch(() => null)
    if (detected !== null) {
      if (detected.length > 0) {
        const bodyById = new Map(textCaps.map((c) => [c.id, c.body!.trim()]))
        await bulkInsertProposals({
          report_id: reportId,
          proposals: toProposalRows(detected, siteId, bodyById),
        }).catch(() => [])
      }
      // Analysées (même sans suite trouvée — définitif) : plus de re-run.
      await supabase
        .from('visit_capture')
        .update({ suite_status: 'analyzed', updated_at: new Date().toISOString() })
        .in('id', textCaps.map((c) => c.id))
    }
  }

  // 2. Relire les propositions persistées encore EN ATTENTE de décision.
  const proposals = await listProposals(reportId).catch(() => [])
  const pendingAi = proposals.filter((p) => p.status === 'proposed' && proposalVisitKind(p.payload) !== null)
  if (pendingAi.length === 0) return []

  const siteId = pendingAi[0].site_id ?? captures[0]?.site_id
  const [openActions, reserves] = await Promise.all([
    siteId ? listOpenSiteActions({ siteIds: [siteId] }).catch(() => []) : [],
    siteId ? getSiteReserves(siteId).catch(() => []) : [],
  ])
  const actionPool = (openActions as Array<{ id: string; title: string }>).map((a) => ({ id: a.id, label: a.title }))
  const reservePool = (reserves as Array<{ id: string; label: string; status: string }>)
    .filter((r) => r.status === 'open')
    .map((r) => ({ id: r.id, label: r.label }))

  return pendingAi.map((p) => {
    const kind = proposalVisitKind(p.payload)!
    const pool = kind === 'action' ? actionPool : kind === 'reserve' ? reservePool : []
    const similar = pool.filter((o) => similarTitles(o.label, p.short_label)).slice(0, 3)
    return {
      id: p.id,
      proposalId: p.id,
      captureId: proposalCaptureId(p.payload) ?? '',
      kind,
      text: p.short_label,
      similar,
      source: 'ai' as const,
      excerpt: proposalExcerpt(p.payload),
    }
  })
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

/** Instantané de la MATIÈRE de la visite au moment de la synthèse — sert à dire
 *  « synthèse à jour » ou « visite enrichie depuis » (+N notes, +N photos…). */
export interface VisitSourceSnapshot {
  photos: number
  videos: number
  vocals: number
  notes: number
  /** ISO de la capture la plus récente prise en compte (null si aucune). */
  last_capture_at: string | null
}

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
  /** Instantané des sources prises en compte — pour la synthèse versionnée. */
  sourceSnapshot: VisitSourceSnapshot
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

  const [attachmentsRes, notesRes, actionsRes, reservesRes, subjectsRes, capturesRes, signals] = await Promise.all([
    supabase.from('site_report_attachments').select('filename, kind').eq('report_id', reportId),
    supabase.from('site_notes').select('body, created_at').eq('site_id', siteId).is('deleted_at', null).gte('created_at', from).lte('created_at', to).order('created_at', { ascending: true }),
    supabase.from('site_actions').select('title, corps_etat, created_at').eq('site_id', siteId).gte('created_at', from).lte('created_at', to).order('created_at', { ascending: true }),
    supabase.from('site_reserve').select('label, location, created_at').eq('site_id', siteId).gte('created_at', from).lte('created_at', to).order('created_at', { ascending: true }),
    supabase.from('subjects').select('id, name').eq('site_id', siteId).neq('status', 'closed').limit(40),
    // Les CAPTURES de la visite (vocaux transcrits, notes, commentaires photo/vidéo).
    // ⚠️ Sans ça, le débrief IA n'avait AUCUNE matière : les transcriptions des
    // mémos vivent dans visit_capture.body, pas dans visit.transcript_raw — l'agent
    // ne voyait que l'objectif + des compteurs, d'où des résumés génériques.
    supabase.from('visit_capture').select('kind, body, created_at').eq('report_id', reportId).neq('status', 'discarded').order('created_at', { ascending: true }),
    buildSiteMemorySignals(siteId),
  ])

  const caps = ((capturesRes.data ?? []) as Array<{ kind: string; body: string | null; created_at: string }>)
  const countKind = (k: string) => caps.filter((c) => c.kind === k).length
  const lastCaptureAt = caps.reduce<string | null>((max, c) => (!max || c.created_at > max ? c.created_at : max), null)
  const sourceSnapshot: VisitSourceSnapshot = {
    photos: countKind('photo'),
    videos: countKind('video'),
    vocals: countKind('vocal'),
    notes: countKind('note'),
    last_capture_at: lastCaptureAt,
  }
  const vocalBodies = caps.filter((c) => c.kind === 'vocal' && c.body?.trim()).map((c) => c.body!.trim())
  const captureNotes = caps
    .filter((c) => (c.kind === 'note' || c.kind === 'photo' || c.kind === 'video') && c.body?.trim())
    .map((c) => c.body!.trim())

  // Le transcript de l'agent = le transcript de rapport (le cas échéant) + TOUS les
  // mémos vocaux transcrits de la visite.
  const transcript = [visit.transcript_corrected ?? visit.transcript_raw, ...vocalBodies]
    .filter((t): t is string => !!t && t.trim().length > 0)
    .join('\n\n') || null
  const capturedNotes = [
    ...((notesRes.data ?? []) as Array<{ body: string }>).map((n) => n.body),
    ...captureNotes,
  ]
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
    sourceSnapshot,
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
  /** Conducteur (auteur de la visite) — nom complet, ou null. */
  authorName: string | null
  /** Commune du chantier (identité « où »), ou null si non renseignée. */
  city: string | null
  /** Ex. « 5 juillet 2026, 10:42 ». */
  dateLabel: string
  /** Ex. « Visite spontanée ». */
  typeLabel: string
  /** Intention (mig 186) — spécialise le TITRE et quelques intitulés du PDF. */
  motive: string | null
  durationLabel: string | null
  objective: string | null
  subjectName: string | null
  /** Constats = ce qui a été noté/dit pendant la visite (notes + vocaux + site_notes). */
  constats: string[]
  /** Constats ÉCRITS (notes, commentaires de photo) — présentés en clair. */
  observations: string[]
  /** Transcriptions VOCALES brutes — reléguées plus bas (« pour vérifier »). */
  transcriptions: string[]
  reserves: Array<{ label: string; location: string | null }>
  actions: Array<{ title: string; corps_etat: string | null }>
  /** URLs signées des photos SÉLECTIONNÉES pour le CR (par tag + photo clé,
   *  plafonnées) — embarquées dans le PDF. Le CR est un document de communication. */
  photos: string[]
  /** Photos sélectionnées AVEC leur légende (commentaire de la capture). */
  photoItems: Array<{ url: string; caption: string | null }>
  /** Bloc « Évolution — même point de vue » (mig 195) : les séries de photos de
   *  référence TOUCHÉES par cette visite, échantillonnées (≤3 séries × ≤4 photos,
   *  premier jour → aujourd'hui). Le client reçoit la transformation dans le CR,
   *  sans ouvrir MemorIA. */
  evolutions: Array<{ label: string | null; items: Array<{ url: string; dateLabel: string }> }>
  /** Positions GPS des captures — pour la carte des observations (schéma PDF +
   *  carte interactive sur l'écran). Enrichi de quoi construire un MapCapture. */
  positions: Array<{ id: string; kind: string; lat: number; lng: number; body: string | null; capturedAt: string }>
  /** Nombre TOTAL de photos captées (MemorIA les garde toutes) — pour dire
   *  « N photos clés sur M dans MemorIA ». */
  photoCount: number
  /** Combien de vidéos/vocaux/notes/vérifications captés + éléments marqués. */
  videoCount: number
  vocalCount: number
  noteCount: number
  verificationCount: number
  starredCount: number
  /** Résumé « MemorIA comprend » — IA gatée, ou repli déterministe. Éditable. */
  summary: string | null
  /** Points du CR groupés par TAG (écran 2), texte = commentaire ou libellé. */
  points: {
    memoire: string[]     // 📚 à conserver
    surveiller: string[]  // 👀 à surveiller
    reserve: string[]     // ⚠️ réserve
    action: string[]      // ✅ action
  }
  outcomeLabel: string | null
  resolutionLabel: string | null
}

/**
 * Rassemble le CR d'une visite en données structurées. `null` si introuvable.
 * `userId` (optionnel) : traçabilité du coût du résumé IA. Sans provider IA
 * configuré (ou < 3 observations), le résumé est déterministe — zéro appel.
 */
// ── Sélection INTELLIGENTE des photos du CR (v1, groupée par tag) ─────────────
// Le PDF est un document de COMMUNICATION : court, lisible, métier. MemorIA garde
// TOUT ; le CR ne montre que ce qui sert à comprendre/décider. Règles validées :
//   ⚠️ Réserve + ✅ Action → toujours ; 👀 À surveiller → si peu nombreuses ;
//   📚 Mémoire → jamais (par défaut) ; ⭐ photo clé (starred — p. ex. une photo
//   ANNOTÉE) → prioritaire ; plafond global pour éviter les CR illisibles.
// Limite v1 assumée : on groupe PAR TAG, pas encore par réserve précise (le
// rattachement photo→objet viendra après). Déterministe, sans IA.
export const CR_FOLLOW_MAX = 5
export const CR_PHOTO_CAP = 12

type CrPhotoLike = {
  triage_intent: CaptureTriageIntent
  starred: boolean
  captured_at: string | null
  created_at: string
}

export function selectCrPhotos<T extends CrPhotoLike>(photos: T[]): T[] {
  const includeFollow = photos.filter((c) => c.triage_intent === 'follow').length <= CR_FOLLOW_MAX
  const weight = (c: T): number =>
    c.starred ? 0
    : c.triage_intent === 'reserve' ? 1
    : c.triage_intent === 'action' ? 2
    : c.triage_intent === 'follow' ? 3
    : 4 // mémoire / non tagué — seulement en repli
  const time = (c: T): number => Date.parse(c.captured_at ?? c.created_at) || 0
  const eligible = photos.filter((c) =>
    c.starred ||
    c.triage_intent === 'reserve' ||
    c.triage_intent === 'action' ||
    (includeFollow && c.triage_intent === 'follow'),
  )
  // Repli : visite non triée (aucune photo taguée/clé) → on ne rend pas un CR sans
  // aucune photo ; on prend les premières, plafonnées.
  const pool = eligible.length > 0 ? eligible : photos
  return [...pool].sort((a, b) => weight(a) - weight(b) || time(a) - time(b)).slice(0, CR_PHOTO_CAP)
}

/**
 * Combien de photos seront incluses au CR vs total capté — pour l'écran de
 * confirmation « X photos seront incluses ». Léger (pas d'IA, pas d'URL signée).
 */
export async function getVisitCrPhotoPlan(reportId: string): Promise<{ included: number; total: number }> {
  const captures = (await listVisitCaptures(reportId).catch(() => [])).filter((c) => c.status !== 'discarded')
  const photos = captures.filter((c) => c.kind === 'photo')
  return { included: selectCrPhotos(photos).length, total: photos.length }
}

export async function buildVisitCrDoc(reportId: string, userId: string | null = null): Promise<VisitCrDoc | null> {
  const ctx = await gatherVisitDebriefContext(reportId)
  if (!ctx) return null
  const { visit } = ctx
  const supabase = createAdminClient()

  // ⚠️ RÉGRESSION CORRIGÉE : `sites.commune` N'EXISTE PAS. La sélectionner (et
  // l'embed `clients(name)`) faisait ÉCHOUER toute la requête → `name`, ville et
  // client tombaient en fallback → « Chantier » sur TOUS les comptes-rendus. On
  // ne lit plus que des colonnes GARANTIES (name, address, client_id) ; le client
  // est lu à part (aucun embed ne peut donc blanchir le nom du chantier). La
  // commune se déduit de l'adresse (« …98800 Nouméa » → « Nouméa »).
  const { data: site } = await supabase
    .from('sites')
    .select('name, address, client_id')
    .eq('id', visit.site_id!)
    .maybeSingle()
  const s = site as { name: string | null; address: string | null; client_id: string | null } | null
  const siteName = s?.name?.trim() || 'Chantier'
  const address = s?.address?.trim() || null
  const city = address ? (/\b\d{4,6}\s+(.+)$/.exec(address)?.[1]?.trim() || null) : null
  let clientName: string | null = null
  if (s?.client_id) {
    const { data: cl } = await supabase.from('clients').select('name').eq('id', s.client_id).maybeSingle()
    clientName = (cl as { name: string | null } | null)?.name?.trim() || null
  }
  const subjectName = visit.target_subject_id
    ? ctx.openSubjects.find((s) => s.id === visit.target_subject_id)?.name ?? null
    : null

  // Conducteur (auteur de la visite) — nom complet pour l'en-tête du CR.
  let authorName: string | null = null
  if (visit.created_by) {
    const { data: u } = await supabase.from('users').select('full_name').eq('id', visit.created_by).maybeSingle()
    authorName = (u as { full_name: string | null } | null)?.full_name?.trim() || null
  }

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
  // Notes ET commentaires de photo/vidéo (« ce que la capture montre ») → constats.
  const noteBodies = captures
    .filter((c) => (c.kind === 'note' || c.kind === 'photo' || c.kind === 'video') && c.body?.trim())
    .map((c) => c.body!.trim())
  const vocalBodies = captures
    .filter((c) => c.kind === 'vocal' && c.body?.trim())
    .map((c) => `« ${c.body!.trim()} »`)
  const photoCaptures = captures.filter((c) => c.kind === 'photo')
  const videoCount = captures.filter((c) => c.kind === 'video').length
  const vocalCount = captures.filter((c) => c.kind === 'vocal').length

  // Sélection intelligente (par tag + photo clé, plafonnée) : le CR ne montre que
  // ce qui sert à comprendre/décider ; MemorIA garde les autres. URLs signées des
  // seules photos retenues.
  const selectedPhotos = selectCrPhotos(photoCaptures)
  const previews: Record<string, { url: string; mime: string | null }> =
    await getVisitCapturePreviewUrls(selectedPhotos).catch(() => ({}))
  const photos = selectedPhotos
    .map((c) => previews[c.id]?.url)
    .filter((u): u is string => !!u)
  // Photos AVEC légende (commentaire de la capture) — pour un CR lisible sans l'app.
  const photoItems = selectedPhotos
    .map((c) => ({ url: previews[c.id]?.url, caption: c.body?.trim() || null }))
    .filter((p): p is { url: string; caption: string | null } => !!p.url)

  // Positions GPS des captures → carte des observations (le « où »).
  const positions = captures
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({
      id: c.id, kind: c.kind, lat: c.lat as number, lng: c.lng as number,
      body: c.body?.trim() || null, capturedAt: c.captured_at ?? c.created_at,
    }))

  // Comptes par type + éléments marqués (richesse de la visite, bloc « En bref »).
  const noteCount = captures.filter((c) => c.kind === 'note').length
  const verificationCount = captures.filter((c) => c.kind === 'verification').length
  const starredCount = captures.filter((c) => c.starred).length

  // Dédup insensible à la casse, réutilisable.
  const dedup = (arr: string[]): string[] => {
    const s = new Set<string>()
    return arr.filter((t) => {
      const k = t.trim().toLowerCase()
      if (!k || s.has(k)) return false
      s.add(k)
      return true
    })
  }
  // Constats = tout (compat markdown/aperçu). Observations = écrits ; transcriptions
  // = vocaux bruts (relégués plus bas dans le PDF, « pour vérifier »).
  const constats = dedup([...ctx.capturedNotes, ...noteBodies, ...vocalBodies])
  const observations = dedup([...ctx.capturedNotes, ...noteBodies])
  const transcriptions = dedup(vocalBodies)

  // Points du CR groupés par TAG (écran 2). Texte = commentaire de la capture,
  // sinon un libellé par type. Seules les captures GARDÉES et taguées comptent.
  const kindLabel: Record<VisitCaptureKind, string> = {
    photo: 'Photo', video: 'Vidéo', vocal: 'Mémo vocal', note: 'Note', verification: 'Point vérifié', position: 'Position',
  }
  const kept = captures.filter((c) => c.status === 'kept')
  const textOf = (c: (typeof kept)[number]) => c.body?.trim() || kindLabel[c.kind]
  const points = {
    memoire: kept.filter((c) => c.triage_intent == null).map(textOf),
    surveiller: kept.filter((c) => c.triage_intent === 'follow').map(textOf),
    reserve: kept.filter((c) => c.triage_intent === 'reserve').map(textOf),
    action: kept.filter((c) => c.triage_intent === 'action').map(textOf),
  }

  // Résumé — la SEULE IA (gatée, sur du texte, jamais les images). Ne bloque
  // jamais le CR : repli déterministe intégré au service.
  const summary = await runVisitSummary({
    siteName,
    objective: visit.objective?.trim() || null,
    constats,
    reserves: points.reserve,
    actions: points.action,
    surveiller: points.surveiller,
    photoCount: photoCaptures.length,
    userId,
  }).catch(() => null)

  // ÉVOLUTION — le CR porte la transformation (mig 195) : pour chaque photo de
  // référence dont la série a été TOUCHÉE par cette visite, une bande « même
  // cadrage » du premier jour à aujourd'hui. ≤3 séries × ≤4 photos : des
  // chapitres, jamais une galerie. Best-effort : ne bloque jamais le CR.
  const evolutions: VisitCrDoc['evolutions'] = []
  try {
    const evoChains = groupViewpointChains(await listSiteViewpointRows(visit.site_id!))
      .filter((c) => c.serie.length >= 2 && c.serie.some((r) => r.report_id === reportId))
      .slice(0, 3)
    const evoDateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Pacific/Noumea' })
    for (const chain of evoChains) {
      const sampled = sampleSerie(chain.serie, 4)
      const evoPreviews = await getVisitCapturePreviewUrls(sampled).catch(() => ({} as Record<string, { url: string; mime: string | null }>))
      const items = sampled
        .map((c) => {
          const url = evoPreviews[c.id]?.url
          return url ? { url, dateLabel: evoDateFmt.format(new Date(c.captured_at ?? c.created_at)) } : null
        })
        .filter((x): x is { url: string; dateLabel: string } => x !== null)
      // Une « évolution » à moins de 2 photos ne raconte rien : on l'omet.
      if (items.length >= 2) evolutions.push({ label: chain.label, items })
    }
  } catch { /* CR sans bloc évolution plutôt que pas de CR */ }

  return {
    siteName,
    clientName,
    authorName,
    city,
    dateLabel,
    typeLabel: visitIntentLabel(visit.visit_motive) ?? ORIGIN_FR[visit.origin ?? ''] ?? 'Visite',
    motive: visit.visit_motive ?? null,
    durationLabel,
    objective: visit.objective?.trim() || null,
    subjectName,
    constats,
    observations,
    transcriptions,
    reserves: ctx.capturedReserves,
    actions: ctx.capturedActions,
    photos,
    photoItems,
    evolutions,
    positions,
    photoCount: photoCaptures.length,
    videoCount,
    vocalCount,
    noteCount,
    verificationCount,
    starredCount,
    summary,
    points,
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

  // Titre cadré par l'intention (cohérent avec le PDF).
  const crKicker = doc.motive === 'premiere'
    ? 'État initial du chantier'
    : doc.motive === 'previsite_ao'
      ? "Prévisite d'appel d'offres"
      : 'Compte-rendu de visite'

  const lines: string[] = []
  lines.push(`# ${crKicker} — ${doc.siteName}`)
  lines.push('')
  lines.push(`**Date :** ${doc.dateLabel}`)
  lines.push(`**Type :** ${doc.typeLabel}`)
  if (doc.durationLabel) lines.push(`**Durée :** ${doc.durationLabel}`)
  lines.push('')

  lines.push(doc.motive === 'premiere' || doc.motive === 'previsite_ao' ? '## Contexte' : '## Objet de la visite')
  lines.push(doc.objective || '_Non précisé._')
  if (doc.subjectName) lines.push(`Sujet : **${doc.subjectName}**`)
  lines.push('')

  if (doc.summary) {
    lines.push('## Résumé')
    lines.push(doc.summary)
    lines.push('')
  }

  lines.push('## Constats')
  if (doc.constats.length > 0) doc.constats.forEach((n) => lines.push(`- ${n}`))
  else lines.push('_Aucune note saisie pendant la visite._')
  lines.push('')

  const reserveLines = [
    ...doc.reserves.map((r) => `${r.label}${r.location ? ` (${r.location})` : ''}`),
    ...doc.points.reserve,
  ]
  if (reserveLines.length > 0) {
    lines.push('## Réserves')
    reserveLines.forEach((r) => lines.push(`- ${r}`))
    lines.push('')
  }

  if (doc.points.surveiller.length > 0) {
    lines.push('## Points à surveiller')
    doc.points.surveiller.forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }

  const actionLines = [
    ...doc.actions.map((a) => `${a.corps_etat ? `(${a.corps_etat}) ` : ''}${a.title}`),
    ...doc.points.action,
  ]
  if (actionLines.length > 0) {
    lines.push('## Actions')
    actionLines.forEach((a) => lines.push(`- ${a}`))
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
