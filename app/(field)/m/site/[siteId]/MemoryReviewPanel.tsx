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

import { useEffect, useMemo, useState, useTransition } from 'react'
import { CalendarDays, Check, ChevronRight, Loader2, MapPin, X } from 'lucide-react'
import Link from 'next/link'
import { promoteFromMemoryAction, dismissFromMemoryAction } from './memory-actions'
import { WhyButton } from '@/components/provenance/WhyButton'
import { cn } from '@/lib/utils'
import type { MemoryReview, ReviewItem } from '@/lib/knowledge/memory-review'
import { frDayMonthLocal } from '@/lib/time/local-date'
import { splitPersonCompany, looksLikePerson } from '@/lib/knowledge/person-name'
import { searchIntervenantTargetsAction, type IntervenantTarget } from '@/app/(dashboard)/sites/[id]/views/intervenants/intervenants-actions'
import { listActeursConnusAction, listOrgCompanyNamesAction } from '@/app/(dashboard)/sites/[id]/visites/[visitId]/compte-rendu/acteurs-actions'

/** Les rôles courants du chantier. Libre : le métier varie (mig 137). */
const ROLES = ['MOA', 'MOE', 'BET', 'ETV', 'OPC', 'CSPS', 'PAVE', 'PLANIF']

const KIND_LABEL: Record<string, string> = {
  action: 'Action',
  deadline: 'Échéance',
  knowledge: 'Information',
  stakeholder: 'Intervenant',
  decision: 'Décision',
  vigilance: 'Vigilance',
}
const KIND_TONE: Record<string, string> = {
  action: 'border-blue-200 bg-blue-50 text-blue-700',
  deadline: 'border-amber-200 bg-amber-50 text-amber-700',
  stakeholder: 'border-violet-200 bg-violet-50 text-violet-700',
  decision: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  vigilance: 'border-rose-200 bg-rose-50 text-rose-700',
  knowledge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
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
  const [source, setSource] = useState<'cr' | 'meeting' | null>(null)

  const remaining = items.filter((i) => !done.has(i.id))
  const counts = useMemo(() => {
    const c: Record<Family, number> = { personnes: 0, engagements: 0, connaissances: 0 }
    for (const i of remaining) c[FAMILY_OF[i.kind] ?? 'connaissances']++
    return c
  }, [remaining])
  const visible = family ? remaining.filter((i) => (FAMILY_OF[i.kind] ?? 'connaissances') === family) : remaining
  const sourceOf = (item: ReviewItem) => item.provenance.sourceType ?? (item.provenance.reportId ? 'cr' : 'unknown')
  const sourceCounts = useMemo(() => ({
    cr: remaining.filter((item) => sourceOf(item) === 'cr').length,
    meeting: remaining.filter((item) => sourceOf(item) === 'meeting').length,
  }), [remaining])
  const filtered = source ? visible.filter((item) => sourceOf(item) === source) : visible
  // Tri par poids de conséquence, ordre stable à l'intérieur d'une famille.
  const ordered = [...filtered].sort((a, b) =>
    FAMILY_ORDER.indexOf(FAMILY_OF[a.kind] ?? 'connaissances') - FAMILY_ORDER.indexOf(FAMILY_OF[b.kind] ?? 'connaissances'))

  if (remaining.length === 0) return <p className="text-[13px] text-muted-foreground">Rien à confirmer pour l'instant.</p>

  return (
    <div>
      {/* Les comptes sont TOUJOURS affichés (comportement verrouillé) ; l'état
          actif est net — un filtre, pas un petit tag. */}
      {withFilters && remaining.length > 1 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setFamily(null)}
            className={cn('rounded-full border px-3 py-1 text-[12px]', family === null ? 'border-foreground bg-foreground font-semibold text-background shadow-sm' : 'bg-card text-muted-foreground hover:text-foreground')}>
            Tous {remaining.length}
          </button>
          {FAMILY_ORDER.filter((f) => counts[f] > 0).map((f) => (
            <button key={f} type="button" onClick={() => setFamily(family === f ? null : f)}
              className={cn('rounded-full border px-3 py-1 text-[12px]', family === f ? 'border-foreground bg-foreground font-semibold text-background shadow-sm' : 'bg-card text-muted-foreground hover:text-foreground')}>
              {FAMILY_LABEL[f]} {counts[f]}
            </button>
          ))}
          {sourceCounts.cr > 0 && (
            <button type="button" onClick={() => setSource(source === 'cr' ? null : 'cr')}
              className={cn('rounded-full border px-3 py-1 text-[12px]', source === 'cr' ? 'border-foreground bg-foreground font-semibold text-background shadow-sm' : 'bg-card text-muted-foreground hover:text-foreground')}>
              CR {sourceCounts.cr}
            </button>
          )}
          {sourceCounts.meeting > 0 && (
            <button type="button" onClick={() => setSource(source === 'meeting' ? null : 'meeting')}
              className={cn('rounded-full border px-3 py-1 text-[12px]', source === 'meeting' ? 'border-foreground bg-foreground font-semibold text-background shadow-sm' : 'bg-card text-muted-foreground hover:text-foreground')}>
              Réunions {sourceCounts.meeting}
            </button>
          )}
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
 *  sections, jamais mélangés dans une même pile.
 *  Affichage synthétique : 3 éléments max par groupe + compte + « ... et N autres ».
 *  La nature (« Information actuelle ») est portée par le groupe, pas répétée ligne à ligne. */
export function MemoryReviewPanel({ siteId, review }: { siteId: string; review: MemoryReview }) {
  const groups = [...new Set(review.confirmed.map((c) => c.group))]
  const byGroup = new Map<string, typeof review.confirmed>()
  for (const c of review.confirmed) {
    if (!byGroup.has(c.group)) byGroup.set(c.group, [])
    byGroup.get(c.group)!.push(c)
  }
  const PREVIEW = 3

  return (
    <section className="space-y-4">
      {review.confirmed.length === 0 ? (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ce que le chantier sait
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Rien de confirmé pour l'instant.</p>
        </div>
      ) : (
        groups.map((g) => {
          const items = byGroup.get(g)!
          const visible = items.slice(0, PREVIEW)
          const hidden = items.length - visible.length
          return (
            <div key={g}>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g}</h2>
                <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">{items.length}</span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {visible.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-[13px] text-foreground/90">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="min-w-0">
                      {c.href ? (
                        <Link href={c.href} className="hover:underline underline-offset-2">{c.title}</Link>
                      ) : c.title}
                      {c.group === 'Décisions' && (
                        <span className="mt-0.5 block">
                          <WhyButton objectType="decision" objectId={c.id} label="Voir l'origine" />
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {hidden > 0 && (
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  ... et {hidden} autre{hidden > 1 ? 's' : ''}
                </p>
              )}
            </div>
          )
        })
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
  // Ce que l'écran doit DEMANDER — il ne le devine pas, la capability le dit.
  const [asking, setAsking] = useState<'role' | 'who' | 'nature' | 'date' | null>(null)
  const [stakeholderMode, setStakeholderMode] = useState<'new' | 'attach' | null>(null)
  // 'role_only' (P0-3C) : « je ne sais pas encore qui » est une réponse légitime.
  const [entityType, setEntityType] = useState<'person' | 'company' | 'role_only' | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState('')
  const guess = splitPersonCompany(item.title)
  const [personName, setPersonName] = useState(guess.person ?? (looksLikePerson(item.title) ? item.title : ''))
  const [companyName, setCompanyName] = useState(guess.company ?? '')
  // L'IDENTITÉ DOIT ÊTRE VISIBLE AVANT VALIDATION (Vincent, P0-3C tranche 2) :
  // les Jean déjà connus et les entreprises existantes se proposent dans la
  // saisie — sinon le serveur dédoublonne après coup sans que l'utilisateur
  // sache ce qu'il sélectionne ou crée. Chargé UNE fois, à l'ouverture du dialog.
  const [connusNoms, setConnusNoms] = useState<string[]>([])
  const [entreprisesNoms, setEntreprisesNoms] = useState<string[]>([])
  useEffect(() => {
    if (asking !== 'who' || connusNoms.length > 0 || entreprisesNoms.length > 0) return
    let vivant = true
    void listActeursConnusAction().then((gens) => {
      if (vivant) setConnusNoms(gens.map((g) => (g.entreprise ? `${g.nom} — ${g.entreprise}` : g.nom)))
    }).catch(() => {})
    void listOrgCompanyNamesAction().then((noms) => { if (vivant) setEntreprisesNoms(noms) }).catch(() => {})
    return () => { vivant = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking])

  function promote(extra: {
    role?: string
    person_name?: string
    company_name?: string
    contact_id?: string | null
    company_id?: string | null
    role_only?: boolean
    knowledge_kind?: 'current_information' | 'durable_knowledge'
    due_date?: string
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

  function startNewStakeholder() {
    setStakeholderMode('new')
    // La nature de l'intervenant est la première décision visible. Le rôle
    // vient ensuite dans le même formulaire, sans déduction automatique.
    setAsking('who')
  }

  return (
    <li className="rounded-xl border bg-card px-3 py-2">
      {/* La ligne dense : nature · contenu · provenance — tout visible sans ouvrir. */}
      <div className="flex items-baseline gap-2">
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide', KIND_TONE[item.kind] ?? 'border-border bg-muted text-muted-foreground')}>{KIND_LABEL[item.kind] ?? item.kind}</span>
        <p className="min-w-0 text-[13px] font-medium leading-snug text-foreground/90">{item.title}</p>
      </div>
      <Provenance item={item} />
      {item.confidence && <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground" title="Niveau de confiance de l'analyse">{'★'.repeat(confidenceStars(item.confidence))}{'☆'.repeat(5 - confidenceStars(item.confidence))} <span>{confidenceLabel(item.confidence)}</span></span>}

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

      {item.kind === 'stakeholder' && stakeholderMode === 'attach' && (
        <StakeholderAttachPanel
          siteId={siteId}
          initialQuery={item.title}
          pending={pending}
          onCancel={() => setStakeholderMode(null)}
          onPromote={(target, selectedRole) => promote({
            role: selectedRole,
            company_name: target.companyName,
            person_name: target.kind === 'contact' ? target.name : undefined,
            contact_id: target.kind === 'contact' ? target.contactId : undefined,
            company_id: target.companyId,
          })}
        />
      )}

      {asking === 'who' && (
        <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-2">
          {/* LA question qui manquait : sans elle, confirmer « Vincent Milon »
              créait une ENTREPRISE « Vincent Milon ». L'humain déclare, le
              titre ne fait que préremplir. */}
          <p className="text-[12px] text-muted-foreground">Qui est cet intervenant{role ? ` (${role})` : ''} ?</p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={pending}
              aria-label="Une personne"
              onClick={() => {
                setEntityType('person')
                setPersonName(guess.person ?? item.title)
                setCompanyName(guess.company ?? '')
              }}
              className={cn('rounded-lg border px-2.5 py-2 text-left text-[12px]', entityType === 'person' ? 'border-primary bg-primary/10 font-semibold text-primary' : 'bg-background')}
            >
              Une personne
              <span className="block text-[11px] font-normal text-muted-foreground">Entreprise facultative</span>
            </button>
            <button
              type="button"
              disabled={pending}
              aria-label="Une entreprise"
              onClick={() => {
                setEntityType('company')
                setPersonName('')
                setCompanyName(guess.company ?? item.title)
              }}
              className={cn('rounded-lg border px-2.5 py-2 text-left text-[12px]', entityType === 'company' ? 'border-primary bg-primary/10 font-semibold text-primary' : 'bg-background')}
            >
              Une entreprise
              <span className="block text-[11px] font-normal text-muted-foreground">Société intervenante</span>
            </button>
            {/* « Je ne sais pas encore » est une RÉPONSE (niveau 2 de la
                doctrine) : le rôle est retenu, aucune identité n'est inventée. */}
            <button
              type="button"
              disabled={pending}
              aria-label="Seulement un rôle pour l'instant"
              onClick={() => {
                setEntityType('role_only')
                setPersonName('')
                setCompanyName('')
              }}
              className={cn('col-span-2 rounded-lg border px-2.5 py-2 text-left text-[12px]', entityType === 'role_only' ? 'border-primary bg-primary/10 font-semibold text-primary' : 'bg-background')}
            >
              Seulement un rôle pour l’instant
              <span className="block text-[11px] font-normal text-muted-foreground">MemorIA retient le rôle sans inventer d’identité — précisable plus tard.</span>
            </button>
          </div>
          <div>
            <p className="mb-1 text-[12px] text-muted-foreground">Rôle sur le chantier</p>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((candidate) => (
                <button key={candidate} type="button" disabled={pending} onClick={() => setRole(candidate)} className={cn('rounded-full border px-2.5 py-1 text-[12px]', role === candidate ? 'border-primary bg-primary text-primary-foreground' : 'bg-background')}>
                  {candidate}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {entityType === 'person' && <input
              type="text"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Rechercher ou ajouter — Prénom Nom"
              list={`connus-${item.id}`}
              className="block w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
            />}
            {entityType === 'person' && <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Entreprise (facultatif)"
              list={`entreprises-${item.id}`}
              className="block w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
            />}
            {entityType === 'company' && <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Rechercher ou ajouter une entreprise"
              list={`entreprises-${item.id}`}
              className="block w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
            />}
            <datalist id={`connus-${item.id}`}>
              {connusNoms.map((n) => <option key={n} value={n.split(' — ')[0]}>{n}</option>)}
            </datalist>
            <datalist id={`entreprises-${item.id}`}>
              {entreprisesNoms.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !role || !entityType || (entityType === 'company' ? !companyName.trim() : entityType === 'person' ? !personName.trim() : false)}
              onClick={() => promote({
                role: role ?? undefined,
                person_name: entityType === 'person' ? personName.trim() : undefined,
                company_name: entityType === 'role_only' ? undefined : companyName.trim() || undefined,
                role_only: entityType === 'role_only' || undefined,
              })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground active:opacity-80 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {entityType === 'role_only' ? 'Retenir le rôle' : personName.trim() ? 'Ajouter la personne' : "Ajouter l'entreprise"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsking('role')}
              className="rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground active:brightness-95 disabled:opacity-50"
            >
              Changer le rôle
            </button>
            <button type="button" disabled={pending} onClick={() => { setAsking(null); setStakeholderMode(null) }} className="rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground">
              Annuler
            </button>
          </div>
        </div>
      )}

      {asking === 'nature' && (
        <div className="mt-2 space-y-1.5 rounded-lg bg-muted/50 p-2">
          {/* Deux choix, pas trois : une HABITUDE se constate sur plusieurs visites.
              L'offrir ici ferait d'une circonstance ponctuelle une règle générale. */}
          <p className="text-[12px] text-muted-foreground">Cette information est…</p>
          {item.kind !== 'stakeholder' && (<>
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
          </>)}
        </div>
      )}

      {asking === 'date' && (
        <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-2">
          <p className="text-[12px] text-muted-foreground">
            À quelle date cette échéance doit-elle être tenue ?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`deadline-date-${item.id}`}>Date de l&apos;échéance</label>
            <input
              id={`deadline-date-${item.id}`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
            />
            <button
              type="button"
              disabled={pending || !dueDate}
              onClick={() => promote({ due_date: dueDate })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />}
              Ajouter au planning
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsking(null)}
              className="rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-rose-600">{error}</p>}

      {!asking && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {/* Le geste vient du contrat, jamais de l'écran : le bouton dit quel
              objet va naître. HIÉRARCHIE par conséquence métier : créer un
              intervenant ou acter une décision ENGAGE le chantier → bouton plein ;
              confirmer une information l'ENRICHIT → bouton tonal. Quatre cartes
              bleues d'affilée attiraient plus que leur contenu. */}
          {item.kind === 'stakeholder' ? (
            <>
              <button type="button" disabled={pending} onClick={startNewStakeholder} className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50">
                Nouvel intervenant
              </button>
              <button type="button" disabled={pending} onClick={() => setStakeholderMode('attach')} className="rounded-lg border px-3 py-1.5 text-[13px] font-medium hover:bg-muted disabled:opacity-50">
                Préciser l’intervenant
              </button>
              <button type="button" disabled={pending} onClick={dismiss} className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                Écarter
              </button>
            </>
          ) : item.capability.available ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (item.kind === 'deadline') {
                  setDueDate('')
                  setAsking('date')
                } else if (item.kind === 'knowledge') {
                  setAsking('nature')
                } else {
                  promote()
                }
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium active:opacity-80 disabled:opacity-50',
                (FAMILY_OF[item.kind] ?? 'connaissances') === 'connaissances'
                  ? 'border border-primary/40 bg-primary/10 text-primary'
                  : 'bg-primary text-primary-foreground',
              )}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {item.capability.label}
            </button>
          ) : (
            // Un type sans geste ne reste pas muet : il dit pourquoi.
            <p className="text-[12px] text-muted-foreground">{item.capability.explanation}</p>
          )}
          {item.kind !== 'stakeholder' && item.capability.available && (
            <button
              type="button"
              disabled={pending}
              onClick={dismiss}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Écarter
            </button>
          )}
          {item.kind === 'action' && (
            <div className="flex basis-full flex-wrap gap-1.5 pt-0.5">
              <Link href={`/sites/${siteId}/actions`} className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                + Affecter un responsable
              </Link>
              <Link href={`/sites/${siteId}/actions`} className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                + Ajouter une échéance
              </Link>
              <Link href={`/semaine?site=${siteId}`} className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Planifier l&apos;intervention
              </Link>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function StakeholderAttachPanel({
  siteId,
  initialQuery,
  pending,
  onCancel,
  onPromote,
}: {
  siteId: string
  initialQuery: string
  pending: boolean
  onCancel: () => void
  onPromote: (target: IntervenantTarget, role: string) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [hits, setHits] = useState<IntervenantTarget[] | null>(null)
  const [selected, setSelected] = useState<IntervenantTarget | null>(null)
  const [role, setRole] = useState('')
  const [searching, setSearching] = useState(false)

  async function search() {
    if (query.trim().length < 2) return
    setSearching(true)
    const result = await searchIntervenantTargetsAction({ site_id: siteId, q: query.trim() })
    setSearching(false)
    if (result.ok) setHits(result.hits)
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-2">
      <p className="text-[12px] text-muted-foreground">Rechercher un intervenant existant</p>
      <div className="flex gap-1.5">
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search() } }} className="min-w-0 flex-1 rounded-lg border bg-background px-2.5 py-1.5 text-[13px]" aria-label="Rechercher un intervenant existant" />
        <button type="button" disabled={searching || pending || query.trim().length < 2} onClick={() => void search()} className="rounded-lg border bg-background px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50">{searching ? 'Recherche…' : 'Chercher'}</button>
      </div>
      {hits !== null && hits.length === 0 && <p className="text-[12px] text-muted-foreground">Aucun intervenant trouvé dans cette organisation.</p>}
      {hits && hits.length > 0 && (
        <ul className="space-y-1">
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.contactId ?? hit.companyId}`}>
              <button type="button" onClick={() => { setSelected(hit); if (hit.knownRole) setRole(hit.knownRole) }} className={cn('w-full rounded-lg border px-2.5 py-2 text-left text-[12.5px]', selected?.companyId === hit.companyId && selected?.contactId === hit.contactId ? 'border-primary bg-primary/10' : 'bg-background')}>
                <span className="font-medium">{hit.kind === 'contact' ? hit.name : hit.companyName}</span>
                <span className="block text-[11px] text-muted-foreground">{hit.kind === 'contact' ? hit.companyName : 'Entreprise'}{hit.onThisSite ? ' · déjà sur ce chantier' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="space-y-1.5">
          <label className="text-[12px] text-muted-foreground" htmlFor={`attach-role-${selected.companyId}`}>Rôle sur le chantier</label>
          <input id={`attach-role-${selected.companyId}`} value={role} onChange={(event) => setRole(event.target.value)} placeholder="MOA, BET, PAVE…" className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]" />
          <button type="button" disabled={pending || !role.trim()} onClick={() => onPromote(selected, role.trim())} className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50">Confirmer l’intervenant</button>
        </div>
      )}
      <button type="button" disabled={pending} onClick={onCancel} className="rounded-lg border px-3 py-1.5 text-[12.5px] text-muted-foreground">Annuler</button>
    </div>
  )
}

function confidenceStars(value: string): number {
  if (['high', 'forte', 'certain', 'very_high'].includes(value)) return 5
  if (['medium', 'moyenne', 'probable'].includes(value)) return 4
  if (['low', 'faible', 'uncertain'].includes(value)) return 2
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(1, Math.min(5, Math.round(numeric <= 1 ? numeric * 5 : numeric))) : 3
}

function confidenceLabel(value: string): string {
  if (['high', 'forte', 'certain', 'very_high'].includes(value)) return 'Très certain'
  if (['medium', 'moyenne', 'probable'].includes(value)) return 'Probable'
  if (['low', 'faible', 'uncertain'].includes(value)) return 'À confirmer'
  return 'Confiance'
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
      {p.visitedAt ? `Visite du ${frDayMonthLocal(p.visitedAt)}` : "Issue d'une visite"}
      {traces > 0 && ` · ${traces} trace${traces > 1 ? 's' : ''}`}
      <ChevronRight className="h-3 w-3 shrink-0" />
    </a>
  )
}
