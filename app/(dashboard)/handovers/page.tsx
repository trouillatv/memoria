// /handovers — Liste des passages de témoin.
//
// Vincent 2026-05-22 — Sprint Équipes C. Admin + manager (chef_equipe redirigé).
//
// Doctrine : la page liste des briefs. Pas de « top créateurs », pas de classement.
// On filtre par statut (À transmettre / Partagé / Reconnu / Archivé).

import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRightLeft,
  ChevronRight,
  FileText,
  CheckCircle2,
  Share2,
  Archive,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  listHandoverBriefs,
  countHandoverBriefsByStatus,
} from '@/lib/db/handover'
import type { HandoverStatus } from '@/types/db'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: HandoverStatus[] = ['draft', 'shared', 'acknowledged', 'archived']

const STATUS_LABEL: Record<HandoverStatus, string> = {
  draft: 'À transmettre',
  shared: 'Partagé',
  acknowledged: 'Reconnu',
  archived: 'Archivé',
}

const STATUS_ICON: Record<HandoverStatus, React.ComponentType<{ className?: string }>> = {
  draft: FileText,
  shared: Share2,
  acknowledged: CheckCircle2,
  archived: Archive,
}

const KIND_LABEL: Record<string, string> = {
  member_change: 'Changement d’équipe',
  team_takes_site: 'Prise de site',
  manual: 'Ad-hoc',
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default async function HandoversPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const me = await getCurrentUserWithProfile()
  if (!me) redirect('/login')
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/m')

  const { status: rawStatus } = await searchParams
  const filter: HandoverStatus =
    VALID_STATUSES.includes(rawStatus as HandoverStatus)
      ? (rawStatus as HandoverStatus)
      : 'draft'

  const [briefs, counts] = await Promise.all([
    listHandoverBriefs({ status: filter, limit: 200 }),
    countHandoverBriefsByStatus(),
  ])

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <ArrowRightLeft className="h-6 w-6 text-brand-600" />
          Passages de témoin
        </h1>
        <p className="text-sm text-muted-foreground">
          Briefs de continuité quand quelqu&apos;un bascule ou qu&apos;une équipe
          prend un nouveau site. Documente le site et la mémoire utile, jamais la
          personne.
        </p>
      </header>

      {/* Tabs */}
      <nav className="flex items-center gap-2 border-b" aria-label="Filtre par statut">
        {VALID_STATUSES.map((s) => {
          const Icon = STATUS_ICON[s]
          return (
            <Link
              key={s}
              href={`/handovers?status=${s}`}
              aria-current={filter === s ? 'page' : undefined}
              className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
                filter === s
                  ? 'border-brand-600 text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {STATUS_LABEL[s]}
              <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                ({counts[s]})
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Liste */}
      {briefs.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground italic">
          {filter === 'draft'
            ? 'Aucun brief à transmettre. Crée-en un depuis une fiche intervenant ou une fiche équipe.'
            : `Aucun brief ${STATUS_LABEL[filter].toLowerCase()}.`}
        </div>
      ) : (
        <ul className="space-y-2">
          {briefs.map((b) => {
            const Icon = STATUS_ICON[b.status as HandoverStatus]
            return (
              <li key={b.id}>
                <Link
                  href={`/handovers/${b.id}`}
                  className="block rounded-lg border bg-card p-4 hover:border-brand-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground inline-flex items-center gap-1">
                          <Icon className="h-3 w-3" />
                          {STATUS_LABEL[b.status as HandoverStatus]}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">
                          {KIND_LABEL[b.kind] ?? b.kind}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDateShort(b.created_at)}
                        </span>
                      </div>
                      <p className="text-sm font-medium mt-1 truncate">
                        {b.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {b.payload?.sites?.length ?? 0} site
                        {(b.payload?.sites?.length ?? 0) > 1 ? 's' : ''}
                        {b.shared_token && b.expires_at && (
                          <>
                            {' · Partagé '}
                            <span className="tabular-nums">
                              (expire le {fmtDateShort(b.expires_at)})
                            </span>
                            {' · '}
                            {b.access_count} consultation
                            {b.access_count > 1 ? 's' : ''}
                          </>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
