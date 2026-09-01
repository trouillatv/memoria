import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ChevronRight, Brain, Footprints, Users, Wrench, MapPin, Star, Gavel, ClipboardCheck,
} from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSiteStatusSummary, buildSitePatrimoine, getSiteRecentActivity, buildSiteImportantEvidence } from '@/lib/db/visits'
import { getMemoryReview } from '@/lib/knowledge/memory-review'
import { listSiteMapCaptures } from '@/lib/db/visit-captures'
import { listSubjectsBySite } from '@/lib/db/subjects'
import { SiteStatusCard } from '../../SiteStatusCard'
import { SitePatrimoineSearch } from '../../SitePatrimoineSearch'
import { MemoryReviewPanel } from '../../MemoryReviewPanel'
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
  await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase.from('sites').select('id, name').eq('id', siteId).is('deleted_at', null).maybeSingle()
  if (!site) notFound()

  const [statusCells, patrimoine, subjects, activity, mapCaptures, evidence, review, canonicalSubjects] = await Promise.all([
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
    (async (): Promise<Array<{ id: string; label: string }>> => {
      // « Sujets du chantier » = UNIQUEMENT les sujets métier (kind='business_subject').
      // Les intervenants (kind='actor') ont déjà leur place — « Ce que MemorIA sait »
      // (site_intervenants) et le Suivi « Intervenants » — et n'ont pas à reparaître
      // ici comme s'ils étaient des sujets. Sans ce filtre, le tri par created_at
      // faisait remonter les acteurs importés en tête (audit UX 2026-09-01).
      const { data } = await supabase
        .from('canonical_subject')
        .select('id, label')
        .eq('site_id', siteId)
        .eq('status', 'active')
        .eq('kind', 'business_subject')
        .order('created_at', { ascending: true })
        .limit(10)
      return (data ?? []) as Array<{ id: string; label: string }>
    })().catch(() => [] as Array<{ id: string; label: string }>),
  ])
  const hasEvidence = evidence.photos.length > 0 || evidence.decisions.length > 0

  // Sujets, du plus fréquent au moins fréquent (déterministe).
  const subjectsByFreq = [...subjects].sort((a, b) => subjectFreq(b) - subjectFreq(a) || a.name.localeCompare(b.name))
  const suggestions = subjectsByFreq.slice(0, 8).map((s) => s.name)

  // Ce chantier apprend — n'a de sens que si le chantier a une histoire (visites
  // terrain OU mémoire documentaire importée OU autres traces).
  const learns = patrimoine && (patrimoine.visits + patrimoine.importedDocs + patrimoine.meetings + patrimoine.photos + patrimoine.actions + patrimoine.reserves) > 0

  // Meilleures ressources — la dernière de chaque type (lien direct).
  const resources = (['visit', 'meeting', 'intervention'] as const)
    .map((k) => activity.find((a) => a.kind === k))
    .filter((a): a is NonNullable<typeof a> => !!a)

  return (
    <div className="max-w-md space-y-5 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Patrimoine</h1>
        <p className="text-[13px] text-muted-foreground">Qu'est-ce que ce chantier sait aujourd'hui ?</p>
      </header>

      {/* LA recherche — la porte d'entrée de toute la connaissance du chantier. */}
      <SitePatrimoineSearch siteId={siteId} suggestions={suggestions} />

      {/* ── CE QUE MEMORIA SAIT ────────────────────────────────────────────
          Le patrimoine répond à « qu'est-ce que ce chantier sait ? ».
          Les éléments confirmés sont affichés directement.
          Les propositions en attente sont regroupées dans une carte d'appel
          vers l'écran dédié — elles n'ont pas vocation à remplir cette vue. */}
      {review.confirmed.length > 0 && (
        <section className="space-y-3 rounded-2xl border bg-card p-4">
          <MemoryReviewPanel siteId={siteId} review={{ confirmed: review.confirmed, toReview: [] }} />
        </section>
      )}

      {/* Propositions en attente — carte compacte vers l'écran de validation. */}
      {review.toReview.length > 0 && (
        <Link
          href={`/m/site/${siteId}/patrimoine/examiner`}
          className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 shadow-sm active:brightness-95 dark:border-amber-900/40 dark:bg-amber-950/20"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40">
            <ClipboardCheck className="h-[18px] w-[18px] text-amber-700 dark:text-amber-400" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium text-amber-900 dark:text-amber-200">
              {review.toReview.length} proposition{review.toReview.length > 1 ? 's' : ''} à examiner
            </span>
            <span className="block text-[12px] text-amber-700/80 dark:text-amber-400/80">
              Propositions de MemorIA en attente de votre validation
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-amber-700/60" />
        </Link>
      )}

      {/* ── Bloc : Le chantier aujourd'hui (état + prochaine échéance) ── */}
      {statusCells.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Le chantier aujourd'hui</SectionTitle>
          <SiteStatusCard cells={statusCells} />
        </section>
      )}

      {/* ── Bloc : Ce chantier apprend (patrimoine accumulé) ── */}
      {learns && patrimoine && (
        <section className="space-y-2">
          <SectionTitle>Ce chantier apprend</SectionTitle>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            {/* P0.5-Vérité : la « première visite » est TERRAIN. Sans visite terrain,
                on parle de mémoire documentaire (PV/CR importés), datée par la vraie
                date métier du document — jamais la date technique d'import. */}
            {patrimoine.firstVisitLabel ? (
              <p className="flex items-center gap-2 text-[13px] text-emerald-900/80 dark:text-emerald-200/80">
                <Brain className="h-4 w-4 shrink-0 text-emerald-600" /> Depuis la première visite ({patrimoine.firstVisitLabel})
              </p>
            ) : patrimoine.importedDocs > 0 ? (
              // Date = premier DOCUMENT historique connu (documents.effective_date), pas
              // « le début du chantier » : « Mémoire documentée depuis <date> » ne sur-promet pas.
              <p className="flex items-center gap-2 text-[13px] text-emerald-900/80 dark:text-emerald-200/80">
                <Brain className="h-4 w-4 shrink-0 text-emerald-600" />
                Mémoire documentée{patrimoine.firstDocDateLabel ? ` depuis ${patrimoine.firstDocDateLabel}` : ''}
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-3 text-center">
              <Stat n={patrimoine.photos} label={patrimoine.photos > 1 ? 'photos' : 'photo'} />
              <Stat n={patrimoine.visits} label={patrimoine.visits > 1 ? 'visites terrain' : 'visite terrain'} />
              {patrimoine.importedDocs > 0 && (
                <Stat n={patrimoine.importedDocs} label={patrimoine.importedDocs > 1 ? 'PV/CR historiques' : 'PV/CR historique'} />
              )}
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

      {/* ── Bloc : Terrain (aperçu — la carte complète vit dans l'onglet Terrain) ── */}
      <section className="space-y-2">
        <SectionTitle>Terrain</SectionTitle>
        {mapCaptures.length > 0 ? (
          <Link href={`/m/site/${siteId}/terrain`} className="block overflow-hidden rounded-2xl border">
            <div className="pointer-events-none">
              <CaptureMap siteId={siteId} captures={mapCaptures} heightClass="h-40" linkPopups={false} />
            </div>
            <div className="flex items-center justify-between border-t bg-card px-4 py-2.5">
              <span className="text-[13px] text-muted-foreground">
                {mapCaptures.length} preuve{mapCaptures.length > 1 ? 's' : ''} géolocalisée{mapCaptures.length > 1 ? 's' : ''}
              </span>
              <span className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground">
                Ouvrir Terrain <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>
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

      {/* ── Bloc : Sujets du chantier (canonical_subject, business_subject seuls) ── */}
      {canonicalSubjects.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Sujets du chantier</SectionTitle>
          <ul className="space-y-1.5">
            {canonicalSubjects.map((cs) => (
              <li key={cs.id}>
                <Link
                  href={`/m/site/${siteId}/sujets/${cs.id}`}
                  className="flex items-center gap-3 rounded-2xl border bg-background px-3.5 py-3 shadow-sm active:brightness-95"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40">
                    <Brain className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{cs.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
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
