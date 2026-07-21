'use client'

// G2 + G3 — CONFIRMER UN INTERVENANT, EN POSANT LA QUESTION.
//
// Guillaume ne dit pas « l'IA s'est trompée ». Il dit « je suis bloqué ». Et il
// avait raison : un intervenant exige un RÔLE, le moteur répondait donc
// `needs_input`, et rien à l'écran ne posait la question. La proposition restait
// « À confirmer » pour toujours.
//
// Une proposition doit TOUJOURS offrir trois issues — confirmer, corriger,
// ignorer — et jamais rester coincée entre les deux.
//
// G3 vient avec, parce que c'est le même geste : « le prénom est bon, la
// société est fausse ». Une proposition se corrige AVANT d'être validée, sinon
// l'humain n'a le choix qu'entre accepter une erreur et tout perdre.
//
// Ce que l'écran ne fait pas : deviner. Il ne déduit pas un rôle d'un nom, ne
// transforme pas « Yann » en entreprise, et refuse une personne sans entreprise
// — un contact vit sous une entreprise (mig 137), et l'inverse créait jadis une
// société au nom d'un homme.

import { useState } from 'react'
import { Loader2, Check, X, Users, Pencil } from 'lucide-react'
import {
  promoteStakeholderProposalAction,
  dismissActionProposalAction,
} from '../debrief-actions'
import type { SummaryItem } from '@/lib/knowledge/visit-summary'

/** Les rôles courants d'un chantier. Une liste qui AIDE, jamais qui enferme :
 *  le champ reste libre, parce qu'aucune liste ne couvre tous les chantiers. */
const ROLES = ['Entreprise', 'Maître d’œuvre', 'Maître d’ouvrage', 'Bureau d’études', 'Contrôleur technique', 'Sous-traitant']

export function StakeholderProposals({
  reportId,
  items,
  onSettled,
}: {
  reportId: string
  items: SummaryItem[]
  onSettled?: (proposalId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="mt-2 space-y-2">
      <p className="text-[12px] text-sky-700 dark:text-sky-300">À confirmer — relevé par MemorIA :</p>
      {items.map((item) => (
        <StakeholderCard key={item.id} reportId={reportId} item={item} onSettled={onSettled} />
      ))}
    </div>
  )
}

function StakeholderCard({
  reportId,
  item,
  onSettled,
}: {
  reportId: string
  item: SummaryItem
  onSettled?: (proposalId: string) => void
}) {
  // Ce que MemorIA a lu est une CHAÎNE NUE : « Ginger », « Yann ». On ne sait
  // pas si c'est une entreprise ou une personne — donc on demande, on ne devine
  // pas. Par défaut, le texte lu remplit l'entreprise : c'est le cas le plus
  // fréquent sur un chantier, et il reste corrigible d'un geste.
  const [company, setCompany] = useState(item.title)
  const [person, setPerson] = useState('')
  const [role, setRole] = useState('')
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settled, setSettled] = useState<'created' | 'ignored' | null>(null)

  const proposalId = item.proposalId
  if (!proposalId) return null

  const confirm = async () => {
    if (pending) return
    if (!role.trim()) {
      setError('Indiquez son rôle sur le chantier — il ne se devine pas.')
      setEditing(true)
      return
    }
    setPending(true)
    setError(null)
    const res = await promoteStakeholderProposalAction({
      report_id: reportId,
      proposal_id: proposalId,
      role: role.trim(),
      company_name: company.trim() || undefined,
      person_name: person.trim() || undefined,
    })
    setPending(false)
    if (res.ok) {
      setSettled('created')
      onSettled?.(proposalId)
    } else setError(res.error)
  }

  const ignore = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    const res = await dismissActionProposalAction({ report_id: reportId, proposal_id: proposalId })
    setPending(false)
    if (res.ok) {
      setSettled('ignored')
      onSettled?.(proposalId)
    } else setError(res.error)
  }

  if (settled) {
    return (
      <p
        data-slot="stakeholder-settled"
        className="rounded-lg bg-muted/50 px-2.5 py-2 text-[12px] text-muted-foreground"
      >
        {settled === 'created' ? `${company || item.title} ajouté au chantier.` : `${item.title} ignoré.`}
      </p>
    )
  }

  return (
    <div data-slot="stakeholder-proposal" className="rounded-lg border bg-card px-2.5 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
          <Users className="h-3 w-3" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-1.5">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Entreprise</span>
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="w-full rounded-md border bg-background px-2 py-1 text-[13px]"
                  aria-label="Entreprise"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Personne (facultatif)</span>
                <input
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                  placeholder="Prénom Nom"
                  className="w-full rounded-md border bg-background px-2 py-1 text-[13px]"
                  aria-label="Personne"
                />
              </label>
            </div>
          ) : (
            <p className="text-[13px] font-medium leading-snug">{company || item.title}</p>
          )}

          <label className="mt-1.5 block">
            <span className="text-[11px] text-muted-foreground">Rôle sur le chantier</span>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              list={`roles-${proposalId}`}
              placeholder="Entreprise, maître d’œuvre…"
              className="w-full rounded-md border bg-background px-2 py-1 text-[13px]"
              aria-label="Rôle sur le chantier"
            />
            <datalist id={`roles-${proposalId}`}>
              {ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[12px] font-semibold text-background disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          Confirmer
        </button>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] hover:bg-muted disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Corriger
          </button>
        )}
        <button
          type="button"
          onClick={ignore}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Ignorer
        </button>
      </div>

      {error && <p className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  )
}
