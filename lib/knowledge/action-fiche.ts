import 'server-only'

// ── LA FICHE ACTION — read model d'UNE action, lecture canonique (Lot 4) ──────
// « La fiche Action devient capable de lire entièrement une action. » Une seule
// lecture, site-scopée + fail-closed org (le service-role bypasse la RLS). Le
// responsable est la PREUVE structurelle (assigned_contact_id) ; assigned_to
// n'est qu'une trace texte. La provenance (Slice 5) est STRUCTURELLE (colonnes
// FK), jamais inférée du titre/texte. Le read model est l'UNIQUE lieu de
// composition ; le composant ne fait qu'afficher.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { todayLocalIso } from '@/lib/time/local-date'
import type { DbSiteAction, SiteActionStatus } from '@/types/db'
import {
  primaryProvenanceKind, PROVENANCE_TYPE_LABEL, PROVENANCE_LINK_LABEL,
  reportProvenanceType, mobileSourceHref, desktopSourceHref,
  type ActionFicheSource, type ActionFicheContext, type ProvenanceType,
} from '@/lib/knowledge/action-provenance'
import {
  normalizeActionHistory, groupHistoryByDay, historyNoteFor,
  type RawActionEvent, type ActionHistoryDay,
} from '@/lib/knowledge/action-history'
import { deriveCanonicalAttentionItems } from '@/lib/knowledge/canonical-attention'

type Db = SupabaseClient

const STATUS_LABEL: Record<SiteActionStatus, string> = {
  open: 'Ouverte', planned: 'Planifiée', done: 'Terminée', cancelled: 'Annulée',
}
/** Libellé métier d'un statut d'action (pur, testable). */
export function actionStatusLabel(s: SiteActionStatus): string {
  return STATUS_LABEL[s] ?? s
}

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric',
})
const frDate = (iso: string | null | undefined): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

export type ActionFicheResponsible =
  | { kind: 'contact'; name: string; fonction: string | null }
  | { kind: 'text'; label: string }

/** Preuves de RÉALISATION — jamais l'origine. Uniquement les traces déclarées à la
 *  clôture (completed_comment / completed_photo_path, mig 107). `scope` distingue la
 *  preuve de la clôture ACTUELLE d'éléments d'une clôture ANTÉRIEURE (action rouverte). */
export interface ActionFicheProofs {
  scope: 'current' | 'previous'
  dateLabel: string | null
  /** `null` = aucune photo déclarée ; `missing` = chemin présent mais fichier introuvable. */
  photo: { url: string | null; missing: boolean } | null
  comment: string | null
  /** Action terminée sans aucune trace jointe (affichage honnête, pas de carte vide). */
  empty: boolean
}

/** « Ce qui a été observé » — la capture QUI A DÉCLENCHÉ l'action (source_capture_id) :
 *  son texte (note ou transcription vocale) + éventuellement sa photo. JAMAIS une
 *  photo « du même report supposée liée » : uniquement la capture précise. */
export interface ActionFicheObserved {
  text: string | null
  authorLabel: string | null
  /** URL signée de la photo de la capture ; `null` = pas de photo ou fichier disparu. */
  photoUrl: string | null
  photoMissing: boolean
  /** Mémo vocal : le texte est alors sa transcription. */
  isVocal: boolean
}

/** Point 13A — contexte du SUJET CANONIQUE durable auquel l'action appartient.
 *  Présent dès que `canonical_subject_id` résout un sujet réel (ladder de
 *  dégradation, cf. getSiteActionFiche). Encart COMPACT — jamais la vie complète
 *  du sujet (pas de mini-fiche), jamais la provenance (« d'où elle vient » = 7A,
 *  séparé). Répond seulement à « dans quelle histoire métier cette action
 *  s'inscrit ? ». */
