'use client'

// Point 11A — colonne de LECTURE du Brief mobile, convergée sur LiveDebrief
// (vérité commune desktop/mobile). LECTURE SEULE : aucun geste, aucun ajout au
// plan ici (le plan reste dans VisitBriefClient, mécanique P1-A inchangée). La
// sobriété est la règle : « À traiter » plafonné à 5 objets NOMMÉS + « Voir plus »,
// jamais un compteur « 5 actions » à la place des objets. La qualité des raisons
// de « À surveiller » n'est PAS traitée ici (point 14).

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { LiveDebriefItem, LiveDebriefSinceLastVisit, LiveDebriefConfirmedToday } from '@/lib/knowledge/live-debrief'

const TO_HANDLE_MAX = 5
const TO_WATCH_MAX = 5
const SINCE_MAX = 5

const DELTA_PREFIX: Record<string, string> = {
  reserve_lifted: 'Réserve levée',
  reserve_new: 'Nouvelle réserve',
  decision_new: 'Décision',
  action_done: 'Action terminée',
  meeting: 'Réunion',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

/** Une ligne objet/signal LiveDebrief — titre NOMMÉ, lien vers l'objet, lecture seule. */
function ItemRow({ item }: { item: LiveDebriefItem }) {
  const reason = item.kind === 'informational_signal' && item.reasons.length > 0 ? item.reasons[0] : null
  return (
    <Link href={item.href} className="flex items-start gap-3 py-2.5 active:opacity-60">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-snug text-foreground">{item.title}</span>
        {reason && <span className="block text-[12px] leading-snug text-muted-foreground">{reason}</span>}
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** Liste plafonnée + « Voir plus » (jamais un agrégat en remplacement des objets). */
function CappedItemList({ items, max }: { items: LiveDebriefItem[]; max: number }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items : items.slice(0, max)
  const rest = items.length - shown.length
  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-card px-4">
      <div className="divide-y divide-foreground/[0.06]">
        {shown.map((item) => (
          <ItemRow key={item.kind === 'informational_signal' ? item.signalKey : `${item.kind}:${item.id}`} item={item} />
        ))}
      </div>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-foreground/[0.06] py-2.5 text-left text-[13px] font-medium text-foreground/70 active:opacity-70"
        >
          Voir plus ({rest} autre{rest > 1 ? 's' : ''})
        </button>
      )}
    </div>
  )
}

export function PrepareReadSpine({
  objective,
  toHandle,
  toWatch,
  sinceLastVisit,
  confirmedToday,
}: {
  objective: { text: string; href: string | null } | null
  toHandle: LiveDebriefItem[]
  toWatch: LiveDebriefItem[]
  sinceLastVisit: LiveDebriefSinceLastVisit
  confirmedToday: LiveDebriefConfirmedToday
}) {
  // « Ce que je dois retenir » — SEULE l'info contextuelle UNIQUE survit : le
  // prochain passage prévu. Les compteurs (actions/réserves/échéances) de
  // confirmedToday dupliquent « À traiter » → jamais répétés (audit item par item).
  const nextEvent = confirmedToday.nextEvent

  return (
    <div className="space-y-6">
      {/* 1 — Pourquoi j'y vais */}
      {objective && (
        <Section title="Pourquoi j'y vais">
          <div className="rounded-2xl border border-foreground/[0.06] bg-card px-4 py-3">
            {objective.href ? (
              <Link href={objective.href} className="text-[14px] font-medium leading-snug active:opacity-70">
                {objective.text}
              </Link>
            ) : (
              <p className="text-[14px] font-medium leading-snug">{objective.text}</p>
            )}
          </div>
        </Section>
      )}

      {/* 2 — À traiter */}
      {toHandle.length > 0 && (
        <Section title="À traiter">
          <CappedItemList items={toHandle} max={TO_HANDLE_MAX} />
        </Section>
      )}

      {/* 3 — À surveiller (qualité des raisons = point 14, pas ici) */}
      {toWatch.length > 0 && (
        <Section title="À surveiller">
          <CappedItemList items={toWatch} max={TO_WATCH_MAX} />
        </Section>
      )}

      {/* 4 — Depuis la dernière venue : items NOMMÉS, un seul delta, vérité
          personnelle 9+10 (personal ⇒ « votre », sinon « la dernière visite »). */}
      {sinceLastVisit.kind === 'delta' && (
        <Section
          title={`${sinceLastVisit.personal ? 'Depuis votre dernière venue' : 'Depuis la dernière visite'} · ${sinceLastVisit.visitDateLabel}`}
        >
          {sinceLastVisit.items.length === 0 ? (
            <p className="rounded-2xl border border-foreground/[0.06] bg-card px-4 py-3 text-[13px] text-muted-foreground">
              Rien de nouveau depuis {sinceLastVisit.personal ? 'votre passage' : 'la dernière visite'}.
            </p>
          ) : (
            <div className="rounded-2xl border border-foreground/[0.06] bg-card px-4">
              <div className="divide-y divide-foreground/[0.06]">
                {sinceLastVisit.items.slice(0, SINCE_MAX).map((it, i) => (
                  <div key={i} className="py-2.5">
                    <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                      {DELTA_PREFIX[it.kind] ?? 'Changement'}
                    </span>
                    <span className="block text-[13px] font-medium leading-snug">{it.label}</span>
                  </div>
                ))}
              </div>
              {sinceLastVisit.overflow > 0 && (
                <p className="border-t border-foreground/[0.06] py-2.5 text-[13px] text-muted-foreground">
                  +{sinceLastVisit.overflow} autre{sinceLastVisit.overflow > 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </Section>
      )}

      {/* 5 — Ce que je dois retenir : uniquement l'info contextuelle unique */}
      {nextEvent && (
        <Section title="Ce que je dois retenir">
          <div className="rounded-2xl border border-foreground/[0.06] bg-card px-4 py-3">
            {nextEvent.href ? (
              <Link href={nextEvent.href} className="text-[14px] font-medium leading-snug active:opacity-70">
                Prochain passage prévu : {nextEvent.title}
              </Link>
            ) : (
              <p className="text-[14px] font-medium leading-snug">Prochain passage prévu : {nextEvent.title}</p>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}
