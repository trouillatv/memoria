import { listSiteDeadlines } from '@/lib/db/site-deadlines'
import { getDeadlineFieldEvidenceBatch, type DeadlineFieldEvidence } from '@/lib/db/deadline-field-evidence'
import { echeanceDateLabel } from '@/lib/visits/echeance-labels'

// Comparaison de date « aujourd'hui » en heure Nouméa (UTC+11).
function todayNoumea(): string {
  return new Date(Date.now() + 11 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function EvidenceTag({ evidence }: { evidence: DeadlineFieldEvidence }) {
  switch (evidence.classification) {
    case 'FIELD_COMPLETION_EVIDENCE':
      return (
        <p className="text-[11px] leading-tight text-emerald-700 dark:text-emerald-400">
          ✓ Réalisation constatée
          {evidence.lastEvidenceDate ? ` le ${echeanceDateLabel(evidence.lastEvidenceDate)}` : ''}
          {evidence.validationStatus !== 'confirmed' ? ' — à confirmer' : ''}
        </p>
      )
    case 'FIELD_PROGRESS_OBSERVED':
      return (
        <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400">
          ↻ Activité terrain
          {evidence.lastEvidenceDate ? ` le ${echeanceDateLabel(evidence.lastEvidenceDate)}` : ''}
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
          Aucune observation récente
          {evidence.lastEvidenceDate
            ? ` (dernière : ${echeanceDateLabel(evidence.lastEvidenceDate)})`
            : ''}
        </p>
      )
  }
}

export async function OverdueDeadlinesSection({ siteId }: { siteId: string }) {
  const today = todayNoumea()
  const deadlines = await listSiteDeadlines(siteId).catch(() => [])

  // Seules les datées, dépassées, avec un sujet canonique connu.
  const overdue = deadlines.filter(
    (d) => d.status === 'planned' && d.due_date && d.due_date < today && !!d.canonical_subject_id,
  )
  if (overdue.length === 0) return null

  const linked = overdue.map((d) => ({
    id: d.id,
    canonical_subject_id: d.canonical_subject_id!,
    due_date: d.due_date!,
  }))
  const evidenceMap = await getDeadlineFieldEvidenceBatch(linked).catch(() => new Map<string, DeadlineFieldEvidence>())

  // 11A'' — plafond de densité : on montre au plus 5 échéances dépassées, dans
  // l'ordre EXISTANT (slice, aucun retri). Le total reste au titre. Il n'existe
  // pas de surface mobile « liste des échéances du chantier » → conformément à
  // « ne pas inventer de route », le dépassement est un indicateur de compte (pas
  // un faux lien). À réévaluer si une surface échéances mobile est créée.
  const MAX = 5
  const shown = overdue.slice(0, MAX)
  const rest = overdue.length - shown.length

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-400">
        Échéances dépassées ({overdue.length})
      </p>
      <ul className="space-y-2.5">
        {shown.map((d) => {
          const evidence = evidenceMap.get(d.id)
          return (
            <li key={d.id} className="space-y-0.5">
              <p className="text-[13px] font-medium leading-tight text-foreground">{d.title}</p>
              <p className="text-[11px] text-muted-foreground">
                Prévu le {echeanceDateLabel(d.due_date!)}
              </p>
              {evidence && <EvidenceTag evidence={evidence} />}
            </li>
          )
        })}
      </ul>
      {rest > 0 && (
        <p className="text-[11px] text-amber-800/80 dark:text-amber-400/80">
          +{rest} autre{rest > 1 ? 's' : ''} échéance{rest > 1 ? 's' : ''} dépassée{rest > 1 ? 's' : ''}
        </p>
      )}
    </section>
  )
}
