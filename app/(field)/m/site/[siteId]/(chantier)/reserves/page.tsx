import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteReserves, statusLabel, resolveReserveSourceLinks } from '@/lib/db/site-reserve'
import { getSiteReservesPilotage } from '@/lib/knowledge/reserves-pilotage'

export const dynamic = 'force-dynamic'

// V1-3 — MÊME projection durable que le desktop (getSiteReservesPilotage) : hiérarchie SUJET →
// réserve durable → occurrences. Plus de liste plate. AUCUN état durable réserve affiché (pas de
// lifecycle) : le statut BRUT reste au niveau occurrence.
export default async function ReservesPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const [siteRow, reserves, pilotage] = await Promise.all([
    supabase.from('sites').select('name').eq('id', siteId).is('deleted_at', null).maybeSingle()
      .then(({ data }) => data as { name: string } | null, () => null as null),
    getSiteReserves(siteId).catch(() => []),
    getSiteReservesPilotage(siteId).catch(() => ({ kpi: { subjectsWithReserves: 0, durableReserves: 0, occurrences: 0 }, subjects: [] })),
  ])
  if (!siteRow) notFound()

  const byId = new Map(reserves.map((r) => [r.id, r]))
  const sourceLinks = await resolveReserveSourceLinks(reserves, siteId)

  return (
    <div className="flex max-w-md flex-col gap-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
          Réserves à piloter
        </h1>
        <p className="text-[13px] text-muted-foreground">
          {pilotage.kpi.durableReserves} réserve{pilotage.kpi.durableReserves > 1 ? 's' : ''} suivie{pilotage.kpi.durableReserves > 1 ? 's' : ''} · {pilotage.kpi.occurrences} occurrence{pilotage.kpi.occurrences > 1 ? 's' : ''} documentaire{pilotage.kpi.occurrences > 1 ? 's' : ''}
        </p>
      </header>

      {pilotage.subjects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
          <ClipboardCheck className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-[14px] font-medium text-muted-foreground">Aucune réserve sur ce chantier</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {pilotage.subjects.map((s) => (
            <li key={s.canonicalSubjectId} className="rounded-xl border bg-card shadow-sm">
              <div className="border-b px-3.5 py-2">
                <p className="text-sm font-semibold leading-snug">{s.label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {s.occurrenceCount} occurrence{s.occurrenceCount > 1 ? 's' : ''}{s.pvCount > 0 ? ` · ${s.pvCount} PV` : ''}
                </p>
              </div>
              <ul className="divide-y">
                {s.reserves.flatMap((r) => r.occurrenceIds).map((occId) => {
                  const r = byId.get(occId)
                  if (!r) return null
                  const src = sourceLinks.get(r.id)
                  return (
                    <li key={r.id} className="px-3.5 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] leading-snug">{r.label}</p>
                        <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${r.status === 'lifted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                          {statusLabel(r.status)}
                        </span>
                      </div>
                      {r.location && <p className="mt-0.5 text-xs text-muted-foreground">{r.location}</p>}
                      {r.issuedOn && <p className="mt-1 text-[11px] text-muted-foreground/80">Signalée le {new Date(r.issuedOn).toLocaleDateString('fr-FR')}</p>}
                      {src && (src.mobileHref
                        ? <Link href={src.mobileHref} className="mt-1 inline-block text-[11px] font-medium text-indigo-700 active:opacity-70 dark:text-indigo-400">{src.line} →</Link>
                        : <p className="mt-1 text-[11px] text-muted-foreground/80">{src.line}</p>)}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
