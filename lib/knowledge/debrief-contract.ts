// ── LE CONTRAT DÉBRIEF (D1) ──────────────────────────────────────────────────
// Le Débrief n'est pas un document généré après une visite : c'est une PROJECTION
// temps réel de l'état des objets métier (Action, Échéance, Réserve, Planning,
// signaux PV canonical). Il ne possède AUCUN statut à lui — jamais de
// `debrief_status`, jamais de case à cocher propre au Débrief. Chaque objet garde
// son propre vocabulaire (Action: open/planned/done/cancelled ; Échéance:
// to_plan/planned/done/cancelled/superseded ; Réserve: open/lifted).
//
// Une mutation d'objet (Action passée à `done`, Échéance datée, Réserve levée)
// doit suffire à faire disparaître l'item du Débrief — sans bouton « régénérer »,
// sans LLM. C'est la même doctrine que site-event-contract.ts (`phase` calculée à
// la lecture, jamais stockée) appliquée à la question « ai-je encore quelque
// chose à faire ici ? ».
//
// Pas de `server-only` : ce contrat est pur (types + classifieurs), testable
// sans DB, et sert de référence à D2 (read-model qui appelle ces classifieurs
// sur les vraies lignes Action/Échéance/Réserve/Planning du site).

// ── Les six blocs ─────────────────────────────────────────────────────────────

export type DebriefBlockKey =
  | 'confirmed_today'   // ÉTAT CONFIRMÉ AUJOURD'HUI — 100% NOW, aucun texte daté
  | 'since_last_visit'  // DEPUIS VOTRE DERNIÈRE VENUE — diff report N-1 → maintenant
  | 'to_handle'         // À TRAITER — objets qui exigent une intervention utilisateur
  | 'to_watch'          // À SURVEILLER — pris en charge (daté/planifié) ou informationnel non vu
  | 'recently_handled'  // TRAITÉ RÉCEMMENT — sorti de à_traiter, transitoire, TOUJOURS daté
  | 'recent_activity'   // ACTIVITÉ RÉCENTE + PREUVES — existant (buildActivitySinceLastPv), inchangé

export interface DebriefBlockSpec {
  key: DebriefBlockKey
  label: string
  /** Read-models existants à consommer pour peupler ce bloc — jamais un nouvel accès DB direct depuis l'écran. */
  sources: string[]
}

export const DEBRIEF_BLOCKS: DebriefBlockSpec[] = [
  { key: 'confirmed_today', label: "État confirmé aujourd'hui", sources: ['getSiteOverview (compteurs uniquement)'] },
  { key: 'since_last_visit', label: 'Depuis votre dernière venue', sources: ['buildActivitySinceLastPv', 'pvLastDelta', 'diff to_handle/to_watch entre la clôture du dernier report et maintenant (D2)'] },
  { key: 'to_handle', label: 'À traiter', sources: ['site_actions (open)', 'site_deadlines (to_plan)', 'site_reserve (open)'] },
  { key: 'to_watch', label: 'À surveiller', sources: ['site_actions (planned)', 'site_deadlines (planned)', 'deriveCanonicalAttentionItems — signaux sans objet métier lié, non vus'] },
  { key: 'recently_handled', label: 'Traité récemment', sources: ['objets passés en état terminal avec une date de transition fiable, dans la fenêtre de rétention', 'signaux informationnels vus (ack)'] },
  { key: 'recent_activity', label: 'Activité récente', sources: ['buildActivitySinceLastPv (existant, inchangé)'] },
]

// ── Disposition d'un item dans le Débrief ───────────────────────────────────────
//
// `handled_without_reliable_date` est un état DISTINCT de `not_relevant` : l'objet
// est bien terminal (plus rien à faire), mais aucune date de transition fiable
// n'existe pour prouver QUAND — jamais de fallback vers `updated_at` ou une date
// inventée, `updated_at` ne prouve pas une transition terminale (un objet peut être
// mis à jour sans changer de statut). `debriefBlockForDisposition` décide où (ou si)
// cet état s'affiche ; la fabrication d'une fausse temporalité est interdite ici.

export type DebriefDisposition =
  | 'to_handle'
  | 'to_watch'
  | 'recently_handled'
  | 'handled_without_reliable_date'
  | 'not_relevant'

/** Au-delà de cette fenêtre, un objet traité quitte le Débrief : il reste consultable
 *  dans sa propre fiche et dans Activité récente, mais cesse d'occuper l'écran. */
const RECENTLY_HANDLED_RETENTION_DAYS = 7

function daysSince(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null
  const days = Math.round((Date.parse(today) - Date.parse(iso)) / 86_400_000)
  return Number.isFinite(days) ? days : null
}

