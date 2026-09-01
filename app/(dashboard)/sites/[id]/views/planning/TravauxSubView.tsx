import Link from 'next/link'
import { Flag, HardHat } from 'lucide-react'
import type { SitePlanningItem, PlanningItemSourceDocument } from '@/lib/db/site-planning-items'
import { SectionTitle, Empty, SourceExcerpt } from './PlanningUI'
import { TravauxWeeksBoard } from './TravauxWeeksBoard'
import { groupByWeek } from './travaux-week-grouping'
import { splitDatedTitle } from './dated-title'

interface TravauxSubViewProps {
  siteId: string
  /** Nombre d'échéances ACTIVES du chantier (déjà chargées à cette surface :
   *  même valeur que le badge de l'onglet Échéances). Aucun read-model neuf. */
  deadlinesCount: number
  items: SitePlanningItem[]
  sourceDocuments: Map<string, PlanningItemSourceDocument>
}

// Planification DOCUMENTAIRE, pas une todo-list : jamais de statut « À faire »
// ou « En retard » sans preuve opérationnelle correspondante. La semaine est
// le repère de lecture ; « Aujourd'hui » ne fait que situer, jamais juger.
export function TravauxSubView({ siteId, deadlinesCount, items, sourceDocuments }: TravauxSubViewProps) {
  const tasks = items.filter((i) => i.kind === 'task')
  const milestones = items.filter((i) => i.kind === 'milestone').sort((a, b) => (a.plannedStart ?? '').localeCompare(b.plannedStart ?? ''))

  // Point 16A — état vide HONNÊTE. Travaux répond d'abord « ai-je un planning
  // structuré ? » (non → on le dit), puis signale seulement qu'une AUTRE vérité
  // temporelle existe ailleurs : les échéances. On ne les affiche jamais ici
  // (elles ont leur surface) — on donne le compte et le lien. Aucune inférence
  // depuis les PV, aucun jalon fabriqué. Deux branches déterministes.
  if (items.length === 0) {
    return (
      <main className="space-y-4">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={HardHat} title="Travaux" detail="La planification documentaire du chantier." />
          <div className="mt-4">
            <Empty>
              {deadlinesCount > 0 ? (
                <>
                  <span className="block font-medium text-foreground">Aucun planning de travaux documenté</span>
                  <span className="mt-1 block">MemorIA ne dispose pas d’un planning de travaux structuré pour ce chantier.</span>
                  <span className="mt-1 block">
                    {deadlinesCount} échéance{deadlinesCount > 1 ? 's' : ''} {deadlinesCount > 1 ? 'sont' : 'est'} néanmoins connue{deadlinesCount > 1 ? 's' : ''}.
                  </span>
                  <Link
                    href={`/sites/${siteId}?tab=planning&plantab=echeances`}
                    className="mt-2 inline-block text-sm font-medium text-sky-700 underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    Voir les échéances →
                  </Link>
                </>
              ) : (
                <>
                  <span className="block font-medium text-foreground">Aucun planning documenté pour le moment</span>
                  <span className="mt-1 block">MemorIA ne dispose d’aucun planning de travaux structuré pour ce chantier.</span>
                  <span className="mt-1 block">Aucun jalon n’est déduit automatiquement des documents.</span>
                </>
              )}
            </Empty>
          </div>
        </section>
      </main>
    )
  }

  const dated = tasks.filter((t) => t.plannedStart)
  const undated = tasks.filter((t) => !t.plannedStart)
  const weeks = groupByWeek(dated)
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Noumea', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

  return (
    <main className="space-y-4">
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <SectionTitle icon={HardHat} title="Travaux" detail="La planification documentaire du chantier." />

        <TravauxWeeksBoard weeks={weeks} milestones={milestones} sourceDocuments={sourceDocuments} todayIso={todayIso} undated={undated} />
      </section>

      {milestones.length > 0 && (
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={Flag} title="Jalons" detail="Les étapes qui marquent le chantier." />
          <ul className="mt-4 space-y-4">
            {milestones.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rotate-45 bg-foreground" aria-hidden />
                <div className="min-w-0">
                  {item.plannedStart ? (
                    (() => {
                      const { title, date } = splitDatedTitle(item.title, item.plannedStart)
                      return (
                        <>
                          <p className="text-sm font-medium text-foreground">{title}</p>
                          <p className="text-sm text-muted-foreground tabular-nums">{date}</p>
                        </>
                      )
                    })()
                  ) : (
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                  )}
                  <SourceLine item={item} sourceDocuments={sourceDocuments} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function SourceLine({ item, sourceDocuments }: { item: SitePlanningItem; sourceDocuments: Map<string, PlanningItemSourceDocument> }) {
  const doc = item.sourceProposalId ? sourceDocuments.get(item.sourceProposalId) : undefined
  if (!doc) return null
  return (
    <div className="mt-1">
      <SourceExcerpt documentId={doc.documentId} filename={doc.filename} excerpt={doc.sourceExcerpt} />
    </div>
  )
}
