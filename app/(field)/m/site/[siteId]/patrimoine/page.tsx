import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, ChevronRight, Brain, Footprints, Users, Wrench, MapPin, Star, Gavel,
} from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSiteStatusSummary, buildSitePatrimoine, getSiteRecentActivity, buildSiteImportantEvidence } from '@/lib/db/visits'
import { getMemoryReview } from '@/lib/knowledge/memory-review'
import { listSiteMapCaptures } from '@/lib/db/visit-captures'
import { listSubjectsBySite } from '@/lib/db/subjects'
import { SiteTabs } from '../SiteTabs'
import { SiteStatusCard } from '../SiteStatusCard'
import { SitePatrimoineSearch } from '../SitePatrimoineSearch'
import { MemoryReviewPanel } from '../MemoryReviewPanel'
import { CaptureMap } from '@/components/CaptureMap'

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
  // Un chantier d'une autre organisation doit être indiscernable d'un chantier
  // inexistant : la garde rend 404, jamais « accès refusé ».
  const { user } = await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase.from('sites').select('id, name').eq('id', siteId).is('deleted_at', null).maybeSingle()
  if (!site) notFound()

  const [statusCells, patrimoine, subjects, activity, mapCaptures, evidence, review] = await Promise.all([
    buildSiteStatusSummary(siteId).catch(() => []),
    buildSitePatrimoine(siteId).catch(() => null),
    listSubjectsBySite(siteId).catch(() => []),
    getSiteRecentActivity(siteId).catch(() => []),
    listSiteMapCaptures(siteId).catch(() => []),
    buildSiteImportantEvidence(siteId).catch(() => ({ photos: [], decisions: [] })),
    // La mémoire du chantier vient du MÊME read model que la fiche : un fait su
    // ne peut pas être vrai ici et faux là.
    // Ce qu'on peut CONFIRMER — chaque élément porte déjà son geste et sa
    // provenance : l'écran ne décide d'aucun bouton.
    getMemoryReview(siteId).catch(() => ({ confirmed: [], toReview: [] })),
  ])
  const hasEvidence = evidence.photos.length > 0 || evidence.decisions.length > 0

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

      {/* ── CE QUE MEMORIA SAIT ────────────────────────────────────────────
          Cet écran demandait « qu'est-ce que ce chantier sait aujourd'hui ? » et
          ne savait pas y répondre : il lisait tout SAUF la connaissance. La
          mémoire ne commence pas à la troisième visite, elle commence à la
          PREMIÈRE — dès qu'un fait durable est su, il est su.
          Les échéances ne sont PAS ici : elles répondent à « quand agir ? », donc
          au Planning. Le même objet à deux endroits sous deux noms, c'est le
          conducteur qui ne sait plus lequel fait foi. */}
      {(review.confirmed.length + review.toReview.length) > 0 && (
        <section className="space-y-3 rounded-2xl border bg-card p-4">
          {/* La Mémoire ne se contente plus de MONTRER : on peut agir. Elle était
              vide en « confirmées » parce que personne ne pouvait confirmer — 4
              types sur 6 levaient « promotion non supportée ». Le cycle est
              complet ; l'écran est la moitié visible.
              Les actions et les échéances ne sont PAS ici : leur contexte naturel
              est le Travail et le Planning. La Mémoire n'est pas un centre de
              validation universel. */}
          <MemoryReviewPanel siteId={siteId} review={review} />

          {/* « Habitudes observées » : une ligne, pas une carte. Une habitude se
              constate sur plusieurs visites — l'annoncer avant serait inventer une
              régularité qui n'existe pas. */}
          <p className="border-t pt-2 text-[12px] text-muted-foreground">
            Aucune habitude détectée pour l’instant. Elles apparaîtront après plusieurs visites.
          </p>
        </section>
      )}

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

      {/* ── Bloc : Preuves importantes (⭐ photos + décisions, ouvre la source) ── */}
      {hasEvidence && (
        <section className="space-y-2">
          <SectionTitle>Les preuves importantes</SectionTitle>
          {evidence.photos.length > 0 && (
            <div className="rounded-2xl border bg-background p-3.5 shadow-sm">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Star className="h-[18px] w-[18px] shrink-0 fill-amber-400 text-amber-400" /> Photos favorites
              </p>
              <div className="grid grid-cols-4 gap-2">
                {evidence.photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="relative aspect-square overflow-hidden rounded-lg border bg-muted active:brightness-95">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
          {evidence.decisions.length > 0 && (
            <div className="rounded-2xl border bg-background p-3.5 shadow-sm">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Gavel className="h-[18px] w-[18px] shrink-0 text-indigo-600" /> Décisions
              </p>
              <ul className="space-y-1.5">
                {evidence.decisions.map((d) => {
                  const row = (
                    <span className="flex items-start gap-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-indigo-500" />
                      <span className="min-w-0 flex-1">{d.titre}</span>
                      {d.href && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    </span>
                  )
                  return (
                    <li key={d.id} className="text-[13px] leading-snug">
                      {d.href ? <Link href={d.href} className="block active:opacity-70">{row}</Link> : row}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── Bloc : Carte mémoire (TOUTES les observations géolocalisées) ── */}
      <section className="space-y-2">
        <SectionTitle>Carte mémoire</SectionTitle>
        {mapCaptures.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border">
            <CaptureMap siteId={siteId} captures={mapCaptures} heightClass="h-72" />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-6 text-center">
            <MapPin className="mx-auto h-6 w-6 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">Aucune observation géolocalisée</p>
            <p className="mx-auto mt-1 max-w-xs text-[13px] text-muted-foreground">
              Activez la localisation des observations pendant vos visites pour voir tout le chantier se dessiner ici.
            </p>
          </div>
        )}
      </section>

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
