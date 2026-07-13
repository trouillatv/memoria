import Link from 'next/link'
import { BookText, ListTodo, Sparkles, ShieldCheck, Clock, AlertTriangle, ClipboardCheck, Layers } from 'lucide-react'
import type { MemorySignal } from '@/lib/db/site-memory-signals'

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

export function SiteDomainHub({ siteId, data, signals }: { siteId: string; data: SiteHubData; signals: MemorySignal[] }) {
  const lastVisit = relDate(data.lastVisitAt)

  const domains: HubDomain[] = [
    // ── CHRONOLOGIE ──────────────────────────────────────────────────────
    // « Tout ce qui s'est passé, dans l'ordre. » Le RÉCIT est un MODE DE
    // LECTURE de la chronologie, pas une fonction indépendante — il vit donc
    // ici, plus dans « Mémoire ». Pas de « Frise » tant qu'elle n'existe pas :
    // un segment qui mène à un écran vide est une navigation factice.
    {
      question: 'Chronologie',
      icon: <BookText className="h-4 w-4 text-sky-600" />,
      hint: lastVisit ? `dernière visite ${lastVisit}` : 'tout ce qui s’est passé, dans l’ordre',
      children: [
        { label: 'Flux', href: `/sites/${siteId}/chronicle` },
        { label: 'Lire le récit', href: `/sites/${siteId}/recit` },
        { label: 'Visites', href: `/sites/${siteId}/visites`, count: data.visits },
      ],
    },
    // ── OPÉRATIONNEL — inchangé : la composition validée ne le couvre pas. ──
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
    // ── MÉMOIRE ──────────────────────────────────────────────────────────
    // Ce qui restera utile dans trois mois, même pour quelqu'un qui reprend le
    // chantier. Jamais le mot « signaux » ici : ce sont des connaissances
    // DURABLES, pas des alertes. « Dossiers vivants » est le nom montré ;
    // la route et le vocabulaire technique (subjects) restent inchangés.
    {
      question: 'Mémoire',
      icon: <Sparkles className="h-4 w-4 text-violet-600" />,
      hint: 'ce qui restera utile dans trois mois',
      children: [
        { label: 'Dossiers vivants', href: `/sites/${siteId}/subjects`, count: data.subjectsOpen },
        { label: 'Explorer la mémoire', href: `/memoire/${siteId}` },
      ],
    },
    // ── DOCUMENTS & PREUVES ──────────────────────────────────────────────
    // La BIBLIOTHÈQUE est l'entrée principale (tous les documents du chantier).
    // Le dossier de preuves est un accès CONTEXTUALISÉ — une sélection pour
    // démontrer ou valider — jamais un nom concurrent de la bibliothèque.
    // QR Code : « Ouvrir » seulement — pas de « Gérer » tant qu'aucune vraie
    // fonction de gestion n'existe.
    {
      question: 'Documents & preuves',
      icon: <ShieldCheck className="h-4 w-4 text-emerald-600" />,
      hint: data.docs > 0 ? `${data.docs} document${data.docs > 1 ? 's' : ''}` : null,
      children: [
        { label: 'Bibliothèque', href: `/sites/${siteId}/documents`, count: data.docs },
        { label: 'Dossiers de preuves', href: `/sites/${siteId}/preuves` },
        { label: 'Ouvrir le QR Code', href: `/sites/${siteId}/qr` },
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

      {/* Ce qui demande ton attention — la SYNTHÈSE (signaux mémoire déterministes).
          La page RÉPOND avant de faire naviguer. Wording calme et descriptif ; le
          détail s'approfondit dans les sections ci-dessous. */}
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800/80 dark:text-amber-300/80">
          Ce qui demande ton attention
        </div>
        {signals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Rien ne demande ton attention pour l&apos;instant.</p>
        ) : (
          <ul className="space-y-2">
            {signals.slice(0, 5).map((s) => (
              <li key={s.kind}>
                <div className="text-sm font-medium">{s.title}</div>
                <ul className="mt-0.5 space-y-0.5">
                  {s.items.slice(0, 3).map((it) => (
                    <li key={it.id} className="flex gap-1.5 text-xs text-muted-foreground">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500/70" aria-hidden />
                      <span className="min-w-0">
                        {it.label}
                        {it.meta && <span className="text-muted-foreground/70"> — {it.meta}</span>}
                      </span>
                    </li>
                  ))}
                  {s.items.length > 3 && (
                    <li className="pl-2.5 text-xs text-muted-foreground/70">+{s.items.length - 3} autre{s.items.length - 3 > 1 ? 's' : ''}</li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Les 4 lectures métier — pour APPROFONDIR, plus pour découvrir. */}
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
