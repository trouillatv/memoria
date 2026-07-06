// lib/db/site-presence.ts
//
// « Assistant de présence » — le premier comportement du niveau 3 (Présence) du
// conducteur. C'est un FILTRE D'ATTENTION, pas un résumé de page : le conducteur
// a déjà toutes les données sous les yeux ; MemorIA n'en montre pas plus, il
// sélectionne les 1 à 3 éléments qui méritent son attention à cet instant précis.
//
// LA question à laquelle le bloc répond, et une seule :
//   « Qu'est-ce que je risque de manquer si je repars maintenant ? »
//
// Doctrine (cf. artifact « niveau Conducteur ») :
//   - DÉTERMINISTE, zéro IA, zéro donnée nouvelle.
//   - Ton OPPORTUNITÉ, jamais reproche (« vous pourriez », pas « vous devez »).
//   - Max 3 rappels. Priorité descendante :
//       1. Sécurité (absolue)          — réserve sécurité ouverte
//       2. Ce qui vieillit mal         — réserve ancienne, action en retard
//       3. Ce qui va bientôt arriver   — réunion proche (comme DEADLINE, ci-dessous)
//   - JAMAIS répéter un fait déjà affiché juste en dessous. La valeur d'un rappel
//     est le LIEN entre deux éléments de mémoire, pas la restitution d'un fait.
//     → La réunion n'est donc pas un rappel autonome : elle REFORMULE l'élément
//       ouvert le plus prioritaire en lui donnant une échéance (« réunion demain,
//       et la réserve incendie est toujours ouverte : à vérifier avant de partir »).
//   - Si rien ne remonte : tableau vide → l'UI affiche un état rassurant. C'est
//     le cas NORMAL et souhaité : la rareté fait la confiance.
//
// TROIS RÈGLES (le contrat du moteur — toute source ajoutée doit les respecter) :
//   Règle 1 — Un rappel ne remonte jamais SEUL si un lien métier peut être
//     établi. Toujours préférer « événement + contexte » à « événement ». (Ex. la
//     réunion ne s'affiche pas seule : elle donne une échéance à un problème ouvert.)
//   Règle 2 — Le moteur remonte des OPPORTUNITÉS, pas des objets. Pas « réserve
//     ouverte » mais « vous pouvez lever cette réserve avant la réunion » ; pas
//     « action en retard » mais « vous êtes au bon endroit pour la boucler ». On
//     ancre dans le RÉEL (le lieu de la réserve, la présence sur site) dès qu'on a
//     la donnée : c'est ce qui déclenche l'action, pas l'objet.
//   Règle 3 — Le contexte est CUMULATIF. On relie aujourd'hui réunion × réserve ;
//     demain météo × intervention extérieure, sous-traitant × matériel, collègue
//     déjà sur place × visite — SANS changer le moteur, en ajoutant des sources.
//     C'est pourquoi le cœur ci-dessous raisonne en « éléments ouverts » + « liens »
//     génériques, et non en cas particuliers figés.
//
// Volontairement HORS moteur :
//   - Les interventions du jour : déjà listées (heure, statut, lien) juste dessous.
//   - Le compteur générique d'actions ouvertes : c'est un résumé de page (le
//     statut du chantier l'affiche déjà) — seule l'action EN RETARD est missable.
//   - Les photos ⭐ en rappel permanent : une photo déjà prise n'est pas « ce que
//     je risque de manquer ». Elle le redeviendra une fois LIÉE à un signal
//     (sujet rouvert, approche de réception) — pas comme fixture perpétuelle.

import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteReserves } from '@/lib/db/site-reserve'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { todayLocalIso } from '@/lib/time/local-date'

export type PresenceReminderKind =
  | 'reserve_safety'
  | 'reserve_old'
  | 'action_overdue'
  | 'meeting_soon'

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

// Âge d'une réserve au-delà duquel « ça traîne » (jours).
const STALE_DAYS = 30
// Fenêtre où une réunion sert de DEADLINE à un problème ouvert (jours).
const MEETING_LINK_DAYS = 7
// Fenêtre où une réunion SEULE (chantier par ailleurs à jour) vaut un rappel.
const MEETING_SOLO_DAYS = 2

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

