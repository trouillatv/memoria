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
// Ce que l'écran ne fait pas : deviner. Il ne déduit pas un rôle d'un nom et ne
// transforme jamais « Yann » en entreprise.
//
// ── P0-3C (doctrine des 4 niveaux, migs 320+321, Vincent 2026-08-14) ─────────
//
// La question devient « QUI EST CET INTERVENANT ? » — et « je ne sais pas
// encore » est une réponse LÉGITIME. Personne et entreprise sont indépendantes
// et facultatives : rôle seul / personne seule / entreprise seule / les deux.
// Une personne sans entreprise est une identité de l'organisation (plus
// d'entreprise d'attente) ; personne + entreprise crée l'affiliation DATÉE.
// La mention lue reste intacte — préciser n'est pas renommer.

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
  // Ce que MemorIA a lu est une CHAÎNE NUE : « Ginger », « Yann »,
  // « Électricien ». Une société, un homme, un rôle — rien dans le texte ne dit
  // lequel, alors on n'ASSUME RIEN : les deux identités partent vides
  // (« Non identifiée »), et deux raccourcis d'un geste qualifient la mention.
  // Confirmer avec les deux vides est LÉGITIME : c'est la participation à rôle
  // seul (niveau 2) — MemorIA retient « l'électricien » sans inventer qui.
  const [company, setCompany] = useState('')
  const [person, setPerson] = useState('')
  const [role, setRole] = useState('')
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settled, setSettled] = useState<'created' | 'ignored' | null>(null)

  const proposalId = item.proposalId
  if (!proposalId) return null

  const roleOnly = !company.trim() && !person.trim()

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
      role_only: roleOnly || undefined,
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
        {settled === 'created'
          ? `${person.trim() || company.trim() || `Rôle « ${role.trim() || item.title} »`} ajouté au chantier.`
          : `${item.title} ignoré.`}
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
          {/* La MENTION lue, intacte — préciser n'est pas renommer. */}
          <p className="text-[13px] font-medium leading-snug">
            Intervenant détecté : «&nbsp;{item.title}&nbsp;»
          </p>

          {/* Qualification d'un GESTE : la mention est-elle une entreprise ou
              une personne ? On propose, on ne devine jamais. */}
          {!editing && !company.trim() && !person.trim() && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCompany(item.title)}
                disabled={pending}
                className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                C’est l’entreprise
              </button>
              <button
                type="button"
                onClick={() => setPerson(item.title)}
                disabled={pending}
                className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                C’est une personne
              </button>
            </div>
          )}

          {editing ? (
            /* Personne et entreprise INDÉPENDANTES, toutes deux facultatives. */
            <div className="mt-1.5 space-y-1.5">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Personne (facultatif)</span>
                <input
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                  placeholder="Rechercher ou ajouter — Prénom Nom"
                  className="w-full rounded-md border bg-background px-2 py-1 text-[13px]"
                  aria-label="Personne"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Entreprise (facultatif)</span>
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Rechercher ou ajouter"
                  className="w-full rounded-md border bg-background px-2 py-1 text-[13px]"
                  aria-label="Entreprise"
                />
              </label>
            </div>
          ) : (
            (company.trim() || person.trim()) && (
              <p className="mt-1 text-[12px] text-muted-foreground">
                Personne : <span className="text-foreground">{person.trim() || 'Non identifiée'}</span>
                {' · '}Entreprise : <span className="text-foreground">{company.trim() || 'Non identifiée'}</span>
              </p>
            )
          )}

          <label className="mt-1.5 block">
            <span className="text-[11px] text-muted-foreground">Rôle sur le chantier</span>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              list={`roles-${proposalId}`}
              placeholder="Électricien, maître d’œuvre…"
              className="w-full rounded-md border bg-background px-2 py-1 text-[13px]"
              aria-label="Rôle sur le chantier"
            />
            <datalist id={`roles-${proposalId}`}>
              {ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>

          {/* CE QUE « CONFIRMER » VA FAIRE — dit AVANT le clic. Les quatre
              états de connaissance parlent chacun leur vérité, y compris
              « personne encore identifiée » qui est un état légitime. */}
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {roleOnly
              ? 'Sans personne ni entreprise : MemorIA retiendra ce rôle sur le chantier, sans inventer d’identité — vous pourrez le préciser plus tard.'
              : person.trim() && company.trim()
                ? `Confirmera ${person.trim()} (${company.trim()}) — fiches créées si absentes, et l’appartenance ${person.trim()} ↔ ${company.trim()} sera enregistrée.`
                : person.trim()
                  ? `Confirmera ${person.trim()} comme intervenant — sa fiche sera créée si absente, entreprise à préciser plus tard.`
                  : `Confirmera « ${company.trim()} » comme entreprise intervenante — créée dans votre référentiel si absente.`}
          </p>
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
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Préciser l’intervenant
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
