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
  Clock,
  Users,
  EyeOff,
  ListTodo,
  CheckCircle2,
  CalendarClock,
  ChevronRight,
  Camera,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import type { StatusValue } from '@/components/ui/status-badge'
import { getClientDetail, getClientCockpit } from '@/lib/db/clients'
import { todayLocalIso } from '@/lib/time/local-date'
import { HealthRing } from '@/components/ui/health-ring'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SmartBackLink } from '@/components/nav/SmartBackLink'
import { RemoveClientButton } from './RemoveClientButton'

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

const SITE_LEVEL_RANK: Record<'green' | 'orange' | 'red', number> = { red: 0, orange: 1, green: 2 }
const SITE_LEVEL_DOT: Record<'green' | 'orange' | 'red', string> = {
  green: 'bg-emerald-500', orange: 'bg-amber-500', red: 'bg-red-500',
}

function TodaySignal({ tone, label, dot, icon }: {
  tone: 'green' | 'orange' | 'red' | 'muted'
  label: string
  dot?: boolean
  icon?: React.ReactNode
}) {
  const text = tone === 'green' ? 'text-emerald-700' : tone === 'orange' ? 'text-amber-700' : tone === 'red' ? 'text-red-700' : 'text-muted-foreground'
  const dotCls = tone === 'green' ? 'bg-emerald-500' : tone === 'orange' ? 'bg-amber-500' : tone === 'red' ? 'bg-red-500' : 'bg-muted-foreground'
  return (
    <span className={`inline-flex items-center gap-1.5 ${text}`}>
      {dot && <span className={`h-2 w-2 rounded-full ${dotCls}`} />}
      {icon}
      {label}
    </span>
  )
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const client = await getClientDetail(id)
  if (!client) notFound()

  const contractCount = client.contracts.length
  const siteCount = client.sites.length
  const hasNotes = !!client.notes?.trim()

  const todayIso = todayLocalIso()

  // Cockpit : signaux d'attention (risques + à faire + santé sites), pas d'historique.
  const cockpit = await getClientCockpit(id, todayIso)
  const { risks, thisWeek } = cockpit
  const hasRisks =
    risks.openAnomalies > 0 || risks.sitesNotVisited.length > 0 ||
    risks.missionsWithoutTeam > 0 || risks.staleOpenActions > 0

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
          {/* Lot D : « Retirer » — bloqué tant qu'un chantier actif subsiste
              (la cascade client → sites → … → photos n'est jamais exposée). */}
          <span className="ml-auto">
            <RemoveClientButton
              clientId={client.id}
              clientName={client.name}
              activeSiteCount={siteCount}
            />
          </span>
        </div>
        <div className="pl-7 flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
          {client.contact_name && <span>{client.contact_name}</span>}
          <span className="inline-flex items-center gap-1"><FileCheck className="h-3.5 w-3.5" />{contractCount} contrat{contractCount > 1 ? 's' : ''}</span>
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{siteCount} site{siteCount > 1 ? 's' : ''}</span>
        </div>
      </header>

      {/* ── {CLIENT} AUJOURD'HUI — lecture 4 s ─────────────────────────────── */}
      <section className="rounded-lg border bg-card px-4 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          {client.name} aujourd&apos;hui
        </h2>
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap text-sm">
          <TodaySignal tone="green" dot label={`${cockpit.today.sitesGreen} site${cockpit.today.sitesGreen > 1 ? 's' : ''} en rythme`} />
          {cockpit.today.sitesOrange > 0 && <TodaySignal tone="orange" dot label={`${cockpit.today.sitesOrange} à surveiller`} />}
          {cockpit.today.sitesRed > 0 && <TodaySignal tone="red" dot label={`${cockpit.today.sitesRed} site${cockpit.today.sitesRed > 1 ? 's' : ''} critique${cockpit.today.sitesRed > 1 ? 's' : ''}`} />}
          {cockpit.today.criticalAnomalies > 0 && (
            <TodaySignal tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />} label={`${cockpit.today.criticalAnomalies} anomalie${cockpit.today.criticalAnomalies > 1 ? 's' : ''} critique${cockpit.today.criticalAnomalies > 1 ? 's' : ''}`} />
          )}
          <TodaySignal tone="muted" icon={<Camera className="h-3.5 w-3.5" />} label={`${cockpit.today.proofCount} preuve${cockpit.today.proofCount > 1 ? 's' : ''}`} />
          {cockpit.today.next && (
            <span className="inline-flex items-center gap-1.5 text-sky-700">
              <CalendarClock className="h-3.5 w-3.5" />
              Prochaine : {formatDateShort(cockpit.today.next.scheduled_for)} · {cockpit.today.next.siteName}
            </span>
          )}
        </div>
      </section>

      {/* ── RISQUES EN COURS — actionnable, items nommés ───────────────────── */}
      <section className={`rounded-lg border p-4 ${hasRisks ? 'border-amber-200 bg-amber-50/30' : 'border-emerald-200 bg-emerald-50/30'}`}>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5 mb-2">
          <AlertTriangle className="h-3.5 w-3.5" /> {hasRisks ? `${client.name} nécessite votre attention` : 'Risques en cours'}
        </h2>
        {!hasRisks ? (
          <p className="text-sm text-emerald-700 inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Aucun risque en cours.
          </p>
        ) : (
          <div className="space-y-1.5">
            {risks.criticalAnomalies > 0 && (
              <RiskRow
                tone="red"
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                count={risks.criticalAnomalies}
                label={`anomalie${risks.criticalAnomalies > 1 ? 's' : ''} critique${risks.criticalAnomalies > 1 ? 's' : ''}`}
                detail={risks.criticalAnomalySites.length > 0 ? `à ${risks.criticalAnomalySites.slice(0, 3).join(', ')}` : null}
              />
            )}
            {risks.openAnomalies - risks.criticalAnomalies > 0 && (
              <RiskRow
                tone="orange"
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                count={risks.openAnomalies - risks.criticalAnomalies}
                label={`autre${risks.openAnomalies - risks.criticalAnomalies > 1 ? 's' : ''} anomalie${risks.openAnomalies - risks.criticalAnomalies > 1 ? 's' : ''} ouverte${risks.openAnomalies - risks.criticalAnomalies > 1 ? 's' : ''}`}
                detail={null}
              />
            )}
            {risks.sitesNotVisited.length > 0 && (
              <RiskRow
                tone="orange"
                icon={<EyeOff className="h-3.5 w-3.5" />}
                count={risks.sitesNotVisited.length}
                label={`site${risks.sitesNotVisited.length > 1 ? 's' : ''} non vu${risks.sitesNotVisited.length > 1 ? 's' : ''} depuis 21 j`}
                detail={risks.sitesNotVisited.slice(0, 3).map((s) => `${s.siteName} (${s.days === null ? 'jamais' : `${s.days} j`})`).join(' · ')}
              />
            )}
            {risks.staleOpenActions > 0 && (
              <RiskRow
                tone="orange"
                icon={<ListTodo className="h-3.5 w-3.5" />}
                count={risks.staleOpenActions}
                label={`action${risks.staleOpenActions > 1 ? 's' : ''} ouverte${risks.staleOpenActions > 1 ? 's' : ''} depuis +7 j`}
                detail={null}
              />
            )}
            {risks.missionsWithoutTeam > 0 && (
              <RiskRow
                tone="orange"
                icon={<Users className="h-3.5 w-3.5" />}
                count={risks.missionsWithoutTeam}
                label={`mission${risks.missionsWithoutTeam > 1 ? 's' : ''} sans équipe`}
                detail={null}
              />
            )}
          </div>
        )}
      </section>

      {/* ── À FAIRE CETTE SEMAINE — prospectif ─────────────────────────────── */}
      {thisWeek.length > 0 && (
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5 mb-2">
            <CalendarClock className="h-3.5 w-3.5" /> À faire cette semaine
          </h2>
          <ul className="rounded-lg border divide-y">
            {thisWeek.map((t) => (
              <li key={t.interventionId}>
                <Link href={`/interventions/${t.interventionId}`} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/20 transition-colors">
                  <span className="text-xs font-medium text-sky-700 shrink-0 w-16">{formatDateShort(t.scheduled_for)}</span>
                  <span className="text-sm truncate">{t.missionName}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">· {t.siteName}</span>
                  {t.slot && <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{SLOT_FR[t.slot] ?? t.slot}</span>}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 ml-auto shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── SANTÉ DES SITES + CHARGE PAR SITE — côte à côte ────────────────── */}
      {cockpit.sites.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Santé des sites — anneau (proportion) + liste actionnable */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Santé des sites
            </h2>
            <div className="flex items-start gap-6">
              <HealthRing
                green={cockpit.today.sitesGreen}
                orange={cockpit.today.sitesOrange}
                red={cockpit.today.sitesRed}
                total={cockpit.sites.length}
                unit="sites"
                size={88}
              />
              <ul className="flex-1 min-w-0 divide-y -my-1.5">
                {[...cockpit.sites]
                  .sort((a, b) => SITE_LEVEL_RANK[a.level] - SITE_LEVEL_RANK[b.level])
                  .slice(0, 6)
                  .map((s) => (
                    <li key={s.siteId}>
                      <Link href={`/sites/${s.siteId}`} className="flex items-center gap-2 py-1.5 hover:opacity-80 transition-opacity">
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${SITE_LEVEL_DOT[s.level]}`} />
                        <span className="text-sm truncate">{s.siteName}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{s.reason}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          </div>

          {/* Charge par site — où se concentre l'activité */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Charge par site
            </h2>
            {cockpit.sites.some((s) => s.interventionCount > 0) ? (
              (() => {
                const maxIv = Math.max(1, ...cockpit.sites.map((s) => s.interventionCount))
                return (
                  <div className="space-y-2.5">
                    {cockpit.sites.filter((s) => s.interventionCount > 0).slice(0, 6).map((s) => (
                      <div key={s.siteId} className="flex items-center gap-3">
                        <span className="w-32 shrink-0 truncate text-xs font-medium">{s.siteName}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(6, (s.interventionCount / maxIv) * 100)}%` }} />
                        </div>
                        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                          {s.interventionCount} int.
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })()
            ) : (
              <p className="text-sm text-muted-foreground italic">Pas encore d&apos;activité.</p>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Colonne gauche : contact + mémoire */}
        <div className="lg:col-span-1 space-y-4">

          {/* Contact — réduit à un lien si vide (pas de grande carte morte) */}
          {(client.contact_name || client.contact_phone || client.contact_email || client.address) ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Contact
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {client.contact_name && <div className="text-sm font-medium">{client.contact_name}</div>}
                {client.contact_phone && (
                  <a href={`tel:${client.contact_phone}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <Phone className="h-3.5 w-3.5 shrink-0" />{client.contact_phone}
                  </a>
                )}
                {client.contact_email && (
                  <a href={`mailto:${client.contact_email}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <Mail className="h-3.5 w-3.5 shrink-0" /><span className="break-all">{client.contact_email}</span>
                  </a>
                )}
                {client.address && (
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="whitespace-pre-wrap">{client.address}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <button type="button" className="w-full inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors">
              <Phone className="h-3.5 w-3.5" /> Ajouter un contact principal
            </button>
          )}

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

function RiskRow({
  tone, icon, count, label, detail,
}: {
  tone: 'red' | 'orange'
  icon: React.ReactNode
  count: number
  label: string
  detail: string | null
}) {
  const toneText = tone === 'red' ? 'text-red-700' : 'text-amber-700'
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className={`inline-flex items-center gap-1.5 ${toneText} shrink-0`}>
        {icon}
        <span className="font-bold tabular-nums">{count}</span>
      </span>
      <span className="text-foreground/90">{label}</span>
      {detail && <span className="text-xs text-muted-foreground truncate">— {detail}</span>}
    </div>
  )
}
