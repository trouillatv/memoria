// ── ACTIONS ASSIGNÉES À UNE PERSONNE — logique PURE (P2 Slice 3A) ────────────
// « Qu'attend-on de cette personne ? » La SEULE preuve d'attribution est
// l'identité structurelle `site_actions.assigned_contact_id` (mig 220). Jamais
// `assigned_to` (texte libre), jamais un rôle, jamais un rapprochement de nom.
//
// Module PUR (aucune dépendance serveur/DB) → testable en isolation et
// réutilisable côté read model. Le chemin de construction de `assignedActions`
// est ici, protégé par des tests de comportement.

export interface AssignedAction {
  id: string
  title: string
  /** Jour civil « YYYY-MM-DD » ou null. */
  dueDate: string | null
  /** `explicit` = date dite ; `estimated` = date IA « à confirmer » ; null = aucune. */
  dueDateStatus: 'explicit' | 'estimated' | null
  /** En retard = échéance EXPLICITE strictement passée. Une date estimée ne l'est jamais. */
  isLate: boolean
  /** Destination honnête : la réunion source, sinon l'onglet Travail. Jamais un
   *  faux ancrage précis (il n'existe pas de route par action). */
  href: string
  hrefSource: 'report' | 'site_work'
}

export interface RawAssignedActionRow {
  id: string
  title: string
  assigned_contact_id: string | null
  due_date: string | null
  due_date_status: 'explicit' | 'estimated' | null
  report_id: string | null
  status: string
  created_at: string
}

/** « Ouverte » canonique = open + planned (site-overview : une planifiée engage
 *  toujours la personne). On ne crée PAS une définition locale. */
const ACTIVE_STATUS = new Set(['open', 'planned'])

type Ranked = AssignedAction & { createdAt: string }

/**
 * Groupe des actions par `assigned_contact_id` (l'identité structurelle), avec
 * calcul du retard et de la destination. `today` = jour civil Nouméa
 * « YYYY-MM-DD » (todayLocalIso). Les lignes sans contact, fermées ou annulées
 * sont ignorées — jamais rattachées par texte.
 */
export function assignedActionsByContact(
  siteId: string,
  rows: RawAssignedActionRow[],
  today: string,
): Map<string, AssignedAction[]> {
  const byContact = new Map<string, Ranked[]>()
  for (const r of rows) {
    // La SEULE preuve : l'identité structurelle. Jamais assigned_to.
    if (!r.assigned_contact_id) continue
    // Défensif : la requête filtre déjà, mais la fonction pure reste sûre seule.
    if (!ACTIVE_STATUS.has(r.status)) continue
    const dueDate = r.due_date ? r.due_date.slice(0, 10) : null
    const isLate = r.due_date_status === 'explicit' && dueDate !== null && dueDate < today
    const item: Ranked = {
      id: r.id,
      title: r.title,
      dueDate,
      dueDateStatus: r.due_date_status,
      isLate,
      href: r.report_id ? `/meetings/${r.report_id}` : `/sites/${siteId}?tab=travail`,
      hrefSource: r.report_id ? 'report' : 'site_work',
      createdAt: r.created_at,
    }
    const list = byContact.get(r.assigned_contact_id) ?? []
    list.push(item)
    byContact.set(r.assigned_contact_id, list)
  }
  const out = new Map<string, AssignedAction[]>()
  for (const [contactId, list] of byContact) {
    list.sort(compareAssigned)
    out.set(contactId, list.map((a) => ({
      id: a.id, title: a.title, dueDate: a.dueDate, dueDateStatus: a.dueDateStatus,
      isLate: a.isLate, href: a.href, hrefSource: a.hrefSource,
    })))
  }
  return out
}

/** Bucket d'ordre : retard explicite → explicite future → date estimée → sans date. */
function bucket(a: Ranked): number {
  if (a.isLate) return 0
  if (a.dueDateStatus === 'explicit' && a.dueDate) return 1
  if (a.dueDate) return 2
  return 3
}

/** Ordre DÉTERMINISTE (jamais l'ordre SQL implicite) : bucket, puis date
 *  croissante dans les buckets datés, puis création, puis id. */
function compareAssigned(a: Ranked, b: Ranked): number {
  const ba = bucket(a), bb = bucket(b)
  if (ba !== bb) return ba - bb
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
