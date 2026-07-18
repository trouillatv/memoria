'use client'

// ── ONGLET « INTERVENANTS » — qui travaille sur ce chantier ──────────────────
// Maquette validée 2026-07-18 (docs/design/intervenants-maquette.html, v3) :
//   · liste compacte groupée par ENTREPRISE (« qui est chez PAVE ? ») ;
//   · une ligne = UN fait à droite (dernière activité + point vert si action
//     ouverte) — les chiffres respirent dans la fiche, jamais en enfilade ;
//   · « À identifier » = la couche IA (indigo reading-*), jamais mélangée au
//     confirmé ; rien n'entre dans le casting sans confirmation humaine ;
//   · la FICHE NARRATIVE répond à « c'était qui déjà ? » en 20 secondes —
//     pas une fiche de gestion : coordonnées repliées, jamais au premier niveau.
// La liste sert à trouver, la fiche à se remettre le contexte, Explorer à
// comprendre. Un seul cycle de promotion : promoteFromMemoryAction.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Check, ChevronDown, ChevronRight, Loader2, Network, Phone, Plus, Search, Users, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { frDayMonthLocal } from '@/lib/time/local-date'
import { splitPersonCompany, looksLikePerson } from '@/lib/knowledge/person-name'
import type {
  IntervenantPerson, SiteIntervenantsView, ToIdentifyItem,
} from '@/lib/knowledge/site-intervenants-view'
import { promoteFromMemoryAction, dismissFromMemoryAction } from '@/app/(field)/m/site/[siteId]/memory-actions'
import {
  associateContactAction, logIntervenantFicheOpenedAction, searchOrgContactsAction, type OrgContactHit,
} from './intervenants-actions'

/** Les rôles courants du chantier — la même liste libre que la Mémoire (mig 137). */
const ROLES = ['MOA', 'MOE', 'BET', 'ETV', 'OPC', 'CSPS', 'PAVE', 'PLANIF']

