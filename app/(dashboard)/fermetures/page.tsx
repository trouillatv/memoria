// FERMETURES — « je déclare les jours fermés ».
//
// Le deuxième temps de la phrase de Guillaume : « je définis mes roulements,
// je déclare les jours fermés, puis j'ajuste ma semaine. »
//
// Trois blocs, et la distinction qui compte (arbitrage Vincent, 2026-07-15) :
//
//   1. LES CALENDRIERS COMMUNS — vacances scolaires, jours fériés. Des sources
//      de dates partagées, saisies UNE fois pour l'organisation.
//   2. LES CHANTIERS CONCERNÉS — l'adhésion est un CHOIX, par chantier : un
//      jour férié ne ferme PAS tous les sites. Le magasin ouvre peut-être le
//      14 juillet ; l'école, jamais.
//   3. LES FERMETURES À VENIR — ce qui ferme vraiment, et quand. Lecture
//      seule : chaque fermeture s'édite à sa SOURCE (fiche chantier, ou
//      calendrier commun si elle en dérive).
//
// ⚠️ Aucune date n'est pré-remplie, fériés compris : le calendrier calédonien
// est saisi par l'utilisateur. Une fermeture fausse déplacerait du vrai travail.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarOff, GraduationCap, Flag, Building2, Lock } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listPeriods } from '@/lib/db/school-calendar'
import { listUpcomingClosuresForOrg } from '@/lib/db/site-closures'
import { createAdminClient } from '@/lib/supabase/admin'
import { frDayMonthLocal } from '@/lib/time/local-date'
import { CLOSURE_REASON_FR } from '@/lib/planning/closures'
import { CalendarEditor } from '../calendrier-scolaire/CalendarEditor'

export const dynamic = 'force-dynamic'

export default async function FermeturesPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const [periods, upcoming] = await Promise.all([
    listPeriods().catch(() => []),
    listUpcomingClosuresForOrg().catch(() => []),
  ])
  const scolaires = periods.filter((p) => p.kind === 'scolaire')
  const feries = periods.filter((p) => p.kind === 'ferie')

  // Les chantiers concernés — qui adhère à quoi.
  const { data: siteRows } = await createAdminClient()
    .from('sites')
    .select('id, name, follows_school_calendar, follows_public_holidays, organization_id')
    .is('deleted_at', null)
    .or('follows_school_calendar.eq.true,follows_public_holidays.eq.true')
    .order('name')
  const orgId = user.organization_id
  const following = ((siteRows ?? []) as Array<{
    id: string
    name: string
    follows_school_calendar: boolean
    follows_public_holidays: boolean
    organization_id: string | null
  }>).filter((s) => !orgId || s.organization_id === orgId)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-semibold leading-tight">
          <CalendarOff className="h-5 w-5 text-muted-foreground" />
          Fermetures
        </h1>
        <p className="text-sm text-muted-foreground">
          Les jours où les chantiers sont fermés — et pourquoi. La semaine, les roulements et le
          tableau de bord s&apos;en servent partout.
        </p>
      </header>

      {/* ── 1. Les calendriers communs ─────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Calendriers communs
        </h2>

        <div className="space-y-1.5">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-medium">
            <GraduationCap className="h-4 w-4 text-muted-foreground" /> Vacances scolaires
          </h3>
          <CalendarEditor
            periods={scolaires}
            followingCount={following.filter((s) => s.follows_school_calendar).length}
            kind="scolaire"
          />
        </div>

        <div className="space-y-1.5">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-medium">
            <Flag className="h-4 w-4 text-muted-foreground" /> Jours fériés
          </h3>
          <CalendarEditor
            periods={feries}
            followingCount={following.filter((s) => s.follows_public_holidays).length}
            kind="ferie"
            placeholder="ex : Fête de la citoyenneté"
            emptyText="Aucun jour férié saisi. Entrez ceux du calendrier officiel — MemorIA n’en invente aucun."
          />
        </div>
      </section>

      {/* ── 2. Les chantiers concernés — l'adhésion est un CHOIX ─────────── */}
      <section className="space-y-2 rounded-2xl border bg-card p-4">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          Chantiers concernés
        </h2>
        <p className="text-xs text-muted-foreground">
          Un jour férié ne ferme pas tous les sites : chaque chantier choisit, sur sa fiche, les
          calendriers qu&apos;il suit.
        </p>
        {following.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun pour l&apos;instant. Sur la fiche d&apos;un chantier, carte «&nbsp;Fermetures&nbsp;».
          </p>
        ) : (
          <ul className="space-y-1">
            {following.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sites/${s.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/40"
                >
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {[
                      s.follows_school_calendar ? 'vacances scolaires' : null,
                      s.follows_public_holidays ? 'jours fériés' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 3. Ce qui ferme VRAIMENT, et quand ────────────────────────────── */}
      <section className="space-y-2 rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Fermetures à venir</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune fermeture à venir. Elles se déclarent sur la fiche d&apos;un chantier, ou
            découlent des calendriers ci-dessus.
          </p>
        ) : (
          <ul className="divide-y">
            {upcoming.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/sites/${c.siteId}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.siteName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.startsOn === c.endsOn
                        ? frDayMonthLocal(c.startsOn)
                        : `${frDayMonthLocal(c.startsOn)} → ${frDayMonthLocal(c.endsOn)}`}
                      {' · '}
                      {c.reason?.trim() || CLOSURE_REASON_FR[c.reasonKind]}
                    </span>
                  </span>
                  {/* Dérivée d'un calendrier commun : elle se corrige LÀ-BAS,
                      jamais ici — la source est le calendrier, pas la copie. */}
                  {c.fromCalendar && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <Lock className="h-3 w-3" /> calendrier
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
