import Link from 'next/link'
import { BookText, ListTodo, Sparkles, ShieldCheck } from 'lucide-react'

// HUB chantier — refonte IA 2026-06-29. Avant : 4 chips menaient chacun à une page
// intermédiaire (souvent un hub de 2-3 cartes = clic mort). Maintenant : les 4
// domaines sont visibles ET leurs sous-fonctions sont DIRECTEMENT cliquables sur la
// page chantier, enrichies de compteurs. La page devient un cockpit, pas un menu.
// Pas de hover (mauvais mobile / accessibilité). Les pages intermédiaires restent
// accessibles par URL — elles ne sont plus un passage obligé.

interface HubChild {
  label: string
  href: string
  count?: number | null
  alert?: string | null
}
interface HubDomain {
  title: string
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
  visits: number
  docs: number
  canExport: boolean
}

export function SiteDomainHub({ siteId, data }: { siteId: string; data: SiteHubData }) {
  const domains: HubDomain[] = [
    {
      title: 'Journal du chantier',
      icon: <BookText className="h-4 w-4 text-sky-600" />,
      children: [
        { label: 'Le journal', href: `/sites/${siteId}/chronicle` },
        { label: 'Visites', href: `/sites/${siteId}/visites`, count: data.visits },
      ],
    },
    {
      title: 'Actions',
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
      title: 'Mémoire',
      icon: <Sparkles className="h-4 w-4 text-violet-600" />,
      children: [
        { label: 'Dossiers suivis', href: `/sites/${siteId}/subjects`, count: data.subjectsOpen },
        { label: 'Atelier mémoire', href: `/memoire/${siteId}` },
        { label: 'Récit', href: `/sites/${siteId}/recit` },
      ],
    },
    {
      title: 'Documents',
      icon: <ShieldCheck className="h-4 w-4 text-emerald-600" />,
      children: [
        { label: 'Dossier de preuve', href: `/sites/${siteId}/preuves`, count: data.docs },
        { label: 'QR Code', href: `/sites/${siteId}/qr` },
        ...(data.canExport ? [{ label: 'Exporter', href: `/sites/${siteId}/export` }] : []),
      ],
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {domains.map((d) => (
        <section key={d.title} className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">{d.icon}{d.title}</span>
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
                {c.alert && (
                  <span className="rounded-full bg-rose-100 px-1.5 text-[11px] font-semibold text-rose-700">{c.alert}</span>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
