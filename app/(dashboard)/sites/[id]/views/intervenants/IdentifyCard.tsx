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

/** Les rôles courants du chantier — la même liste libre que la Mémoire (mig 137). */
const ROLES = ['MOA', 'MOE', 'BET', 'ETV', 'OPC', 'CSPS', 'PAVE', 'PLANIF']

// ── « À identifier » : le geste d'identification ─────────────────────────────
export function IdentifyCard({ siteId, item, onDone }: { siteId: string; item: ToIdentifyItem; onDone: () => void }) {
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
