// ── HISTORIQUE CANONIQUE d'une action (Lot 4 · Slice 6B) — composition PURE ───
// Normalise les lignes de `site_action_events` (mig 221) en une chronologie
// d'affichage. Règle absolue : on ne raconte QUE les événements réellement
// enregistrés — jamais une reconstruction depuis l'état courant (status,
// assigned_contact_id, due_date…). Pas de `server-only` : testable en vitest.

export type ActionEventKind =
  | 'created' | 'assigned' | 'unassigned' | 'due_date_changed' | 'completed' | 'reopened'

/** Une ligne brute du journal, telle que lue en base (JSONB déjà désérialisé). */
export interface RawActionEvent {
  id: string
  kind: ActionEventKind
  occurred_at: string
  actor_label: string | null
  before_value: { label?: string | null; date?: string | null } | null
  after_value: { label?: string | null; date?: string | null } | null
  reason: string | null
}

export interface ActionHistoryEntry {
  id: string
  kind: ActionEventKind
  occurredAt: string
  /** Le fait, en clair : « Créée », « Attribuée à Vincent Milon », « Échéance déplacée »… */
  line: string
  /** Précision éventuelle : « 22 juillet 2026 → 25 juillet 2026 ». */
  detail: string | null
  /** Nom de l'acteur — UNIQUEMENT le snapshot conservé (jamais résolu aujourd'hui). */
  actorLabel: string | null
  /** Quand aucun nom : origine honnête selon la nature de l'événement. */
  actorFallback: 'auto' | 'unknown' | null
  reason: string | null
}

export interface ActionHistoryItem {
  id: string
  kind: ActionEventKind
  time: string
  line: string
  detail: string | null
  actorLabel: string | null
  actorFallback: 'auto' | 'unknown' | null
  reason: string | null
}
export interface ActionHistoryDay {
  dayIso: string
  dayLabel: string
  items: ActionHistoryItem[]
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Date civile (YYYY-MM-DD) → « 22 juillet 2026 », sans passer par Date (zéro dérive TZ). */
function frCivil(d: string | null | undefined): string | null {
  if (!d) return null
  const m = d.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

function labelAndDetail(e: RawActionEvent): { line: string; detail: string | null } {
  switch (e.kind) {
    case 'created':
      return { line: 'Créée', detail: null }
    case 'assigned': {
      const who = e.after_value?.label?.trim()
      return { line: who ? `Attribuée à ${who}` : 'Attribuée', detail: null }
    }
    case 'unassigned': {
      const who = e.before_value?.label?.trim()
      return { line: who ? `Attribution retirée (${who})` : 'Attribution retirée', detail: null }
    }
    case 'due_date_changed': {
      const before = frCivil(e.before_value?.date)
      const after = frCivil(e.after_value?.date)
      if (before && after) return { line: 'Échéance déplacée', detail: `${before} → ${after}` }
      if (!before && after) return { line: 'Échéance fixée', detail: after }
      if (before && !after) return { line: 'Échéance retirée', detail: before }
      return { line: 'Échéance modifiée', detail: null }
    }
    case 'completed':
      return { line: 'Clôturée', detail: null }
    case 'reopened':
      return { line: 'Rouverte', detail: null }
  }
}

/** Journal brut → entrées d'affichage, triées chronologiquement (déterministe). */
export function normalizeActionHistory(rows: RawActionEvent[]): ActionHistoryEntry[] {
  return [...rows]
    .sort((a, b) => {
      const t = new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
      return t !== 0 ? t : a.id.localeCompare(b.id)
    })
    .map((e) => {
      const { line, detail } = labelAndDetail(e)
      const actorLabel = e.actor_label?.trim() || null
      const actorFallback: ActionHistoryEntry['actorFallback'] =
        actorLabel ? null : e.kind === 'created' ? 'auto' : 'unknown'
      return { id: e.id, kind: e.kind, occurredAt: e.occurred_at, line, detail, actorLabel, actorFallback, reason: e.reason?.trim() || null }
    })
}

const NOUMEA = 'Pacific/Noumea'
const DTF = new Intl.DateTimeFormat('en-GB', {
  timeZone: NOUMEA, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
function noumeaParts(iso: string): { dayIso: string; dayLabel: string; time: string } {
  const p = DTF.formatToParts(new Date(iso))
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  const y = g('year'), mo = g('month'), d = g('day')
  return { dayIso: `${y}-${mo}-${d}`, dayLabel: `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`, time: `${g('hour')}:${g('minute')}` }
}

/** Entrées → jours (heure locale Nouméa), ordre chronologique stable. */
export function groupHistoryByDay(entries: ActionHistoryEntry[]): ActionHistoryDay[] {
  const days: ActionHistoryDay[] = []
  for (const e of entries) {
    const { dayIso, dayLabel, time } = noumeaParts(e.occurredAt)
    let day = days[days.length - 1]
    if (!day || day.dayIso !== dayIso) {
      day = { dayIso, dayLabel, items: [] }
      days.push(day)
    }
    day.items.push({ id: e.id, kind: e.kind, time, line: e.line, detail: e.detail, actorLabel: e.actorLabel, actorFallback: e.actorFallback, reason: e.reason })
  }
  return days
}

/** Note honnête pour une action dont on ne connaît QUE la création (backfill) :
 *  le suivi détaillé n'existe qu'à partir du premier événement réellement présent.
 *  `null` dès qu'un événement autre que `created` existe. Jamais de date inventée. */
export function historyNoteFor(entries: ActionHistoryEntry[]): string | null {
  if (entries.length === 0) return null
  if (!entries.every((e) => e.kind === 'created')) return null
  const { dayLabel } = noumeaParts(entries[0].occurredAt)
  return `Historique détaillé disponible à partir du ${dayLabel}.`
}
