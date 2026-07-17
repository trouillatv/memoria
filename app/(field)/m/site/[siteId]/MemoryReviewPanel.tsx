'use client'

// ── LA MÉMOIRE ACTIONNABLE ───────────────────────────────────────────────────
// Le vide de « Ce que le chantier sait » n'était pas de l'UX : personne ne
// pouvait confirmer une information ou un intervenant, parce que le cycle métier
// était incomplet. Il l'est maintenant — cet écran est la moitié visible.
//
// LA RÈGLE : cet écran ne DÉCIDE d'aucun bouton. Il lit `capability`, fournie par
// le read model. Un type sans geste affiche son explication ; un type qui exige
// une réponse (le rôle, la nature) ouvre la question au lieu de planter.

import { useState, useTransition } from 'react'
import { Check, ChevronRight, Loader2, MapPin, X } from 'lucide-react'
import { promoteFromMemoryAction, dismissFromMemoryAction } from './memory-actions'
import type { MemoryReview, ReviewItem } from '@/lib/knowledge/memory-review'
import { frDayMonthLocal } from '@/lib/time/local-date'

/** Les rôles courants du chantier. Libre : le métier varie (mig 137). */
const ROLES = ['MOA', 'MOE', 'BET', 'ETV', 'OPC', 'CSPS', 'PAVE', 'PLANIF']

const KIND_LABEL: Record<string, string> = {
  knowledge: 'Information',
  stakeholder: 'Intervenant',
  decision: 'Décision',
  vigilance: 'Point de vigilance',
}