export interface ActionFicheSubjectContext {
  /** Libellé canonique (cliquable vers la vie du sujet). Toujours présent. */
  label: string
  /** Lien vers la vie/historique existante du sujet (jamais dupliquée ici). */
  href: string
  /** UNE ligne d'attention déterministe, UNIQUEMENT si canonical-attention en
   *  fournit une (`reasons[0]`). `null` = sujet sans signal → libellé + lien seuls. */
  evolution: string | null
  /** `true` UNIQUEMENT si le signal `pv_reopened` est réellement porté (jamais une
   *  décoration anticipée : 0/22 sur OCEF aujourd'hui → badge absent). */
  reopened: boolean
  /** Nombre de réserves OUVERTES partageant ce `canonical_subject_id` (coappartenance
   *  au sujet, JAMAIS causalité). 0 = rien affiché. Jamais de compteur d'actions. */
  reservesOnSubject: number
}

export interface ActionFicheData {
  id: string
  siteId: string
  title: string
  body: string | null
  corpsEtat: string | null
  status: SiteActionStatus
  statusLabel: string
  responsible: ActionFicheResponsible | null
  dueDate: string | null
  dueDateStatus: 'explicit' | 'estimated' | null
  isLate: boolean
  /** Origine PRIMAIRE (structurelle). `available: false` = relation présente mais
   *  objet introuvable → « Origine indisponible ». */
  source: ActionFicheSource | null
  /** Contexte SECONDAIRE (la réunion/visite où l'action est née), quand la source
   *  primaire est une réserve/un sujet. */
  context: ActionFicheContext | null
  /** La DÉCISION dont découle cette action (lookup inverse site_decisions.action_id).
   *  Répond à « pourquoi cette action existe » au niveau décisionnel. `null` sinon. */
  fromDecision: { title: string; href: string } | null
  createdAt: string
  doneAt: string | null
  /** Chronologie CANONIQUE — uniquement les événements réellement journalisés
   *  (site_action_events), jamais reconstruits depuis l'état courant. */
  historyDays: ActionHistoryDay[]
  /** Note honnête quand seule la création est connue (action ancienne, backfill). */
  historyNote: string | null
  /** Preuves de réalisation (ou éléments d'une clôture antérieure), ou `null` si
   *  l'action n'a jamais été clôturée. Jamais l'origine, jamais reconstruit. */
  proofs: ActionFicheProofs | null
  /** « État actuel » : où en est l'engagement, en un coup d'œil. DÉRIVÉ des données
   *  déjà chargées — aucun champ inventé, aucune donnée nouvelle. */
  progress: Array<{ label: string; done: boolean }>
  /** Nom du chantier — contexte principal du dossier. */
  siteName: string
  /** Objets liés cliquables (le réseau de la mémoire), depuis la provenance connue. */
  relations: Array<{ icon: string; label: string; href: string | null }>
  /** Ce qui a été observé sur le terrain et a déclenché l'action, ou `null`. */
  observed: ActionFicheObserved | null
  /** Qui a créé l'action (auteur de l'événement `created`), ou `null`. Replace
   *  l'action dans son histoire humaine. Jamais résolu depuis l'état courant. */
  createdByLabel: string | null
  /** Qui a clôturé (auteur du dernier événement `completed`), ou `null`. */
  closedByLabel: string | null
  /** `true` = aucune source documentaire (`source === null`) MAIS l'action a été
   *  créée via une porte MemorIA (`created_from` renseigné) → « Créée manuellement ».
   *  `false` avec `source === null` = origine réellement inconnue (legacy) →
   *  « Origine non renseignée ». Distinct de `createdByLabel` (QUI a créé). */
  createdManually: boolean
  /** Contexte du sujet canonique durable (point 13), ou `null`. Desktop uniquement
   *  (calculé seulement si `withSubjectContext`). Cf. `ActionFicheSubjectContext`. */
  subjectContext: ActionFicheSubjectContext | null
}

const PROOF_BUCKET = 'intervention-photos'
/** Accès à une photo de clôture (bucket PRIVÉ) : URL signée courte, générée côté
 *  serveur après le contrôle d'org. Fichier disparu → `missing`, jamais de lien mort. */
