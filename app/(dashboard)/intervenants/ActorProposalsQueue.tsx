'use client'

// ── FILE « ACTEURS À CONFIRMER » ─────────────────────────────────────────────
// Rend actionnable le compteur « intervenants à confirmer » : chaque personne
// (ou entreprise) détectée dans un CR / une visite / une réunion apparaît comme
// une PROPOSITION à trancher — associer à un acteur existant, créer, ou ignorer —
// sans jamais devenir automatiquement un acteur définitif. Provenance affichée
// (type de source, chantier, date, extrait, lien). Casting du chantier source =
// décision EXPLICITE, jamais automatique.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  UserPlus, User, Building2, MapPin, Search, Check, X, ExternalLink, Link2, Users, ChevronRight,
} from 'lucide-react'
import type { ActorProposal, ActorTarget } from '@/lib/db/actor-proposals'
import { confirmActorProposalAction, dismissActorProposalAction, searchActorTargetsAction } from './proposal-actions'

const SOURCE_LABEL = { visit: 'CR de visite', meeting: 'Réunion' } as const

const INPUT = 'w-full rounded-md border border-border/60 bg-background px-2 py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring'

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function ActorProposalsQueue({ proposals, teams }: {
  proposals: ActorProposal[]
  teams: Array<{ id: string; name: string }>
}) {
  const [resolved, setResolved] = useState<Set<string>>(() => new Set())
  const visible = proposals.filter((p) => !resolved.has(p.id))

  // Bloc rendu uniquement s'il y avait des propositions à traiter (org sans file
  // détectée → page épurée). Une fois vidée en session, on montre l'état vide.
  if (proposals.length === 0) return null

  return (
    <section id="acteurs-a-confirmer" className="rounded-2xl border border-amber-300/60 bg-amber-50/30 p-4 dark:border-amber-800/40 dark:bg-amber-950/15">
      <div className="mb-3 flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden />
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Acteurs à confirmer{visible.length > 0 ? ` — ${visible.length}` : ''}
        </h2>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 bg-card/60 px-4 py-6 text-center text-sm text-muted-foreground">
          Aucun acteur à confirmer.<br />
          <span className="text-xs">Les nouvelles personnes détectées dans les visites et réunions apparaîtront ici.</span>
        </p>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {visible.map((p) => (
            <ProposalCard key={p.id} proposal={p} teams={teams} onResolved={() => setResolved((s) => new Set(s).add(p.id))} />
          ))}
        </ul>
      )}
    </section>
  )
}

type Panel = 'none' | 'associate' | 'create' | 'dismiss'

