import 'server-only'

// ── LISTE DES POINTS D'UN CHANTIER (Lot 1 « Points comme entrée centrale », mandat Vincent) ──
//
// Compose au-dessus de tracked-point-read-model.ts, JAMAIS un second moteur d'état : le
// derivedState et le tri viennent tels quels de `loadTrackedPointReadModel` et
// `sortPointsForSubjectDisplay` (gelés). Ce fichier n'ajoute que de l'HYDRATATION en lecture
// (libellé du sujet propriétaire, noms d'acteurs) et un filtrage pur — jamais un recalcul d'état.
//
// Acteurs (§6, réutilisé) : même jointure que `getTrackedPointDetail`
// (canonical_business_object_member → site_actions/site_deadlines/site_reserve →
// company_contacts/companies), mais exécutée UNE SEULE FOIS pour tout le site au lieu d'une fois
// par Point — un simple batching, pas un nouveau moteur de calcul.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadTrackedPointReadModel,
  sortPointsForSubjectDisplay,
  type PointReadModelEntry,
} from '@/lib/knowledge/tracked-point-read-model'
import type { PointComputedCurrentState } from '@/lib/knowledge/tracked-point-lifecycle-reducer'
import { loadMemoriaNeedsYouSummary, filterMemoriaNeedsYouQuestionsForPoint } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { MEMORIA_NEEDS_YOU_CATEGORY_LABELS, type MemoriaNeedsYouCategory } from '@/lib/knowledge/tracked-point-needs-you-categories'
import {
  selectLingeringPoints,
  loadSitePvDates,
  loadOpenActionCountBySubject,
  type LingeringPointEntry,
} from '@/lib/knowledge/tracked-point-lingering'
import { deriveCanonicalAttentionItems, type CanonicalSignal } from '@/lib/knowledge/canonical-attention'
import { todayLocalIso, frDayMonthYearLocal } from '@/lib/time/local-date'
import {
  computeTrackedPointReviewFingerprint,
  isTrackedPointReviewed,
  type TrackedPointReviewSignalInput,
} from '@/lib/knowledge/tracked-point-review'
import { getTrackedPointReviews } from '@/lib/db/tracked-point-reviews'

type AdminClient = ReturnType<typeof createAdminClient>

export interface PointListEntry {
  id: string
  siteId: string
  label: string
  derivedState: PointComputedCurrentState
  latestMeaningfulEventAt: string | null
  ownerCanonicalSubjectId: string | null
  subjectLabel: string | null
  actorNames: string[]
  // Badge/filtre « Besoin de toi » (mandat Vincent, lot UX Cockpit+Points) : nombre de
  // questions NeedsYou qui référencent STRUCTURELLEMENT ce Point (cf.
  // filterMemoriaNeedsYouQuestionsForPoint, zéro heuristique). needsYouQuestionId n'est
  // renseigné que lorsqu'UNE SEULE question est concernée (deep-link ?q=<id> honnête,
  // jamais un choix arbitraire parmi plusieurs — même convention que resolveMemoriaNeedsYouSubjectPointRef).
  needsYouCount: number
  needsYouQuestionId: string | null
  // Raisons déterministes « Pourquoi maintenant » (mandat Vincent, ajustement Pilotage
  // avant recette) : composition, SANS nouveau moteur, de signaux déjà gelés ailleurs
  // (réouverture, NeedsYou, changement lors du dernier PV, Points qui traînent, attention
  // canonique pertinente). Un Point peut porter plusieurs raisons ; tableau vide = pas de
  // raison de revue actuelle. Jamais un score.
  reviewReasons: string[]
  // Flags structurés dérivés des MÊMES conditions que reviewReasons/buildReviewSignalInput
  // ci-dessous (mandat Vincent, habillage résumé Pilotage — item 3 lot 3) : permettent de
  // décomposer le bucket résiduel « autre signal » en ses 2 vraies catégories nommées
  // (changé au dernier PV, Points qui traînent) sans nouveau moteur ni recalcul.
  isLingering: boolean
  isChangedSinceLastPv: boolean
  // Compteurs d'affichage « si disponible » (mandat ajustement Pilotage) — dérivés à coût nul
  // de la trajectoire déjà chargée par tracked-point-read-model.ts (même bornage que
  // mentionsCount/openedAt de tracked-point-detail.ts, jamais une 2e heuristique).
  // passagesSinceEvent = null quand latestMeaningfulEventAt est inconnu (jamais confondu
  // avec 0 passage réel).
  mentionsCount: number
  openedAt: string | null
  passagesSinceEvent: number | null
  // Ancienneté du blocage « si disponible » (mandat Vincent, Delta chantier) : dupliquée depuis
  // `LingeringPointEntry.daysSinceLastEvent` (déjà calculée par `selectLingeringPoints` ci-dessus,
  // jamais un second calcul) — null quand le Point n'est pas dans la sélection lingering.
  daysSinceLastEvent: number | null
  // Couche 1.1 « Mémoire de revue » (mandat Vincent, mig 405) : `reviewFingerprint` est la
  // signature COURANTE calculée par l'unique primitive pure computeTrackedPointReviewFingerprint
  // (lib/knowledge/tracked-point-review.ts) à partir des MÊMES signaux que reviewReasons — donc
  // `reviewFingerprint !== null` coïncide structurellement avec `reviewReasons.length > 0`.
  // `isReviewed` = ce fingerprint courant est strictement identique à celui déjà enregistré pour
  // CET utilisateur (« David a revu ce Point dans cet état précis », jamais « le Point est traité » :
  // l'état métier du Point reste indépendant). `reviewedAt` n'est renseigné que si une revue existe.
  reviewFingerprint: string | null
  isReviewed: boolean
  reviewedAt: string | null
}

