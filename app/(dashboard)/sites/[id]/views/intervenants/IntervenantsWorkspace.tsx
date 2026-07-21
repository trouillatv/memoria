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
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Plus, Search, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { frDayMonthLocal } from '@/lib/time/local-date'
import type { IntervenantPerson, SiteIntervenantsView } from '@/lib/knowledge/site-intervenants-view'
import {
  associateContactAction, logIntervenantFicheOpenedAction, searchOrgContactsAction, type OrgContactHit,
} from './intervenants-actions'
import { IntervenantFicheSheet } from './IntervenantFiche'
import { IdentifyCard } from './IdentifyCard'

/** Les rôles courants du chantier — la même liste libre que la Mémoire (mig 137). */
const ROLES = ['MOA', 'MOE', 'BET', 'ETV', 'OPC', 'CSPS', 'PAVE', 'PLANIF']

export function IntervenantsWorkspace({ view }: { view: SiteIntervenantsView }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
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
        if (!q) return true
        return `${p.name} ${p.companyName} ${p.role} ${p.fonction ?? ''}`.toLowerCase().includes(q)
      }),
    }))
    .filter((g) => g.people.length > 0), [view.groups, q])

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
            <span className="rounded-full bg-reading-bg/10 px-2 py-0.5 text-[11px] font-medium text-reading-label ring-1 ring-reading-border/40">
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
          {/* Le filtre « Avec action ouverte » reposait sur le signal rôle↔texte
              retiré en Slice 0 ; il reviendra en Slice 3 sur la vraie relation. */}
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
                      {/* UN fait à droite : la dernière activité. (Le point vert
                          « action ouverte » reposait sur le signal rôle↔texte
                          retiré en Slice 0 — il reviendra sur la vraie relation.) */}
                      <span className="ml-auto hidden shrink-0 text-[12.5px] text-muted-foreground/80 sm:inline">
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
          <div className="mt-5 rounded-xl border border-dashed border-reading-border/60 bg-reading-bg/[0.07] p-3.5">
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

      <IntervenantFicheSheet siteId={view.siteId} person={selected} onClose={() => setSelected(null)} />
    </main>
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

// La fiche narrative vit désormais dans IntervenantFiche.tsx (composant partagé,
// ouvert PARTOUT : onglet, Explorer, recherche, objets métier).
