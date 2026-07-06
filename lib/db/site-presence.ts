// lib/db/site-presence.ts
//
// « Assistant de présence » — le premier comportement du niveau 3 (Présence) du
// conducteur. Puisque vous êtes SUR PLACE, MemorIA relit ce qui existe déjà sur
// CE chantier et remonte 1 à 3 opportunités que vous pourriez saisir maintenant,
// tant que vous y êtes. Rien n'est créé : on ne fait que présenter, au bon
// moment et au bon endroit, des données qui existent déjà.
//
// Doctrine (cf. artifact « niveau Conducteur ») :
//   - DÉTERMINISTE, zéro IA, zéro donnée nouvelle.
//   - Ton OPPORTUNITÉ, jamais reproche (« vous pourriez », pas « vous devez »).
//   - Max 3 rappels. Priorité descendante : réserve sécurité > réserve qui
//     traîne > action en retard > réunion proche > actions ouvertes > photo clé.
//   - Chaque rappel est CLIQUABLE (href vers là où l'on agit).
//   - Si rien ne remonte : l'UI affiche un état rassurant (le tableau est vide,
//     et c'est une bonne nouvelle).
//
// Volontairement HORS moteur : les interventions du jour. Elles ont déjà leur
// liste détaillée (heure, statut, lien) juste sous ce bloc — les répéter ici
// ferait doublon. La présence remonte l'OPPORTUNISTE (ce qu'on ne verrait pas
// sinon), pas le PLANIFIÉ (déjà visible).

import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteReserves } from '@/lib/db/site-reserve'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { todayLocalIso } from '@/lib/time/local-date'

export type PresenceReminderKind =
  | 'reserve_safety'
  | 'reserve_old'
  | 'action_overdue'
  | 'meeting_soon'
  | 'action_open'
  | 'starred'

export interface PresenceReminder {
  kind: PresenceReminderKind
  /** Texte court, ton opportunité — jamais un reproche. */
  text: string
  /** Où aller pour saisir l'opportunité. Toujours défini (rappel cliquable). */
  href: string
}

// Une réserve « sécurité » se reconnaît à son libellé (déterministe, pas d'IA).
// Volontairement large : mieux vaut surfacer une réserve sécurité de trop que
// d'en rater une.
const SAFETY_RE = /s[ée]cur|[ée]chafaud|garde.?corps|\bEPI\b|chute|[ée]lectr|amiante|incendie|extincteur|balis|harnais|nacelle/i

// Âge d'une réserve/action au-delà duquel « ça traîne » (jours).
const STALE_DAYS = 30
// Fenêtre « réunion proche » (jours).
const MEETING_SOON_DAYS = 7

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / 86_400_000)
}

