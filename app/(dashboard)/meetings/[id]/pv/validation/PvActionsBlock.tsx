'use client'

// Bloc ACTIONS du CR — Ajouter / Modifier / Supprimer (Vincent : l'entité la plus
// fréquente ; « dans 80 % des cas, Émeline ajoute »). Écrit la SOURCE (site_actions)
// → une seule vérité, ressert partout (briefing, recherche, pilier Actions).
//
// P2 Slice 2 : le responsable devient une PERSONNE STRUCTURELLE. Un sélecteur
// « Responsable identifié » propose les personnes confirmées du chantier (casting
// actif, groupées par entreprise) et stocke assigned_contact_id. Le texte libre
// (« Responsable historique ») subsiste pour les anciennes actions, mais les DEUX
// modes sont EXCLUSIFS : choisir une personne masque le texte (jamais
// assigned_contact_id=Vincent + assigned_to=Sotrap). Le texte n'est jamais
// présenté comme une relation structurelle.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, Trash2, Plus, Loader2, ListTodo, UserCheck } from 'lucide-react'
import { addActionAction, editActionAction, deleteActionAction } from '../../pv-actions'
import { PvActionCodes } from './PvActionCodes'

export interface CastingCompany {
  company: string
  persons: Array<{ id: string; fullName: string; fonction: string | null }>
}

export interface ActionRow {
  id: string
  title: string
  assignedTo: string
  /** Responsable STRUCTUREL (personne) — '' si aucun. assigned_to reste la trace. */
  assignedContactId: string
  dueDate: string // AAAA-MM-JJ ou ''
  corpsEtat: string
  actionCodes: string[] // colonne ACTION mémorisée (ETV/MOA/… ; mig 132)
}

type Res = { ok: true } | { ok: false; error: string }
type RoleActors = Record<string, { company: string; contact: string | null }>

/** Le choix du responsable : UNE personne du casting (structurel) OU un texte
 *  libre (historique/hors casting), jamais les deux. Choisir une personne masque
 *  le champ texte — l'utilisateur choisit un mode, pas deux. */
