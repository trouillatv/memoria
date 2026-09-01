import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteReserves, summarizeReserves, statusLabel, resolveReserveSourceLinks } from '@/lib/db/site-reserve'

export const dynamic = 'force-dynamic'

export default async function ReservesPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const [siteRow, reserves] = await Promise.all([
    supabase.from('sites').select('name').eq('id', siteId).is('deleted_at', null).maybeSingle()
      .then(({ data }) => data as { name: string } | null, () => null as null),
    getSiteReserves(siteId).catch(() => []),
  ])
  if (!siteRow) notFound()

  const summary = summarizeReserves(reserves)
  // Ouvertes d'abord (ce qui reste à traiter), puis levées — la fiche décrit
  // « qu'est-ce qu'il reste à lever ? » avant l'historique.
  const ordered = [...reserves].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    return (b.issuedOn ?? b.createdAt).localeCompare(a.issuedOn ?? a.createdAt)
  })
  // Objet → source (7A) : lien vers le PV/visite d'où la réserve est issue, quand
  // `report_id` est renseigné. Aucune réserve sans source démontrée n'affiche de lien.
  const sourceLinks = await resolveReserveSourceLinks(ordered, siteId)

  return (
    <div className="flex max-w-md flex-col gap-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
          Points à lever
        </h1>
        <p className="text-[13px] text-muted-foreground">
          {summary.open} ouvert{summary.open > 1 ? 's' : ''} · {summary.lifted} levé{summary.lifted > 1 ? 's' : ''}
        </p>
      </header>

      {ordered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
          <ClipboardCheck className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-[14px] font-medium text-muted-foreground">Aucune réserve sur ce chantier</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {ordered.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border bg-card shadow-sm px-3.5 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug">{r.label}</p>
                <span
                  className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    r.status === 'lifted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {statusLabel(r.status)}
                </span>
              </div>
              {r.location && (
                <p className="mt-0.5 text-xs text-muted-foreground">{r.location}</p>
              )}
              {r.issuedOn && (
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  Signalée le {new Date(r.issuedOn).toLocaleDateString('fr-FR')}
                </p>
              )}
              {(() => {
                const src = sourceLinks.get(r.id)
                if (!src) return null
                // Source précise si navigable ; sinon le libellé seul (jamais un faux lien).
                return src.mobileHref ? (
                  <Link
                    href={src.mobileHref}
                    className="mt-1 inline-block text-[11px] font-medium text-indigo-700 active:opacity-70 dark:text-indigo-400"
                  >
                    {src.line} →
                  </Link>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground/80">{src.line}</p>
                )
              })()}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
