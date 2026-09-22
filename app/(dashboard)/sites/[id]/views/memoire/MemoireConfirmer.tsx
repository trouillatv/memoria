// ── « À CONFIRMER » — la file de décisions humaines (desktop) ────────────────
// Une INBOX, pas une page de lecture. Ordre : propositions (le centre) →
// recherche en SECOND plan → connaissances validées (rupture visuelle nette :
// au-dessus l'IA propose, ici l'humain a validé) → actions utiles regroupées.
// Le lien « Atelier complet » a été RETIRÉ d'ici (Vincent, 2026-07-20) : une inbox
// n'a qu'un travail — valider les propositions ; une sortie vers une autre page y
// concurrence l'action principale. Il n'a pas été déplacé dans « Pourquoi ? » (surface
// de lecture, qui a déjà sa sortie « Voir la chronologie complète »). L'atelier reste
// accessible par /sites/<id>/memoire — aucune capacité perdue.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { MemoryInbox } from '@/app/(field)/m/site/[siteId]/MemoryReviewPanel'
import { WhyButton } from '@/components/provenance/WhyButton'
import { PrepareSitePassationButton } from '../memory/PrepareSitePassationButton'
import { ArchiveKnowledgeEntryButton } from './ArchiveKnowledgeEntryButton'
import { CausalPanel } from './CausalPanel'
import type { MemoryReview, ConfirmedItem } from '@/lib/knowledge/memory-review'
import type { MemorySignal } from '@/lib/db/site-memory-signals'
import type { DbTeam } from '@/types/db'
import type { CausalThread } from '@/lib/knowledge/causal-threads-model'

// Point 17A — lecture principale = « quelques connaissances durables lisibles »,
// pas 381 cartes. On plafonne l'affichage d'emblée ; le reste vit derrière un
// <details> natif (aucun JS, composant serveur). Le geste « Marquer comme
// obsolète » reste disponible sur CHAQUE item, y compris repliés — la compaction
// ne doit jamais enterrer le cycle de vie.
const CAP = 6

// Libellés des thèmes d'ACTIVITÉ (non durables) — consignés mais hors mémoire
// durable. Déterministe, jamais un jugement dynamique.
const ACTIVITY_THEME_LABEL: Record<string, string> = {
  progress: 'Avancement constaté',
  forecast: 'Prévisions',
  weather: 'Météo / intempéries',
  test_control: 'Essais et contrôles',
}

function ConfirmedRow({ item, siteId, threads }: { item: ConfirmedItem; siteId: string; threads: CausalThread[] }) {
  const occurrenceSummary = formatOccurrenceSummary(item)
  // « Comprendre pourquoi » — n'apparaît que si un fil causal touche RÉELLEMENT
  // cet item (même href qu'un nœud du fil) : un bouton qui ne tient pas sa
  // promesse est pire qu'aucun bouton (doctrine WhyButton).
  const relatedThreads = item.href ? threads.filter((t) => t.steps.some((s) => s.node.href === item.href)) : []
  return (
    <li className="flex items-start gap-2 text-[13px] text-foreground/90">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
      <span className="min-w-0">
        {item.href ? (
          <Link href={item.href} scroll={false} className="font-medium hover:underline">{item.title}</Link>
        ) : (
          item.title
        )}
        {occurrenceSummary}
        {item.nature && <span className="ml-1.5 text-[11px] text-muted-foreground">· {item.nature}</span>}
        {item.group === 'Décisions' && (
          <span className="mt-0.5 block"><WhyButton objectType="decision" objectId={item.id} label="Voir l’origine" /></span>
        )}
        {item.knowledgeEntryId && (
          <span className="mt-0.5 block"><ArchiveKnowledgeEntryButton siteId={siteId} entryId={item.knowledgeEntryId} /></span>
        )}
        {relatedThreads.length > 0 && (
          <span className="mt-0.5 block">
            <CausalPanel threads={relatedThreads} siteId={siteId} title={item.title} triggerLabel="Comprendre pourquoi" />
          </span>
        )}
      </span>
    </li>
  )
}

/** Liste plafonnée : les CAP premiers d'emblée, le reste derrière un <details>.
 *  Rien n'est perdu, aucun geste enterré, jamais 381 cartes visibles d'emblée. */
function formatOccurrenceSummary(item: ConfirmedItem): ReactNode {
  const occurrences = item.sourceOccurrences
  if (!occurrences || occurrences.length === 0) return null
  const count = occurrences.length
  const countLabel = `${count} occurrence${count > 1 ? 's' : ''}`
  const shown = count > 3 ? occurrences.slice(-1) : occurrences
  const prefix = count > 3 ? `${countLabel} - derniere ` : `${countLabel} - `
  return (
    <span className="ml-1.5 text-[11px] text-muted-foreground/70">
      - {prefix}
      {shown.map((occ, index) => (
        <span key={occ.reportId}>
          {index > 0 && ' - '}
          {occ.href ? (
            <Link href={occ.href} className="hover:underline">{occ.label}</Link>
          ) : (
            occ.label
          )}
        </span>
      ))}
    </span>
  )
}