export function IntervenantsWorkspace({ view }: { view: SiteIntervenantsView }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'action'>('all')
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<IntervenantPerson | null>(null)
  const [associating, setAssociating] = useState(false)
  // Les propositions traitées pendant la session — retrait optimiste, le serveur
  // reste la source (router.refresh()).
  const [done, setDone] = useState<ReadonlySet<string>>(new Set())

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => view.groups
    .map((g) => ({
      ...g,
      people: g.people.filter((p) => {
        if (filter === 'action' && p.openActions === 0) return false
        if (!q) return true
        return `${p.name} ${p.companyName} ${p.role} ${p.fonction ?? ''}`.toLowerCase().includes(q)
      }),
    }))
    .filter((g) => g.people.length > 0), [view.groups, filter, q])

  const toIdentify = view.toIdentify.filter((t) => !done.has(t.proposalId))

  return (
    <main className="space-y-4">
      <section className="rounded-[18px] border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Intervenants du chantier
            </h2>
          </div>
          <span className="text-sm font-semibold tabular-nums">{view.confirmedCount}</span>
          {toIdentify.length > 0 && (
            <span className="rounded-full bg-reading-bg px-2 py-0.5 text-[11px] font-medium text-reading-label ring-1 ring-reading-border">
              {toIdentify.length} à identifier
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground">
            <Search className="h-4 w-4 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher"
              className="w-full bg-transparent text-foreground outline-none"
            />
          </label>
          <div className="flex gap-1.5" role="group" aria-label="Filtres">
            <FilterChip on={filter === 'all'} onClick={() => setFilter('all')}>Tous</FilterChip>
            <FilterChip on={filter === 'action'} onClick={() => setFilter('action')}>Avec action ouverte</FilterChip>
          </div>
          <button
            type="button"
            onClick={() => setAssociating((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Associer une personne existante…
          </button>
        </div>

        {associating && (
          <AssociatePanel
            siteId={view.siteId}
            onDone={() => { setAssociating(false); router.refresh() }}
          />
        )}

        {view.confirmedCount === 0 && toIdentify.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Personne pour l’instant. Les intervenants apparaissent quand MemorIA les entend
            dans vos visites — ou associez une personne déjà connue.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {groups.map((g) => {
              const isClosed = closed.has(g.companyId)
              return (
                <div key={g.companyId} className="overflow-hidden rounded-xl border">
                  <button
                    type="button"
                    onClick={() => setClosed((s) => {
                      const n = new Set(s)
                      if (n.has(g.companyId)) n.delete(g.companyId); else n.add(g.companyId)
                      return n
                    })}
                    className="flex w-full items-center gap-2.5 bg-muted/40 px-3.5 py-2.5 text-left"
                  >
                    {isClosed
                      ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="text-[13.5px] font-semibold">{g.companyName}</span>
                    <span className="text-[12.5px] text-muted-foreground">{g.roles.join(' · ')}</span>
                    <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
                      {g.people.length} {g.people.length > 1 ? 'personnes' : g.people.some((p) => p.isPerson) ? 'personne' : 'entreprise'}
                    </span>
                  </button>
                  {!isClosed && g.people.map((p) => (
                    <button
                      key={p.intervenantId}
                      type="button"
                      onClick={() => {
                        setSelected(p)
                        // L'observation du lot : d'où vient-on à la fiche ?
                        void logIntervenantFicheOpenedAction({ site_id: view.siteId, source: 'tab' })
                      }}
                      className={cn(
                        'flex w-full items-baseline gap-2.5 border-t px-3.5 py-2.5 text-left hover:bg-primary/5',
                        selected?.intervenantId === p.intervenantId && 'bg-primary/5',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="text-[13.5px] font-semibold">{p.name}</span>
                        <span className="ml-2 text-[12.5px] text-muted-foreground">
                          {p.fonction ?? (p.isPerson ? p.role : `Rôle ${p.role}`)}
                        </span>
                      </span>
                      {/* UN fait à droite : la dernière activité. Le point vert =
                          au moins une action ouverte portée par son rôle. */}
                      <span className="ml-auto hidden shrink-0 text-[12.5px] text-muted-foreground/80 sm:inline">
                        {p.openActions > 0 && <span className="mr-1 text-emerald-600">●</span>}
                        {p.lastActivity ? frDayMonthLocal(p.lastActivity) : null}
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* Ce que MemorIA a ENTENDU mais ne connaît pas encore — la couche IA,
            jamais mélangée au confirmé. */}
        {toIdentify.length > 0 && (
          <div className="mt-5 rounded-xl border border-dashed border-reading-border bg-reading-bg p-3.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-reading-label">À identifier</h3>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Des personnes citées dans les visites et mémos, que MemorIA ne connaît pas encore.
              Rien n’entre dans le casting sans votre confirmation.
            </p>
            <ul className="mt-2 space-y-2">
              {toIdentify.map((item) => (
                <IdentifyCard
                  key={item.proposalId}
                  siteId={view.siteId}
                  item={item}
                  onDone={() => {
                    setDone((s) => new Set(s).add(item.proposalId))
                    router.refresh()
                  }}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <FicheSheet siteId={view.siteId} person={selected} onClose={() => setSelected(null)} />
    </main>
  )
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-[12.5px]',
        on ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

// ── « À identifier » : le geste d'identification ─────────────────────────────
function IdentifyCard({ siteId, item, onDone }: { siteId: string; item: ToIdentifyItem; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const guess = splitPersonCompany(item.title)
  const [personName, setPersonName] = useState(
    item.suggestion?.name ?? guess.person ?? (looksLikePerson(item.title) ? item.title : ''),
  )
  const [companyName, setCompanyName] = useState(item.suggestion?.companyName ?? guess.company ?? '')

  function promote(extra: { person_name?: string; company_name?: string; contact_id?: string | null }) {
    if (!role) return
    setError(null)
    start(async () => {
      const res = await promoteFromMemoryAction({ site_id: siteId, proposal_id: item.proposalId, role, ...extra })
      if (res.ok) return onDone()
      setError(res.error)
    })
  }

  function dismiss() {
    setError(null)
    start(async () => {
      const res = await dismissFromMemoryAction({ site_id: siteId, proposal_id: item.proposalId })
      if (res.ok) return onDone()
      setError(res.error)
    })
  }

  const source = [
    `Cité${item.mentionCount > 1 ? ` ${item.mentionCount} fois` : ''}`,
    item.visitDates.length > 0 ? `visite du ${item.visitDates.map((d) => frDayMonthLocal(d)).join(', du ')}` : null,
  ].filter(Boolean).join(' — ')

  return (
    <li className="rounded-lg border border-reading-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold">« {item.title} »</p>
          <p className="text-[12.5px] text-muted-foreground">{source}</p>
          {item.suggestion && (
            <p className="text-[12.5px] text-reading-label">
              Correspond peut-être à {item.suggestion.name} ({item.suggestion.companyName})
            </p>
          )}
        </div>
        {!open && (
          <div className="ml-auto flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen(true)}
              className="rounded-lg border bg-background px-3 py-1.5 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-50"
            >
              Identifier
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={dismiss}
              className="rounded-lg px-2 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              aria-label="Écarter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-2.5">
          <p className="text-[12px] text-muted-foreground">Son rôle sur le chantier ?</p>
          <div className="flex flex-wrap gap-1.5">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending}
                aria-pressed={role === r}
                onClick={() => setRole(r)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] font-medium disabled:opacity-50',
                  role === r ? 'border-foreground bg-foreground text-background' : 'bg-background',
                )}
              >
                {r}
              </button>
            ))}
          </div>

          {item.suggestion && (
            <button
              type="button"
              disabled={pending || !role}
              onClick={() => promote({
                contact_id: item.suggestion!.contactId,
                company_name: item.suggestion!.companyName,
              })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              C’est {item.suggestion.name}
            </button>
          )}

          <div className="space-y-1.5">
            <input
              type="text"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Personne (laisser vide si entreprise seule)"
              className="block w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
            />
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Entreprise"
              className="block w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
            />
            {personName.trim() && !companyName.trim() && (
              <p className="text-[12px] text-muted-foreground">Une personne s’ajoute avec son entreprise.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={
                pending || !role
                || (!personName.trim() && !companyName.trim())
                || (!!personName.trim() && !companyName.trim())
              }
              onClick={() => promote({
                person_name: personName.trim() || undefined,
                company_name: companyName.trim() || undefined,
              })}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-[13px] font-medium hover:bg-muted disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {personName.trim() ? 'Ajouter la personne' : 'Ajouter l’entreprise'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
              className="text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              Annuler
            </button>
          </div>
          {error && <p className="text-[12px] text-rose-600">{error}</p>}
        </div>
      )}
    </li>
  )
}

// ── « Associer une personne existante » — réutiliser, jamais recréer ─────────
function AssociatePanel({ siteId, onDone }: { siteId: string; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<OrgContactHit[]>([])
  const [picked, setPicked] = useState<OrgContactHit | null>(null)
  const [error, setError] = useState<string | null>(null)

  function search(value: string) {
    setQ(value)
    setPicked(null)
    setError(null)
    if (value.trim().length < 2) return setHits([])
    start(async () => {
      const res = await searchOrgContactsAction({ site_id: siteId, q: value })
      if (res.ok) setHits(res.hits)
    })
  }

  function associate(role: string) {
    if (!picked) return
    setError(null)
    start(async () => {
      const res = await associateContactAction({ site_id: siteId, contact_id: picked.contactId, role })
      if (res.ok) return onDone()
      setError(res.error)
    })
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border bg-muted/30 p-3">
      <input
        type="search"
        value={q}
        onChange={(e) => search(e.target.value)}
        placeholder="Nom de la personne déjà connue…"
        className="block w-full rounded-lg border bg-background px-3 py-2 text-[13px]"
      />
      {hits.length > 0 && !picked && (
        <ul className="space-y-1">
          {hits.map((h) => (
            <li key={h.contactId}>
              <button
                type="button"
                onClick={() => setPicked(h)}
                className="flex w-full items-baseline gap-2 rounded-lg border bg-background px-3 py-2 text-left hover:bg-muted"
              >
                <span className="text-[13px] font-semibold">{h.name}</span>
                <span className="text-[12.5px] text-muted-foreground">
                  {[h.companyName, h.fonction].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && hits.length === 0 && !pending && !picked && (
        <p className="text-[12.5px] text-muted-foreground">
          Personne à ce nom dans le registre. Les personnes citées se confirment depuis « À identifier ».
        </p>
      )}
      {picked && (
        <div className="space-y-1.5">
          <p className="text-[12.5px] text-muted-foreground">
            Rôle de {picked.name} sur CE chantier ?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending}
                onClick={() => associate(r)}
                className="rounded-full border bg-background px-2.5 py-1 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-[12px] text-rose-600">{error}</p>}
    </div>
  )
}

// ── LA FICHE NARRATIVE — « c'était qui déjà ? » en 20 secondes ───────────────
function FicheSheet({ siteId, person, onClose }: {
  siteId: string
  person: IntervenantPerson | null
  onClose: () => void
}) {
  if (!person) return null
  const p = person

  // Une phrase DÉTERMINISTE, composée de faits — jamais un texte inventé.
  const phrase = p.isPerson
    ? `${p.fonction ?? 'Interlocuteur'} ${p.companyName} — rôle ${p.role} sur ce chantier.`
    : `Entreprise du chantier — rôle ${p.role}.`
  const provenance = p.citedVisits.length > 0
    ? `D’après ${p.citedVisits.length} visite${p.citedVisits.length > 1 ? 's' : ''} et le casting du chantier.`
    : 'D’après le casting du chantier.'

  const timeline: Array<{ date: string | null; label: string }> = [
    ...p.citedVisits.slice(0, 2).map((v) => ({ date: v.date, label: 'Cité pendant cette visite' })),
    { date: p.firstSeen, label: 'Première apparition dans la mémoire' },
  ]

  const infos: Array<[string, string]> = []
  if (p.phone) infos.push(['Téléphone', p.phone])
  if (p.mobile) infos.push(['Mobile', p.mobile])
  if (p.email) infos.push(['Mail', p.email])

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="pb-0">
          <SheetTitle className="text-base font-semibold">{p.name}</SheetTitle>
          <p className="text-[13px] text-muted-foreground">
            {[p.companyName, p.fonction ?? `Rôle ${p.role}`].filter(Boolean).join(' · ')}
          </p>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <section>
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">En une phrase</h4>
            <p className="mt-1 text-[13.5px]">{phrase}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground/80">{provenance}</p>
          </section>

          {p.openActions > 0 && (
            <section>
              <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Aujourd’hui</h4>
              <p className="mt-1 text-[13px]">
                <Check className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
                {p.openActions} action{p.openActions > 1 ? 's' : ''} ouverte{p.openActions > 1 ? 's' : ''} pour {p.role}
              </p>
            </section>
          )}

          <section>
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Pourquoi {p.isPerson ? 'est-il ici' : 'est-elle ici'} ?
            </h4>
            <p className="mt-1 text-[13.5px]">
              {p.citedVisits.length > 0
                ? `Cité${p.isPerson ? '' : 'e'} dans ${p.citedVisits.length} visite${p.citedVisits.length > 1 ? 's' : ''} de ce chantier, et confirmé${p.isPerson ? '' : 'e'} par un humain.`
                : 'Ajouté au casting du chantier par un humain.'}
            </p>
          </section>

          <section>
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Dernières activités</h4>
            <ul className="mt-2 space-y-2 border-l-2 pl-3">
              {timeline.map((t, i) => (
                <li key={i} className="text-[13px]">
                  <span className="block text-[12px] text-muted-foreground">
                    {t.date ? frDayMonthLocal(t.date) : '—'}
                  </span>
                  {t.label}
                </li>
              ))}
            </ul>
          </section>

          {p.elsewhere.length > 0 && (
            <section>
              <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Ailleurs</h4>
              <ul className="mt-1 space-y-1">
                {p.elsewhere.slice(0, 4).map((e) => (
                  <li key={e.siteId} className="text-[13px]">
                    <Link href={`/sites/${e.siteId}?tab=intervenants`} className="hover:underline">
                      {e.siteName}
                    </Link>
                    <span className="text-muted-foreground"> — rôle {e.role}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Coordonnées REPLIÉES : la fiche est narrative, pas un CRM. */}
          {infos.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                Informations
              </summary>
              <ul className="mt-1 space-y-1">
                {infos.map(([k, v]) => (
                  <li key={k} className="text-[13px]">
                    <span className="text-muted-foreground">{k}</span> · {v}
                    {(k === 'Téléphone' || k === 'Mobile') && (
                      <a href={`tel:${v.replace(/\s/g, '')}`} className="ml-2 text-primary">
                        <Phone className="inline h-3 w-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <Link
            href={`/sites/${siteId}?tab=explorer`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium hover:bg-muted"
          >
            <Network className="h-4 w-4" /> Voir dans Explorer
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}
