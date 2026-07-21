'use client'

// LE GESTE D'IDENTIFICATION — extrait pour être RÉUTILISÉ, pas réécrit.
//
// Il vivait dans l'onglet Intervenants, qui n'est plus rendu depuis que le
// leaderboard a pris sa place : la bannière « À identifier » listait donc des
// personnes citées sans offrir aucun moyen de les confirmer. La capacité
// existait, elle était devenue invisible. Un seul cycle de promotion —
// promoteFromMemoryAction — quelle que soit la surface qui l'appelle.

import { useState, useTransition } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { frDayMonthLocal } from '@/lib/time/local-date'
import { splitPersonCompany, looksLikePerson } from '@/lib/knowledge/person-name'
import type { ToIdentifyItem } from '@/lib/knowledge/site-intervenants-view'
import { promoteFromMemoryAction, dismissFromMemoryAction } from '@/app/(field)/m/site/[siteId]/memory-actions'
import { searchIntervenantTargetsAction, type IntervenantTarget } from './intervenants-actions'

/** Les rôles courants du chantier — la même liste libre que la Mémoire (mig 137). */
const ROLES = ['MOA', 'MOE', 'BET', 'ETV', 'OPC', 'CSPS', 'PAVE', 'PLANIF']

// ── « À identifier » : le geste d'identification ─────────────────────────────
export function IdentifyCard({ siteId, item, onDone }: { siteId: string; item: ToIdentifyItem; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'ferme' | 'nouveau' | 'rattacher'>('ferme')
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
    <li className="rounded-lg border border-reading-border/50 bg-card p-3">
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
        {mode === 'ferme' && (
          <div className="ml-auto flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode('nouveau')}
              className="rounded-lg border bg-background px-3 py-1.5 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-50"
            >
              Nouvel intervenant
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode('rattacher')}
              className="rounded-lg border bg-background px-3 py-1.5 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-50"
            >
              Rattacher
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

      {mode === 'nouveau' && (
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
              onClick={() => setMode('ferme')}
              className="text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              Annuler
            </button>
          </div>
          {error && <p className="text-[12px] text-rose-600">{error}</p>}
        </div>
      )}

      {mode === 'rattacher' && (
        <AttachPanel
          siteId={siteId}
          item={item}
          onCancel={() => setMode('ferme')}
          onDone={onDone}
        />
      )}
    </li>
  )
}

// ── RATTACHER : on ne renomme pas la détection, on la relie ──────────────────
//
// « Rattacher », jamais « Fusionner » : on ne fond pas deux fiches, on relie une
// MENTION issue d'une visite à une identité connue. La mention d'origine reste
// écrite telle quelle dans la proposition (`title`) — c'est ce qui permet au
// récit de dire plus tard « “Clim Expert” a été cité, et rattaché à Clim'Expert
// SARL par Guillaume ». Faire disparaître l'orthographe entendue serait perdre
// la preuve pour gagner de la propreté.
function AttachPanel({
  siteId,
  item,
  onCancel,
  onDone,
}: {
  siteId: string
  item: ToIdentifyItem
  onCancel: () => void
  onDone: () => void
}) {
  const [q, setQ] = useState(item.title)
  const [hits, setHits] = useState<IntervenantTarget[] | null>(null)
  const [cible, setCible] = useState<IntervenantTarget | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function search() {
    const terme = q.trim()
    if (terme.length < 2) return
    setSearching(true)
    setError(null)
    searchIntervenantTargetsAction({ site_id: siteId, q: terme }).then((res) => {
      setSearching(false)
      if (res.ok) setHits(res.hits)
      else setError(res.error)
    })
  }

  function attach() {
    if (!cible) return
    // Le rôle en vigueur évite de reposer la question ; sinon l'humain tranche.
    const roleFinal = cible.knownRole ?? role
    if (!roleFinal) return
    setError(null)
    start(async () => {
      const res = await promoteFromMemoryAction({
        site_id: siteId,
        proposal_id: item.proposalId,
        role: roleFinal,
        company_id: cible.companyId,
        // Une entreprise citée ne devient PAS un contact à son nom : on ne
        // transmet un contact que si l'humain en a désigné un.
        contact_id: cible.kind === 'contact' ? cible.contactId : null,
      })
      if (res.ok) return onDone()
      setError(res.error)
    })
  }

  const roleManquant = cible !== null && !cible.knownRole && !role

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-2.5">
      <p className="text-[12px] text-muted-foreground">
        Rechercher un intervenant existant — « {item.title} » restera écrit comme il a été entendu.
      </p>

      <div className="flex gap-1.5">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
          placeholder="Nom d’une entreprise ou d’une personne"
          className="block w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
        />
        <button
          type="button"
          onClick={search}
          disabled={searching || q.trim().length < 2}
          className="shrink-0 rounded-lg border bg-background px-3 py-1.5 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-50"
        >
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Chercher'}
        </button>
      </div>

      {hits !== null && hits.length === 0 && (
        <p className="text-[12.5px] text-muted-foreground">
          Personne ni entreprise à ce nom. C’est peut-être une identité nouvelle — dans ce cas, « Nouvel intervenant ».
        </p>
      )}

      {hits !== null && hits.length > 0 && (
        <ul className="space-y-1">
          {hits.map((h) => {
            const choisi = cible?.companyId === h.companyId && cible?.contactId === h.contactId
            return (
              <li key={`${h.kind}:${h.contactId ?? h.companyId}`}>
                <button
                  type="button"
                  onClick={() => { setCible(h); setRole(null) }}
                  aria-pressed={choisi}
                  className={cn(
                    'w-full rounded-lg border px-2.5 py-1.5 text-left text-[13px]',
                    choisi ? 'border-foreground bg-background' : 'bg-background hover:bg-muted',
                  )}
                >
                  <span className="font-medium">{h.name}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {h.kind === 'company' ? 'Entreprise' : `Contact · ${h.companyName}`}
                    {h.onThisSite ? ` · déjà sur ce chantier${h.knownRole ? ` (${h.knownRole})` : ''}` : ' · organisation'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {roleManquant && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">Son rôle sur ce chantier ?</p>
          <div className="flex flex-wrap gap-1.5">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                onClick={() => setRole(r)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] font-medium',
                  role === r ? 'border-foreground bg-foreground text-background' : 'bg-background',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || !cible || (!cible.knownRole && !role)}
          onClick={attach}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {cible ? `Rattacher à ${cible.name}` : 'Rattacher'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          Annuler
        </button>
      </div>
      {error && <p className="text-[12px] text-rose-600">{error}</p>}
    </div>
  )
}