async function signProofPhoto(db: Db, path: string): Promise<{ url: string | null; missing: boolean }> {
  const { data } = await db.storage.from(PROOF_BUCKET).createSignedUrl(path, 3600)
  const url = data?.signedUrl ?? null
  return { url, missing: !url }
}

// ── Chargements de provenance — TOUS scopés au chantier (garde IDOR) ─────────

type LoadedReport = { origin: string | null; date: string | null; title: string | null } | 'missing'

async function loadReport(db: Db, siteId: string, reportId: string): Promise<LoadedReport> {
  const { data } = await db.from('site_reports')
    .select('origin, title, started_at, created_at').eq('id', reportId).eq('site_id', siteId).maybeSingle()
  if (!data) return 'missing'
  const r = data as { origin: string | null; title: string | null; started_at: string | null; created_at: string }
  return { origin: r.origin, date: r.started_at ?? r.created_at, title: r.title }
}

/** Une source « report » — visite terrain, réunion, ou PV/document historique
 *  importé. Le type vient de `origin` SEUL (reportProvenanceType), jamais du
 *  titre : un `origin='import'` est un PV, pas une « Visite ». */
function reportSource(r: Exclude<LoadedReport, 'missing'>, reportId: string, siteId: string): ActionFicheSource {
  const type = reportProvenanceType(r.origin)
  const fallbackTitle = type === 'pv' ? 'Document historique' : type === 'visite' ? 'Visite' : 'Compte rendu'
  return {
    type,
    typeLabel: PROVENANCE_TYPE_LABEL[type],
    title: r.title?.trim() || fallbackTitle,
    detail: frDate(r.date),
    // Route canonique unique (desktopSourceHref) : une visite/PV importé ouvre LA
    // page visite (/visites/[reportId]), une réunion sa fiche (/reunion/[reportId]).
    // Avant, tout partait vers /reunion — un PV importé y perdait sa page riche.
    href: desktopSourceHref(type, { siteId, reportId }),
    mobileHref: mobileSourceHref(type, { siteId, reportId }),
    linkLabel: PROVENANCE_LINK_LABEL[type],
    available: true,
  }
}

/** « Origine indisponible » — une relation existait, l'objet a disparu. On ne le
 *  masque JAMAIS silencieusement. */
function unavailable(type: ProvenanceType): ActionFicheSource {
  return { type, typeLabel: PROVENANCE_TYPE_LABEL[type], title: 'Origine indisponible', detail: null, href: null, mobileHref: null, linkLabel: '', available: false }
}

