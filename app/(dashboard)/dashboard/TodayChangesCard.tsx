import Link from 'next/link'
import { CalendarClock, Check, ChevronRight, HardHat, RefreshCw, Sparkles } from 'lucide-react'
import type { SiteChangedToday, TodayChanges } from '@/lib/knowledge/today-changes'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import { cn } from '@/lib/utils'

// ── « IL S'EST PASSÉ QUELQUE CHOSE AUJOURD'HUI » ─────────────────────────────
// L'accueil ne dit plus « 15 actions ouvertes » (une statistique, vraie hier comme
// aujourd'hui) mais « votre visite de 11:57 a produit ceci » (un événement). En
// ouvrant MemorIA, le conducteur doit comprendre en moins de 5 secondes ce que sa
// visite a produit — sans ouvrir un chantier, sans recharger.
//
// Silence total si rien n'a bougé : un accueil qui met en scène du vide use la
// confiance plus vite qu'un accueil vide.

const heureFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: NOUMEA_TZ, hour: '2-digit', minute: '2-digit' })

export function TodayChangesCard({ changes }: { changes: TodayChanges }) {
  if (changes.sites.length === 0) return null

  return (
    <section className="rounded-[18px] border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Aujourd&apos;hui
        </h2>
      </div>

      <div className="mt-3 space-y-4">
        {changes.sites.map((site) => (
          <SiteBlock key={site.siteId} site={site} />
        ))}
      </div>

      {changes.events.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <h3 className="text-[13px] font-medium text-muted-foreground">Dernières évolutions</h3>
          <ol className="mt-1.5 space-y-1">
            {changes.events.map((e) => (
              <li key={`${e.siteId}-${e.id}`} className="flex items-baseline gap-3 text-[13px]">
                <span className="shrink-0 tabular-nums text-muted-foreground">{heureFmt.format(new Date(e.at))}</span>
                <span className="min-w-0 text-foreground/90">{e.label}</span>
                {changes.sites.length > 1 && (
                  <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">{e.siteName}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}

function SiteBlock({ site }: { site: SiteChangedToday }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <HardHat className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Link href={`/sites/${site.siteId}`} className="text-base font-semibold hover:underline">
          {site.siteName}
        </Link>
        <SynthesisChip status={site.synthesisStatus} />
      </div>

      {/* Ce que la visite a FAIT APPARAÎTRE — des ajouts du jour, pas des stocks. */}
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
        {addedLabels(site.added).map((label) => (
          <li key={label} className="text-[13px] text-foreground/90">{label}</li>
        ))}
      </ul>

      {/* ── CE QUE LE CHANTIER ATTEND ──────────────────────────────────────
          L'accueil doit être ACTIONNABLE, pas un journal de ce qui s'est passé.
          Une échéance datée dit QUAND ; une échéance sans date dit qu'elle attend
          une décision — et sa contrainte dit pourquoi, avec les mots du débrief. */}
      {site.deadlines.length > 0 && (
        <div className="mt-2.5">
          <h3 className="text-[13px] font-medium text-muted-foreground">Échéances</h3>
          <ul className="mt-1 space-y-1">
            {site.deadlines.map((d) => (
              <li key={d.id} className="flex items-start gap-2 text-[13px]">
                <CalendarClock className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', d.toPlan ? 'text-amber-600' : 'text-sky-600')} />
                <span className="min-w-0 text-foreground/90">{d.title}</span>
                <span className={cn('ml-auto shrink-0 text-xs', d.toPlan ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
                  {d.when}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {site.todo.length > 0 && (
        <div className="mt-2.5">
          <h3 className="text-[13px] font-medium text-muted-foreground">À traiter</h3>
          <ul className="mt-1 space-y-1">
            {site.todo.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-[13px] text-foreground/90">
                <span className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-[3px] border border-muted-foreground/40" />
                <span className="min-w-0">{t.title}</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/sites/${site.siteId}`}
            className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
          >
            Voir le chantier <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  )
}

/** « +3 actions proposées » — ce qui est APPARU aujourd'hui. Un zéro se tait. */
function addedLabels(added: SiteChangedToday['added']): string[] {
  const out: string[] = []
  if (added.actions > 0) out.push(`+${added.actions} action${added.actions > 1 ? 's' : ''} proposée${added.actions > 1 ? 's' : ''}`)
  if (added.watchpoints > 0) out.push(`+${added.watchpoints} point${added.watchpoints > 1 ? 's' : ''} de vigilance`)
  if (added.deadlines > 0) out.push(`+${added.deadlines} échéance${added.deadlines > 1 ? 's' : ''}`)
  if (added.stakeholders > 0) out.push(`+${added.stakeholders} intervenant${added.stakeholders > 1 ? 's' : ''}`)
  if (added.knowledge > 0) out.push(`+${added.knowledge} information${added.knowledge > 1 ? 's' : ''} à savoir`)
  return out
}

/** Les mêmes mots que la fiche chantier — un état ne change pas de nom selon l'écran. */
function SynthesisChip({ status }: { status: SiteChangedToday['synthesisStatus'] }) {
  if (status === 'up_to_date') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
        <Check className="h-3.5 w-3.5" /> Synthèse à jour
      </span>
    )
  }
  if (status === 'outdated') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[12px] font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <RefreshCw className="h-3.5 w-3.5" /> Synthèse à mettre à jour
      </span>
    )
  }
  if (status === 'generating') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-[12px] font-medium text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
        <RefreshCw className="h-3.5 w-3.5" /> Synthèse en cours
      </span>
    )
  }
  return null
}
