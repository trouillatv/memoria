// La PROFONDEUR DU CLIC d'un point « À vérifier » (revue 2026-07-12).
// Une question seule rappelle ; une question accompagnée de son pourquoi, de sa
// source et du geste attendu aide à travailler. PUR, zéro IA, zéro entité :
// tout vient de l'objet source réel (source_kind/source_ref, mig 196).
// Phrase à rendre vraie : « je clique sur un point et je comprends immédiatement
// pourquoi je dois le vérifier et quelle preuve prendre. »

export interface WatchSourceLink {
  kind: 'reunion' | 'visite'
  id: string
  /** « 8 juillet » — formatée par l'appelant (fuseau Nouméa). */
  dateLabel: string
}

export interface WatchContextFacts {
  source_kind: string
  /** Naissance de l'objet source (réserve ouverte le…, décision actée le…). */
  sinceIso?: string | null
  /** Échéance dépassée (action en retard). */
  dueIso?: string | null
  /** Localisation de la réserve, quand elle existe. */
  location?: string | null
  /** Le rapport (réunion/visite) où l'objet est né, quand il est connu. */
  source?: WatchSourceLink | null
}

export interface WatchContext {
  /** POURQUOI ce point apparaît — factuel, daté. */
  why: string
  /** Le GESTE terrain recommandé (la preuve attendue). */
  gesture: string
  sourceLabel: string | null
  sourceHref: string | null
}

function daysSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000))
}

export function buildWatchContext(f: WatchContextFacts, nowMs: number): WatchContext {
  const d = f.sinceIso ? daysSince(f.sinceIso, nowMs) : null

  // Le POURQUOI parle comme un compagnon : « ce point apparaît parce que… » —
  // la logique de MemorIA s'explique, elle ne s'impose pas (revue 2026-07-12).
  let why: string
  let gesture: string
  switch (f.source_kind) {
    case 'reserve_open':
      why = `Ce point apparaît parce que la réserve est toujours ouverte${f.location ? ` (${f.location})` : ''}${d !== null ? ` depuis ${d} j` : ''}.`
      gesture = 'Constater sur place et photographier — la levée se prouve.'
      break
    case 'action_overdue':
      why = `Cette action est toujours ouverte${d !== null ? ` depuis ${d} j` : ''}${f.dueIso ? ' et son échéance est dépassée' : ''}.`
      gesture = "Demander où ça en est, noter l'avancée au retour."
      break
    case 'decision_unapplied':
      why = `Cette décision n'a jamais été revue sur le terrain${d !== null ? ` (actée il y a ${d} j)` : ''}.`
      gesture = "Vérifier l'application sur place — photo si c'est visible."
      break
    case 'proof_window_closing':
      why = 'Ce point apparaît parce que la fenêtre de preuve se ferme — bientôt, ce ne sera plus visible.'
      gesture = 'Photographier maintenant, même cadrage que la dernière fois si possible.'
      break
    case 'obligation_neglected':
      why = "Cette obligation du chantier n'a pas de trace récente."
      gesture = 'Contrôler et laisser une trace — photo ou note.'
      break
    case 'manual':
      why = 'Vous avez ajouté ce point à la main pour cette visite.'
      gesture = 'À contrôler comme convenu — une preuve vaut trace.'
      break
    default:
      why = 'Ce point vient de la mémoire du chantier.'
      gesture = 'Contrôler sur place et laisser une trace.'
  }

  const sourceLabel = f.source
    ? f.source.kind === 'visite'
      ? `Vu en visite du ${f.source.dateLabel}`
      : `Vu en réunion du ${f.source.dateLabel}`
    : null
  const sourceHref = f.source
    ? f.source.kind === 'visite'
      ? `/m/visite/${f.source.id}/recap`
      : `/m/reunion/${f.source.id}`
    : null

  return { why, gesture, sourceLabel, sourceHref }
}
