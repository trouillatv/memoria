'use client'

// ── « TRAVAILLE PRINCIPALEMENT AVEC » + ÉCOSYSTÈME (V3, étape 5B) ─────────────
// Rend visibles et EXPLICABLES les relations d'un acteur, à partir du read model
// (étape 5A) — aucun recalcul ici, aucun qualificatif inventé. Chaque relation se
// déplie en « Pourquoi proche ? » (contributions réelles → sources cliquables).

import { useState } from 'react'
import Link from 'next/link'
import { User, Building2, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { trendUiLabel, type ActorRelationsResult, type ActorRelationView } from '@/lib/knowledge/actor-relation-view'

const fmt = (n: number): string => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const frDate = (iso: string | null): string | null =>
  iso ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T00:00:00Z`)) : null

/** État factuel de la relation (jamais de qualificatif si tendance non concluante). */
function statusLine(v: ActorRelationView): string {
  const t = trendUiLabel(v.activity.trend)
  if (t) return t
  const n = v.interactionCount
  return `${n} interaction${n > 1 ? 's' : ''} observée${n > 1 ? 's' : ''}` // insufficient_data → factuel
}
function recencyLine(v: ActorRelationView): string {
  if (v.daysSinceLastInteraction === 0 && v.activeInteractionCount > 0) return 'actif actuellement'
  const d = v.daysSinceLastInteraction
  return `dernière interaction il y a ${d} jour${d > 1 ? 's' : ''}`
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 mt-3.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</p>
}

export function ActorRelationsPanel({ data }: { data: ActorRelationsResult }) {
  const top = data.relations.slice(0, 5)
  if (top.length === 0) {
    return (
      <>
        <Label>Travaille principalement avec</Label>
        {/* État vide HONNÊTE — l'absence de données ne permet aucun jugement. */}
        <p className="text-[12.5px] text-muted-foreground">Aucune collaboration structurelle connue avec cet acteur.</p>
      </>
    )
  }
  return (
    <>
      <Label>Travaille principalement avec</Label>
      <ul className="space-y-1.5">
        {top.map((v) => <RelationRow key={`${v.actor.kind}:${v.actor.id}`} v={v} />)}
      </ul>
      <Ecosystem eco={data.ecosystem} shownIds={new Set(top.map((v) => `${v.actor.kind}:${v.actor.id}`))} />
    </>
  )
}

function RelationRow({ v }: { v: ActorRelationView }) {
  const [open, setOpen] = useState(false)
  const Icon = v.actor.kind === 'company' ? Building2 : User
  return (
    <li className="rounded-lg border border-border/60">
      <div className="flex items-start gap-2 p-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {v.actor.href
              ? <Link href={v.actor.href} className="truncate text-[13px] font-semibold hover:underline">{v.actor.label}</Link>
              : <span className="truncate text-[13px] font-semibold">{v.actor.label}</span>}
          </div>
          <p className="text-[11.5px] text-muted-foreground">{statusLine(v)}</p>
          <p className="text-[11.5px] text-muted-foreground">
            <span className="font-medium text-foreground/80 tabular-nums">Force {fmt(v.strength)}</span> · {recencyLine(v)}
          </p>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted" aria-expanded={open} aria-label="Pourquoi proche ?">
          {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {open && (
        <div className="border-t border-border/50 p-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pourquoi proche ?</p>
          <ul className="space-y-1.5">
            {v.explanation.map((e, i) => (
              <li key={i} className="text-[12px]">
                <div className="flex items-center gap-1">
                  {e.sourceHref
                    ? <Link href={e.sourceHref} className="inline-flex items-center gap-0.5 font-medium hover:underline">{e.sourceLabel}<ExternalLink className="h-3 w-3" aria-hidden /></Link>
                    : <span className="font-medium">{e.sourceLabel}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {explanationWhen(e)} · <span className="tabular-nums">contribution {fmt(e.currentContribution)}</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 border-t border-border/40 pt-1.5 text-[11.5px] font-medium tabular-nums">Force totale : {fmt(v.strength)}</p>
        </div>
      )}
    </li>
  )
}

function explanationWhen(e: ActorRelationView['explanation'][number]): string {
  if (e.interactionType === 'co_action') return `le ${frDate(e.observedAt) ?? '—'}`
  if (e.isActive) return `active depuis le ${frDate(e.activeFrom) ?? '—'}`
  return `terminée le ${frDate(e.activeTo ?? null) ?? '—'}`
}

/** Écosystème compact : relations récentes / inactives (hiérarchie par ordre, sans
 *  qualificatif de type « allié » / « stratégique »). Ne répète pas le top déjà montré. */
function Ecosystem({ eco, shownIds }: { eco: ActorRelationsResult['ecosystem']; shownIds: Set<string> }) {
  const key = (v: ActorRelationView) => `${v.actor.kind}:${v.actor.id}`
  const recent = eco.recent.filter((v) => !shownIds.has(key(v)))
  const inactive = eco.inactive.filter((v) => !shownIds.has(key(v)))
  if (recent.length === 0 && inactive.length === 0) return null
  return (
    <>
      {recent.length > 0 && (
        <>
          <Label>Relations récentes</Label>
          <ul className="space-y-0.5">{recent.map((v) => <EcoRow key={key(v)} v={v} />)}</ul>
        </>
      )}
      {inactive.length > 0 && (
        <>
          <Label>Relations inactives encore significatives</Label>
          <ul className="space-y-0.5">{inactive.map((v) => <EcoRow key={key(v)} v={v} />)}</ul>
        </>
      )}
    </>
  )
}

function EcoRow({ v }: { v: ActorRelationView }) {
  return (
    <li className="flex items-center justify-between gap-2 text-[12px]">
      {v.actor.href
        ? <Link href={v.actor.href} className="truncate hover:underline">{v.actor.label}</Link>
        : <span className="truncate">{v.actor.label}</span>}
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {trendUiLabel(v.activity.trend) ?? `${v.interactionCount} interaction${v.interactionCount > 1 ? 's' : ''}`} · <span className="tabular-nums">{fmt(v.strength)}</span>
      </span>
    </li>
  )
}
