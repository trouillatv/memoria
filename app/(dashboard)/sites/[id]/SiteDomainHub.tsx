import Link from 'next/link'
import { BookText, ListTodo, Sparkles, ShieldCheck, Clock, AlertTriangle, ClipboardCheck, Layers } from 'lucide-react'

// HUB chantier organisé par QUESTIONS métier, pas par modules (refonte IA 2026-06-29).
// Guillaume ne pense pas « je vais dans Mémoire » mais « qu'est-ce que je dois
// savoir ? ». L'interface reflète les LECTURES, pas l'architecture logicielle.
// Cockpit, pas menu. Pas de hover. Le hub reste COURT : un état général factuel +
// 4 questions, chacune avec un résumé et des sous-fonctions directement cliquables.
//
// DOCTRINE : aucun verdict de « santé » (pas de pastille verte = pas de score, cf.
// « descriptif jamais juge »). On affiche des FAITS ; le rouge ne marque qu'un fait
// déclaré (« en retard » = échéance dépassée), jamais une inférence.

interface HubChild { label: string; href: string; count?: number | null }
interface HubDomain {
  question: string
  icon: React.ReactNode
  hint?: string | null
  children: HubChild[]
}

export interface SiteHubData {
  openActions: number
  overdueActions: number
  reservesOpen: number
  oblToDo: number
  subjectsOpen: number
  blockedDossiers: number
  visits: number
  docs: number
  lastVisitAt: string | null
  canExport: boolean
}

function relDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const today = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOfDay(today) - startOfDay(d)) / 86400000)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} j`
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

export function SiteDomainHub({ siteId, data }: { siteId: string; data: SiteHubData }) {
  const lastVisit = relDate(data.lastVisitAt)

  const domains: HubDomain[] = [
    {
      question: "Que s'est-il passé ?",
      icon: <BookText className="h-4 w-4 text-sky-600" />,
      hint: lastVisit ? `dernière visite ${lastVisit}` : null,
      children: [
        { label: 'Le journal', href: `/sites/${siteId}/chronicle` },
        { label: 'Visites', href: `/sites/${siteId}/visites`, count: data.visits },
      ],
    },
    {
      question: 'Que reste-t-il à faire ?',
      icon: <ListTodo className="h-4 w-4 text-amber-600" />,
      hint: data.openActions > 0
        ? `${data.openActions} ouverte${data.openActions > 1 ? 's' : ''}${data.overdueActions > 0 ? ` · ${data.overdueActions} en retard` : ''}`
        : null,
      children: [
        { label: 'Points à lever', href: `/sites/${siteId}/reserves`, count: data.reservesOpen },
        { label: 'Obligations', href: `/sites/${siteId}/obligations`, count: data.oblToDo },
      ],
    },
    {
      question: 'Que faut-il savoir ?',
      icon: <Sparkles className="h-4 w-4 text-violet-600" />,
      hint: data.blockedDossiers > 0 ? `${data.blockedDossiers} dossier${data.blockedDossiers > 1 ? 's' : ''} bloqué${data.blockedDossiers > 1 ? 's' : ''}` : null,
      children: [
        { label: 'Dossiers suivis', href: `/sites/${siteId}/subjects`, count: data.subjectsOpen },
        { label: 'Atelier mémoire', href: `/memoire/${siteId}` },
        { label: 'Récit', href: `/sites/${siteId}/recit` },
      ],
    },
    {
      question: 'Quelles preuves a-t-on ?',
      icon: <ShieldCheck className="h-4 w-4 text-emerald-600" />,
      hint: data.docs > 0 ? `${data.docs} document${data.docs > 1 ? 's' : ''}` : null,
      children: [
        { label: 'Dossier de preuve', href: `/sites/${siteId}/preuves`, count: data.docs },
        { label: 'QR Code', href: `/sites/${siteId}/qr` },
        ...(data.canExport ? [{ label: 'Exporter', href: `/sites/${siteId}/export` }] : []),
      ],
    },
  ]

  return (
    <div className="space-y-3">
      {/* État général — des FAITS, pas un verdict de santé. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Où en est-on</span>
        <Fact icon={<ListTodo className="h-3.5 w-3.5" />} n={data.openActions} label="action ouverte" labelPlural="actions ouvertes" />
        {data.overdueActions > 0 && (
          <span className="inline-flex items-center gap-1 text-rose-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="font-semibold tabular-nums">{data.overdueActions}</span> en retard
          </span>
        )}
        <Fact icon={<ClipboardCheck className="h-3.5 w-3.5" />} n={data.reservesOpen} label="réserve" labelPlural="réserves" />
        {data.blockedDossiers > 0 && (
          <span className="inline-flex items-center gap-1 text-rose-600">
            <Layers className="h-3.5 w-3.5" />
            <span className="font-semibold tabular-nums">{data.blockedDossiers}</span> dossier{data.blockedDossiers > 1 ? 's' : ''} bloqué{data.blockedDossiers > 1 ? 's' : ''}
          </span>
        )}
        {lastVisit && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> dernière visite {lastVisit}
          </span>
        )}
      </div>

      {/* Les 4 lectures métier. */}
      <div className="grid gap-3 md:grid-cols-2">
        {domains.map((d) => (
          <section key={d.question} className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold">{d.icon}{d.question}</span>
              {d.hint && <span className="text-[11px] text-muted-foreground">{d.hint}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {d.children.map((c) => (
                <Link
                  key={c.label}
                  href={c.href}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:border-foreground/40 hover:bg-muted/40 transition-colors active:scale-[0.97]"
                >
                  {c.label}
                  {typeof c.count === 'number' && c.count > 0 && (
                    <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{c.count}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function Fact({ icon, n, label, labelPlural }: { icon: React.ReactNode; n: number; label: string; labelPlural: string }) {
  if (n === 0) return null
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {icon}
      <span className="font-semibold tabular-nums text-foreground">{n}</span> {n > 1 ? labelPlural : label}
    </span>
  )
}