/**
 * `closedAt` DOIT être une date qui PROUVE la transition terminale (posée par la
 * même mutation que le changement de statut) — jamais une date d'édition générique.
 * `null` signifie « terminal, mais sans preuve de date » : ce n'est pas une absence
 * d'information à masquer, c'est un fait à router explicitement (cf. ci-dessus).
 */
function terminalDisposition(closedAt: string | null | undefined, today: string): DebriefDisposition {
  if (!closedAt) return 'handled_without_reliable_date'
  const age = daysSince(closedAt, today)
  return age !== null && age >= 0 && age <= RECENTLY_HANDLED_RETENTION_DAYS ? 'recently_handled' : 'not_relevant'
}

/**
 * Où (ou si) une disposition s'affiche dans le Débrief. `handled_without_reliable_date`
 * ne rejoint JAMAIS `recently_handled` : ce bloc promet une date (« Fait le 31 août »),
 * l'afficher sans date romprait sa propre sémantique. Il sort donc du Débrief comme
 * `not_relevant` — la distinction reste utile en amont (métriques/backlog D2 sur les
 * objets qu'une migration additive pourrait un jour dater), mais l'écran ne la voit pas.
 */
export function debriefBlockForDisposition(disposition: DebriefDisposition): DebriefBlockKey | null {
  switch (disposition) {
    case 'to_handle': return 'to_handle'
    case 'to_watch': return 'to_watch'
    case 'recently_handled': return 'recently_handled'
    case 'handled_without_reliable_date': return null
    case 'not_relevant': return null
  }
}

// ── Action ────────────────────────────────────────────────────────────────────
// open → à traiter. planned → à surveiller (prise en charge explicite, jamais
// « en retard », cf. doctrine site-actions/canonical-attention).
//
// TIMESTAMPS AUDITÉS (lib/db/site-actions.ts) : `markSiteActionDone` écrit
// `done_at` de façon ATOMIQUE avec `status='done'` (RPC `fn_complete_action`) —
// fiable. `cancelSiteAction` ne pose AUCUN timestamp (update status seul) — pour
// une action annulée, `doneAt` est donc toujours `null` ici, et
// `terminalDisposition` la route correctement vers `handled_without_reliable_date`
// SANS fallback. Ne jamais faire lire `updated_at` en substitut.

export interface DebriefActionInput {
  status: 'open' | 'planned' | 'done' | 'cancelled'
  /** Fiable pour `done` (fn_complete_action). Toujours `null` pour `cancelled` aujourd'hui. */
  doneAt: string | null
}

export interface DebriefActionItem {
  kind: 'action'
  disposition: DebriefDisposition
}

export function classifyActionForDebrief(action: DebriefActionInput, today: string): DebriefActionItem {
  if (action.status === 'open') return { kind: 'action', disposition: 'to_handle' }
  if (action.status === 'planned') return { kind: 'action', disposition: 'to_watch' }
  return { kind: 'action', disposition: terminalDisposition(action.doneAt, today) }
}

// ── Échéance ──────────────────────────────────────────────────────────────────
// to_plan → à traiter (« reste à planifier »). planned → à surveiller.
//
// TIMESTAMP AUDITÉ (lib/db/site-deadlines.ts) : `completed_at` (posé avec
// `status='done'` dans completeSiteDeadline()) et `cancelled_at` (posé avec
// `status='cancelled'`/`'superseded'` dans cancelSiteDeadline()) sont les
// timestamps terminaux fiables. `resolvedAt` = `completed_at ?? cancelled_at`
// (résolu côté appelant, cf. lib/knowledge/live-debrief.ts). Une échéance
// terminale peut donc légitimement atteindre `recently_handled`.

export interface DebriefDeadlineInput {
  status: 'to_plan' | 'planned' | 'done' | 'cancelled' | 'superseded'
  /** `completed_at ?? cancelled_at` (site_deadlines) — `null` seulement si aucun des deux n'est renseigné. */
  resolvedAt: string | null
}

export interface DebriefDeadlineItem {
  kind: 'deadline'
  disposition: DebriefDisposition
}

export function classifyDeadlineForDebrief(deadline: DebriefDeadlineInput, today: string): DebriefDeadlineItem {
  if (deadline.status === 'to_plan') return { kind: 'deadline', disposition: 'to_handle' }
  if (deadline.status === 'planned') return { kind: 'deadline', disposition: 'to_watch' }
  return { kind: 'deadline', disposition: terminalDisposition(deadline.resolvedAt, today) }
}

// ── Réserve ───────────────────────────────────────────────────────────────────
// open → à traiter. Vocabulaire "levée", jamais "résolu" (cf. RESERVE_STATUS_META,
// connotation juridique).
//
// TIMESTAMP AUDITÉ (lib/db/site-reserve.ts) : lever une réserve écrit
// `status='lifted'` ET `lifted_at=now()` dans la MÊME mutation (atomique) — fiable,
// aucun cas où `liftedAt` manque pour une réserve levée.

