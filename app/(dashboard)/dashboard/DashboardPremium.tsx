import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  Info,
  MapPin,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react'
import type { VisitImpact, SiteImpact } from '@/lib/knowledge/site-events'
import type { AttentionDigest, AttentionItem } from '@/lib/db/attention'
import type { UpcomingDashboardItem } from '@/lib/db/upcoming-items'
import type { SiteDashboardItem } from '@/lib/db/sites-dashboard'
import type { LivingASavoirCard } from '@/lib/db/handover'
import type { SiteActionRow } from '@/lib/db/site-actions'
import type { NowDashboardItem, NowDashboardSummary } from '@/lib/db/now-dashboard'
import { OrgBadge, orgLabelOf, type OrgLabels } from '@/components/dashboard/OrgBadge'
import { ActionCheckbox } from './ActionCheckbox'
import { CockpitNow, PriorityActionList } from './CockpitNow'

type Props = {
  firstName: string
  orgNames: string[]
  attention: AttentionDigest
  visit: VisitImpact
  upcoming: UpcomingDashboardItem[]
  sites: SiteDashboardItem[]
  aSavoir: LivingASavoirCard[]
  orgLabels: OrgLabels
  now: { items: NowDashboardItem[]; summary: NowDashboardSummary; actions: SiteActionRow[] }
}

