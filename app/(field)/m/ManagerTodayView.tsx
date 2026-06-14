// Vue superviseur /m — "Mes chantiers du jour"
// Remplace le EmptyState pour les managers/admins sans équipe assignée.
// Gros boutons, mobile-first. Chaque intervention = 1 accès direct + raccourcis.

import Link from 'next/link'
import {
  MapPin,
  ArrowRight,
  QrCode,
  BookOpen,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import type { OrgTodaySite } from '@/lib/db/field-today'

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  planned:     { label: 'Planifiée',  dot: 'bg-sky-500',      text: 'text-sky-700' },
  in_progress: { label: 'En cours',   dot: 'bg-amber-500',    text: 'text-amber-700' },
  completed:   { label: 'Terminée',   dot: 'bg-emerald-500',  text: 'text-emerald-700' },
  validated:   { label: 'Validée',    dot: 'bg-green-600',    text: 'text-green-700' },
}

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function interventionActionLabel(status: string): string {
  if (status === 'planned') return 'Démarrer'
  if (status === 'in_progress') return 'Continuer'
  return 'Réouvrir'
}

interface Props {
  sites: OrgTodaySite[]
  todayLabel: string
}

export function ManagerTodayView({ sites, todayLabel }: Props) {
  if (sites.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-6 text-center space-y-1">
        <CheckCircle2 className="h-8 w-8 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium">Aucune intervention {todayLabel}</p>
        <p className="text-xs text-muted-foreground">La page se met à jour automatiquement.</p>
      </div>
    )
  }

  const totalInterventions = sites.reduce((n, s) => n + s.interventions.length, 0)

  return (
    <div className="space-y-4">
      <div className="space-y-0.5">
        <h1 className="text-xl font-semibold">Mes chantiers du jour</h1>
        <p className="text-sm text-muted-foreground">
          {totalInterventions} intervention{totalInterventions > 1 ? 's' : ''} · {sites.length} chantier{sites.length > 1 ? 's' : ''}
        </p>
      </div>

      <ul className="space-y-3">
        {sites.map((site) => (
          <li key={site.siteId} className="rounded-xl border bg-card overflow-hidden">
            {/* En-tête site */}
            <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-semibold text-base truncate">{site.siteName}</span>
              <span className="ml-auto text-xs text-muted-foreground shrink-0">
                {site.interventions.length} intervention{site.interventions.length > 1 ? 's' : ''}
              </span>
            </div>

            {/* Interventions */}
            <ul className="divide-y divide-border/40">
              {site.interventions.map((intv) => (
                <li key={intv.id} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/20 active:bg-muted/30" style={{ minHeight: 72 }}>
                  {/* Zone mission — lien vers la fiche mission */}
                  <Link
                    href={`/missions/${intv.missionId}`}
                    className="flex-1 min-w-0 space-y-1 block"
                  >
                    <p className="font-medium text-sm truncate">{intv.missionName}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusPill status={intv.status} />
                      {intv.openAnomalyCount > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5"
                          title={`${intv.openAnomalyCount} anomalie${intv.openAnomalyCount > 1 ? 's' : ''} ouverte${intv.openAnomalyCount > 1 ? 's' : ''}`}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {intv.openAnomalyCount}
                        </span>
                      )}
                      {intv.teamName && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {intv.teamName}
                        </span>
                      )}
                      {intv.plannedStart && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {new Date(intv.plannedStart).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Pacific/Noumea',
                          })}
                        </span>
                      )}
                    </div>
                  </Link>
                  {/* Bouton accès intervention */}
                  <Link
                    href={`/m/intervention/${intv.id}`}
                    className="shrink-0 flex items-center justify-center rounded-full bg-foreground text-background px-4 py-3 text-sm font-medium gap-1 active:opacity-70"
                    style={{ minWidth: 80, minHeight: 56 }}
                  >
                    {interventionActionLabel(intv.status)}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>

            {/* Raccourcis bas de carte */}
            <div className="px-4 py-2.5 border-t border-border/50 flex items-center gap-3 bg-muted/20">
              <Link
                href={`/sites/${site.siteId}/journal`}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2 rounded-md hover:bg-muted/40 active:bg-muted/60"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Journal
              </Link>
              <Link
                href={`/sites/${site.siteId}/qr`}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2 rounded-md hover:bg-muted/40 active:bg-muted/60"
              >
                <QrCode className="h-3.5 w-3.5" />
                QR Code
              </Link>
              <Link
                href={`/sites/${site.siteId}`}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2 rounded-md hover:bg-muted/40 active:bg-muted/60 ml-auto"
              >
                Fiche site
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </li>
        ))}
      </ul>

    </div>
  )
}
