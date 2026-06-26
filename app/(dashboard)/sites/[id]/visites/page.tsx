import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Camera, StickyNote, ClipboardCheck, ListTodo, ChevronRight, MapPin } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSiteVisitsWithCounts } from '@/lib/db/visits'

export const dynamic = 'force-dynamic'

const ORIGIN_LABEL: Record<string, string> = { planned: 'Planifiée', spontaneous: 'Spontanée', qr: 'QR', gps: 'GPS' }
const OUTCOME_LABEL: Record<string, { label: string; cls: string }> = {
  ras: { label: 'RAS', cls: 'bg-muted text-muted-foreground' },
  conforme: { label: 'Conforme', cls: 'bg-emerald-50 text-emerald-700' },
  conforme_reserves: { label: 'Conforme avec réserves', cls: 'bg-amber-50 text-amber-800' },
  non_conforme: { label: 'Non conforme', cls: 'bg-rose-50 text-rose-700' },
  a_revoir: { label: 'À revoir', cls: 'bg-amber-50 text-amber-800' },
  info: { label: 'Information', cls: 'bg-sky-50 text-sky-700' },
}

function durationLabel(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`
}

export default async function SiteVisitsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, visits] = await Promise.all([getSiteIdentity(id), listSiteVisitsWithCounts(id)])
  if (!identity) notFound()

  const fr = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{identity.name}</p>
        <h1 className="text-2xl font-bold">Visites terrain</h1>
        <p className="text-sm text-muted-foreground">
          Chaque visite capturée sur le terrain. Ouvrez-en une pour la débriefer.
        </p>
      </header>

      {visits.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Aucune visite pour l’instant. Une visite démarrée sur le mobile apparaîtra ici.
        </div>
      ) : (
        <ul className="space-y-2">
          {visits.map(({ visit, photos, notes, reserves, actions }) => {
            const outcome = visit.outcome ? OUTCOME_LABEL[visit.outcome] : null
            const dur = durationLabel(visit.started_at, visit.ended_at)
            return (
              <li key={visit.id}>
                <Link
                  href={`/sites/${id}/visites/${visit.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 transition hover:border-foreground/30"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{fr(visit.started_at ?? visit.created_at)}</span>
                      {dur && <span className="text-muted-foreground">· {dur}</span>}
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                        <MapPin className="h-3 w-3" />{ORIGIN_LABEL[visit.origin ?? ''] ?? 'Visite'}
                      </span>
                      {!visit.ended_at && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">En cours</span>
                      )}
                      {outcome && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${outcome.cls}`}>{outcome.label}</span>}
                    </div>
                    {visit.objective && <p className="truncate text-sm text-muted-foreground">{visit.objective}</p>}
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" />{photos}</span>
                      <span className="inline-flex items-center gap-1"><StickyNote className="h-3.5 w-3.5" />{notes}</span>
                      <span className="inline-flex items-center gap-1"><ClipboardCheck className="h-3.5 w-3.5" />{reserves}</span>
                      <span className="inline-flex items-center gap-1"><ListTodo className="h-3.5 w-3.5" />{actions}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
