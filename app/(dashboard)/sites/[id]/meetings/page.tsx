import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Mic, Building2, MapPin, ListTodo, AlertTriangle, FileCheck2, FileText, Users } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listMeetings, type MeetingListRow } from '@/lib/db/site-reports'
import { EmptyState } from '@/components/ui/empty-state'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SiteChantierNav } from '../SiteChantierNav'
import { SiteReportLauncher } from '@/app/(field)/m/site/[siteId]/SiteReportLauncher'
import type { SiteReportStatus } from '@/types/db'

export const dynamic = 'force-dynamic'

// Statut métier affiché sur l'onglet chantier — vocabulaire orienté action,
// distinct des libellés du cockpit global /meetings (mandat Vincent 2026-10-02).
export function statusLabel(s: SiteReportStatus): { label: string; cls: string } {
  switch (s) {
    case 'proposed':
      return { label: 'À valider', cls: 'bg-amber-100 text-amber-800' }
    case 'curated':
    case 'archived':
      return { label: 'Finalisée', cls: 'bg-emerald-100 text-emerald-700' }
    case 'failed':
      return { label: "Échec d'analyse", cls: 'bg-red-100 text-red-700' }
    default: // draft | transcribing | ready | analyzing
      return { label: 'En préparation / À analyser', cls: 'bg-muted text-muted-foreground' }
  }
}

function meetingHeading(m: MeetingListRow): string {
  if (m.title) return m.title
  return m.type === 'contract'
    ? `Réunion contrat${m.contractName ? ` — ${m.contractName}` : ''}`
    : 'Réunion de chantier'
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function SiteMeetingsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, meetings] = await Promise.all([
    getSiteIdentity(id),
    listMeetings({ siteId: id }),
  ])
  if (!identity) notFound()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-1 pb-10">
      <DynamicCrumb segmentId={id} label={identity.name} />
      <DynamicCrumb segmentId="meetings" label="Réunions" />
      {identity.clientName && (
        <BreadcrumbPrefix crumbs={[
          { href: '/sites', label: 'Chantiers' },
          { href: '/sites', label: identity.clientName },
        ]} />
      )}

      <SiteChantierNav siteId={id} siteName={identity.name} clientName={identity.clientName} activeTab="meetings" />

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <Mic className="h-6 w-6 text-muted-foreground" /> Réunions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Les comptes-rendus de réunion de ce chantier — captés ici ou routés depuis une réunion de contrat.
          </p>
        </div>
        {meetings.length > 0 && (
          <SiteReportLauncher siteId={id} siteName={identity.name} variant="desktop" label="+ Nouvelle réunion" />
        )}
      </header>

      {meetings.length === 0 ? (
        <EmptyState
          icon={Mic}
          title="Aucune réunion enregistrée pour ce chantier."
          primaryAction={
            <SiteReportLauncher siteId={id} siteName={identity.name} variant="desktop" label="Créer une réunion" />
          }
        />
      ) : (
        <ul className="space-y-2">
          {meetings.map((m) => (
            <SiteMeetingRow key={m.id} m={m} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SiteMeetingRow({ m }: { m: MeetingListRow }) {
  const st = statusLabel(m.status)
  const isContract = m.type === 'contract'

  return (
    <li>
      <Link
        href={`/meetings/${m.id}`}
        className="block rounded-lg border bg-card p-3.5 hover:border-foreground/30 hover:bg-muted/20 transition-colors active:scale-[0.997]"
      >
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isContract ? 'bg-violet-50 text-violet-600' : 'bg-sky-50 text-sky-600'}`}>
            {isContract ? <Building2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold truncate">{meetingHeading(m)}</span>
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>
                {st.label}
              </span>
              {m.hasFinalVersion && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                  <FileCheck2 className="h-3 w-3" /> PV final
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground flex-wrap">
              <span className="capitalize">{formatDateTime(m.createdAt)}</span>
              {m.participantsCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />{m.participantsCount} participant{m.participantsCount > 1 ? 's' : ''}
                </span>
              )}
              {m.decisionCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" />{m.decisionCount} décision{m.decisionCount > 1 ? 's' : ''}
                </span>
              )}
              {m.openActionCount > 0 && (
                <span className="inline-flex items-center gap-1 text-sky-700">
                  <ListTodo className="h-3 w-3" />{m.openActionCount} action{m.openActionCount > 1 ? 's' : ''} ouverte{m.openActionCount > 1 ? 's' : ''}
                </span>
              )}
              {m.blockerCount > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-3 w-3" />{m.blockerCount} blocage{m.blockerCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </li>
  )
}