function clip(s: string, n = 48): string {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`
}

/** Nombre de photos/vidéos « clés » (⭐) épinglées sur ce chantier. */
async function countStarredKeyPhotos(siteId: string): Promise<number> {
  const supabase = createAdminClient()
  const { count } = await supabase
    .from('visit_capture')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('starred', true)
    .in('kind', ['photo', 'video'])
  return count ?? 0
}

/**
 * 1 à 3 rappels de présence pour un chantier, en ordre de priorité décroissante.
 * Le tableau peut être VIDE (rien à signaler) — l'appelant affiche alors un état
 * rassurant. `limit` borne le nombre de rappels (défaut 3).
 */
export async function buildSitePresenceReminders(
  siteId: string,
  opts?: { limit?: number },
): Promise<PresenceReminder[]> {
  const limit = opts?.limit ?? 3
  const supabase = createAdminClient()
  const todayIso = todayLocalIso()

  const [reserves, openActions, meeting, starredCount] = await Promise.all([
    getSiteReserves(siteId).catch(() => []),
    listOpenSiteActions({ siteIds: [siteId] }).catch(() => []),
    supabase
      .from('site_reports')
      .select('next_meeting_at')
      .eq('site_id', siteId)
      .not('next_meeting_at', 'is', null)
      .gte('next_meeting_at', new Date().toISOString())
      .order('next_meeting_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    countStarredKeyPhotos(siteId).catch(() => 0),
  ])

  const out: PresenceReminder[] = []
  const openReserves = reserves.filter((r) => r.status === 'open')

  // 1 — Réserve SÉCURITÉ ouverte : le plus prioritaire. On est là, on peut la lever.
  const safety = openReserves.find(
    (r) => SAFETY_RE.test(r.label) || (r.location != null && SAFETY_RE.test(r.location)),
  )
  if (safety) {
    out.push({
      kind: 'reserve_safety',
      text: `Une réserve sécurité est ouverte ici — « ${clip(safety.label)} ». Vous pourriez la lever tant que vous y êtes.`,
      href: `/m/site/${siteId}#reste-a-faire`,
    })
  }

  // 2 — Réserve qui TRAÎNE (≥ 30 j), hors sécurité déjà remontée.
  const oldReserve = openReserves.find(
    (r) => r.id !== safety?.id && (daysSince(r.issuedOn ?? r.createdAt) ?? 0) >= STALE_DAYS,
  )
  if (oldReserve) {
    const d = daysSince(oldReserve.issuedOn ?? oldReserve.createdAt) ?? 0
    out.push({
      kind: 'reserve_old',
      text: `La réserve « ${clip(oldReserve.label)} » est ouverte depuis ${d} jours. Un point sur place la ferait avancer.`,
      href: `/m/site/${siteId}#reste-a-faire`,
    })
  }

  // 3 — Action EN RETARD (échéance dépassée).
  const overdue = openActions
    .filter((a) => a.due_date != null && a.due_date < todayIso)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0]
  if (overdue) {
    const d = daysSince(overdue.due_date) ?? 0
    out.push({
      kind: 'action_overdue',
      text:
        d > 0
          ? `L'action « ${clip(overdue.title)} » a dépassé son échéance de ${d} j. Vous êtes au bon endroit pour la faire avancer.`
          : `L'action « ${clip(overdue.title)} » était attendue pour aujourd'hui. Vous êtes au bon endroit pour la boucler.`,
      href: `/m/actions?site=${siteId}`,
    })
  }

  // 4 — Réunion PROCHE (≤ 7 j) : ce que vous voyez aujourd'hui la nourrira.
  const nextMeetingIso = (meeting.data as { next_meeting_at: string } | null)?.next_meeting_at ?? null
  const inDays = daysUntil(nextMeetingIso)
  if (nextMeetingIso && inDays != null && inDays <= MEETING_SOON_DAYS) {
    const isToday = nextMeetingIso.slice(0, 10) === todayIso || inDays <= 0
    out.push({
      kind: 'meeting_soon',
      text: isToday
        ? `Une réunion de chantier est prévue aujourd'hui. Ce que vous relevez maintenant la nourrira.`
        : `Une réunion approche (dans ${inDays} j). Vos observations d'aujourd'hui la prépareront.`,
      href: `/m/site/${siteId}/reunions`,
    })
  }

  // 5 — Actions OUVERTES (générique) — seulement si aucune « en retard » n'a déjà
  //     été remontée (sinon on répète le même sujet).
  const stillOpen = openActions.length
  if (stillOpen > 0 && !overdue) {
    out.push({
      kind: 'action_open',
      text:
        stillOpen === 1
          ? `Une action est ouverte ici. Un geste sur place suffit peut-être à la clore.`
          : `${stillOpen} actions sont ouvertes ici. Vous pourriez en boucler une ou deux tant que vous y êtes.`,
      href: `/m/actions?site=${siteId}`,
    })
  }

  // 6 — Photos CLÉS (⭐) : la mémoire visuelle est là si besoin de comparer.
  if (starredCount > 0) {
    out.push({
      kind: 'starred',
      text:
        starredCount === 1
          ? `Une photo clé est épinglée sur ce chantier — utile pour comparer l'avant/après.`
          : `${starredCount} photos clés sont épinglées ici — utiles pour comparer l'avant/après.`,
      href: `/m/site/${siteId}/patrimoine`,
    })
  }

  return out.slice(0, limit)
}
