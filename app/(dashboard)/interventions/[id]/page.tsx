import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar, MapPin } from 'lucide-react'
import { getIntervention, listChecklistItemsByIntervention } from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUS_LABELS: Record<string, string> = {
  planned:     'Planifiée',
  in_progress: 'En cours',
  completed:   'Terminée',
  validated:   'Validée',
  skipped:     'Annulée',
}

const STATUS_BADGES: Record<string, string> = {
  planned:     'bg-slate-50 border-slate-200 text-slate-700',
  in_progress: 'bg-sky-50 border-sky-200 text-sky-700',
  completed:   'bg-indigo-50 border-indigo-200 text-indigo-700',
  validated:   'bg-emerald-50 border-emerald-200 text-emerald-700',
  skipped:     'bg-muted border-border text-muted-foreground',
}

export default async function InterventionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const intervention = await getIntervention(id)
  if (!intervention) notFound()

  const [mission, checklistItems] = await Promise.all([
    getMission(intervention.mission_id),
    listChecklistItemsByIntervention(id),
  ])

  // Get site + contract for breadcrumb
  const supabase = createAdminClient()
  const { data: site } = mission
    ? await supabase.from('sites').select('id, name, contract_id').eq('id', mission.site_id).maybeSingle()
    : { data: null }

  const scheduledDate = new Date(intervention.scheduled_at)
  const dateLabel = scheduledDate.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  const timeLabel = scheduledDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-6 max-w-3xl">
      {site?.contract_id && (
        <Link href={`/contracts/${site.contract_id}/interventions`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Retour au contrat
        </Link>
      )}

      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{mission?.name ?? 'Intervention'}</h1>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium uppercase tracking-wider ${STATUS_BADGES[intervention.status] ?? STATUS_BADGES.planned}`}>
            {STATUS_LABELS[intervention.status] ?? intervention.status}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {dateLabel} · {timeLabel}
          </span>
          {site && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {site.name}
            </span>
          )}
        </div>
      </header>

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Checklist ({checklistItems.length})
        </h2>
        {checklistItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune tâche pour cette intervention.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {checklistItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2 p-2 rounded border bg-background">
                <span className={`inline-block w-4 h-4 rounded border mt-0.5 shrink-0 ${item.done ? 'bg-emerald-500 border-emerald-600' : 'bg-card border-border'}`} aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${item.done ? 'line-through text-muted-foreground' : ''}`}>
                    {item.label}
                    {item.required && <span className="ml-1 text-rose-500">*</span>}
                  </div>
                  {item.done && item.done_at && (
                    <div className="text-[10px] text-muted-foreground">
                      ✓ {new Date(item.done_at).toLocaleString('fr-FR')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground italic mt-2">
          Exécution + photos seront disponibles dans la slice 2.3 (à venir).
        </p>
      </section>

      {intervention.notes && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">Notes</h2>
          <p className="text-sm whitespace-pre-wrap">{intervention.notes}</p>
        </section>
      )}
    </div>
  )
}
