'use client'

// DÉCISIONS (mig 136) — « on a décidé que… ». L'objet le plus durable d'un CR :
// mémoire du site, ni action ni prévision. Saisie + cycle de vie (actée → appliquée
// → caduque/contredite) ici même ; la décision est PROJETÉE dans le CR (Points
// administratifs) via le spine, pas dans un écran parallèle. MVP : ajout = human/sûr/actée.
import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Gavel, Pencil, Check, X, Trash2, Plus, Loader2, Link2 } from 'lucide-react'
import { addDecisionAction, editDecisionAction, deleteDecisionAction, attachDecisionToSubjectAction, attachDecisionSubjectsAction } from '../../pv-actions'
import { ACTION_CODES } from '@/lib/db/action-codes'
import { DECISION_STATUTS, DECISION_IMPACTS, STATUT_LABEL, IMPACT_LABEL, type DecisionImpact } from '@/lib/db/decision-constants'
import { subjectDedupKey, looksLikeAction } from '@/lib/db/subject-doctrine'
import type { SiteDecision } from '@/lib/db/site-decisions'

// PROPOSITION PRÉ-COCHÉE (choix B, Vincent) : à la validation du PV, on propose de
// rattacher d'un clic les décisions à leur sujet (champ `sujet` déjà saisi). Visible,
// défaisable (cases décochables), un seul « Rattacher ». L'humain valide, rien d'inventé.
function SubjectProposals({ reportId, decisions, existingNames }: { reportId: string; decisions: SiteDecision[]; existingNames: string[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  const existingKeys = useMemo(() => new Set(existingNames.map(subjectDedupKey)), [existingNames])
  // Une décision avec un `sujet` saisi mais pas encore rattachée = une proposition.
  // État DÉTERMINISTE (jamais un % inventé) : existant / nouveau / ressemble-à-action.
  const groups = useMemo(() => {
    const m = new Map<string, { sujet: string; existing: boolean; actionLike: boolean; hasAction: boolean; ids: string[] }>()
    for (const d of decisions) {
      const name = (d.sujet ?? '').trim()
      if (!name || d.subjectId) continue
      const key = subjectDedupKey(name)
      const g = m.get(key) ?? { sujet: name, existing: existingKeys.has(key), actionLike: looksLikeAction(name), hasAction: false, ids: [] as string[] }
      g.ids.push(d.id)
      if (d.actionId) g.hasAction = true
      m.set(key, g)
    }
    return [...m.entries()].map(([key, g]) => ({ key, ...g }))
  }, [decisions, existingKeys])

  if (groups.length === 0) return null
  // Pré-coché par défaut SAUF si « ressemble à une action » (on ne crée pas de sujet
  // douteux sans regard) → l'humain coche explicitement ceux-là.
  const isChecked = (g: { key: string; actionLike: boolean }) => checked[g.key] ?? !g.actionLike
  const selectedIds = groups.filter(isChecked).flatMap((g) => g.ids)

  function validate() {
    setError(null)
    start(async () => {
      const r = await attachDecisionSubjectsAction(reportId, selectedIds)
      if (r.ok) router.refresh()
      else setError(r.error)
    })
  }

  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
      <p className="text-[11px] font-medium text-violet-900">
        Retrouver automatiquement ces points lors des prochaines réunions ? (pré-coché, décochez ce qui ne va pas)
      </p>
      <ul className="space-y-1.5">
        {groups.map((g) => (
          <li key={g.key} className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={isChecked(g)} onChange={() => setChecked((c) => ({ ...c, [g.key]: !isChecked(g) }))} className="mt-1 accent-violet-600" />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">« {g.sujet} »</span>
                {g.existing ? (
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">✓ Déjà connu</span>
                ) : g.actionLike ? (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">⚠ Ressemble à une action — à vérifier</span>
                ) : (
                  <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">➕ Sera ajouté à la mémoire</span>
                )}
                {g.ids.length > 1 && <span className="text-[10px] text-muted-foreground">· {g.ids.length} décisions</span>}
              </span>
              {/* #2 — ce que ça enrichit réellement (pas juste une ligne). */}
              <span className="block text-[10px] text-muted-foreground">
                Décision{g.hasAction ? ' · Action liée' : ''} · apparaît au Journal et à la Vue Sujet
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending || selectedIds.length === 0} onClick={validate}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Suivre{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
        </button>
        {/* #3 — le bénéfice immédiat, pour expliquer POURQUOI on demande cette validation. */}
        <span className="text-[10px] text-muted-foreground">Les prochaines réunions et l’Atelier mémoire retrouveront automatiquement ce point.</span>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </div>
  )
}

type Res = { ok: true } | { ok: false; error: string }
export interface DecisionOption { id: string; label: string }

// Cycle de vie pertinent à piloter à la main (proposée = réservé extraction IA).
const STATUTS_HUMAINS = DECISION_STATUTS.filter((s) => s !== 'proposee')

function ddmmyyyy(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

function Row({ reportId, siteId, d, contacts, actions, personLinkByContact }: { reportId: string; siteId: string | null; d: SiteDecision; contacts: DecisionOption[]; actions: DecisionOption[]; personLinkByContact: Record<string, string> }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [editing, setEditing] = useState(false)
  const [titre, setTitre] = useState(d.titre)
  const [desc, setDesc] = useState(d.description ?? '')
  const [sujet, setSujet] = useState(d.sujet ?? '')
  const [role, setRole] = useState(d.decisionnaireRole ?? '')
  const [contactId, setContactId] = useState(d.decisionnaireContactId ?? '')
  const [actionId, setActionId] = useState(d.actionId ?? '')
  const [impact, setImpact] = useState<DecisionImpact | ''>(d.impact ?? '')
  const [ech, setEch] = useState(d.echeance ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const editStartRef = useRef<number>(0) // chrono d'édition → temps de correction (mig 140)
  const contactLabel = d.decisionnaireContactId ? contacts.find((c) => c.id === d.decisionnaireContactId)?.label : null
  const actionLabel = d.actionId ? actions.find((a) => a.id === d.actionId)?.label : null

  function run(fn: () => Promise<Res>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try { const r = await fn(); if (r.ok) { onOk?.(); router.refresh() } else setError(r.error) }
      catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  // Décisionnaire : la PERSONNE réelle si liée (P2), sinon l'organisme, sinon le rôle.
  const decideur = contactLabel || d.decisionnaireOrg || d.decisionnaireRole
  // « Fiche partout » : le décisionnaire ouvre sa fiche transverse UNIQUEMENT s'il
  // est un intervenant du casting (résolu côté serveur). Hors casting = texte
  // inerte : aucun rapprochement nominal, aucune fiche reconstruite.
  const decideurLinkId = d.decisionnaireContactId ? personLinkByContact[d.decisionnaireContactId] : undefined
  const ficheHref = (intervenantId: string): string => {
    const p = new URLSearchParams(searchParams?.toString() ?? '')
    p.set('person', intervenantId)
    p.set('person_source', 'decision')
    return `${pathname}?${p.toString()}`
  }
  const echLabel = ddmmyyyy(d.echeance)
  const metaParts: React.ReactNode[] = []
  if (d.sujet) metaParts.push(d.sujet)
  if (decideur) {
    metaParts.push(
      decideurLinkId
        ? <Link key="dec" href={ficheHref(decideurLinkId)} scroll={false} className="underline decoration-dotted underline-offset-2 hover:text-foreground">{decideur}</Link>
        : decideur,
    )
  }
  if (d.impact) metaParts.push(IMPACT_LABEL[d.impact])
  if (echLabel) metaParts.push(`éch. ${echLabel}`)

  return (
    <li className="rounded-lg border bg-card px-3 py-2 text-sm">
      {editing ? (
        <div className="space-y-1.5">
          <input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Décision prise" autoFocus
            className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Détail (optionnel)"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <div className="flex flex-wrap gap-2">
            <input value={sujet} onChange={(e) => setSujet(e.target.value)} placeholder="Sujet (ex. « revêtement »)"
              className="min-w-[8rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
            <select value={role} onChange={(e) => setRole(e.target.value)} title="Décisionnaire"
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
              <option value="">Décisionnaire…</option>
              {ACTION_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={impact} onChange={(e) => setImpact(e.target.value as DecisionImpact | '')} title="Impact"
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
              <option value="">Impact…</option>
              {DECISION_IMPACTS.map((i) => <option key={i} value={i}>{IMPACT_LABEL[i]}</option>)}
            </select>
            <input value={ech} onChange={(e) => setEch(e.target.value)} type="date" title="Échéance d'application"
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          </div>
          {/* Décisionnaire = personne réelle (P2) + lien vers l'action engendrée (UI légère). */}
          <div className="flex flex-wrap gap-2">
            {contacts.length > 0 && (
              <select value={contactId} onChange={(e) => setContactId(e.target.value)} title="Décisionnaire (contact réel)"
                className="min-w-[10rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
                <option value="">Décisionnaire — contact réel…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            )}
            {actions.length > 0 && (
              <select value={actionId} onChange={(e) => setActionId(e.target.value)} title="Action engendrée par la décision"
                className="min-w-[10rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
                <option value="">→ Action liée…</option>
                {actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending || !titre.trim()}
              onClick={() => run(() => editDecisionAction(reportId, d.id, { titre, description: desc, sujet, decisionnaireRole: role, decisionnaireContactId: contactId || null, actionId: actionId || null, impact: impact || '', echeance: ech, timeToCorrectMs: editStartRef.current ? Date.now() - editStartRef.current : null }), () => setEditing(false))}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
            </button>
            <button type="button" disabled={pending} onClick={() => { setTitre(d.titre); setDesc(d.description ?? ''); setSujet(d.sujet ?? ''); setRole(d.decisionnaireRole ?? ''); setContactId(d.decisionnaireContactId ?? ''); setActionId(d.actionId ?? ''); setImpact(d.impact ?? ''); setEch(d.echeance ?? ''); setEditing(false); setError(null) }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /> Annuler</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <span className="min-w-0 flex-1">
            {/* « Toutes les portes » : l'écran de validation reste l'espace de
                travail (saisie, cycle de vie, rattachement) ; le titre ouvre la
                fiche du graphe, d'où l'on suit les relations de la décision.
                Sans chantier (réunion de contrat), pas de fiche : simple texte. */}
            {siteId ? (
              <Link
                href={`/sites/${siteId}/decision/${d.id}`}
                scroll={false}
                className={`hover:underline ${d.statut === 'caduque' || d.statut === 'contredite' ? 'text-muted-foreground line-through' : ''}`}
              >
                {d.titre}
              </Link>
            ) : (
              <span className={d.statut === 'caduque' || d.statut === 'contredite' ? 'text-muted-foreground line-through' : ''}>{d.titre}</span>
            )}
            {d.description && <span className="block text-[11px] text-muted-foreground">{d.description}</span>}
            {metaParts.length > 0 && (
              <span className="block text-[11px] text-muted-foreground">
                {metaParts.map((part, i) => <span key={i}>{i > 0 && ' · '}{part}</span>)}
              </span>
            )}
            {actionLabel && (
              // Lot 4 · Slice 4 : une décision qui référence une action ouvre la
              // FICHE canonique de l'action (?action=). Sinon simple texte.
              siteId && d.actionId ? (
                <Link href={`/sites/${siteId}?action=${d.actionId}&action_source=decision`} scroll={false}
                  className="block text-[11px] text-sky-700 hover:underline">→ Action : {actionLabel}</Link>
              ) : (
                <span className="block text-[11px] text-sky-700">→ Action : {actionLabel}</span>
              )
            )}
          </span>
          {/* Cycle de vie piloté à la main (la mémoire vivante : appliquée / caduque…). */}
          <select value={d.statut} disabled={pending} title="Statut de la décision"
            onChange={(e) => run(() => editDecisionAction(reportId, d.id, { statut: e.target.value as SiteDecision['statut'] }))}
            className="shrink-0 rounded-md border bg-background px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-slate-300">
            {STATUTS_HUMAINS.map((s) => <option key={s} value={s}>{STATUT_LABEL[s]}</option>)}
          </select>
          {d.confiance === 'à confirmer' && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">à confirmer</span>}
          {/* Pont Vue Sujet : rattacher la décision à son sujet (find-or-create). */}
          {d.subjectId ? (
            <span title="Rattachée à un sujet" className="shrink-0 text-[11px] text-emerald-700">🔗 sujet</span>
          ) : d.sujet ? (
            <button type="button" disabled={pending} title={`Rattacher au sujet « ${d.sujet} »`}
              onClick={() => run(() => attachDecisionToSubjectAction(reportId, d.id, d.sujet!))}
              className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">🔗 sujet</button>
          ) : null}
          <button type="button" disabled={pending} title="Modifier" onClick={() => { editStartRef.current = Date.now(); setEditing(true) }} className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={pending} title="Supprimer" onClick={() => run(() => deleteDecisionAction(reportId, d.id))} className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  )
}

function AddDecision({ reportId, contacts }: { reportId: string; contacts: DecisionOption[] }) {
  const router = useRouter()
  const [titre, setTitre] = useState('')
  const [sujet, setSujet] = useState('')
  const [role, setRole] = useState('')
  const [contactId, setContactId] = useState('')
  const [impact, setImpact] = useState<DecisionImpact | ''>('')
  const [ech, setEch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    setError(null)
    startTransition(async () => {
      try {
        const r = await addDecisionAction(reportId, { titre, sujet, decisionnaireRole: role, decisionnaireContactId: contactId || undefined, impact, echeance: ech })
        if (r.ok) { setTitre(''); setSujet(''); setRole(''); setContactId(''); setImpact(''); setEch(''); router.refresh() }
        else setError(r.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-2">
      <input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Décision prise (ex. « Validation du revêtement : produit X retenu »)"
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      <div className="flex flex-wrap items-center gap-2">
        <input value={sujet} onChange={(e) => setSujet(e.target.value)} placeholder="Sujet (ex. « revêtement »)"
          className="min-w-[8rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <select value={role} onChange={(e) => setRole(e.target.value)} title="Décisionnaire"
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
          <option value="">Rôle décideur…</option>
          {ACTION_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {contacts.length > 0 && (
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} title="Décisionnaire (contact réel)"
            className="min-w-[10rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
            <option value="">Contact décideur…</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
        <select value={impact} onChange={(e) => setImpact(e.target.value as DecisionImpact | '')} title="Impact"
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
          <option value="">Impact…</option>
          {DECISION_IMPACTS.map((i) => <option key={i} value={i}>{IMPACT_LABEL[i]}</option>)}
        </select>
        <input value={ech} onChange={(e) => setEch(e.target.value)} type="date" title="Échéance d'application (optionnelle)"
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <button type="button" disabled={pending || !titre.trim()} onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Décision
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  )
}

export function PvDecisionsBlock({ reportId, siteId = null, decisions, contacts = [], actions = [], existingSubjectNames = [], personLinkByContact = {} }: {
  reportId: string; siteId?: string | null; decisions: SiteDecision[]; contacts?: DecisionOption[]; actions?: DecisionOption[]; existingSubjectNames?: string[]
  /** contactId → id du lien de casting actif : le décisionnaire n'est cliquable
   *  (ouvre sa fiche) que s'il est présent ici. Absent = nom inerte. */
  personLinkByContact?: Record<string, string>
}) {
  return (
    <section className="space-y-2">
      <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Gavel className="h-3.5 w-3.5" /> Décisions ({decisions.length})
      </h2>
      <SubjectProposals reportId={reportId} decisions={decisions} existingNames={existingSubjectNames} />
      {decisions.length > 0 && (
        <ul className="space-y-1">{decisions.map((d) => <Row key={d.id} reportId={reportId} siteId={siteId} d={d} contacts={contacts} actions={actions} personLinkByContact={personLinkByContact} />)}</ul>
      )}
      <AddDecision reportId={reportId} contacts={contacts} />
    </section>
  )
}
