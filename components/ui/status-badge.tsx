import { cn } from '@/lib/utils'

// Slice C.1 — StatusBadge unifié.
//
// Doctrine impérative :
//   - Sobriété > couleur. Couleurs muted, contrastes WCAG AA.
//   - Wording français cohérent. Aucune redéclaration inline.
//   - Borders + bg muted + text strong, jamais saturé.
//
// Domaines couverts :
//   - Intervention : planned / in_progress / completed / validated / skipped
//   - Tender       : draft / extracting / analyzing / ready / failed / submitted / archived
//   - Contract     : active / paused / terminated / archived
//   - Engagement   : extracted / curated / active / completed / archived / rejected
//   - Anomaly      : open / resolved / ignored
//
// Pour les tokens partagés entre domaines (active, archived, completed), un seul
// label / une seule couleur. Le label de "completed" reste « Exécutée » (verbatim
// intervention) — c'est le sens dominant côté UX produit.

export type StatusValue =
  // Intervention
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'validated'
  | 'skipped'
  // Tender
  | 'draft'
  | 'extracting'
  | 'analyzing'
  | 'ready'
  | 'failed'
  | 'submitted'
  // Contract / Engagement / shared
  | 'active'
  | 'paused'
  | 'terminated'
  | 'archived'
  // Engagement
  | 'extracted'
  | 'curated'
  | 'rejected'
  // Anomaly
  | 'open'
  | 'resolved'
  | 'ignored'

interface StatusMeta {
  label: string
  className: string
}

// Doctrine couleur :
//   - Slate  → neutre / non-actif (planned, draft, terminated, rejected, ignored)
//   - Sky    → en cours (in_progress, extracting, analyzing)
//   - Emerald→ succès / terminé positif (completed, validated, ready, active,
//              curated, resolved)
//   - Amber  → attention / en attente (skipped, paused, open, extracted)
//   - Rose   → échec uniquement (failed)
//   - Violet → soumis (état formel terminé en attente externe)
//   - Muted  → archivé
const STATUS_MAP: Record<StatusValue, StatusMeta> = {
  // Intervention
  planned:     { label: 'Planifiée',  className: 'bg-slate-50 border-slate-200 text-slate-700' },
  in_progress: { label: 'En cours',   className: 'bg-sky-50 border-sky-200 text-sky-800' },
  completed:   { label: 'Exécutée',   className: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  validated:   { label: 'Validée',    className: 'bg-emerald-100 border-emerald-300 text-emerald-900' },
  skipped:     { label: 'Sautée',     className: 'bg-amber-50 border-amber-200 text-amber-800' },

  // Tender
  draft:       { label: 'Brouillon',  className: 'bg-slate-50 border-slate-200 text-slate-700' },
  extracting:  { label: 'Extraction', className: 'bg-sky-50 border-sky-200 text-sky-800' },
  analyzing:   { label: 'Analyse',    className: 'bg-sky-50 border-sky-200 text-sky-800' },
  ready:       { label: 'Prêt',       className: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  failed:      { label: 'Échec',      className: 'bg-rose-50 border-rose-200 text-rose-800' },
  submitted:   { label: 'Soumis',     className: 'bg-violet-50 border-violet-200 text-violet-800' },

  // Contract / Engagement shared
  active:      { label: 'Actif',      className: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  paused:      { label: 'En pause',   className: 'bg-amber-50 border-amber-200 text-amber-800' },
  terminated:  { label: 'Terminé',    className: 'bg-slate-50 border-slate-200 text-slate-700' },
  archived:    { label: 'Archivé',    className: 'bg-muted/50 border-border text-muted-foreground' },

  // Engagement curation
  extracted:   { label: 'Extrait',    className: 'bg-amber-50 border-amber-200 text-amber-800' },
  curated:     { label: 'Validée',    className: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  rejected:    { label: 'Rejetée',    className: 'bg-slate-50 border-slate-200 text-slate-700' },

  // Anomaly
  open:        { label: 'Signalée',   className: 'bg-amber-50 border-amber-200 text-amber-800' },
  resolved:    { label: 'Résolue',    className: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  ignored:     { label: 'Ignorée',    className: 'bg-slate-50 border-slate-200 text-slate-700' },
}

interface StatusBadgeProps {
  /**
   * Valeur de statut. `string` accepté pour graceful degradation : un statut
   * inconnu est rendu tel quel avec un style neutre muted.
   */
  status: StatusValue | string
  /**
   * `sm` (défaut) pour listes denses, `md` pour headers de page.
   */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Badge de statut unifié — un seul composant, un seul mapping, un seul wording.
 *
 * Doctrine : aucune redéclaration inline ailleurs dans le codebase. Si un statut
 * manque, l'ajouter ici (et non recréer un mapping local).
 */
export function StatusBadge({ status, size = 'sm', className }: StatusBadgeProps) {
  const meta = STATUS_MAP[status as StatusValue]
  const label = meta?.label ?? status
  const classNameMeta =
    meta?.className ?? 'bg-muted/50 border-border text-muted-foreground'

  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        'inline-flex items-center rounded-full border font-medium uppercase tracking-wider whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        classNameMeta,
        className,
      )}
    >
      {label}
    </span>
  )
}

/**
 * Helper standalone — utile quand on veut juste le label sans le rendu badge.
 * Retourne le statut brut si inconnu (fallback gracieux).
 */
export function statusLabel(status: string): string {
  return STATUS_MAP[status as StatusValue]?.label ?? status
}
