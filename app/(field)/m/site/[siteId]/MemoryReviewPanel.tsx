'use client'

// ── LA MÉMOIRE ACTIONNABLE ───────────────────────────────────────────────────
// « À confirmer » est une INBOX, pas une page de lecture : voici ce que l'IA
// propose, voici ce que votre validation produira. Doctrine :
//   · la proposition décrit ce que l'IA croit avoir trouvé ; le BOUTON décrit
//     exactement ce que l'humain va autoriser (capability.label, jamais décidé ici) ;
//   · cartes COMPACTES — nature, contenu, source, conséquence visibles sans ouvrir ;
//     l'extrait complet et « Écarter » vivent dans le détail (⋯) ;
//   · filtres par CONSÉQUENCE métier (Personnes / Engagements / Connaissances),
//     déduits du type d'objet — jamais une appréciation opaque ;
//   · les propositions ne sont JAMAIS mélangées aux connaissances validées.

import { useMemo, useState, useTransition } from 'react'
import { Check, ChevronRight, Loader2, MapPin, MoreHorizontal, X } from 'lucide-react'
import { promoteFromMemoryAction, dismissFromMemoryAction } from './memory-actions'
import { WhyButton } from '@/components/provenance/WhyButton'
import { cn } from '@/lib/utils'
import type { MemoryReview, ReviewItem } from '@/lib/knowledge/memory-review'
import { frDayMonthLocal } from '@/lib/time/local-date'
import { splitPersonCompany, looksLikePerson } from '@/lib/knowledge/person-name'

/** Les rôles courants du chantier. Libre : le métier varie (mig 137). */
const ROLES = ['MOA', 'MOE', 'BET', 'ETV', 'OPC', 'CSPS', 'PAVE', 'PLANIF']

const KIND_LABEL: Record<string, string> = {
  knowledge: 'Information',
  stakeholder: 'Intervenant',
  decision: 'Décision',
  vigilance: 'Vigilance',
}

// La FAMILLE = la conséquence de la validation, déduite du type (jamais inventée) :
// valider un intervenant crée un casting ; une décision engage le chantier ; une
// information enrichit la connaissance.
type Family = 'personnes' | 'engagements' | 'connaissances'
const FAMILY_OF: Record<string, Family> = {
  stakeholder: 'personnes',
  decision: 'engagements',
  action: 'engagements',
  deadline: 'engagements',
  knowledge: 'connaissances',
  vigilance: 'connaissances',
}
const FAMILY_LABEL: Record<Family, string> = {
  personnes: 'Personnes', engagements: 'Engagements', connaissances: 'Connaissances',
}
// L'ordre = le poids factuel de la validation (casting > engagement > contexte).
const FAMILY_ORDER: Family[] = ['personnes', 'engagements', 'connaissances']

/** L'INBOX seule (sans les connaissances validées) — réutilisée par la Mémoire
 *  desktop. `withFilters` affiche les familles quand la file est assez longue. */
