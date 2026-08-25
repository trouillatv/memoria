import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ListTodo } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { readSiteActionSummaries, groupActionsByThread } from '@/lib/knowledge/repository'
import { todayLocalIso } from '@/lib/time/local-date'
import { SiteTabs } from '../SiteTabs'

export const dynamic = 'force-dynamic'

export default async function ActionsPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const { user } = await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const [siteRow, actionRows] = await Promise.all([
    supabase.from('sites').select('name').eq('id', siteId).is('deleted_at', null).maybeSingle()
      .then(({ data }) => data as { name: string } | null, () => null as null),
    readSiteActionSummaries(siteId).catch(() => []),
  ])
  if (!siteRow) notFound()

  const today = todayLocalIso()
  const rawOpen = actionRows.filter((a) => a.status === 'open' || a.status === 'planned')
  const groups = groupActionsByThread(rawOpen)
    .sort((a, b) => (a.representative.due_date ?? '9999').localeCompare(b.representative.due_date ?? '9999'))

  return (
    <div className="flex max-w-md flex-col gap-4 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {siteRow.name}
        </Link>

        <div>
          <h1 className="text-xl font-semibold inline-flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-muted-foreground" />
            Sujets d&apos;action
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {groups.length} ouvert{groups.length > 1 ? 's' : ''}
          </p>
        </div>

        <SiteTabs siteId={siteId} active="actions" userRole={user.role} />
      </header>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
          <ListTodo className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-[14px] font-medium text-muted-foreground">Aucun sujet d&apos;action ouvert sur ce chantier</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => {
            const rep = g.representative
            const isLate = Boolean(rep.due_date && rep.due_date < today)
            return (
              <li
                key={rep.id}
                className="rounded-xl border bg-card shadow-sm px-3.5 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug">{rep.title}</p>
                  {rep.due_date && (
                    <span
                      className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        isLate ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {new Date(rep.due_date).toLocaleDateString('fr-FR')}
                    </span>
                  )}
                </div>
                {rep.corps_etat && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{rep.corps_etat}</p>
                )}
                {rep.assigned_to && (
                  <p className="mt-1 text-[11px] text-muted-foreground/80">Responsable : {rep.assigned_to}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