function ResponsibleFields({
  castingPersons, contactId, setContactId, text, setText,
}: {
  castingPersons: CastingCompany[]
  contactId: string
  setContactId: (v: string) => void
  text: string
  setText: (v: string) => void
}) {
  return (
    <div className="min-w-[10rem] flex-1 space-y-1">
      {castingPersons.length > 0 && (
        <select
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          title="Responsable identifié (personne du chantier)"
          className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <option value="">Responsable identifié…</option>
          {castingPersons.map((g) => (
            <optgroup key={g.company} label={g.company}>
              {g.persons.map((p) => (
                <option key={p.id} value={p.id}>{p.fullName}{p.fonction ? ` · ${p.fonction}` : ''}</option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      {/* Texte libre : UNIQUEMENT si aucune personne choisie (modes exclusifs). */}
      {!contactId && (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={castingPersons.length > 0 ? 'ou responsable (texte libre)' : 'Responsable'}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      )}
    </div>
  )
}

function Row({ reportId, action, roleActors, castingPersons }: { reportId: string; action: ActionRow; roleActors?: RoleActors; castingPersons: CastingCompany[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(action.title)
  // Contact structurel d'un côté, texte de l'autre. Le texte ne porte l'ancienne
  // valeur QUE s'il n'y a pas de contact (sinon assignedTo est le mirror du nom).
  const [whoContact, setWhoContact] = useState(action.assignedContactId)
  const [whoText, setWhoText] = useState(action.assignedContactId ? '' : action.assignedTo)
  const [due, setDue] = useState(action.dueDate)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<Res>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try { const r = await fn(); if (r.ok) { onOk?.(); router.refresh() } else setError(r.error) }
      catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <li className="rounded-lg border bg-card px-3 py-2 text-sm">
      {editing ? (
        <div className="space-y-1.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intitulé de l'action" autoFocus
            className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <div className="flex flex-wrap gap-2">
            <ResponsibleFields castingPersons={castingPersons} contactId={whoContact} setContactId={setWhoContact} text={whoText} setText={setWhoText} />
            <input value={due} onChange={(e) => setDue(e.target.value)} type="date"
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending || !title.trim()} onClick={() => run(() => editActionAction(reportId, action.id, { title, assignedTo: whoText, assignedContactId: whoContact || null, dueDate: due }), () => setEditing(false))}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
            </button>
            <button type="button" disabled={pending} onClick={() => { setTitle(action.title); setWhoContact(action.assignedContactId); setWhoText(action.assignedContactId ? '' : action.assignedTo); setDue(action.dueDate); setEditing(false); setError(null) }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /> Annuler</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <span className="min-w-0 flex-1">
            {action.title}
            {(action.assignedContactId || action.assignedTo || action.dueDate) && (
              <span className="block text-[11px] text-muted-foreground">
                {action.assignedContactId ? (
                  // Responsable STRUCTUREL : une personne du chantier.
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                    <UserCheck className="h-3 w-3" />{action.assignedTo}
                  </span>
                ) : action.assignedTo ? (
                  // Trace texte historique — jamais présentée comme une personne.
                  <span>Responsable (ancien suivi) : {action.assignedTo}</span>
                ) : null}
                {(action.assignedContactId || action.assignedTo) && action.dueDate ? ' · ' : ''}
                {action.dueDate ? `échéance ${action.dueDate}` : ''}
              </span>
            )}
          </span>
          <button type="button" disabled={pending} title="Modifier" onClick={() => setEditing(true)} className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={pending} title="Supprimer" onClick={() => run(() => deleteActionAction(reportId, action.id))} className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {/* Colonne ACTION (mig 132) : qui doit faire quoi — codes responsables mémorisés. */}
      {!editing && (
        <div className="mt-2 border-t pt-2">
          <PvActionCodes reportId={reportId} source={action.id} codes={action.actionCodes} roleActors={roleActors} />
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  )
}

function AddAction({ reportId, castingPersons }: { reportId: string; castingPersons: CastingCompany[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [whoContact, setWhoContact] = useState('')
  const [whoText, setWhoText] = useState('')
  const [due, setDue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    setError(null)
    startTransition(async () => {
      try {
        const r = await addActionAction(reportId, { title, assignedTo: whoText, assignedContactId: whoContact || null, dueDate: due })
        if (r.ok) { setTitle(''); setWhoContact(''); setWhoText(''); setDue(''); setOpen(false); router.refresh() }
        else setError(r.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted/40">
      <Plus className="h-4 w-4" /> Ajouter une action
    </button>
  )
  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intitulé (ex. « Relancer SudÉlec pour le tableau »)" autoFocus
        className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      <div className="flex flex-wrap items-start gap-2">
        <ResponsibleFields castingPersons={castingPersons} contactId={whoContact} setContactId={setWhoContact} text={whoText} setText={setWhoText} />
        <input value={due} onChange={(e) => setDue(e.target.value)} type="date"
          className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <button type="button" disabled={pending || !title.trim()} onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null) }} className="text-sm text-muted-foreground hover:text-foreground">Annuler</button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  )
}

export function PvActionsBlock({ reportId, actions, roleActors, castingPersons = [] }: { reportId: string; actions: ActionRow[]; roleActors?: RoleActors; castingPersons?: CastingCompany[] }) {
  return (
    <section className="space-y-2">
      <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <ListTodo className="h-3.5 w-3.5" /> Actions ({actions.length})
      </h2>
      {actions.length > 0 && (
        <ul className="space-y-1">{actions.map((a) => <Row key={a.id} reportId={reportId} action={a} roleActors={roleActors} castingPersons={castingPersons} />)}</ul>
      )}
      <AddAction reportId={reportId} castingPersons={castingPersons} />
    </section>
  )
}