export function MemoryReviewPanel({ siteId, review }: { siteId: string; review: MemoryReview }) {
  // Le déplacement INSTANTANÉ : l'élément quitte « À examiner » au moment du
  // geste, sans attendre le rechargement. Sinon le conducteur clique, rien ne
  // bouge, et il doute d'avoir cliqué.
  const [done, setDone] = useState<Set<string>>(new Set())
  // Ce qui vient d'être retenu, dit tout de suite. La liste `confirmed` vient du
  // serveur et ne bougera qu'au rechargement ; on ne fait pas patienter.
  const [justConfirmed, setJustConfirmed] = useState<string[]>([])

  const remaining = review.toReview.filter((i) => !done.has(i.id))
  const groups = [...new Set(review.confirmed.map((c) => c.group))]

  return (
    <section className="space-y-4">
      {review.confirmed.length + justConfirmed.length === 0 ? (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ce que le chantier sait
          </h2>
          {/* Honnête, et bref : une grande carte vide donnerait l'impression d'un
              écran cassé. La phrase dit l'état réel, les propositions suivent tout
              de suite — c'est là qu'est le travail. */}
          <p className="mt-1 text-[13px] text-muted-foreground">Rien de confirmé pour l’instant.</p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g}</h2>
            <ul className="mt-2 space-y-1">
              {review.confirmed.filter((c) => c.group === g).map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-[13px] text-foreground/90">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="min-w-0">
                    {c.title}
                    {/* La nature choisie à la confirmation, enfin visible : sans
                        elle, la question posée n'aurait servi à rien. */}
                    {c.nature && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">· {c.nature}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {justConfirmed.length > 0 && (
        <ul className="space-y-1">
          {justConfirmed.map((t) => (
            <li key={t} className="flex items-start gap-2 text-[13px] text-foreground/90">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="min-w-0">{t}</span>
            </li>
          ))}
        </ul>
      )}

      {remaining.length > 0 && (
        <div>
          <h3 className="text-[13px] font-medium text-sky-700 dark:text-sky-300">
            À examiner ({remaining.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {remaining.map((item) => (
              <ReviewCard
                key={item.id}
                siteId={siteId}
                item={item}
                onDone={(promoted) => {
                  setDone((s) => new Set(s).add(item.id))
                  if (promoted) setJustConfirmed((l) => [...l, item.title])
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ReviewCard({
  siteId,
  item,
  onDone,
}: {
  siteId: string
  item: ReviewItem
  onDone: (promoted: boolean) => void
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Ce que l'écran doit DEMANDER — il ne le devine pas, la capability le dit.
  const [asking, setAsking] = useState<'role' | 'nature' | null>(null)

  function promote(extra: { role?: string; knowledge_kind?: 'current_information' | 'durable_knowledge' } = {}) {
    setError(null)
    start(async () => {
      const res = await promoteFromMemoryAction({ site_id: siteId, proposal_id: item.id, ...extra })
      if (res.ok) return onDone(true)
      // `needsInput` n'est pas une panne : c'est la question à poser.
      if (res.needsInput?.includes('role')) return setAsking('role')
      if (res.needsInput?.includes('nature')) return setAsking('nature')
      setError(res.error)
    })
  }

  function dismiss() {
    setError(null)
    start(async () => {
      const res = await dismissFromMemoryAction({ site_id: siteId, proposal_id: item.id })
      if (res.ok) return onDone(false)
      setError(res.error)
    })
  }

  return (
    <li className="rounded-xl border bg-card p-3">
      <p className="text-[12px] text-muted-foreground">{KIND_LABEL[item.kind] ?? item.kind}</p>
      <p className="mt-0.5 text-[13px] font-medium text-foreground/90">{item.title}</p>
      {item.body && <p className="mt-0.5 text-[13px] text-muted-foreground">{item.body}</p>}

      <Provenance item={item} />

      {asking === 'role' && (
        <div className="mt-2 rounded-lg bg-muted/50 p-2">
          <p className="text-[12px] text-muted-foreground">Son rôle sur le chantier ?</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending}
                onClick={() => promote({ role: r })}
                className="rounded-full border bg-background px-2.5 py-1 text-[12px] font-medium active:brightness-95 disabled:opacity-50"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {asking === 'nature' && (
        <div className="mt-2 space-y-1.5 rounded-lg bg-muted/50 p-2">
          {/* Deux choix, pas trois : une HABITUDE se constate sur plusieurs visites.
              L'offrir ici ferait d'une circonstance ponctuelle une règle générale. */}
          <p className="text-[12px] text-muted-foreground">Cette information est…</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => promote({ knowledge_kind: 'current_information' })}
            className="block w-full rounded-lg border bg-background px-2.5 py-1.5 text-left text-[13px] active:brightness-95 disabled:opacity-50"
          >
            <span className="font-medium">Vraie en ce moment</span>
            <span className="block text-[12px] text-muted-foreground">Elle pourra devenir fausse</span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => promote({ knowledge_kind: 'durable_knowledge' })}
            className="block w-full rounded-lg border bg-background px-2.5 py-1.5 text-left text-[13px] active:brightness-95 disabled:opacity-50"
          >
            <span className="font-medium">Vraie durablement</span>
            <span className="block text-[12px] text-muted-foreground">À savoir aux prochaines visites</span>
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-rose-600">{error}</p>}

      {!asking && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Le geste vient du contrat, jamais de l'écran. Pas de « Confirmer » nu :
              le bouton dit ce qui va se passer. */}
          {item.capability.available ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => promote()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground active:opacity-80 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {item.capability.label}
            </button>
          ) : (
            // Un type sans geste ne reste pas muet : il dit pourquoi.
            <p className="text-[12px] text-muted-foreground">{item.capability.explanation}</p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={dismiss}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground active:brightness-95 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Écarter
          </button>
        </div>
      )}
    </li>
  )
}

/** « Mentionné dans la visite du 15 juillet · 4 photos · 2 mémos » — et le lien
 *  vers la preuve. Sans provenance, le conducteur devrait croire MemorIA sur
 *  parole. (Cf. confiance-actif-transversal.) */
function Provenance({ item }: { item: ReviewItem }) {
  const p = item.provenance
  if (!p.reportId) return null
  const preuves = [
    p.photos > 0 ? `${p.photos} photo${p.photos > 1 ? 's' : ''}` : null,
    p.vocals > 0 ? `${p.vocals} mémo${p.vocals > 1 ? 's' : ''}` : null,
  ].filter(Boolean)
  return (
    <a
      href={`/m/visite/${p.reportId}/cr`}
      className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-muted-foreground active:text-foreground"
    >
      <MapPin className="h-3 w-3 shrink-0" />
      {p.visitedAt ? `Visite du ${frDayMonthLocal(p.visitedAt)}` : 'Issue d’une visite'}
      {preuves.length > 0 && ` · ${preuves.join(' · ')}`}
      <ChevronRight className="h-3 w-3 shrink-0" />
    </a>
  )
}
