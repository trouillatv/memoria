// /continuite — Passations à préparer (anticipation des fins de contrat).
//
// Vincent 2026-05-22 — Sprint E. TRANSGRESSION ASSUMÉE sous garde-fous
// techniques (cf. [[doctrine-rh]] + [[continuite-de-memoire-anticipee]]).
//
// Garde-fous appliqués ici :
//   - Kill switch ENV CONTINUITY_PAGE_ENABLED (cf. lib/continuity/access.ts)
//   - Audit log de chaque consultation
//   - Self-exclu (la personne ne voit pas sa propre fin)
//   - Allowlist user_id confinée à lib/db/continuity.ts
//   - Aucune comparaison, aucun ranking, aucun score
//
// Le sujet grammatical est TOUJOURS la mémoire / les sites.
// Wording évalué à chaque section pour éviter le glissement RH.

import Link from 'next/link'
import {
  ArrowRightLeft,
  Calendar,
  Clock,
  MapPin,
  Users,
  AlertTriangle,
  CheckCircle2,
  Pin,
} from 'lucide-react'
import { listContinuityRisks, type ContinuityEntry } from '@/lib/db/continuity'
import { logAuditEvent } from '@/lib/audit/log'
import { checkContinuityAccess } from '@/lib/continuity/access'

export const dynamic = 'force-dynamic'

const EMPLOYMENT_LABEL: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  cdi_chantier: 'CDI Chantier',
}

function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function daysLabel(days: number): string {
  if (days < 0) return `dépassée de ${-days} jour${-days > 1 ? 's' : ''}`
  if (days === 0) return "aujourd'hui"
  if (days === 1) return 'demain'
  return `dans ${days} jours`
}

export default async function ContinuitePage() {
  const access = await checkContinuityAccess()

  // Audit log obligatoire à chaque consultation
  await logAuditEvent({
    userId: access.viewer.id,
    entityType: 'user',
    entityId: null,
    action: 'consulted',
    metadata: { kind: 'continuity_page_visit' },
  })

  const risks = await listContinuityRisks({
    horizonDays: 30,
    viewerUserId: access.viewer.id,
  })

  const bucketJ7 = risks.entries.filter((e) => e.bucket === 'j7')
  const bucketJ14 = risks.entries.filter((e) => e.bucket === 'j14')
  const bucketJ30 = risks.entries.filter((e) => e.bucket === 'j30')

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <ArrowRightLeft className="h-6 w-6 text-brand-600" />
          Continuité opérationnelle
        </h1>
        <p className="text-sm text-muted-foreground">
          Passations à préparer pour les contrats finissant dans les 30 prochains
          jours. Le sujet est <strong>la mémoire portée par chaque équipe</strong>,
          jamais la valeur des personnes concernées.
        </p>
      </header>

      {/* Bandeau doctrine — toujours visible */}
      <div className="rounded-lg border border-amber-300 bg-amber-50/40 dark:bg-amber-950/20 p-4">
        <p className="text-sm flex items-start gap-2">
          <Pin className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>
            Cette page sert à <strong>anticiper la passation</strong> avant qu'un
            contrat se termine. Ce n'est pas un outil RH. Le bouton « Préparer
            la passation » génère un brief de mémoire opérationnelle — pas une
            note d'évaluation. Cf. <Link href="/manuel" className="underline">manuel</Link>.
          </span>
        </p>
      </div>

      {/* Bucket J-7 : Urgent (rouge MEDU) */}
      <ContinuitySection
        title="Cette semaine (≤ 7 jours)"
        count={bucketJ7.length}
        emptyText="Aucune passation à préparer cette semaine."
        emphasis="urgent"
        entries={bucketJ7}
      />

      {/* Bucket J-14 : Ambre */}
      <ContinuitySection
        title="Dans 2 semaines (8-14 jours)"
        count={bucketJ14.length}
        emptyText="Aucune passation à préparer pour la quinzaine à venir."
        emphasis="warning"
        entries={bucketJ14}
      />

      {/* Bucket J-30 : Sobre */}
      <ContinuitySection
        title="Dans 1 mois (15-30 jours)"
        count={bucketJ30.length}
        emptyText="Aucune passation à préparer pour le mois à venir."
        emphasis="neutral"
        entries={bucketJ30}
      />

      {/* Total */}
      {risks.entries.length === 0 && (
        <div className="rounded-lg border border-dashed bg-emerald-50/40 dark:bg-emerald-950/20 px-6 py-8 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-600 mb-2" />
          <p className="text-sm font-medium">Aucune passation à anticiper dans les 30 jours.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Pour qu'une personne apparaisse ici, sa date de fin de contrat doit
            être renseignée sur sa fiche. Cf. /intervenants/[id].
          </p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground italic text-center py-2">
        Aucune comparaison entre personnes. Aucun score. Aucun classement. Aucune
        prédiction de départ. Cette page documente des faits administratifs pour
        anticiper la passation de la mémoire opérationnelle.
      </p>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Section temporelle (urgent / warning / neutral)
// ----------------------------------------------------------------------------

function ContinuitySection({
  title,
  count,
  emptyText,
  emphasis,
  entries,
}: {
  title: string
  count: number
  emptyText: string
  emphasis: 'urgent' | 'warning' | 'neutral'
  entries: ContinuityEntry[]
}) {
  const borderColor = {
    urgent: 'border-rose-300',
    warning: 'border-amber-300',
    neutral: 'border-border',
  }[emphasis]
  const bgColor = {
    urgent: 'bg-rose-50/30 dark:bg-rose-950/20',
    warning: 'bg-amber-50/30 dark:bg-amber-950/20',
    neutral: 'bg-card',
  }[emphasis]
  const Icon = {
    urgent: AlertTriangle,
    warning: Clock,
    neutral: Calendar,
  }[emphasis]
  const iconColor = {
    urgent: 'text-rose-600',
    warning: 'text-amber-600',
    neutral: 'text-muted-foreground',
  }[emphasis]

  if (entries.length === 0 && emphasis !== 'urgent') {
    // En mode warning/neutral, on cache la section vide pour ne pas surcharger
    return null
  }

  return (
    <section className={`rounded-lg border-2 ${borderColor} ${bgColor} p-4 sm:p-5 space-y-3`}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          {title}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count} passation{count > 1 ? 's' : ''}
        </span>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <ContinuityEntryCard key={e.subject_user_id} entry={e} />
          ))}
        </ul>
      )}
    </section>
  )
}

