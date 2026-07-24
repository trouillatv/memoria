import Link from 'next/link'
import { ArrowRight, CheckCircle2, ChevronRight } from 'lucide-react'
import type { NowDashboardItem, NowDashboardSummary } from '@/lib/db/now-dashboard'
import type { SiteActionRow } from '@/lib/db/site-actions'
import { ActionCheckbox } from './ActionCheckbox'

const surface = 'rounded-[24px] border border-[#e5eaf3] bg-white shadow-[0_10px_35px_rgba(23,39,74,0.045)]'

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function CockpitNow({ items, summary }: { items: NowDashboardItem[]; summary: NowDashboardSummary }) {
  return <section className={`${surface} p-5 sm:p-6`}><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">Pilotage de la journée</p><h2 className="mt-2 text-xl font-semibold text-[#101a35]">À faire maintenant</h2><p className="mt-2 text-xs text-[#718099]">{summary.overdueActions} action{summary.overdueActions !== 1 ? 's' : ''} en retard · {summary.imminentPassages} passage{summary.imminentPassages !== 1 ? 's' : ''} à préparer · {summary.weekDeadlines} échéance{summary.weekDeadlines !== 1 ? 's' : ''} cette semaine</p></div><span className="rounded-full bg-[#edf3ff] px-3 py-1 text-[10px] font-semibold text-[#3c67b3]">5 priorités max</span></div>{items.length === 0 ? <p className="mt-5 rounded-xl bg-[#f3fbf6] px-3 py-3 text-xs text-[#258657]">Rien ne demande une intervention immédiate.</p> : <ol className="mt-5 space-y-2">{items.map((item) => <li key={item.id} className="flex items-center gap-3 rounded-2xl bg-[#fbfcff] px-3 py-3"><span className="w-14 shrink-0 rounded-lg bg-[#edf3ff] px-2 py-1 text-center text-[10px] font-bold text-[#3c67b3]">{item.startsAt ? timeLabel(item.startsAt) : item.priority === 'urgent' ? 'Retard' : 'À suivre'}</span>{item.actionId ? <ActionCheckbox actionId={item.actionId} siteId={item.siteId} label={item.title} /> : <span className="h-7 w-7 shrink-0 rounded-lg bg-[#e8f0ff]" />}<Link href={item.href} className="min-w-0 flex-1"><strong className="block truncate text-xs font-semibold text-[#17213a]">{item.title}</strong><span className="mt-1 block text-[11px] text-[#7b879d]">{item.sourceType === 'passage' ? 'Préparer' : item.siteName}</span></Link><ChevronRight className="h-3.5 w-3.5 text-[#a4afc0]" /></li>)}</ol>}</section>
}

export function PriorityActionList({ actions }: { actions: SiteActionRow[] }) {
  return <section className={`${surface} p-5 sm:p-6`}><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">À décider ou lancer</p><h2 className="mt-2 text-lg font-semibold text-[#101a35]">Actions prioritaires</h2></div><CheckCircle2 className="h-5 w-5 text-[#6077b7]" /></div>{actions.length === 0 ? <p className="mt-5 rounded-xl bg-[#f3fbf6] px-3 py-3 text-xs text-[#258657]">Aucune action prioritaire aujourd&apos;hui.</p> : <ul className="mt-5 space-y-3">{actions.slice(0, 4).map((action) => <li key={action.id} className="flex items-start gap-3"><ActionCheckbox actionId={action.id} siteId={action.site_id} label={action.title} /><span className="min-w-0 flex-1"><strong className="block text-xs font-medium leading-snug text-[#17213a]">{action.title}</strong><span className="mt-1 block text-[11px] text-[#7b879d]">{action.site_name}</span></span><span className="text-[10px] font-semibold text-[#e35d65]">À traiter</span></li>)}</ul>}<Link href="/actions" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8]">Voir toutes mes actions <ArrowRight className="h-3.5 w-3.5" /></Link></section>
}