function CappedList({ items, siteId, threads }: { items: ConfirmedItem[]; siteId: string; threads: CausalThread[] }) {
  const head = items.slice(0, CAP)
  const rest = items.slice(CAP)
  return (
    <ul className="mt-1.5 space-y-1">
      {head.map((c) => <ConfirmedRow key={c.id} item={c} siteId={siteId} threads={threads} />)}
      {rest.length > 0 && (
        <li className="list-none">
          <details>
            <summary className="cursor-pointer list-none text-[12px] font-medium text-sky-700 hover:underline">
              + {rest.length} autre{rest.length > 1 ? 's' : ''}
            </summary>
            <ul className="mt-1 space-y-1">
              {rest.map((c) => <ConfirmedRow key={c.id} item={c} siteId={siteId} threads={threads} />)}
            </ul>
          </details>
        </li>
      )}
    </ul>
  )
}

export function MemoireConfirmer({
  siteId,
  siteName,
  review,
  signals,
  subjectsCount,
  teams,
  threads,
}: {
  siteId: string
  siteName: string
  review: MemoryReview
  signals: MemorySignal[]
  subjectsCount: number
  teams: DbTeam[]
  threads: CausalThread[]
}) {
  const suites = signals.reduce((n, s) => n + s.items.length, 0)
  // Point 17A — deux niveaux : mémoire DURABLE en lecture principale, faits
  // d'ACTIVITÉ (progress/forecast/weather/test) accessibles en second niveau.
  // Filtrage déterministe par `durable` (thematic_category), rien n'est supprimé.
  const durable = review.confirmed.filter((c) => c.durable)
  const activity = review.confirmed.filter((c) => !c.durable)
  const durableGroups = [...new Set(durable.map((c) => c.group))]
  const activityThemes = [...new Set(activity.map((c) => c.thematicCategory ?? 'autre'))]
  // La passation est toujours là ; les deux autres dépendent des données. Un
  // titre au-dessus d'un seul bouton fait croire à une section incomplète.
  const usefulCount = 1 + (subjectsCount > 0 ? 1 : 0) + (suites > 0 ? 1 : 0)

  return (
    <div className="space-y-5">
      {/* ── À VALIDER — n'existe QUE s'il y a quelque chose à décider (Vincent
           2026-09-22) : « (0) » ne doit jamais s'afficher, la section disparaît. ── */}
      {review.toReview.length > 0 && (
        <section>
          <div>
            <h2 className="text-[15px] font-semibold">À valider ({review.toReview.length})</h2>
            {/* Une phrase de DOCTRINE produit, pas une aide secondaire. */}
            <p className="mb-3 text-[13px] text-foreground/75">Ce que l’IA a relevé. Le bouton dit exactement ce que votre validation produira.</p>
          </div>
          <MemoryInbox siteId={siteId} items={review.toReview} withFilters />
        </section>
      )}

      {/* ── LES CONNAISSANCES VALIDÉES — mémoire DURABLE d'abord (point 17A) ── */}
      <section className="rounded-xl border bg-muted/30 p-4">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold">Connaissances validées</h2>
            <p className="text-[12.5px] text-muted-foreground">Ce que MemorIA sait durablement sur ce chantier.</p>
          </div>
          {threads.length > 0 && (
            <CausalPanel
              threads={threads}
              siteId={siteId}
              title="Liens entre connaissances"
              triggerLabel="Explorer les liens entre connaissances"
            />
          )}
        </div>
        {review.confirmed.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Rien de confirmé pour l’instant.</p>
        ) : (
          <div className="space-y-3">
            {durableGroups.map((g) => (
              <div key={g}>
                <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</h3>
                <CappedList items={durable.filter((c) => c.group === g)} siteId={siteId} threads={threads} />
              </div>
            ))}
            {durable.length === 0 && (
              <p className="text-[13px] text-muted-foreground">Aucune connaissance durable pour l’instant — voir l’activité consignée ci-dessous.</p>
            )}

            {/* ── SECOND NIVEAU — l'activité consignée du chantier (avancement,
                 prévisions, météo, essais). Consignée, jamais supprimée, mais hors
                 de la lecture durable. Repliée par défaut ; gestes préservés. ── */}
            {activity.length > 0 && (
              <details className="mt-1 border-t border-border/60 pt-3">
                <summary className="cursor-pointer list-none text-[12.5px] font-medium text-sky-700 hover:underline">
                  Voir toute l’activité consignée ({activity.length})
                </summary>
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  Avancement, prévisions, météo, essais : consignés sur ce chantier, mais hors de la mémoire durable.
                </p>
                <div className="mt-2 space-y-3">
                  {activityThemes.map((t) => (
                    <div key={t}>
                      <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {ACTIVITY_THEME_LABEL[t] ?? 'Autres'}
                      </h3>
                      <CappedList items={activity.filter((c) => (c.thematicCategory ?? 'autre') === t)} siteId={siteId} threads={threads} />
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* ── ACTIONS UTILES — le titre n'apparaît qu'à partir de deux gestes ── */}
      <section>
        {usefulCount > 1 && (
          <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Actions utiles</h2>
        )}
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <PrepareSitePassationButton siteId={siteId} siteName={siteName} teams={teams} />
          {subjectsCount > 0 && (
            <Link href={`/sites/${siteId}/subjects`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              Voir les dossiers vivants <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
          {suites > 0 && (
            <Link href={`/sites/${siteId}?tab=travail`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              Ouvrir le travail ({suites} suite{suites > 1 ? 's' : ''}) <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </section>
    </div>
  )
}