export async function getSiteActionFiche(
  siteId: string,
  actionId: string,
  // Point 13 — le contexte du sujet canonique est DESKTOP-only : les appelants
  // desktop passent `{ withSubjectContext: true }`. Le mobile omet l'option →
  // aucune requête d'attention ajoutée, aucun champ, mobile strictement inchangé.
  opts: { withSubjectContext?: boolean } = {},
): Promise<ActionFicheData | null> {
  const db = createAdminClient()
  // M3-D — accès par l'org DE LA RESSOURCE (le chantier), jamais `getOrgId()`.
  const { data: site } = await db.from('sites').select('id, organization_id, name').eq('id', siteId).maybeSingle()
  if (!site) return null
  const siteOrgId = (site as { organization_id: string | null }).organization_id
  if (!siteOrgId || !(await requireOrganizationMembership(siteOrgId)).ok) return null
  const siteName = (site as { name: string | null }).name ?? 'Chantier'

  const { data } = await db.from('site_actions').select('*').eq('id', actionId).eq('site_id', siteId).maybeSingle()
  if (!data) return null
  const a = data as DbSiteAction

  // Responsable : la personne (preuve) d'abord, sinon la trace texte.
  let responsible: ActionFicheResponsible | null = null
  if (a.assigned_contact_id) {
    const { data: c } = await db.from('company_contacts')
      .select('full_name, function').eq('id', a.assigned_contact_id).maybeSingle()
    if (c) responsible = { kind: 'contact', name: (c.full_name as string) ?? '', fonction: (c.function as string | null) ?? null }
  }
  if (!responsible && a.assigned_to) responsible = { kind: 'text', label: a.assigned_to }

  const due = a.due_date ? a.due_date.slice(0, 10) : null
  const isLate = a.due_date_status === 'explicit' && due !== null && due < todayLocalIso()
    && a.status !== 'done' && a.status !== 'cancelled'

  // ── Provenance STRUCTURELLE (Slice 5) : source primaire déterministe ──
  const kind = primaryProvenanceKind({
    reserveId: a.reserve_id, reportId: a.report_id,
    sourceCaptureId: a.source_capture_id, subjectId: a.subject_id,
  })
  let source: ActionFicheSource | null = null
  if (kind === 'reserve' && a.reserve_id) {
    const { data: r } = await db.from('site_reserve')
      .select('label, issued_on, created_at').eq('id', a.reserve_id).eq('site_id', siteId).maybeSingle()
    source = !r
      ? unavailable('reserve')
      : {
          type: 'reserve', typeLabel: PROVENANCE_TYPE_LABEL.reserve,
          title: (r as { label: string }).label,
          detail: frDate((r as { issued_on: string | null; created_at: string }).issued_on ?? (r as { created_at: string }).created_at)
            ? `Constatée le ${frDate((r as { issued_on: string | null; created_at: string }).issued_on ?? (r as { created_at: string }).created_at)}` : null,
          href: `/sites/${siteId}/reserves`, mobileHref: mobileSourceHref('reserve', { siteId, reportId: null }),
          linkLabel: PROVENANCE_LINK_LABEL.reserve, available: true,
        }
  } else if (kind === 'report' && a.report_id) {
    const r = await loadReport(db, siteId, a.report_id)
    source = r === 'missing' ? unavailable('reunion') : reportSource(r, a.report_id, siteId)
  } else if (kind === 'capture' && a.source_capture_id) {
    const { data: cap } = await db.from('visit_capture')
      .select('report_id').eq('id', a.source_capture_id).eq('site_id', siteId).maybeSingle()
    const capReportId = (cap as { report_id: string | null } | null)?.report_id ?? null
    if (!capReportId) source = unavailable('visite')
    else {
      const r = await loadReport(db, siteId, capReportId)
      source = r === 'missing' ? unavailable('visite') : reportSource(r, capReportId, siteId)
    }
  } else if (kind === 'subject' && a.subject_id) {
    const { data: s } = await db.from('subjects')
      .select('name').eq('id', a.subject_id).eq('site_id', siteId).maybeSingle()
    source = !s
      ? unavailable('sujet')
      : {
          type: 'sujet', typeLabel: PROVENANCE_TYPE_LABEL.sujet, title: (s as { name: string }).name,
          detail: null, href: `/sites/${siteId}/subjects/${a.subject_id}`,
          mobileHref: mobileSourceHref('sujet', { siteId, reportId: null }),
          linkLabel: PROVENANCE_LINK_LABEL.sujet, available: true,
        }
  }

  // ── Historique CANONIQUE : lu depuis site_action_events, trié en SQL (jamais
  //    en React), scopé à l'action ET au chantier (garde IDOR/tenant). ──
  const { data: events } = await db.from('site_action_events')
    .select('id, kind, occurred_at, actor_label, before_value, after_value, reason')
    .eq('action_id', actionId).eq('site_id', siteId)
    .order('occurred_at', { ascending: true }).order('id', { ascending: true })
  const historyEntries = normalizeActionHistory((events ?? []) as RawActionEvent[])
  const historyDays = groupHistoryByDay(historyEntries)
  const historyNote = historyNoteFor(historyEntries)

  // ── Preuves de RÉALISATION (Slice 7) : uniquement les traces déclarées à la
  //    clôture (mig 107). source_capture_id est une ORIGINE (Provenance), jamais ici. ──
  const hasComment = !!a.completed_comment?.trim()
  const hasPhoto = !!a.completed_photo_path
  let proofs: ActionFicheProofs | null = null
  if (a.status === 'done') {
    // Clôture ACTUELLE : les colonnes correspondent à l'état terminé courant.
    proofs = {
      scope: 'current',
      dateLabel: frDate(a.done_at),
      photo: hasPhoto ? await signProofPhoto(db, a.completed_photo_path as string) : null,
      comment: hasComment ? a.completed_comment : null,
      empty: !hasPhoto && !hasComment,
    }
  } else if (hasPhoto || hasComment) {
    // Action ROUVERTE (ou clôturée avant le journal) : ces éléments ne prouvent PAS
    // l'état courant. On les montre comme une clôture ANTÉRIEURE, datée par l'événement
    // `completed` le plus récent (fiable : les colonnes reflètent la dernière clôture ;
    // fn_complete_action est no-op si déjà terminée). Pas d'événement → pas de date.
    const lastCompleted = [...historyEntries].reverse().find((e) => e.kind === 'completed')
    proofs = {
      scope: 'previous',
      dateLabel: lastCompleted ? frDate(lastCompleted.occurredAt) : null,
      photo: hasPhoto ? await signProofPhoto(db, a.completed_photo_path as string) : null,
      comment: hasComment ? a.completed_comment : null,
      empty: false,
    }
  }

  // ── Contexte secondaire : la réunion/visite d'origine, quand la source primaire
  //    est une réserve ou un sujet. Vient de la colonne report_id de l'action. ──
  let context: ActionFicheContext | null = null
  if ((kind === 'reserve' || kind === 'subject') && a.report_id) {
    const r = await loadReport(db, siteId, a.report_id)
    if (r !== 'missing') {
      const t = r.origin ? 'Visite' : 'Réunion'
      const d = frDate(r.date)
      context = { label: `${r.title?.trim() || t}${d ? ` · ${d}` : ''}`, href: `/sites/${siteId}/reunion/${a.report_id}` }
    }
  }

  // ── « Issue de la décision » : lookup INVERSE — la décision dont cette action
  //    est la conséquence (site_decisions.action_id = cette action). ──
  let fromDecision: ActionFicheData['fromDecision'] = null
  {
    const { data: dec } = await db.from('site_decisions').select('id, titre').eq('action_id', actionId).eq('site_id', siteId).maybeSingle()
    if (dec) fromDecision = { title: (dec as { titre: string }).titre, href: `/sites/${siteId}/decision/${(dec as { id: string }).id}` }
  }

  // ── « Ce qui a été observé » (Slice ②) : la capture QUI A DÉCLENCHÉ l'action —
  //    son texte + sa photo. Scopée à source_capture_id (la capture PRÉCISE), jamais
  //    une photo « du même report supposée liée ». ──
  let observed: ActionFicheObserved | null = null
  if (a.source_capture_id) {
    const { data: cap } = await db.from('visit_capture')
      .select('kind, body, attachment_id, created_by').eq('id', a.source_capture_id).eq('site_id', siteId).maybeSingle()
    if (cap) {
      const c = cap as { kind: string; body: string | null; attachment_id: string | null; created_by: string | null }
      let photoUrl: string | null = null
      let photoMissing = false
      if (c.kind === 'photo' && c.attachment_id) {
        const { data: att } = await db.from('site_report_attachments').select('storage_path').eq('id', c.attachment_id).maybeSingle()
        const path = (att as { storage_path: string } | null)?.storage_path
        if (path) { photoUrl = (await signProofPhoto(db, path)).url; photoMissing = !photoUrl }
      }
      let authorLabel: string | null = null
      if (c.created_by) {
        const { data: u } = await db.from('users').select('full_name').eq('id', c.created_by).maybeSingle()
        authorLabel = (u as { full_name: string | null } | null)?.full_name ?? null
      }
      const text = c.body?.trim() || null
      if (text || photoUrl || photoMissing || c.kind === 'vocal') {
        observed = { text, authorLabel, photoUrl, photoMissing, isVocal: c.kind === 'vocal' }
      }
    }
  }

  // ── Point 13A — Contexte du SUJET canonique (DESKTOP only, opt-in). Ladder de
  //    dégradation : pas de canonical_subject_id → null (aucun encart) ; sujet réel
  //    → libellé + lien vers sa vie EXISTANTE ; + item canonical-attention → UNE
  //    ligne d'attention (`reasons[0]`) ; + `pv_reopened` réel → badge ; + réserve(s)
  //    ouverte(s) du même sujet → compte factuel. Le libellé vient de canonical_subject
  //    (autoritatif, existe même sans signal) ; la RAISON vient EXCLUSIVEMENT de
  //    canonical-attention (MÊME source que « À surveiller » → aucune divergence).
  //    Jamais de provenance ici (7A, séparé), jamais de compteur d'actions, jamais
  //    de nouveau moteur/agrégation/LLM. ──
  const canonicalSubjectId = (a as unknown as { canonical_subject_id: string | null }).canonical_subject_id ?? null
  let subjectContext: ActionFicheSubjectContext | null = null
  if (opts.withSubjectContext && canonicalSubjectId) {
    const { data: cs } = await db.from('canonical_subject')
      .select('label').eq('id', canonicalSubjectId).eq('site_id', siteId).maybeSingle()
    if (cs) {
      const [attentionItems, reservesRes] = await Promise.all([
        deriveCanonicalAttentionItems(siteId).catch(() => []),
        db.from('site_reserve').select('id').eq('site_id', siteId)
          .eq('canonical_subject_id', canonicalSubjectId).eq('status', 'open'),
      ])
      const item = attentionItems.find((i) => i.canonicalSubjectId === canonicalSubjectId)
      subjectContext = {
        label: (cs as { label: string }).label,
        href: `/sites/${siteId}/historique/sujets/${canonicalSubjectId}`,
        evolution: item?.reasons[0] ?? null,
        reopened: item?.signals.includes('pv_reopened') ?? false,
        reservesOnSubject: ((reservesRes.data ?? []) as unknown[]).length,
      }
    }
  }

  return {
    id: a.id,
    siteId,
    title: a.title,
    body: a.body,
    corpsEtat: a.corps_etat,
    status: a.status,
    statusLabel: actionStatusLabel(a.status),
    responsible,
    dueDate: due,
    dueDateStatus: a.due_date_status,
    isLate,
    source,
    context,
    fromDecision,
    createdAt: a.created_at,
    doneAt: a.done_at,
    historyDays,
    historyNote,
    proofs,
    // « État actuel » — le CHEMIN de l'engagement, dans l'ordre. Faits dérivés,
    // jamais inventés : on voit ce qui est fait et ce qui reste.
    progress: [
      { label: 'Origine identifiée', done: !!source && source.available },
      { label: 'Responsable affecté', done: !!responsible },
      { label: 'Échéance définie', done: due !== null && a.due_date_status === 'explicit' },
      { label: 'Planifiée en intervention', done: a.status === 'planned' || !!a.converted_to_id },
      { label: 'Preuve déposée', done: !!(a.completed_photo_path || a.completed_comment?.trim()) },
      { label: 'Action clôturée', done: a.status === 'done' },
    ],
    siteName,
    // Le réseau d'objets, depuis la provenance connue (jamais une association devinée).
    relations: [
      { icon: '🏗', label: `Chantier : ${siteName}`, href: `/sites/${siteId}` },
      ...(source?.available && source.href ? [{ icon: '📄', label: source.title, href: source.href }] : []),
      ...(responsible?.kind === 'contact' ? [{ icon: '👤', label: responsible.name, href: null }] : []),
      ...(context ? [{ icon: '📄', label: context.label, href: context.href }] : []),
    ],
    observed,
    createdByLabel: historyEntries.find((e) => e.kind === 'created')?.actorLabel ?? null,
    closedByLabel: [...historyEntries].reverse().find((e) => e.kind === 'completed')?.actorLabel ?? null,
    // Création directe (sans source documentaire) : vraie quand une porte MemorIA
    // est enregistrée mais qu'aucune FK de provenance n'existe. `created_from` est
    // structurel (mig 112), jamais inféré du texte.
    createdManually: source === null && a.created_from != null,
    subjectContext,
  }
}