export function MemoryInbox({ siteId, items, withFilters = false }: {
  siteId: string
  items: ReviewItem[]
  withFilters?: boolean
}) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const [family, setFamily] = useState<Family | null>(null)

  const remaining = items.filter((i) => !done.has(i.id))
  const counts = useMemo(() => {
    const c: Record<Family, number> = { personnes: 0, engagements: 0, connaissances: 0 }
    for (const i of remaining) c[FAMILY_OF[i.kind] ?? 'connaissances']++
    return c
  }, [remaining])
  const visible = family ? remaining.filter((i) => (FAMILY_OF[i.kind] ?? 'connaissances') === family) : remaining
  // Tri par poids de conséquence, ordre stable à l'intérieur d'une famille.
  const ordered = [...visible].sort((a, b) =>
    FAMILY_ORDER.indexOf(FAMILY_OF[a.kind] ?? 'connaissances') - FAMILY_ORDER.indexOf(FAMILY_OF[b.kind] ?? 'connaissances'))

  if (remaining.length === 0) return <p className="text-[13px] text-muted-foreground">Rien à confirmer pour l’instant.</p>

  return (
    <div>
      {withFilters && remaining.length > 3 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setFamily(null)}
            className={cn('rounded-full border px-2.5 py-1 text-[12px]', family === null ? 'border-foreground bg-foreground text-background font-medium' : 'text-muted-foreground')}>
            Tous ({remaining.length})
          </button>
          {FAMILY_ORDER.filter((f) => counts[f] > 0).map((f) => (
            <button key={f} type="button" onClick={() => setFamily(family === f ? null : f)}
              className={cn('rounded-full border px-2.5 py-1 text-[12px]', family === f ? 'border-foreground bg-foreground text-background font-medium' : 'text-muted-foreground')}>
              {FAMILY_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>
      )}
      <ul className="space-y-1.5">
        {ordered.map((item) => (
          <ReviewCard key={item.id} siteId={siteId} item={item} onDone={() => setDone((s) => new Set(s).add(item.id))} />
        ))}
      </ul>
    </div>
  )
}

/** Le panneau du TERRAIN : connaissances validées + inbox — deux mondes, deux
 *  sections, jamais mélangés dans une même pile. */
export function MemoryReviewPanel({ siteId, review }: { siteId: string; review: MemoryReview }) {
  const groups = [...new Set(review.confirmed.map((c) => c.group))]

  return (
    <section className="space-y-4">
      {review.confirmed.length === 0 ? (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ce que le chantier sait
          </h2>
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
                    {c.nature && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">· {c.nature}</span>
                    )}
                    {c.group === 'Décisions' && (
                      <span className="mt-0.5 block">
                        <WhyButton objectType="decision" objectId={c.id} label="Voir l’origine" />
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {review.toReview.length > 0 && (
        <div>
          <h3 className="text-[13px] font-medium text-sky-700 dark:text-sky-300">
            À examiner ({review.toReview.length})
          </h3>
          <div className="mt-2">
            <MemoryInbox siteId={siteId} items={review.toReview} />
          </div>
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
  onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Le détail (extrait complet + Écarter) est replié : la carte reste une LIGNE
  // dense — deux à trois propositions par écran, c'était trop peu.
  const [open, setOpen] = useState(false)
  // Ce que l'écran doit DEMANDER — il ne le devine pas, la capability le dit.
  const [asking, setAsking] = useState<'role' | 'who' | 'nature' | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const guess = splitPersonCompany(item.title)
  const [personName, setPersonName] = useState(guess.person ?? (looksLikePerson(item.title) ? item.title : ''))
  const [companyName, setCompanyName] = useState(guess.company ?? '')

  function promote(extra: {
    role?: string
    person_name?: string
    company_name?: string
    knowledge_kind?: 'current_information' | 'durable_knowledge'
  } = {}) {
    setError(null)
    start(async () => {
      const res = await promoteFromMemoryAction({ site_id: siteId, proposal_id: item.id, ...extra })
      if (res.ok) return onDone()
      // `needsInput` n'est pas une panne : c'est la question à poser.
      if (res.needsInput?.includes('role')) return setAsking('role')
      if (res.needsInput?.includes('company')) return setAsking('who')
      if (res.needsInput?.includes('nature')) return setAsking('nature')
      setError(res.error)
    })
  }

  function dismiss() {
    setError(null)
    start(async () => {
      const res = await dismissFromMemoryAction({ site_id: siteId, proposal_id: item.id })
      if (res.ok) return onDone()
      setError(res.error)
    })
  }

  return (
    <li className="rounded-xl border bg-card px-3 py-2">
      {/* La ligne dense : nature · contenu · provenance — tout visible sans ouvrir. */}
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{KIND_LABEL[item.kind] ?? item.kind}</span>
        <p className="min-w-0 text-[13px] font-medium leading-snug text-foreground/90">{item.title}</p>
      </div>
      <Provenance item={item} />

      {open && item.body && <p className="mt-1.5 text-[13px] text-muted-foreground">{item.body}</p>}

      {asking === 'role' && (
        <div className="mt-2 rounded-lg bg-muted/50 p-2">
          <p className="text-[12px] text-muted-foreground">Son rôle sur le chantier ?</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending}
                onClick={() => { setRole(r); setAsking('who') }}
                className="rounded-full border bg-background px-2.5 py-1 text-[12px] font-medium active:brightness-95 disabled:opacity-50"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {asking === 'who' && (
        <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-2">
          {/* LA question qui manquait : sans elle, confirmer « Vincent Milon »
              créait une ENTREPRISE « Vincent Milon ». L'humain déclare, le
              titre ne fait que préremplir. */}
          <p className="text-[12px] text-muted-foreground">Qui ajoutez-vous{role ? ` comme ${role}` : ''} ?</p>
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || (!personName.trim() && !companyName.trim()) || (!!personName.trim() && !companyName.trim())}
              onClick={() => promote({
                role: role ?? undefined,
                person_name: personName.trim() || undefined,
                company_name: companyName.trim() || undefined,
              })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground active:opacity-80 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {personName.trim() ? 'Ajouter la personne' : 'Ajouter l’entreprise'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsking('role')}
              className="rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground active:brightness-95 disabled:opacity-50"
            >
              Changer le rôle
            </button>
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
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {/* Le geste vient du contrat, jamais de l'écran : le bouton dit quel
              objet va naître (« Créer l'intervenant », « Acter la décision »). */}
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
          {/* Le détail (extrait, Écarter) derrière ⋯ — l'inbox reste dense. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Détails de la proposition"
            className="inline-flex items-center rounded-lg border px-2 py-1.5 text-muted-foreground active:brightness-95"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {open && (
            <button
              type="button"
              disabled={pending}
              onClick={dismiss}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground active:brightness-95 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Écarter
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/** Provenance COMPACTE : « ↳ Visite du 15 juillet · 6 traces » — elle garantit
 *  l'honnêteté sans dominer la carte. Le clic ouvre la source. */
function Provenance({ item }: { item: ReviewItem }) {
  const p = item.provenance
  if (!p.reportId) return null
  const traces = p.photos + p.vocals
  return (
    <a
      href={`/m/visite/${p.reportId}/cr`}
      className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground active:text-foreground"
    >
      <MapPin className="h-3 w-3 shrink-0" />
      {p.visitedAt ? `Visite du ${frDayMonthLocal(p.visitedAt)}` : 'Issue d’une visite'}
      {traces > 0 && ` · ${traces} trace${traces > 1 ? 's' : ''}`}
      <ChevronRight className="h-3 w-3 shrink-0" />
    </a>
  )
}
