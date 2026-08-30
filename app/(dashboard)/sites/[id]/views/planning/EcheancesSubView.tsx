import { CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CANCEL_REASON_LABEL, type SiteDeadline, type SiteDeadlineHistory } from '@/lib/db/site-deadlines'
import { type DeadlineFieldEvidence } from '@/lib/db/deadline-field-evidence'
import type { DbKnowledgeProposal } from '@/lib/db/knowledge-proposals'
import { WhyButton } from '@/components/provenance/WhyButton'
import { DeadlineActions } from './DeadlineActions'
import { DeadlineHistoryItem } from './DeadlineHistoryItem'
import { MaskedProposals } from './MaskedProposals'
import { echeanceDateLabel } from '@/lib/visits/echeance-labels'
import { SectionTitle, Empty } from './PlanningUI'

interface EcheancesSubViewProps {
  siteId: string
  /** Les échéances ACTIVES du chantier : datées ET à planifier. */
  deadlines: SiteDeadline[]
  /** Échéances sorties du planning actif (réalisées / annulées / remplacées). */
  deadlineHistory?: SiteDeadlineHistory[]
  /** Propositions masquées par le filtre de suppression — « Masquées — à vérifier ». */
  maskedProposals?: DbKnowledgeProposal[]
  /** Confrontation échéances ↔ terrain. Clé = deadline id. Lecture seule, pas de mutation de statut. */
  deadlineEvidence?: Map<string, DeadlineFieldEvidence>
}

// « date passée de N jours » est un calcul temporel déterministe (aujourd'hui
// - échéance), jamais une conclusion métier — contrairement à « En retard »
// qu'il remplace ici : un fait, pas un jugement.
function relativeDayLabel(dueIso: string, todayIso: string): string {
  const due = Date.parse(`${dueIso}T00:00:00Z`)
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  const diffDays = Math.round((due - today) / 86_400_000)
  if (diffDays === 0) return "aujourd'hui"
  if (diffDays > 0) return `dans ${diffDays} jour${diffDays > 1 ? 's' : ''}`
  const passed = Math.abs(diffDays)
  return `date passée de ${passed} jour${passed > 1 ? 's' : ''}`
}