export interface PointListFilterOptions {
  subjects: Array<{ id: string; label: string }>
  actors: string[]
}

export interface SiteTrackedPointList {
  points: PointListEntry[]
  filters: PointListFilterOptions
  // Date du dernier PV/visite terrain du chantier (mandat Vincent, Delta chantier) — même valeur
  // que celle utilisée en interne pour `isChangedSinceLastPv`, exposée ici pour l'affichage
  // (bannière « Depuis le dernier PV du... »), jamais recalculée par un consommateur.
  lastPvDate: string | null
}

async function loadSubjectLabels(db: AdminClient, subjectIds: string[]): Promise<Map<string, string>> {
  const labelById = new Map<string, string>()
  if (subjectIds.length === 0) return labelById
  const { data } = await db.from('canonical_subject').select('id, label').in('id', subjectIds)
  for (const row of data ?? []) labelById.set(row.id as string, row.label as string)
  return labelById
}

// Réplique batchée, à l'échelle du site, de la jointure §6 de `getTrackedPointDetail` —
// aucune règle d'attribution nouvelle, seulement la même union responsable
// contact > entreprise > texte libre, exécutée une fois pour tous les CBO du site.
async function loadActorNamesByPoint(
  db: AdminClient,
  siteId: string,
  points: PointReadModelEntry[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  const allCboIds = [...new Set(points.flatMap((p) => p.cboIds))]
  if (allCboIds.length === 0) return result

  const { data: memberRows } = await db
    .from('canonical_business_object_member')
    .select('canonical_business_object_id, member_entity_id, member_entity_type')
    .in('canonical_business_object_id', allCboIds)

  const actionIds = new Set<string>()
  const reserveIds = new Set<string>()
  const deadlineIds = new Set<string>()
  const entityRefsByCbo = new Map<string, Array<{ type: string; id: string }>>()
  for (const r of memberRows ?? []) {
    const type = r.member_entity_type as string
    const id = r.member_entity_id as string
    const cboId = r.canonical_business_object_id as string
    if (type === 'site_action') actionIds.add(id)
    else if (type === 'site_reserve') reserveIds.add(id)
    else if (type === 'site_deadline') deadlineIds.add(id)
    const list = entityRefsByCbo.get(cboId) ?? []
    list.push({ type, id })
    entityRefsByCbo.set(cboId, list)
  }

  const contactIds = new Set<string>()
  const companyIds = new Set<string>()

  type ActionRow = { id: string; assigned_to: string | null; assigned_contact_id: string | null; assigned_company_id: string | null }
  let actionRows: ActionRow[] = []
  if (actionIds.size > 0) {
    const { data } = await db.from('site_actions')
      .select('id, assigned_to, assigned_contact_id, assigned_company_id')
      .in('id', [...actionIds]).eq('site_id', siteId)
    actionRows = (data ?? []) as ActionRow[]
    for (const a of actionRows) {
      if (a.assigned_contact_id) contactIds.add(a.assigned_contact_id)
      if (a.assigned_company_id) companyIds.add(a.assigned_company_id)
    }
  }

  type DeadlineRow = { id: string; assigned_contact_id: string | null; assigned_company_id: string | null }
  let deadlineRows: DeadlineRow[] = []
  if (deadlineIds.size > 0) {
    const { data } = await db.from('site_deadlines')
      .select('id, assigned_contact_id, assigned_company_id')
      .in('id', [...deadlineIds]).eq('site_id', siteId)
    deadlineRows = (data ?? []) as DeadlineRow[]
    for (const d of deadlineRows) {
      if (d.assigned_contact_id) contactIds.add(d.assigned_contact_id)
      if (d.assigned_company_id) companyIds.add(d.assigned_company_id)
    }
  }

  type ReserveRow = { id: string; responsible_company_id: string | null }
  let reserveRows: ReserveRow[] = []
  if (reserveIds.size > 0) {
    const { data } = await db.from('site_reserve')
      .select('id, responsible_company_id')
      .in('id', [...reserveIds]).eq('site_id', siteId)
    reserveRows = (data ?? []) as ReserveRow[]
    for (const r of reserveRows) {
      if (r.responsible_company_id) companyIds.add(r.responsible_company_id)
    }
  }

  const contactNameById = new Map<string, string>()
  if (contactIds.size > 0) {
    const { data } = await db.from('company_contacts').select('id, full_name').in('id', [...contactIds])
    for (const c of data ?? []) contactNameById.set(c.id as string, c.full_name as string)
  }
  const companyNameById = new Map<string, string>()
  if (companyIds.size > 0) {
    const { data } = await db.from('companies').select('id, name').in('id', [...companyIds])
    for (const c of data ?? []) companyNameById.set(c.id as string, c.name as string)
  }

  const actionById = new Map(actionRows.map((a) => [a.id, a]))
  const deadlineById = new Map(deadlineRows.map((d) => [d.id, d]))
  const reserveById = new Map(reserveRows.map((r) => [r.id, r]))

  function nameForEntity(type: string, id: string): string | null {
    if (type === 'site_action') {
      const a = actionById.get(id)
      if (!a) return null
      if (a.assigned_contact_id) return contactNameById.get(a.assigned_contact_id) ?? null
      if (a.assigned_company_id) return companyNameById.get(a.assigned_company_id) ?? null
      return a.assigned_to
    }
    if (type === 'site_deadline') {
      const d = deadlineById.get(id)
      if (!d) return null
      if (d.assigned_contact_id) return contactNameById.get(d.assigned_contact_id) ?? null
      if (d.assigned_company_id) return companyNameById.get(d.assigned_company_id) ?? null
      return null
    }
    if (type === 'site_reserve') {
      const r = reserveById.get(id)
      if (!r) return null
      if (r.responsible_company_id) return companyNameById.get(r.responsible_company_id) ?? null
      return null
    }
    return null
  }

  for (const point of points) {
    const names = new Set<string>()
    for (const cboId of point.cboIds) {
      for (const ref of entityRefsByCbo.get(cboId) ?? []) {
        const name = nameForEntity(ref.type, ref.id)
        if (name) names.add(name)
      }
    }
    if (names.size > 0) result.set(point.id, [...names])
  }

  return result
}

// Dupliqué de `tracked-point-lingering.ts` (countPassagesAfter, non exporté) : même calcul pur
// (comparaison de dates ISO), mais requis ICI pour TOUS les Points à évolution connue
// (affichage « si disponible », mandat item 2) — pas seulement les candidats « qui traînent »
// que ce module sélectionne et plafonne pour son propre usage.
function countPassagesSince(pvDates: readonly string[], afterIso: string): number {
  return pvDates.reduce((n, d) => (d > afterIso ? n + 1 : n), 0)
}

// « Pourquoi maintenant » (mandat Vincent, ajustement Pilotage avant recette) : compose, SANS
// nouveau moteur ni score, les signaux déjà gelés ailleurs. Ordre = celui du mandat (réouverture ;
// NeedsYou ; changé/nouveau depuis dernier PV ; lingering ; attention canonique pertinente). Un
// Point peut cumuler plusieurs raisons — jamais un choix arbitraire entre elles.
function buildReviewReasons(params: {
  derivedState: PointComputedCurrentState
  documentaryDivergences: string[]
  needsYouCategories: MemoriaNeedsYouCategory[]
  lastPvDate: string | null
  lingering: LingeringPointEntry | undefined
  latestMeaningfulEventAt: string | null
  attentionReason: string | null
}): string[] {
  const reasons: string[] = []
  if (params.derivedState === 'reopened') {
    reasons.push(params.documentaryDivergences[0] ?? 'Une preuve plus récente contredit une résolution antérieure.')
  }
  if (params.needsYouCategories.length > 0) {
    const distinct = [...new Set(params.needsYouCategories)]
    reasons.push(
      distinct.length === 1
        ? MEMORIA_NEEDS_YOU_CATEGORY_LABELS[distinct[0]]
        : 'MemorIA a plusieurs questions ouvertes sur ce Point.',
    )
  }
  if (params.lastPvDate && params.latestMeaningfulEventAt === params.lastPvDate) {
    reasons.push(`Changé ou apparu lors du dernier PV (${frDayMonthYearLocal(params.lastPvDate)}).`)
  }
  if (params.lingering) {
    const passages = params.lingering.passagesSinceEvent
    reasons.push(
      `Sans évolution depuis ${params.lingering.daysSinceLastEvent} j, malgré ${passages} passage${passages !== 1 ? 's' : ''} du chantier.`,
    )
  }
  if (params.attentionReason) {
    reasons.push(params.attentionReason)
  }
  return reasons
}

// Signaux STRUCTURÉS (identité/version, jamais un texte) consommés par
// computeTrackedPointReviewFingerprint — mêmes conditions d'activation que buildReviewReasons
// ci-dessus, pour que « à revoir » (reviewReasons non vide) et « a un fingerprint courant »
// restent, par construction, le même ensemble de Points (mandat Vincent, Couche 1.1).
function buildReviewSignalInput(params: {
  derivedState: PointComputedCurrentState
  needsYouQuestionIds: string[]
  lastPvDate: string | null
  latestMeaningfulEventAt: string | null
  lingering: LingeringPointEntry | undefined
  attentionSignals: readonly CanonicalSignal[] | null
}): TrackedPointReviewSignalInput {
  return {
    reopened: params.derivedState === 'reopened' ? { latestMeaningfulEventAt: params.latestMeaningfulEventAt } : null,
    needsYou: params.needsYouQuestionIds.length > 0 ? { questionIds: params.needsYouQuestionIds } : null,
    changedSinceLastPv:
      params.lastPvDate && params.latestMeaningfulEventAt === params.lastPvDate ? { lastPvDate: params.lastPvDate } : null,
    lingering:
      params.lingering && params.lastPvDate
        ? { latestMeaningfulEventAt: params.latestMeaningfulEventAt, lastPvDate: params.lastPvDate }
        : null,
    canonicalAttention:
      params.attentionSignals && params.attentionSignals.length > 0 ? { signals: params.attentionSignals } : null,
  }
}

export async function loadSiteTrackedPointList(siteId: string, userId: string): Promise<SiteTrackedPointList> {
  const { points } = await loadTrackedPointReadModel(siteId)
  const sorted = sortPointsForSubjectDisplay(points)

  const db = createAdminClient()
  const subjectIds = [...new Set(sorted.map((p) => p.ownerCanonicalSubjectId).filter((id): id is string => !!id))]

  const [subjectLabelById, actorNamesByPoint, needsYou, pvDates, openActionCountBySubject, attentionItems, storedReviews] =
    await Promise.all([
      loadSubjectLabels(db, subjectIds),
      loadActorNamesByPoint(db, siteId, sorted),
      loadMemoriaNeedsYouSummary(siteId),
      loadSitePvDates(siteId),
      loadOpenActionCountBySubject(siteId),
      deriveCanonicalAttentionItems(siteId),
      getTrackedPointReviews(siteId, userId),
    ])

  const today = todayLocalIso()
  const lastPvDate = pvDates.length > 0 ? pvDates.reduce((max, d) => (d > max ? d : max)) : null
  const lingeringById = new Map(
    selectLingeringPoints(sorted, today, pvDates, { attentionItems, openActionCountBySubject }).map((l) => [l.id, l]),
  )
  // « Attention canonique pertinente » (mandat item 1) : `act_now` est la catégorie déjà gelée
  // par canonical-attention.ts pour « une preuve métier qualifiée intervention immédiate existe » —
  // aucun nouveau seuil d'urgence inventé ici. `signals` (jamais `score`) alimente aussi le
  // fingerprint de revue (Couche 1.1) : une recalibration de score ne doit jamais, à elle seule,
  // faire réapparaître un Point déjà revu.
  const actNowInfoBySubject = new Map(
    attentionItems
      .filter((it) => it.category === 'act_now')
      .map((it) => [
        it.canonicalSubjectId,
        { reason: it.reasons[0] ?? 'Sujet porteur en intervention immédiate (attention MemorIA).', signals: it.signals },
      ]),
  )

  const entries: PointListEntry[] = sorted.map((p) => {
    const needsYouMatches = filterMemoriaNeedsYouQuestionsForPoint(needsYou.questions, p.id)
    const lingering = lingeringById.get(p.id)
    const attentionInfo = p.ownerCanonicalSubjectId ? actNowInfoBySubject.get(p.ownerCanonicalSubjectId) ?? null : null
    const reviewFingerprint = computeTrackedPointReviewFingerprint(
      buildReviewSignalInput({
        derivedState: p.derivedState,
        needsYouQuestionIds: needsYouMatches.map((q) => q.id),
        lastPvDate,
        latestMeaningfulEventAt: p.latestMeaningfulEventAt,
        lingering,
        attentionSignals: attentionInfo?.signals ?? null,
      }),
    )
    const storedReview = storedReviews.get(p.id)
    return {
      id: p.id,
      siteId: p.siteId,
      label: p.label,
      derivedState: p.derivedState,
      latestMeaningfulEventAt: p.latestMeaningfulEventAt,
      ownerCanonicalSubjectId: p.ownerCanonicalSubjectId,
      subjectLabel: p.ownerCanonicalSubjectId ? subjectLabelById.get(p.ownerCanonicalSubjectId) ?? null : null,
      actorNames: actorNamesByPoint.get(p.id) ?? [],
      needsYouCount: needsYouMatches.length,
      needsYouQuestionId: needsYouMatches.length === 1 ? needsYouMatches[0].id : null,
      reviewReasons: buildReviewReasons({
        derivedState: p.derivedState,
        documentaryDivergences: p.documentaryDivergences,
        needsYouCategories: needsYouMatches.map((q) => q.category),
        lastPvDate,
        lingering,
        latestMeaningfulEventAt: p.latestMeaningfulEventAt,
        attentionReason: attentionInfo?.reason ?? null,
      }),
      isLingering: Boolean(lingering),
      isChangedSinceLastPv: Boolean(lastPvDate && p.latestMeaningfulEventAt === lastPvDate),
      mentionsCount: p.trajectory.length,
      openedAt: p.trajectory[0]?.effectiveAt ?? null,
      passagesSinceEvent: p.latestMeaningfulEventAt ? countPassagesSince(pvDates, p.latestMeaningfulEventAt) : null,
      daysSinceLastEvent: lingering?.daysSinceLastEvent ?? null,
      reviewFingerprint,
      isReviewed: isTrackedPointReviewed(reviewFingerprint, storedReview?.fingerprint),
      reviewedAt: storedReview?.reviewedAt ?? null,
    }
  })

  const subjects = [...subjectLabelById.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const actors = [...new Set(entries.flatMap((e) => e.actorNames))].sort((a, b) => a.localeCompare(b))

  return { points: entries, filters: { subjects, actors }, lastPvDate }
}