function ProposalCard({ proposal, teams, onResolved }: {
  proposal: ActorProposal
  teams: Array<{ id: string; name: string }>
  onResolved: () => void
}) {
  const router = useRouter()
  const [panel, setPanel] = useState<Panel>('none')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { source } = proposal

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (res.ok) { onResolved(); router.refresh() }
      else setError(res.error ?? 'Action impossible')
    })
  }

  const associateTo = (t: ActorTarget, cast: { role: string } | null) =>
    run(() => confirmActorProposalAction({
      proposalId: proposal.id,
      mode: t.kind === 'contact' ? 'associate_contact' : 'associate_company',
      targetId: t.id,
      castOnSite: !!cast,
      role: cast?.role,
    }))

  const dateLabel = formatDate(source.reportDate)

  return (
    <li className="rounded-xl border border-border/60 bg-card p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {proposal.likelyPerson ? <User className="h-4 w-4" aria-hidden /> : <Building2 className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{proposal.title}</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {proposal.likelyPerson ? 'Personne' : 'Entreprise'}
            </span>
          </div>
          {proposal.companyName && (
            <p className="mt-0.5 text-xs text-muted-foreground">{proposal.companyName}</p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            {source.reportKind ? SOURCE_LABEL[source.reportKind] : 'Mention'} · {source.siteName}
            {dateLabel ? ` · ${dateLabel}` : ''}
          </p>
          {source.excerpt && (
            <p className="mt-1 border-l-2 border-border/60 pl-2 text-[11.5px] italic text-muted-foreground">« {source.excerpt} »</p>
          )}
        </div>
      </div>

      {/* Suggestion de rapprochement (jamais imposée). */}
      {panel === 'none' && proposal.suggestion && (
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-brand-200/70 bg-brand-50/50 px-2.5 py-1.5 text-[12px] dark:border-brand-700/50 dark:bg-brand-600/10">
          <span className="min-w-0 truncate">
            Correspond peut-être à <b>{proposal.suggestion.name}</b>
            {proposal.suggestion.companyName ? ` · ${proposal.suggestion.companyName}` : ''}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => associateTo({ kind: proposal.suggestion!.kind, id: proposal.suggestion!.id, name: proposal.suggestion!.name, function: null }, null)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-[11.5px] font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Link2 className="h-3 w-3" aria-hidden /> Associer
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-[11.5px] text-red-700 dark:text-red-400">{error}</p>}

      {/* Actions principales. */}
      {panel === 'none' && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setPanel('associate')} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[12px] hover:bg-muted disabled:opacity-50">
            <Search className="h-3 w-3" aria-hidden /> Associer…
          </button>
          <button type="button" onClick={() => setPanel('create')} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[12px] hover:bg-muted disabled:opacity-50">
            <UserPlus className="h-3 w-3" aria-hidden /> Créer
          </button>
          <button type="button" onClick={() => setPanel('dismiss')} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50">
            <X className="h-3 w-3" aria-hidden /> Ignorer
          </button>
          {source.reportId && (
            <Link href={`/sites/${source.siteId}/visites/${source.reportId}`} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-brand-700 hover:underline dark:text-brand-300">
              <ExternalLink className="h-3 w-3" aria-hidden /> Voir la source
            </Link>
          )}
        </div>
      )}

      {panel === 'associate' && (
        <AssociatePanel siteName={source.siteName} pending={pending} onCancel={() => setPanel('none')} onPick={associateTo} />
      )}
      {panel === 'create' && (
        <CreatePanel proposal={proposal} teams={teams} siteName={source.siteName} pending={pending} onCancel={() => setPanel('none')} onSubmit={run} />
      )}
      {panel === 'dismiss' && (
        <DismissPanel
          pending={pending}
          onCancel={() => setPanel('none')}
          onPick={(kind) => run(() => dismissActorProposalAction({ proposalId: proposal.id, kind }))}
        />
      )}
    </li>
  )
}

/** Recherche unifiée personnes + entreprises pour associer à un acteur existant. */
function AssociatePanel({ siteName, pending, onCancel, onPick }: {
  siteName: string
  pending: boolean
  onCancel: () => void
  onPick: (t: ActorTarget, cast: { role: string } | null) => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ActorTarget[]>([])
  const [searching, startSearch] = useTransition()
  const [cast, setCast] = useState(false)
  const [role, setRole] = useState('')

  const search = (value: string) => {
    setQ(value)
    if (value.trim().length < 2) { setHits([]); return }
    startSearch(async () => {
      const res = await searchActorTargetsAction({ query: value })
      if (res.ok) setHits(res.hits)
    })
  }

  return (
    <div className="mt-2.5 space-y-2 rounded-lg border border-border/60 bg-muted/30 p-2.5">
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input autoFocus type="text" value={q} onChange={(e) => search(e.target.value)} placeholder="Rechercher une personne ou une entreprise…" className="w-full bg-transparent text-[12.5px] outline-none" />
      </div>
      {searching && <p className="text-[11px] text-muted-foreground">Recherche…</p>}
      {q.trim().length >= 2 && !searching && hits.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Aucun acteur existant. Utilisez « Créer ».</p>
      )}
      <CastOption siteName={siteName} cast={cast} setCast={setCast} role={role} setRole={setRole} />
      <ul className="space-y-1">
        {hits.map((t) => (
          <li key={`${t.kind}:${t.id}`}>
            <button
              type="button"
              disabled={pending || (cast && !role.trim())}
              onClick={() => onPick(t, cast ? { role: role.trim() } : null)}
              className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-left text-[12.5px] hover:border-brand-300 disabled:opacity-50"
            >
              {t.kind === 'contact' ? <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{t.name}{t.function ? <span className="text-muted-foreground"> · {t.function}</span> : ''}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCancel} className="text-[11.5px] text-muted-foreground hover:underline">Annuler</button>
    </div>
  )
}

const JOB_SUGGESTIONS = ['Conducteur de travaux', 'MOE', 'MOA', 'SPS', 'Architecte', 'Chef de chantier', 'Électricien', 'Plombier']

/** Création réutilisant le parcours « Ajouter un acteur » (personne ou entreprise). */
function CreatePanel({ proposal, teams, siteName, pending, onCancel, onSubmit }: {
  proposal: ActorProposal
  teams: Array<{ id: string; name: string }>
  siteName: string
  pending: boolean
  onCancel: () => void
  onSubmit: (fn: () => Promise<{ ok: boolean; error?: string }>) => void
}) {
  const [isPerson, setIsPerson] = useState(proposal.likelyPerson)
  const [fullName, setFullName] = useState(proposal.personName ?? proposal.title)
  const [companyName, setCompanyName] = useState(proposal.companyName ?? (proposal.likelyPerson ? '' : proposal.title))
  const [job, setJob] = useState('')
  const [internal, setInternal] = useState(false)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [teamIds, setTeamIds] = useState<Set<string>>(() => new Set())
  const [cast, setCast] = useState(false)
  const [role, setRole] = useState('')

  const submit = () => {
    if (isPerson) {
      onSubmit(() => confirmActorProposalAction({
        proposalId: proposal.id, mode: 'create_person',
        fullName, job: job || undefined, companyName: companyName || undefined,
        email: email || undefined, phone: phone || undefined, isInternalAgent: internal,
        teamIds: teamIds.size ? [...teamIds] : undefined,
        castOnSite: cast, role: cast ? role : undefined,
      }))
    } else {
      onSubmit(() => confirmActorProposalAction({
        proposalId: proposal.id, mode: 'create_company',
        companyName: companyName || proposal.title,
        castOnSite: cast, role: cast ? role : undefined,
      }))
    }
  }

  const disabled = pending || (isPerson ? !fullName.trim() : !companyName.trim()) || (cast && !role.trim())

  return (
    <div className="mt-2.5 space-y-2 rounded-lg border border-border/60 bg-muted/30 p-2.5">
      <div className="inline-flex rounded-md border border-border/60 bg-background p-0.5 text-[11.5px]">
        <button type="button" onClick={() => setIsPerson(true)} className={`rounded px-2 py-0.5 ${isPerson ? 'bg-brand-600 text-white' : 'text-muted-foreground'}`}>Personne</button>
        <button type="button" onClick={() => setIsPerson(false)} className={`rounded px-2 py-0.5 ${!isPerson ? 'bg-brand-600 text-white' : 'text-muted-foreground'}`}>Entreprise</button>
      </div>

      {isPerson ? (
        <>
          <Field label="Nom">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={INPUT} />
          </Field>
          <Field label="Rôle / fonction">
            <input value={job} onChange={(e) => setJob(e.target.value)} list="job-suggestions" placeholder="Conducteur de travaux…" className={INPUT} />
            <datalist id="job-suggestions">{JOB_SUGGESTIONS.map((j) => <option key={j} value={j} />)}</datalist>
          </Field>
          <div className="inline-flex rounded-md border border-border/60 bg-background p-0.5 text-[11.5px]">
            <button type="button" onClick={() => setInternal(false)} className={`rounded px-2 py-0.5 ${!internal ? 'bg-foreground text-background' : 'text-muted-foreground'}`}>Contact externe</button>
            <button type="button" onClick={() => setInternal(true)} className={`rounded px-2 py-0.5 ${internal ? 'bg-foreground text-background' : 'text-muted-foreground'}`}>Agent interne</button>
          </div>
          <Field label="Entreprise (facultatif)">
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={INPUT} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="E-mail (facultatif)"><input value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} /></Field>
            <Field label="Téléphone (facultatif)"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} /></Field>
          </div>
          {teams.length > 0 && (
            <Field label="Ajouter à une équipe (facultatif)">
              <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                {teams.map((t) => {
                  const on = teamIds.has(t.id)
                  return (
                    <button key={t.id} type="button" onClick={() => setTeamIds((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n })}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-brand-300 bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300' : 'border-border/60 text-muted-foreground'}`}>
                      <Users className="h-3 w-3" aria-hidden /> {t.name}{on && <Check className="h-3 w-3" aria-hidden />}
                    </button>
                  )
                })}
              </div>
            </Field>
          )}
        </>
      ) : (
        <Field label="Nom de l’entreprise">
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={INPUT} />
        </Field>
      )}

      <CastOption siteName={siteName} cast={cast} setCast={setCast} role={role} setRole={setRole} />

      <div className="flex items-center gap-2 pt-0.5">
        <button type="button" disabled={disabled} onClick={submit} className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          <Check className="h-3.5 w-3.5" aria-hidden /> Créer et confirmer
        </button>
        <button type="button" onClick={onCancel} className="text-[11.5px] text-muted-foreground hover:underline">Annuler</button>
      </div>
    </div>
  )
}

/** Ajout au casting du chantier source : facultatif et EXPLICITE (case décochée
 *  par défaut) — la mention vient de ce chantier, mais rien n'est automatique. */
function CastOption({ siteName, cast, setCast, role, setRole }: {
  siteName: string
  cast: boolean
  setCast: (v: boolean) => void
  role: string
  setRole: (v: string) => void
}) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-background/60 px-2 py-1.5">
      <label className="flex items-center gap-1.5 text-[12px] text-foreground/80">
        <input type="checkbox" checked={cast} onChange={(e) => setCast(e.target.checked)} className="accent-brand-600" />
        Ajouter au casting de <b>{siteName}</b>
      </label>
      {cast && (
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Rôle sur le chantier (ex. MOE)" className={`${INPUT} mt-1.5`} />
      )}
    </div>
  )
}