// Planning = prévu / Échéance = dû (doctrine cycle de vie de l'information).
// Ce sous-onglet lit exclusivement site_deadlines — jamais site_planning_items.
export function EcheancesSubView({ siteId, deadlines, deadlineHistory, maskedProposals, deadlineEvidence }: EcheancesSubViewProps) {
  // Une échéance sans date n'est pas incomplète : elle attend une décision. Elle a
  // donc sa place à elle — pas une ligne grise en bas d'un calendrier.
  const toPlan = deadlines.filter((d) => !d.due_date)
  const dated = deadlines.filter((d) => d.due_date)
  const history = deadlineHistory ?? []
  // « En retard » est un état CALCULÉ (planned + date dépassée), jamais un statut
  // stocké : une échéance encore due ne disparaît pas parce que sa date est passée.
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Noumea', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  // Autres échéances actives — proposées comme « remplacement » lors d'une annulation.
  const replacementOptions = deadlines.map((d) => ({ id: d.id, title: d.title }))

  if (deadlines.length === 0 && history.length === 0 && (!maskedProposals || maskedProposals.length === 0)) {
    return (
      <main className="space-y-4">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={CalendarClock} title="Échéances" detail="Ce qui doit arriver, et quand on le sait." />
          <div className="mt-4"><Empty>Aucune échéance documentée pour ce chantier.</Empty></div>
        </section>
      </main>
    )
  }

  return (
    <main className="space-y-4">
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <SectionTitle icon={CalendarClock} title="Échéances" detail="Ce qui doit arriver, et quand on le sait." />

        {toPlan.length > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              À planifier ({toPlan.length})
            </h3>
            <ul className="mt-2 space-y-2">
              {toPlan.map((d) => (
                <li key={d.id}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-medium text-foreground">{d.title}</p>
                    <DeadlineActions deadlineId={d.id} hasDate={false} currentDueDate={null} otherDeadlines={replacementOptions.filter((o) => o.id !== d.id)} />
                  </div>
                  {/* La contrainte, avec les mots du débrief : elle dit POURQUOI
                      cette échéance attend, et personne n'a inventé de date. */}
                  {d.constraint_text && (
                    <p className="text-[12px] text-muted-foreground">{d.constraint_text}</p>
                  )}
                  {/* Le raccourci transversal du moteur d'explication : la
                      chaîne remontée jusqu'au mémo qui a dicté cette échéance.
                      Rendu seulement quand la provenance existe. */}
                  {d.report_id && (
                    <div className="mt-1">
                      <WhyButton objectType="deadline" objectId={d.id} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {dated.length > 0 && (
          <ul className="mt-4 space-y-2">
            {dated.map((d) => {
              const overdue = d.due_date! < todayIso
              const evidence = overdue ? deadlineEvidence?.get(d.id) : undefined
              return (
                <li key={d.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-sm text-foreground">{d.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cn('text-xs font-medium tabular-nums', overdue ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground')}>
                        {echeanceDateLabel(d.due_date!)} · {relativeDayLabel(d.due_date!, todayIso)}
                      </span>
                      <DeadlineActions deadlineId={d.id} hasDate currentDueDate={d.due_date} otherDeadlines={replacementOptions.filter((o) => o.id !== d.id)} />
                    </span>
                  </div>
                  {d.report_id && (
                    <div className="mt-0.5">
                      <WhyButton objectType="deadline" objectId={d.id} />
                    </div>
                  )}
                  {evidence && (
                    <div className="mt-0.5">
                      <DeadlineEvidenceTag evidence={evidence} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {dated.length === 0 && toPlan.length === 0 && (
          <div className="mt-4"><Empty>Aucune échéance active — voir l'historique ci-dessous.</Empty></div>
        )}

        {/* HISTORIQUE — réalisées / annulées / remplacées : hors du planning
            actif, mais conservées pour la traçabilité (le « Pourquoi ? » y dit
            qui a annulé, quand et pourquoi). */}
        {history.length > 0 && <DeadlineHistory items={history} siteId={siteId} />}
        {maskedProposals && maskedProposals.length > 0 && <MaskedProposals items={maskedProposals} />}
      </section>
    </main>
  )
}

const evidenceDateFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' })
function fmtEvidenceDate(iso: string) {
  return evidenceDateFmt.format(new Date(iso + 'T00:00:00Z'))
}

/**
 * Tag de confrontation terrain pour une échéance en retard avec identité canonique.
 *
 * Sémantique stricte :
 * - OVERDUE_WITHOUT_PROGRESS_EVIDENCE / NO_POST_DUE_EVIDENCE = MemorIA ne sait pas, pas «rien n'a été fait»
 * - FIELD_COMPLETION_EVIDENCE = signal terrain, pas une clôture automatique
 */
function DeadlineEvidenceTag({ evidence }: { evidence: DeadlineFieldEvidence }) {
  switch (evidence.classification) {
    case 'FIELD_COMPLETION_EVIDENCE':
      return (
        <p className="text-[11px] leading-tight text-emerald-700 dark:text-emerald-400">
          ✓ Réalisation constatée{evidence.lastEvidenceDate ? ` le ${fmtEvidenceDate(evidence.lastEvidenceDate)}` : ''}
          {evidence.validationStatus !== 'confirmed' && ' — à confirmer'}
        </p>
      )
    case 'FIELD_PROGRESS_OBSERVED':
      return (
        <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400">
          ↻ Activité terrain{evidence.lastEvidenceDate ? ` le ${fmtEvidenceDate(evidence.lastEvidenceDate)}` : ''}
        </p>
      )
    case 'OVERDUE_WITHOUT_PROGRESS_EVIDENCE':
      return (
        <p className="text-[11px] leading-tight text-muted-foreground">
          Aucune progression documentée depuis l'échéance
        </p>
      )
    case 'NO_POST_DUE_EVIDENCE':
      return (
        <p className="text-[11px] leading-tight text-muted-foreground">
          Aucune observation récente{evidence.lastEvidenceDate ? ` (dernière : ${fmtEvidenceDate(evidence.lastEvidenceDate)})` : ''}
        </p>
      )
  }
}

/** Historique des échéances (repliable) : réalisées / annulées / remplacées.
 *  Une ligne compacte par élément ; le détail n'apparaît qu'au clic sur
 *  « Pourquoi ? » (voir DeadlineHistoryItem) — pas de double affichage. */
function DeadlineHistory({ items, siteId }: { items: SiteDeadlineHistory[]; siteId: string }) {
  return (
    <details className="mt-4 rounded-2xl border bg-muted/10">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-semibold text-muted-foreground marker:content-none">
        Historique ({items.length}) — réalisées, annulées, remplacées
      </summary>
      <ul className="space-y-3 px-4 pb-4 pt-2">
        {items.map((d) => (
          <DeadlineHistoryItem
            key={d.id}
            item={d}
            siteId={siteId}
            reasonLabel={d.status === 'cancelled' && d.cancel_reason ? CANCEL_REASON_LABEL[d.cancel_reason] : null}
          />
        ))}
      </ul>
    </details>
  )
}
