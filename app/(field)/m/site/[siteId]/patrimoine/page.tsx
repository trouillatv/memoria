import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, ChevronRight, Brain, Footprints, Users, Wrench, ListChecks,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSiteStatusSummary, buildSitePatrimoine, getSiteRecentActivity } from '@/lib/db/visits'
import { listSubjectsBySite } from '@/lib/db/subjects'
import { SiteTabs } from '../SiteTabs'
import { SiteStatusCard } from '../SiteStatusCard'
import { SitePatrimoineSearch } from '../SitePatrimoineSearch'

export const dynamic = 'force-dynamic'

/**
 * « Patrimoine » — l'onglet qui répond à « Qu'est-ce que ce chantier SAIT
 * aujourd'hui ? » (pas « que s'est-il passé ? »). En haut : LA recherche, porte
 * d'entrée de toute la connaissance accumulée. Dessous : des blocs de patrimoine.
 *
 * Règle d'or : CHAQUE bloc doit pouvoir être retiré sans casser la page (chacun se
 * masque s'il n'a rien à montrer). Aujourd'hui 5 blocs, demain 8, dans deux ans 15
 * — l'écran aura toujours été juste. Comptes réels, zéro donnée inventée.
 */

// « Fréquence » d'un sujet = nombre d'objets rattachés (déterministe, pas d'IA).
function subjectFreq(s: { openActions: number; lateActions: number; openReserves: number; decisions: number; documents: number }): number {
  return s.openActions + s.lateActions + s.openReserves + s.decisions + s.documents
}

const RESOURCE_META = {
  visit: { Icon: Footprints, cls: 'text-emerald-600', ring: 'bg-emerald-100 dark:bg-emerald-950/40', label: 'Dernier compte-rendu' },
  meeting: { Icon: Users, cls: 'text-sky-600', ring: 'bg-sky-100 dark:bg-sky-950/40', label: 'Dernière réunion' },
  intervention: { Icon: Wrench, cls: 'text-amber-600', ring: 'bg-amber-100 dark:bg-amber-950/40', label: 'Dernière intervention' },
} as const

export default async function SitePatrimoinePage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const supabase = createAdminClient()
  const { data: site } = await supabase.from('sites').select('id, name').eq('id', siteId).is('deleted_at', null).maybeSingle()
  if (!site) notFound()

  const [statusCells, patrimoine, subjects, activity] = await Promise.all([
    buildSiteStatusSummary(siteId).catch(() => []),
    buildSitePatrimoine(siteId).catch(() => null),
    listSubjectsBySite(siteId).catch(() => []),
    getSiteRecentActivity(siteId).catch(() => []),
  ])

  // Sujets, du plus fréquent au moins fréquent (déterministe).
  const subjectsByFreq = [...subjects].sort((a, b) => subjectFreq(b) - subjectFreq(a) || a.name.localeCompare(b.name))
  const suggestions = subjectsByFreq.slice(0, 8).map((s) => s.name)

  // Ce chantier apprend — n'a de sens que si le chantier a une histoire.
  const learns = patrimoine && (patrimoine.visits + patrimoine.meetings + patrimoine.photos + patrimoine.actions + patrimoine.reserves) > 0

  // Meilleures ressources — la dernière de chaque type (lien direct).
  const resources = (['visit', 'meeting', 'intervention'] as const)
    .map((k) => activity.find((a) => a.kind === k))
    .filter((a): a is NonNullable<typeof a> => !!a)

  return (
    <div className="max-w-md space-y-5 pb-16">
      <header className="space-y-2">
        <Link href={`/m/site/${siteId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {site.name}
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Patrimoine</h1>
          <p className="text-[13px] text-muted-foreground">Qu’est-ce que ce chantier sait aujourd’hui ?</p>
        </div>
        <SiteTabs siteId={siteId} active="patrimoine" userRole={user.role} />
      </header>

      {/* LA recherche — la porte d'entrée de toute la connaissance du chantier. */}
      <SitePatrimoineSearch siteId={siteId} suggestions={suggestions} />

      {/* ── Bloc : Le chantier aujourd'hui (état + prochaine échéance) ── */}
      {statusCells.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Le chantier aujourd’hui</SectionTitle>
          <SiteStatusCard cells={statusCells} />
        </section>
      )}

      {/* ── Bloc : Ce chantier apprend (patrimoine accumulé) ── */}
      {learns && patrimoine && (
        <section className="space-y-2">
          <SectionTitle>Ce chantier apprend</SectionTitle>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            {patrimoine.firstVisitLabel && (
              <p className="flex items-center gap-2 text-[13px] text-emerald-900/80 dark:text-emerald-200/80">
                <Brain className="h-4 w-4 shrink-0 text-emerald-600" /> Depuis la première visite ({patrimoine.firstVisitLabel})
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-3 text-center">
              <Stat n={patrimoine.photos} label={patrimoine.photos > 1 ? 'photos' : 'photo'} />
              <Stat n={patrimoine.visits} label={patrimoine.visits > 1 ? 'visites' : 'visite'} />
              <Stat n={patrimoine.meetings} label={patrimoine.meetings > 1 ? 'réunions' : 'réunion'} />
              <Stat n={patrimoine.actions} label={patrimoine.actions > 1 ? 'actions' : 'action'} />
              <Stat n={patrimoine.reserves} label={patrimoine.reserves > 1 ? 'réserves' : 'réserve'} />
              <Stat n={patrimoine.subjects} label={patrimoine.subjects > 1 ? 'sujets suivis' : 'sujet suivi'} />
            </div>
          </div>
        </section>
      )}

      {/* ── Bloc : Les sujets qui reviennent (fréquence, pas d'IA) ── */}
      {subjectsByFreq.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Les sujets qui reviennent</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {subjectsByFreq.slice(0, 12).map((s) => {
              const n = subjectFreq(s)
              return (
                <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[13px] font-medium">
                  {s.name}
                  {n > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{n}</span>}
                </span>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Bloc : Les meilleures ressources (dernière de chaque type) ── */}
      {resources.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Les meilleures ressources</SectionTitle>
          <ul className="space-y-2">
            {resources.map((r) => {
              const m = RESOURCE_META[r.kind]
              return (
                <li key={`${r.kind}-${r.reportId ?? r.href}`}>
                  <Link href={r.href} className="flex items-center gap-3 rounded-2xl border bg-background p-3 shadow-sm active:brightness-95">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${m.ring}`}>
                      <m.Icon className={`h-[18px] w-[18px] ${m.cls}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{m.label}</span>
                      <span className="block truncate text-[12px] text-muted-foreground first-letter:uppercase">{r.label} · {r.dateLabel}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Fondation vide : un chantier tout neuf n'a pas encore de patrimoine. */}
      {!learns && subjectsByFreq.length === 0 && resources.length === 0 && statusCells.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/30 px-4 py-8 text-center">
          <ListChecks className="h-6 w-6 text-muted-foreground/40" />
          <p className="text-sm font-medium">Le patrimoine se construit visite après visite</p>
          <p className="max-w-xs text-[13px] text-muted-foreground">Dès la première visite, tout ce que vous capturez viendra alimenter la mémoire de ce chantier.</p>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h2>
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums">{n}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
