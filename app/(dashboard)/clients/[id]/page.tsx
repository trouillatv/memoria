import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Building2,
  Phone,
  Mail,
  MapPin,
  FileCheck,
  Calendar,
  AlertTriangle,
  Layers,
  BookOpen,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import type { StatusValue } from '@/components/ui/status-badge'
import { getClientDetail } from '@/lib/db/clients'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SmartBackLink } from '@/components/nav/SmartBackLink'

const SLOT_FR: Record<string, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
}

const FR_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const FR_DAYS = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.']

function formatDateShort(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const utc = new Date(Date.UTC(y, m - 1, d))
  return `${FR_DAYS[utc.getUTCDay()]} ${d} ${FR_MONTHS[m - 1]}`
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const client = await getClientDetail(id)
  if (!client) notFound()

  const contractCount = client.contracts.length
  const siteCount = client.sites.length
  const hasNotes = !!client.notes?.trim()

  return (
    <div className="space-y-6 w-full">
      <BreadcrumbPrefix crumbs={[{ label: 'Clients', href: '/clients' }]} />
      <DynamicCrumb segmentId={client.id} label={client.name} />
      <SmartBackLink fallbackHref="/clients" label="Clients" />

      {/* En-tête */}
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
          <h1 className="text-2xl font-semibold leading-tight">{client.name}</h1>
        </div>
        {client.contact_name && (
          <p className="text-sm text-muted-foreground pl-7">{client.contact_name}</p>
        )}
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Contrats" value={contractCount} icon={<FileCheck className="h-4 w-4" />} />
        <KpiCard label="Sites" value={siteCount} icon={<MapPin className="h-4 w-4" />} />
        <KpiCard label="Interventions" value={client.totalInterventionCount} icon={<Calendar className="h-4 w-4" />} />
        <KpiCard
          label="Anomalies ouvertes"
          value={client.openAnomalyCount}
          icon={<AlertTriangle className="h-4 w-4" />}
          highlight={client.openAnomalyCount > 0}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Colonne gauche : contact + mémoire */}
        <div className="lg:col-span-1 space-y-4">

          {/* Contact */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Contact
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {client.contact_name && (
                <div className="text-sm font-medium">{client.contact_name}</div>
              )}
              {client.contact_phone && (
                <a
                  href={`tel:${client.contact_phone}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  {client.contact_phone}
                </a>
              )}
              {client.contact_email && (
                <a
                  href={`mailto:${client.contact_email}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="break-all">{client.contact_email}</span>
                </a>
              )}
              {client.address && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span className="whitespace-pre-wrap">{client.address}</span>
                </div>
              )}
              {!client.contact_name && !client.contact_phone && !client.contact_email && !client.address && (
                <p className="text-sm text-muted-foreground italic">Aucune information de contact.</p>
              )}
            </CardContent>
          </Card>

          {/* Mémoire client */}
          {hasNotes && (
            <Card className="border-amber-200 bg-amber-50/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-amber-800 inline-flex items-center gap-2">
                  <BookOpen className="h-3.5 w-3.5" />
                  Mémoire client
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-amber-900/80 whitespace-pre-wrap leading-relaxed">
                  {client.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Sites */}
          {siteCount > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5" />
                  Sites ({siteCount})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {client.sites.map((s) => (
                  <Link
                    key={s.id}
                    href={`/sites/${s.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent transition-colors group"
                  >
                    <div className="min-w-0">
                      <p className="text-sm truncate group-hover:text-foreground">{s.name}</p>
                      {s.address && (
                        <p className="text-[11px] text-muted-foreground truncate">{s.address}</p>
                      )}
                    </div>
                    {s.missionCount > 0 && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {s.missionCount} mission{s.missionCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Colonne droite : contrats + activité */}
        <div className="lg:col-span-2 space-y-4">

          {/* Contrats */}
          {contractCount > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
                  <FileCheck className="h-3.5 w-3.5" />
                  Contrats ({contractCount})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {client.contracts.map((co) => (
                    <li key={co.id} className="py-2.5 first:pt-0 last:pb-0">
                      <Link
                        href={`/contracts/${co.id}`}
                        className="flex items-center justify-between gap-3 group"
                      >
                        <div className="min-w-0">
                          <p className="text-sm truncate group-hover:text-foreground transition-colors">{co.name}</p>
                          {(co.start_date || co.end_date) && (
                            <p className="text-[11px] text-muted-foreground">
                              {co.start_date && formatDateShort(co.start_date)}
                              {co.start_date && co.end_date && ' → '}
                              {co.end_date && formatDateShort(co.end_date)}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={co.status as StatusValue} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Activité récente */}
          {client.recentInterventions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5" />
                  Activité récente
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {client.recentInterventions.map((r) => (
                    <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                      <Link
                        href={`/interventions/${r.id}`}
                        className="flex items-start justify-between gap-3 group"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm truncate group-hover:text-foreground transition-colors">
                            {r.missionName}
                          </p>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                            <MapPin className="h-2.5 w-2.5 shrink-0" />
                            {r.siteName}
                            {r.slot && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-muted">
                                {SLOT_FR[r.slot] ?? r.slot}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <StatusBadge status={r.status as StatusValue} />
                          {r.scheduled_for && (
                            <span className="text-[10px] text-muted-foreground">
                              {formatDateShort(r.scheduled_for)}
                            </span>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {siteCount === 0 && contractCount === 0 && (
            <div className="rounded-lg border bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Aucun site ni contrat associé à ce client pour le moment.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Composant KPI ─────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string
  value: number
  icon: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 space-y-1 ${
        highlight && value > 0 ? 'border-amber-200 bg-amber-50/60' : 'bg-card'
      }`}
    >
      <div className={`${highlight && value > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
        {icon}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${highlight && value > 0 ? 'text-amber-800' : ''}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
