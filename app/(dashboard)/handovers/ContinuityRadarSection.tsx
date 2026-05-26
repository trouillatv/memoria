// Radar « À anticiper » — fusionné dans /handovers (ex-page /continuite).
// Vincent 2026-05-27 : deux entrées sidebar (Continuité + Passages de témoin)
// = trop de confusion. On unifie : ici le RADAR (fins de contrat → passations
// à préparer), les briefs eux-mêmes vivent dans la même page juste en dessous.
//
// Présentational : reçoit les entries déjà chargées par la page (pas de fetch).
// Sujet = la mémoire portée / les sites. Jamais d'évaluation de personne.

import Link from 'next/link'
import {
  Calendar, Clock, MapPin, Users, AlertTriangle, CheckCircle2, Pin,
} from 'lucide-react'
import type { ContinuityEntry } from '@/lib/db/continuity'

const EMPLOYMENT_LABEL: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  cdi_chantier: 'CDI Chantier',
}

function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function daysLabel(days: number): string {
  if (days < 0) return `dépassée de ${-days} jour${-days > 1 ? 's' : ''}`
  if (days === 0) return "aujourd'hui"
  if (days === 1) return 'demain'
  return `dans ${days} jours`
}

export function ContinuityRadarSection({ entries }: { entries: ContinuityEntry[] }) {
  const j7 = entries.filter((e) => e.bucket === 'j7')
  const j14 = entries.filter((e) => e.bucket === 'j14')
  const j30 = entries.filter((e) => e.bucket === 'j30')

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground inline-flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" />
          À anticiper — fins de contrat (≤ 30 jours)
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {entries.length} passation{entries.length > 1 ? 's' : ''} à préparer
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-emerald-50/40 dark:bg-emerald-950/20 px-4 py-4 text-sm flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
          <span className="text-muted-foreground">
            Aucune fin de contrat dans les 30 jours. Vous pouvez préparer un passage de témoin
            à tout moment depuis une fiche intervenant ou équipe (boutons plus bas).
          </span>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Pin className="h-3 w-3 mt-0.5 shrink-0 text-amber-600" />
            Le sujet est la mémoire portée par chaque équipe — pas une évaluation. « Préparer la
            passation » génère un brief de mémoire opérationnelle.
          </p>
          {j7.length > 0 && <Bucket title="Cette semaine (≤ 7 jours)" emphasis="urgent" entries={j7} />}
          {j14.length > 0 && <Bucket title="Dans 2 semaines (8-14 jours)" emphasis="warning" entries={j14} />}
          {j30.length > 0 && <Bucket title="Dans 1 mois (15-30 jours)" emphasis="neutral" entries={j30} />}
        </>
      )}
    </section>
  )
}

function Bucket({
  title,
  emphasis,
  entries,
}: {
  title: string
  emphasis: 'urgent' | 'warning' | 'neutral'
  entries: ContinuityEntry[]
}) {
  const border = { urgent: 'border-rose-300', warning: 'border-amber-300', neutral: 'border-border' }[emphasis]
  const bg = {
    urgent: 'bg-rose-50/30 dark:bg-rose-950/20',
    warning: 'bg-amber-50/30 dark:bg-amber-950/20',
    neutral: 'bg-card',
  }[emphasis]
  const Icon = { urgent: AlertTriangle, warning: Clock, neutral: Calendar }[emphasis]
  const iconColor = { urgent: 'text-rose-600', warning: 'text-amber-600', neutral: 'text-muted-foreground' }[emphasis]

  return (
    <div className={`rounded-lg border-2 ${border} ${bg} p-4 space-y-2`}>
      <h3 className="text-sm font-semibold inline-flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        {title}
      </h3>
      <ul className="space-y-2">
        {entries.map((e) => (
          <EntryCard key={e.subject_user_id} entry={e} />
        ))}
      </ul>
    </div>
  )
}

function EntryCard({ entry }: { entry: ContinuityEntry }) {
  const employmentLabel = entry.employment_type
    ? EMPLOYMENT_LABEL[entry.employment_type] ?? entry.employment_type
    : null
  return (
    <li className="rounded-md border bg-background px-3 py-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <Link href={`/intervenants/${entry.subject_user_id}`} className="font-medium hover:text-brand-700 transition-colors">
              {entry.subject_label}
            </Link>
            {employmentLabel && (
              <span className="ml-1.5 text-[10px] uppercase tracking-wider font-medium px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                {employmentLabel}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Contrat se termine le <span className="font-medium text-foreground">{fmtDateLong(entry.contract_end_date)}</span>
            <span className="text-muted-foreground"> · {daysLabel(entry.daysRemaining)}</span>
          </p>
        </div>
        {entry.briefAlreadyPrepared && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            Brief préparé
          </span>
        )}
      </div>

      <div className="rounded-md bg-muted/40 px-3 py-2 space-y-1.5">
        <p className="text-[11px] font-medium text-foreground inline-flex items-center gap-1.5">
          <MapPin className="h-3 w-3 text-brand-600" />
          Mémoire portée actuellement
        </p>
        <p className="text-xs text-muted-foreground">
          {entry.sitesCovered.length === 0 ? (
            <span className="italic">Aucun site documenté pour les équipes actives de cette personne.</span>
          ) : (
            <>
              <strong>{entry.sitesCovered.length} site{entry.sitesCovered.length > 1 ? 's' : ''}</strong> via{' '}
              <strong>{entry.activeTeams.length} équipe{entry.activeTeams.length > 1 ? 's' : ''}</strong>
              {entry.activeTeams.length > 0 && (
                <>
                  {' ('}
                  {entry.activeTeams.map((t, i) => (
                    <span key={t.team_id}>
                      {i > 0 && ', '}
                      <Link href={`/equipes/${t.team_id}`} className="hover:underline">{t.team_name}</Link>
                    </span>
                  ))}
                  {')'}
                </>
              )}
              .
            </>
          )}
        </p>
        {entry.sitesCovered.length > 0 && entry.sitesCovered.length <= 5 && (
          <ul className="text-[11px] text-muted-foreground space-y-0.5 pt-1">
            {entry.sitesCovered.map((s) => (
              <li key={s.site_id}>
                ·{' '}
                <Link href={`/sites/${s.site_id}`} className="hover:underline">{s.site_name}</Link>
                {s.contract_name && <span className="opacity-70"> — {s.contract_name}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end pt-1">
        <Link
          href={`/intervenants/${entry.subject_user_id}`}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs rounded-md border border-brand-300 bg-brand-50 hover:bg-brand-100 text-brand-800 dark:bg-brand-950/30 dark:text-brand-200 dark:border-brand-700 px-3 py-1.5 transition-colors"
        >
          <Users className="h-3.5 w-3.5" />
          {entry.briefAlreadyPrepared ? 'Voir la fiche' : 'Préparer la passation'}
        </Link>
      </div>
    </li>
  )
}