/** Pourquoi écarter ? (taxonomie fermée, mig 322) — sans ce choix, dismiss_kind
 *  restait NULL et « MemorIA s'est trompé » se confondait avec « vrai mais sans
 *  intérêt » : deux signaux qui n'apprennent pas la même chose au système. */
function DismissPanel({ pending, onCancel, onPick }: {
  pending: boolean
  onCancel: () => void
  onPick: (kind: 'false_extraction' | 'not_relevant' | 'duplicate') => void
}) {
  return (
    <div className="mt-2.5 space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-2.5">
      <p className="text-[11.5px] text-muted-foreground">Pourquoi écarter cette proposition ?</p>
      <div className="flex flex-col gap-1">
        <button type="button" disabled={pending} onClick={() => onPick('false_extraction')} className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-left text-[12px] hover:border-brand-300 disabled:opacity-50">
          MemorIA s’est trompé <span className="text-muted-foreground">— ce n’est pas une vraie personne/entreprise</span>
        </button>
        <button type="button" disabled={pending} onClick={() => onPick('not_relevant')} className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-left text-[12px] hover:border-brand-300 disabled:opacity-50">
          Vrai mais sans intérêt <span className="text-muted-foreground">— pas utile pour ce chantier</span>
        </button>
        <button type="button" disabled={pending} onClick={() => onPick('duplicate')} className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-left text-[12px] hover:border-brand-300 disabled:opacity-50">
          Déjà connu <span className="text-muted-foreground">— doublon d’un acteur existant</span>
        </button>
      </div>
      <button type="button" onClick={onCancel} className="text-[11.5px] text-muted-foreground hover:underline">Annuler</button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