function clip(s: string, n = 44): string {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`
}

// Ancrage SPATIAL (règle 2) : « (Bloc B) » quand la réserve porte un lieu — c'est
// ce qui transforme « une réserve existe » en « vous passez devant le local ».
function place(location: string | null): string {
  const t = (location ?? '').trim()
  return t.length > 0 ? ` (${clip(t, 28)})` : ''
}

// « Réunion ici aujourd'hui / demain / dans N j » — la clause d'échéance qui
// donne de l'urgence à un problème ouvert.
function meetingClause(inDays: number): string {
  if (inDays <= 0) return 'Réunion de chantier ici aujourd’hui'
  if (inDays === 1) return 'Réunion de chantier ici demain'
  return `Réunion de chantier ici dans ${inDays} j`
}

// Un candidat « élément ouvert » : ce qu'on risque de laisser derrière soi. En
// ordre de priorité. La réunion, si proche, reformulera le PREMIER de la liste.
interface OpenItem {
  kind: PresenceReminderKind
  href: string
  /** Texte quand l'élément est seul (pas de réunion pour lui donner une deadline). */
  solo: string
  /** Texte quand une réunion proche lui donne une échéance : « … et {tail} ». */
  tail: string
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

  const [reserves, openActions, meeting] = await Promise.all([
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
  ])

  const openReserves = reserves.filter((r) => r.status === 'open')
  const reservesHref = `/m/site/${siteId}#reste-a-faire`
  const actionsHref = `/m/actions?site=${siteId}`

  // ── Éléments ouverts « missables », en ordre de priorité ────────────────────
  const items: OpenItem[] = []

  // 1 — Réserve SÉCURITÉ ouverte : priorité absolue.
  const safety = openReserves.find(
    (r) => SAFETY_RE.test(r.label) || (r.location != null && SAFETY_RE.test(r.location)),
  )
  if (safety) {
    const at = place(safety.location)
    items.push({
      kind: 'reserve_safety',
      href: reservesHref,
      solo: `Vous pourriez lever la réserve sécurité « ${clip(safety.label)} »${at} tant que vous êtes sur place.`,
      tail: `la réserve sécurité « ${clip(safety.label)} »${at} est toujours ouverte. À lever avant de repartir.`,
    })
  }

  // 2 — Ce qui vieillit mal : action en retard.
  const overdue = openActions
    .filter((a) => a.due_date != null && a.due_date < todayIso)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0]
  if (overdue) {
    const d = daysSince(overdue.due_date) ?? 0
    items.push({
      kind: 'action_overdue',
      href: actionsHref,
      solo:
        d > 0
          ? `Vous êtes au bon endroit pour faire avancer l'action « ${clip(overdue.title)} » (en retard de ${d} j).`
          : `Vous êtes au bon endroit pour boucler l'action « ${clip(overdue.title)} », attendue aujourd'hui.`,
      tail:
        d > 0
          ? `l'action « ${clip(overdue.title)} » traîne depuis ${d} j. À faire avancer avant.`
          : `l'action « ${clip(overdue.title)} » est attendue pour aujourd'hui. À boucler avant.`,
    })
  }

  // 2bis — Ce qui vieillit mal : réserve ancienne (≥ 30 j), hors sécurité déjà remontée.
  const oldReserve = openReserves.find(
    (r) => r.id !== safety?.id && (daysSince(r.issuedOn ?? r.createdAt) ?? 0) >= STALE_DAYS,
  )
  if (oldReserve) {
    const d = daysSince(oldReserve.issuedOn ?? oldReserve.createdAt) ?? 0
    const at = place(oldReserve.location)
    items.push({
      kind: 'reserve_old',
      href: reservesHref,
      solo: `Un point sur place ferait avancer la réserve « ${clip(oldReserve.label)} »${at}, ouverte depuis ${d} jours.`,
      tail: `la réserve « ${clip(oldReserve.label)} »${at} est ouverte depuis ${d} j. À vérifier avant.`,
    })
  }

  // ── Réunion proche : DEADLINE d'un problème ouvert, pas un rappel autonome ──
  const nextMeetingIso = (meeting.data as { next_meeting_at: string } | null)?.next_meeting_at ?? null
  const inDays = daysUntil(nextMeetingIso)

  const out: PresenceReminder[] = []

  if (nextMeetingIso && inDays != null && inDays <= MEETING_LINK_DAYS && items.length > 0) {
    // La réunion reformule l'élément le plus prioritaire (le LIEN = la valeur).
    const top = items.shift()!
    out.push({
      kind: top.kind,
      href: top.href,
      text: `${meetingClause(inDays)} — et ${top.tail}`,
    })
  } else if (nextMeetingIso && inDays != null && inDays <= MEETING_SOLO_DAYS && items.length === 0) {
    // Chantier par ailleurs à jour, mais réunion imminente : préparez-la.
    out.push({
      kind: 'meeting_soon',
      href: `/m/site/${siteId}/reunions`,
      text: `${meetingClause(inDays)}. Ce que vous relevez maintenant la nourrira.`,
    })
  }

  // Les éléments ouverts restants, en clair (le premier a pu être « consommé »
  // par la réunion ci-dessus).
  for (const item of items) {
    out.push({ kind: item.kind, href: item.href, text: item.solo })
  }

  return out.slice(0, limit)
}