const surface = 'rounded-[24px] border border-[#e5eaf3] bg-white shadow-[0_10px_35px_rgba(23,39,74,0.045)]'

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function Metric({ icon: Icon, value, label, tone }: { icon: typeof FileText; value: number; label: string; tone: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-[#edf0f6] pb-4 last:border-0 last:pb-0 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4 sm:last:border-r-0">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0"><strong className="block text-2xl font-semibold tracking-tight text-[#101a35]">{value}</strong><span className="text-xs leading-tight text-[#65718b]">{label}</span></span>
    </div>
  )
}

function AttentionRow({ item, urgent, orgLabels }: { item: AttentionItem; urgent: boolean; orgLabels: OrgLabels }) {
  return (
    <Link href={item.href} className={`group flex items-center gap-4 rounded-2xl px-4 py-3.5 transition-colors ${urgent ? 'bg-[#fff8f8] hover:bg-[#fff1f1]' : 'bg-[#fffbf4] hover:bg-[#fff6e6]'}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${urgent ? 'bg-[#ffe7e7] text-[#ef5b62]' : 'bg-[#fff0d7] text-[#ec9a33]'}`}>
        {urgent ? <AlertTriangle className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-[#17213a]">{item.what}</strong><span className="mt-1 block text-xs text-[#66738c]">{item.why} · {item.where}</span></span>
      <span className="hidden rounded-lg bg-white px-2.5 py-1 text-[10px] font-medium text-[#53617b] shadow-sm sm:inline-flex"><OrgBadge label={orgLabelOf(orgLabels, item.organizationId)} /></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#91a0ba] transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

function AttentionPanel({ digest, orgLabels }: { digest: AttentionDigest; orgLabels: OrgLabels }) {
  const items = [...digest.red.map((item) => ({ item, urgent: true })), ...digest.orange.map((item) => ({ item, urgent: false }))].slice(0, 4)
  return (
    <section className={`${surface} p-5 sm:p-7`}>
      <div className="mb-5 flex items-center gap-2 text-[#f0525f]"><AlertTriangle className="h-4 w-4" /><h2 className="text-xs font-bold uppercase tracking-[0.14em]">Ce qui mérite votre attention aujourd&apos;hui</h2></div>
      {items.length === 0 ? <p className="rounded-2xl bg-[#f3fbf6] px-4 py-5 text-sm text-[#258657]">Tout est en rythme aujourd&apos;hui.</p> : <div className="space-y-2">{items.map(({ item, urgent }, index) => <AttentionRow key={`${item.href}-${index}`} item={item} urgent={urgent} orgLabels={orgLabels} />)}</div>}
      <Link href="/actions" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8] hover:text-[#0c4dbd]">Voir toutes les alertes <ArrowRight className="h-3.5 w-3.5" /></Link>
    </section>
  )
}

function VisitSummary({ site, orgLabels }: { site: SiteImpact & { visitActions?: SiteActionRow[] }; orgLabels: OrgLabels }) {
  const actions = site.visitActions ?? []
  const metrics = [
    { icon: FileText, value: site.added.actions, label: 'actions proposées', tone: 'bg-[#eee9ff] text-[#7959d8]' },
    { icon: ShieldAlert, value: site.added.watchpoints, label: 'points de vigilance', tone: 'bg-[#fff0e7] text-[#ef8e45]' },
    { icon: Calendar, value: site.added.deadlines, label: 'échéances détectées', tone: 'bg-[#e8f0ff] text-[#4178db]' },
    { icon: Users, value: site.added.stakeholders, label: 'intervenants identifiés', tone: 'bg-[#e8faf4] text-[#26a67b]' },
    { icon: Info, value: site.added.knowledge, label: 'informations à savoir', tone: 'bg-[#fff7dc] text-[#dca82b]' },
  ]
  return (
    <section className={`${surface} p-5 sm:p-6`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">Depuis votre dernière visite</p><h2 className="mt-2 text-lg font-semibold text-[#101a35]">{site.siteName}</h2><p className="mt-1 text-xs text-[#65718b]"><OrgBadge label={orgLabelOf(orgLabels, site.organizationId)} /> Synthèse à jour</p></div><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eee9ff] text-[#7857d4]"><Sparkles className="h-4 w-4" /></span></div>
      <div className="mt-6 grid gap-4 sm:grid-cols-5">{metrics.map((metric) => <Metric key={metric.label} {...metric} />)}</div>
      {site.deadlines.length > 0 && <div className="mt-6 border-t border-[#edf0f6] pt-5"><h3 className="text-xs font-bold uppercase tracking-[0.14em] text-[#65718b]">Échéances</h3><ul className="mt-3 space-y-2">{site.deadlines.slice(0, 3).map((deadline) => <li key={deadline.id} className="flex items-start gap-2 text-xs text-[#34415c]"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#e9a33d]" /><span className="min-w-0 flex-1">{deadline.title}</span><span className="shrink-0 text-[#8b96aa]">{deadline.when}</span></li>)}</ul></div>}
      <details className="mt-5 rounded-2xl bg-[#f8faff] p-3">
        <summary className="cursor-pointer list-none text-xs font-semibold text-[#1463e8]">Afficher les {actions.length} actions ouvertes et les {site.deadlines.length} échéances</summary>
        <div className="mt-4 space-y-4">
          {actions.length > 0 && <ul className="space-y-2">{actions.map((action) => <li key={action.id} className="flex items-center gap-2"><ActionCheckbox actionId={action.id} siteId={action.site_id} label={action.title} /><span className="text-xs text-[#34415c]">{action.title}</span></li>)}</ul>}
          <Link href={`/sites/${site.siteId}`} className="inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8]">Ouvrir le chantier <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </details>
    </section>
  )
}

function Agenda({ items }: { items: UpcomingDashboardItem[] }) {
  return <section className={`${surface} p-5 sm:p-6`}><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">Votre journée</p><h2 className="mt-2 text-lg font-semibold text-[#101a35]">Prochains passages</h2>{items.length === 0 ? <p className="mt-6 text-sm italic text-[#73809a]">Aucun passage planifié dans les 30 prochains jours.</p> : <ul className="mt-5 space-y-3">{items.slice(0, 5).map((item) => <li key={`${item.sourceType}:${item.id}`}><Link href={item.href} className="group flex items-start gap-3"><span className="rounded-lg bg-[#edf3ff] px-2 py-1 text-[10px] font-bold text-[#3c67b3]">{item.isToday ? "Aujourd'hui" : dateLabel(item.startsAt)}</span><span className="min-w-0 flex-1"><strong className="block truncate text-xs font-semibold text-[#17213a]">{item.title}</strong><span className="mt-1 block truncate text-[11px] text-[#748098]">{item.siteName} · {timeLabel(item.startsAt)}</span></span><ChevronRight className="mt-1 h-3.5 w-3.5 text-[#a4afc0]" /></Link></li>)}</ul>}<Link href="/mois" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8]">Voir le planning complet <ArrowRight className="h-3.5 w-3.5" /></Link></section>
}

function SitesTable({ sites }: { sites: SiteDashboardItem[] }) {
  return <section className={`${surface} p-5 sm:p-6`}><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">Vos lieux</p><h2 className="mt-2 text-lg font-semibold text-[#101a35]">Vos chantiers</h2></div><MapPin className="h-5 w-5 text-[#5c7bd9]" /></div><div className="mt-5 space-y-2">{sites.slice(0, 5).map((site) => <Link key={site.id} href={site.href} className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-[#f7f9fd]"><span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold ${site.status === 'critical' ? 'bg-[#ffe8e8] text-[#e35b63]' : site.status === 'warning' ? 'bg-[#fff1d9] text-[#d18d28]' : 'bg-[#e7f8f0] text-[#2b9c72]'}`}>{site.name.slice(0, 1).toUpperCase()}</span><span className="min-w-0"><strong className="block truncate text-xs font-semibold text-[#17213a]">{site.name}</strong><span className="block truncate text-[11px] text-[#7b879d]">{site.clientName ?? 'Organisation'} · {site.activeActionCount} action{site.activeActionCount > 1 ? 's' : ''} à suivre</span></span><span className="text-right text-[10px] font-medium text-[#e25b63]">{site.overdueActionCount > 0 ? `${site.overdueActionCount} en retard` : site.openReserveCount > 0 ? `${site.openReserveCount} réserve` : 'À jour'}</span></Link>)}</div><Link href="/sites" className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8]">Voir tous les chantiers <ArrowRight className="h-3.5 w-3.5" /></Link></section>
}

function PriorityActions({ items, orgLabels }: { items: AttentionItem[]; orgLabels: OrgLabels }) {
  return <section className={`${surface} p-5 sm:p-6`}><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">À décider ou lancer</p><h2 className="mt-2 text-lg font-semibold text-[#101a35]">Actions prioritaires</h2></div><CheckCircle2 className="h-5 w-5 text-[#6077b7]" /></div><ul className="mt-5 space-y-3">{items.slice(0, 4).map((item, index) => <li key={`${item.href}-${index}`}><Link href={item.href} className="flex items-start gap-3"><span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f0f3f8] text-[#657493]"><CheckCircle2 className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><strong className="block text-xs font-medium leading-snug text-[#17213a]">{item.what}</strong><span className="mt-1 block text-[11px] text-[#7b879d]"><OrgBadge label={orgLabelOf(orgLabels, item.organizationId)} /> {item.where}</span></span><span className="text-[10px] font-semibold text-[#e35d65]">À traiter</span></Link></li>)}</ul><Link href="/actions" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8]">Voir toutes mes actions <ArrowRight className="h-3.5 w-3.5" /></Link></section>
}

function MemoryCards({ items }: { items: LivingASavoirCard[] }) {
  return <section className={`${surface} p-5 sm:p-6`}><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">Connaissances du terrain</p><h2 className="mt-2 text-lg font-semibold text-[#101a35]">Mémoire utile pour aujourd&apos;hui</h2></div><Info className="h-5 w-5 text-[#5e7bd3]" /></div>{items.length === 0 ? <p className="mt-6 text-sm italic text-[#73809a]">Aucune capsule disponible pour le moment.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.slice(0, 4).map((item, index) => <Link key={item.id} href={`/sites/${item.site_id}`} className="group rounded-2xl border border-[#e8edf5] bg-[#fbfcff] p-4 transition-all hover:-translate-y-0.5 hover:border-[#cbd9f7] hover:shadow-sm"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${['bg-[#e5f8ef] text-[#2ba577]', 'bg-[#eee8ff] text-[#7756d7]', 'bg-[#fff0df] text-[#ed8b43]', 'bg-[#e8f0ff] text-[#4779dc]'][index]}`}><Sparkles className="h-4 w-4" /></span><p className="mt-3 line-clamp-3 text-xs font-medium leading-relaxed text-[#27334e]">{item.body}</p><p className="mt-4 truncate text-[10px] text-[#7b879d]">{item.site_name}</p></Link>)}</div>}<Link href="/memoire" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8]">Voir toutes les capsules <ArrowRight className="h-3.5 w-3.5" /></Link></section>
}

export function DashboardPremium({ firstName, orgNames, attention, visit, upcoming, sites, aSavoir, orgLabels, now }: Props) {
  const rawSite = visit.sites[0]
  const site = rawSite ? { ...rawSite, visitActions: now.actions.filter((action) => action.site_id === rawSite.siteId) } : null
  return <div className="min-h-screen w-full bg-[#f8fafc] px-1 pb-12 pt-1 sm:px-2"><div className="w-full space-y-5">
    <header className="flex items-end justify-between gap-5 px-1 py-4 sm:px-2"><div><p className="text-xs font-medium text-[#7a879f]">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · 06h42</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-[#101a35]">Bonjour {firstName} 👋</h1><p className="mt-1 text-sm text-[#68758d]">Voici ce qui demande votre attention aujourd&apos;hui.</p>{orgNames.length > 1 && <p className="mt-3 text-xs font-medium text-[#6b7891]">{orgNames.join(' · ')}</p>}</div><div className="hidden items-center gap-2 text-xs text-[#7a879f] lg:flex"><span className="rounded-full border border-[#e2e8f2] bg-white px-4 py-2">Rechercher un chantier, une action, un document…</span><span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e2e8f2] bg-white"><Info className="h-4 w-4" /></span></div></header>
    <AttentionPanel digest={attention} orgLabels={orgLabels} />
    <CockpitNow items={now.items} summary={now.summary} />
    <div className="grid gap-5 xl:grid-cols-[1.28fr_0.72fr]">{site ? <VisitSummary site={site} orgLabels={orgLabels} /> : <section className={`${surface} p-6`}><h2 className="text-lg font-semibold text-[#101a35]">Depuis votre dernière visite</h2><p className="mt-4 text-sm text-[#73809a]">Aucune évolution récente à afficher.</p></section>}<Agenda items={upcoming} /></div>
    <section className={`${surface} p-5 sm:p-6`}><div className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-[#5674c9]" /><h2 className="text-xs font-bold uppercase tracking-[0.16em] text-[#6a7892]">Vos prochains passages</h2></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{upcoming.slice(0, 4).map((item) => <Link key={`rhythm-${item.id}`} href={item.href} className="rounded-2xl border border-[#e9edf5] bg-[#fbfcff] p-4 transition hover:border-[#cbd9f7] hover:bg-white"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e8f0ff] text-[#4e75d0]"><Calendar className="h-4 w-4" /></span><strong className="mt-3 block line-clamp-2 text-xs leading-relaxed text-[#1c2740]">{item.title}</strong><span className="mt-3 block text-[11px] text-[#7b879d]">{dateLabel(item.startsAt)} · {timeLabel(item.startsAt)}</span></Link>)}</div></section>
    <div className="grid gap-5 xl:grid-cols-2"><SitesTable sites={sites} /><PriorityActionList actions={now.actions} /></div>
    <MemoryCards items={aSavoir} />
    <div className="grid gap-5 md:grid-cols-3"><section className={`${surface} p-5`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6a7892]">État de la continuité</p><p className="mt-4 flex items-center gap-2 text-sm font-medium text-[#21845c]"><CheckCircle2 className="h-4 w-4" /> Continuité stable — rien à signaler</p></section><section className={`${surface} p-5 md:col-span-2`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6a7892]">Mémoire opérationnelle</p><div className="mt-4 flex items-center gap-2 text-xs text-[#65718b]"><span className="h-3 w-3 rounded-[3px] bg-[#61c98b]" /><span className="h-3 w-3 rounded-[3px] bg-[#f4c95e]" /><span className="h-3 w-3 rounded-[3px] bg-[#72a5ed]" /> Les traces récentes restent disponibles dans les fiches des lieux.</div></section></div>
  </div></div>
}