export interface DebriefReserveInput {
  status: 'open' | 'lifted'
  /** Fiable : posé atomiquement avec le passage à `lifted`. */
  liftedAt: string | null
}

export interface DebriefReserveItem {
  kind: 'reserve'
  disposition: DebriefDisposition
}

export function classifyReserveForDebrief(reserve: DebriefReserveInput, today: string): DebriefReserveItem {
  if (reserve.status === 'open') return { kind: 'reserve', disposition: 'to_handle' }
  return { kind: 'reserve', disposition: terminalDisposition(reserve.liftedAt, today) }
}

// ── Planning item ─────────────────────────────────────────────────────────────
// Un planning item n'est JAMAIS actionnable dans le Débrief : c'est une intention
// documentaire (« prévu »), pas un objet dont l'utilisateur change le statut. Le
// faire entrer dans à_traiter/à_surveiller/traité inventerait une réalisation que
// personne n'a confirmée. Il n'alimente que `confirmed_today` en compteur passif
// (« N travaux prévus cette semaine », « prochain jalon »). La confrontation
// Prévu/Constaté reste HARD STOP (cf. planning-v1d3-preuve-textuelle-prevu-constate,
// planning-v1b-contract) — aucun classifieur ne doit contourner ce blocage.
// Disposition figée à `not_relevant` : jamais to_handle, to_watch, recently_handled,
// ni de sémantique Vu.

export interface DebriefPlanningItem {
  kind: 'planning'
  disposition: 'not_relevant'
}

export function classifyPlanningItemForDebrief(): DebriefPlanningItem {
  return { kind: 'planning', disposition: 'not_relevant' }
}

// ── Signal informationnel canonical (PV : stagnation, aggravation, réouverture...) ──
// Ces signaux (deriveCanonicalAttentionItems) n'ont pas de statut propre — aucun
// « done » possible ailleurs dans le produit. Ils ne peuvent donc jamais devenir
// à_traiter (ce serait un item qui ne se résout jamais que par un clic Débrief,
// exactement le second workflow caché que la doctrine interdit). Ils vivent en
// à_surveiller jusqu'à un accusé de lecture (« Vu »), qui est la SEULE donnée que
// le Débrief a le droit de posséder — un accusé de lecture n'est pas un statut
// métier, il ne modifie aucune table Action/Échéance/Réserve/Planning.
//
// Si le même canonical_subject porte déjà un Action/Échéance/Réserve ouvert(e),
// c'est CET objet qui représente l'attention dans le Débrief — jamais les deux :
// une seule carte par sujet réel.
//
// VERROU DE TYPE : « Vu » n'existe QUE sur `DebriefInformationalSignalItem`. Les
// interfaces Action/Deadline/Reserve/Planning ci-dessus n'ont pas de champ `ack`,
// et `markSeen` ci-dessous n'accepte QUE ce type — passer un DebriefActionItem/
// DebriefDeadlineItem/DebriefReserveItem/DebriefPlanningItem à `markSeen` est un
// ÉCHEC DE COMPILATION (le discriminant `kind` ne correspond à aucune surcharge),
// pas une règle UI à respecter par convention.

export type DebriefSignalAck = 'unseen' | 'seen'

export interface DebriefInformationalSignalInput {
  hasOpenLinkedObject: boolean
  ack: DebriefSignalAck
}

export interface DebriefInformationalSignalItem {
  kind: 'informational_signal'
  disposition: DebriefDisposition
  ack: DebriefSignalAck
}

export function classifyInformationalSignalForDebrief(signal: DebriefInformationalSignalInput): DebriefInformationalSignalItem {
  if (signal.hasOpenLinkedObject) {
    return { kind: 'informational_signal', disposition: 'not_relevant', ack: signal.ack }
  }
  return {
    kind: 'informational_signal',
    disposition: signal.ack === 'seen' ? 'recently_handled' : 'to_watch',
    ack: signal.ack,
  }
}

/**
 * Le SEUL point d'entrée pour « Vu ». Le paramètre est typé exclusivement en
 * `DebriefInformationalSignalItem` : aucun autre type d'item du Débrief ne peut
 * être passé ici, à la compilation — pas seulement par convention d'appel.
 */
export function markSeen(item: DebriefInformationalSignalItem): DebriefInformationalSignalItem {
  return { ...item, ack: 'seen', disposition: 'recently_handled' }
}

// ── Union et garde-fou d'exhaustivité ────────────────────────────────────────────

export type DebriefItem =
  | DebriefActionItem
  | DebriefDeadlineItem
  | DebriefReserveItem
  | DebriefPlanningItem
  | DebriefInformationalSignalItem
