// ── DIRE UNE ÉCHÉANCE ────────────────────────────────────────────────────────
// Une échéance, c'est CE QUI doit arriver et QUAND. Le « quand » a deux formes, et
// il ne faut jamais les confondre :
//   · une DATE dite  → « Poser le coffret — 28 juillet »
//   · une CONTRAINTE → « Programmer la visite PAVE — Avant le démarrage »
//
// On ne transforme jamais l'une en l'autre. « Sous une dizaine de jours » n'est pas
// le 27 juillet : c'est ce que quelqu'un a dit. Inventer la date, ce serait faire
// dire au chantier une précision que personne n'a donnée — et le jour où elle est
// fausse, c'est toute la mémoire qu'on cesse de croire.
//
// Module PUR (ni base, ni serveur) : le compte-rendu mobile, le PDF et la fiche
// chantier disent les mêmes mots parce qu'ils lisent les mêmes fonctions.
//
// Le TYPE et le lecteur tolérant vivent ICI, pas dans `debrief-analysis` : ce
// dernier touche la base (donc `next/headers`), et un composant CLIENT qui
// importerait une seule de ses fonctions embarquerait toute la couche serveur —
// le build casse. Une donnée pure n'a pas à habiter chez le serveur.

/** Une échéance telle que le débrief la donne : ce qui doit arriver, et la notion
 *  de temps qui l'accompagne — une date si elle est dite, sinon la contrainte. */
export interface DebriefEcheance {
  label: string
  /** AAAA-MM-JJ, ou '' : une date DITE, jamais déduite d'un délai. */
  date: string
  /** « Avant le démarrage », « Sous une dizaine de jours ». '' si une date est nette. */
  constraint: string
}

/** Les analyses écrites AVANT la forme structurée stockaient des chaînes nues.
 *  On les relit sans jamais les jeter : une vieille échéance devient un label sans
 *  date ni contrainte — exactement ce qu'elle disait, ni plus, ni moins. */
export function toDebriefEcheance(raw: unknown): DebriefEcheance | null {
  if (typeof raw === 'string') {
    const label = raw.trim()
    return label ? { label, date: '', constraint: '' } : null
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { label?: unknown; date?: unknown; constraint?: unknown }
    const label = typeof o.label === 'string' ? o.label.trim() : ''
    if (!label) return null
    return {
      label,
      date: typeof o.date === 'string' ? o.date.trim() : '',
      constraint: typeof o.constraint === 'string' ? o.constraint.trim() : '',
    }
  }
  return null
}

const dayMonthFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Pacific/Noumea',
  day: 'numeric',
  month: 'long',
})

/** « 28 juillet » à partir d'un AAAA-MM-JJ. Rend la chaîne telle quelle si elle
 *  n'est pas une date : on n'affiche jamais « Invalid Date » au conducteur. */
export function echeanceDateLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const ms = Date.parse(`${iso}T12:00:00+11:00`)
  if (!Number.isFinite(ms)) return iso
  return dayMonthFmt.format(new Date(ms))
}

/** Le « quand » d'une échéance, ou null si elle n'en a pas encore. */
export function echeanceWhen(e: DebriefEcheance): string | null {
  if (e.date) return echeanceDateLabel(e.date)
  if (e.constraint) return e.constraint
  return null
}

/** Une ligne complète : « Poser le coffret — 28 juillet ». */
export function echeanceLine(e: DebriefEcheance): string {
  const when = echeanceWhen(e)
  return when ? `${e.label} — ${when}` : e.label
}

/** L'état d'une échéance, dit au conducteur. Jamais « date à définir » : ce n'est
 *  pas la date qui manque, c'est la planification qui reste à faire. */
export const A_PLANIFIER_LABEL = 'Planification à compléter'