// ----------------------------------------------------------------------------
// Entrée individuelle — sujet = sites + mémoire, jamais évaluatif
// ----------------------------------------------------------------------------

function ContinuityEntryCard({ entry }: { entry: ContinuityEntry }) {
  const employmentLabel =
    entry.employment_type ? EMPLOYMENT_LABEL[entry.employment_type] ?? entry.employment_type : null

  return (
    <li className="rounded-md border bg-background px-3 py-3 sm:px-4 sm:py-3.5 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <Link
              href={`/intervenants/${entry.subject_user_id}`}
              className="font-medium hover:text-brand-700 transition-colors"
            >
              {entry.subject_label}
            </Link>
            {employmentLabel && (
              <span className="ml-1.5 text-[10px] uppercase tracking-wider font-medium px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                {employmentLabel}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Contrat se termine le{' '}
            <span className="font-medium text-foreground">{fmtDateLong(entry.contract_end_date)}</span>
            <span className="text-muted-foreground"> · {daysLabel(entry.daysRemaining)}</span>
          </p>
        </div>
        {/* Badge brief préparé */}
        {entry.briefAlreadyPrepared && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            Brief préparé
          </span>
        )}
      </div>

      {/* Mémoire portée — sujet de la passation */}
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
              <strong>{entry.sitesCovered.length} site{entry.sitesCovered.length > 1 ? 's' : ''}</strong>
              {' '}via{' '}
              <strong>{entry.activeTeams.length} équipe{entry.activeTeams.length > 1 ? 's' : ''}</strong>
              {entry.activeTeams.length > 0 && (
                <>
                  {' ('}
                  {entry.activeTeams.map((t, i) => (
                    <span key={t.team_id}>
                      {i > 0 && ', '}
                      <Link href={`/equipes/${t.team_id}`} className="hover:underline">
                        {t.team_name}
                      </Link>
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
                <Link href={`/sites/${s.site_id}`} className="hover:underline">
                  {s.site_name}
                </Link>
                {s.contract_name && <span className="opacity-70"> — {s.contract_name}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Action — préparer la passation */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[11px] text-muted-foreground italic">
          {entry.briefAlreadyPrepared
            ? 'Un brief de mémoire opérationnelle a déjà été préparé.'
            : 'Aucun brief de mémoire opérationnelle n\'a encore été préparé.'}
        </p>
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
