'use client'

// LE TRAVAIL RESTANT — la colonne de droite de l'atelier.
//
// LE DÉFAUT QU'IL CORRIGE : on lisait deux fois la même histoire. Le document
// racontait la visite ; « Ce que MemorIA a retenu » la racontait à nouveau,
// dans le même axe de lecture, juste en dessous. Le conducteur se demandait
// pourquoi il relisait.
//
// Ici, l'axe change. À gauche : LE COMPTE-RENDU, ce que le chantier saura. À
// droite : CE QU'IL RESTE À TRANCHER. Ce ne sont plus deux récits concurrents,
// c'est un document et son reste-à-faire.
//
// CE PANNEAU NE MONTRE QUE CE QUI A UN GESTE. Actions, échéances, intervenants :
// trois familles, trois verbes. Les décisions, vigilances et savoirs n'ont pas
// de bouton ici — ils vivent dans le document et se concrétisent plus bas. Un
// bloc qui n'aide pas à finir la visite n'a pas sa place dans cette colonne.
//
// CE QU'IL NE FERA JAMAIS : « Créer toutes ». Arbitrer six actions d'un clic,
// c'est acquitter, plus décider — exactement l'ambiguïté que la concrétisation
// a supprimée. La compacité règle la fatigue ; le lot ne réglerait qu'un
// compteur. Cf. [[ia-ne-promeut-jamais-meme-sur-demande]].

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, X, ListTodo, CalendarClock, Users, ChevronDown } from 'lucide-react'
import {
  getVisitSummaryAction,
  promoteActionProposalAction,
  dismissActionProposalAction,
  promoteStakeholderProposalAction,
} from '@/app/(field)/m/visite/[reportId]/debrief-actions'
import type { VisitSummary, SummaryItem } from '@/lib/knowledge/visit-summary'

type Cle = 'action' | 'echeance' | 'intervenant'

const FAMILLE: Record<Cle, { un: string; plusieurs: string; Icon: typeof ListTodo; teinte: string; barre: string }> = {
  // Les mêmes teintes que le bureau de la visite : on retrouve « les échéances »
  // sans lire les mots.
  action: {
    un: 'action', plusieurs: 'actions', Icon: ListTodo,
    teinte: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
    barre: 'bg-amber-400',
  },
  echeance: {
    un: 'échéance', plusieurs: 'échéances', Icon: CalendarClock,
    teinte: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
    barre: 'bg-sky-400',
  },
  intervenant: {
    un: 'intervenant', plusieurs: 'intervenants', Icon: Users,
    teinte: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    barre: 'bg-emerald-400',
  },
}

export function PanneauArbitrage({ reportId }: { reportId: string }) {
  const [summary, setSummary] = useState<VisitSummary | null>(null)
  const [phase, setPhase] = useState<'chargement' | 'prêt' | 'erreur'>('chargement')
  // Une seule famille dépliée à la fois — la grammaire du bureau de la visite.
  // Six colonnes ouvertes redonneraient la liste à plat qu'on cherche à éviter.
  const [ouverte, setOuverte] = useState<Cle | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const relire = useCallback(async () => {
    const res = await getVisitSummaryAction({ report_id: reportId })
    if (res.ok) {
      setSummary(res.summary)
      setPhase('prêt')
    } else setPhase('erreur')
  }, [reportId])

  useEffect(() => { void relire() }, [relire])

  // Le serveur fait autorité après chaque geste : on relit le contrat plutôt que
  // de mimer localement un état qui dirait la même chose en moins sûr.
  const agir = async (id: string, fn: () => Promise<{ ok: boolean }>) => {
    if (busy) return
    setBusy(id)
    const res = await fn()
    if (res.ok) await relire()
    setBusy(null)
  }

  if (phase === 'chargement') {
    return (
      <PanneauCadre>
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Lecture des propositions…
        </p>
      </PanneauCadre>
    )
  }

  if (phase === 'erreur' || !summary) {
    return (
      <PanneauCadre>
        <p className="text-[13px] text-muted-foreground">
          Les propositions n’ont pas pu être lues. Le compte-rendu, lui, reste modifiable.
        </p>
      </PanneauCadre>
    )
  }

  const groupes: Array<{ cle: Cle; restants: SummaryItem[]; arbitrés: number }> = [
    { cle: 'action', restants: summary.actions.proposed, arbitrés: summary.actions.confirmed.length },
    { cle: 'echeance', restants: summary.deadlines.proposed, arbitrés: summary.deadlines.confirmed.length },
    { cle: 'intervenant', restants: summary.stakeholders.proposed, arbitrés: summary.stakeholders.confirmed.length },
  ]

  const restant = groupes.reduce((n, g) => n + g.restants.length, 0)
  const arbitrés = groupes.reduce((n, g) => n + g.arbitrés, 0)
  const total = restant + arbitrés

  return (
    <PanneauCadre>
      <Progression restant={restant} arbitrés={arbitrés} total={total} groupes={groupes} />

      {restant === 0 ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[13px] text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
          Plus rien à trancher. Le compte-rendu peut partir.
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {groupes
            .filter((g) => g.restants.length > 0)
            .map((g) => (
              <Groupe
                key={g.cle}
                cle={g.cle}
                items={g.restants}
                ouverte={ouverte}
                setOuverte={setOuverte}
                busy={busy}
                reportId={reportId}
                agir={agir}
              />
            ))}
        </div>
      )}
    </PanneauCadre>
  )
}

function PanneauCadre({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-3.5">
      <h2 className="text-sm font-semibold">Ce qu’il reste à trancher</h2>
      {children}
    </section>
  )
}

/**
 * LA PROGRESSION DIT CE QUI RESTE À REGARDER — jamais un score à finir.
 *
 * « 8/12 » se lit comme une note : il pousse à cliquer pour remplir la barre.
 * Le nombre mis en avant est donc le RESTANT, et la barre n'est qu'un repère
 * derrière lui. Elle ne compte que les familles réellement arbitrables ici :
 * une barre qui inclurait ce qu'on ne peut pas trancher mentirait.
 */
function Progression({
  restant,
  arbitrés,
  total,
  groupes,
}: {
  restant: number
  arbitrés: number
  total: number
  groupes: Array<{ cle: Cle; restants: SummaryItem[] }>
}) {
  if (total === 0) {
    return <p className="mt-1 text-[12.5px] text-muted-foreground">MemorIA n’a rien proposé à arbitrer sur cette visite.</p>
  }
  const part = Math.round((arbitrés / total) * 100)
  return (
    <div className="mt-1">
      <p className="text-[13px]">
        {restant > 0 ? (
          <>
            <span className="font-semibold tabular-nums">{restant}</span>{' '}
            {restant > 1 ? 'propositions à regarder' : 'proposition à regarder'}
          </>
        ) : (
          <span className="font-medium">Tout est arbitré</span>
        )}
      </p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div className="h-full rounded-full bg-foreground/70 transition-[width]" style={{ width: `${part}%` }} />
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground tabular-nums">
        {arbitrés} arbitrée{arbitrés > 1 ? 's' : ''} sur {total}
      </p>
      {restant > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {groupes
            .filter((g) => g.restants.length > 0)
            .map((g) => (
              <li key={g.cle} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <span className={`h-1.5 w-1.5 rounded-full ${FAMILLE[g.cle].barre}`} aria-hidden />
                {g.restants.length} {g.restants.length > 1 ? FAMILLE[g.cle].plusieurs : FAMILLE[g.cle].un}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

function Groupe({
  cle,
  items,
  ouverte,
  setOuverte,
  busy,
  reportId,
  agir,
}: {
  cle: Cle
  items: SummaryItem[]
  ouverte: Cle | null
  setOuverte: (c: Cle | null) => void
  busy: string | null
  reportId: string
  agir: (id: string, fn: () => Promise<{ ok: boolean }>) => Promise<void>
}) {
  const f = FAMILLE[cle]
  const open = ouverte === cle
  return (
    <div className="rounded-xl border bg-background">
      <button
        type="button"
        onClick={() => setOuverte(open ? null : cle)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-muted/60"
      >
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-semibold tabular-nums ${f.teinte}`}>
          {items.length}
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-medium">
          {items.length > 1 ? f.plusieurs : f.un}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <ul className="space-y-1 border-t p-1.5">
          {items.map((item) =>
            cle === 'intervenant' ? (
              <LigneIntervenant key={item.id} item={item} reportId={reportId} busy={busy} agir={agir} />
            ) : (
              <LigneProposition key={item.id} item={item} reportId={reportId} busy={busy} agir={agir} />
            ),
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * UNE PROPOSITION = UNE LIGNE. Le verbe est porté par la famille dépliée, pas
 * répété huit fois en gros bouton violet : les deux gestes sont secondaires et
 * discrets, c'est le TEXTE de la proposition qu'on doit lire.
 */
function LigneProposition({
  item,
  reportId,
  busy,
  agir,
}: {
  item: SummaryItem
  reportId: string
  busy: string | null
  agir: (id: string, fn: () => Promise<{ ok: boolean }>) => Promise<void>
}) {
  const pid = item.proposalId
  if (!pid) return null
  const enCours = busy === pid
  const meta = [item.owner, item.due].filter(Boolean).join(' · ')

  return (
    <li className="rounded-lg px-2 py-1.5 hover:bg-muted/50">
      <p className="text-[13px] font-medium leading-snug">{item.title}</p>
      {item.detail && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{item.detail}</p>}
      {meta && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{meta}</p>}
      <div className="mt-1.5 flex items-center gap-1">
        <button
          type="button"
          disabled={!item.capability.available || !!busy}
          onClick={() => agir(pid, () => promoteActionProposalAction({ report_id: reportId, proposal_id: pid }))}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
        >
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          {item.capability.label}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => agir(pid, () => dismissActionProposalAction({ report_id: reportId, proposal_id: pid }))}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Écarter
        </button>
      </div>
    </li>
  )
}

/**
 * UN INTERVENANT TIENT SUR UNE LIGNE — et se corrige SUR PLACE.
 *
 * L'écran mobile posait trois boutons (Confirmer / Corriger / Ignorer) et deux
 * champs empilés, répétés à chaque personne. « Corriger » disparaît ici : le nom
 * EST le champ. On écrit dedans, ou on n'y touche pas.
 *
 * Ce qui ne change pas, parce que c'est du domaine et non de la mise en page :
 * le rôle ne se devine JAMAIS. Sans rôle, pas de confirmation — un intervenant
 * sans rôle n'existe pas sur un chantier (mig 137).
 */
function LigneIntervenant({
  item,
  reportId,
  busy,
  agir,
}: {
  item: SummaryItem
  reportId: string
  busy: string | null
  agir: (id: string, fn: () => Promise<{ ok: boolean }>) => Promise<void>
}) {
  const pid = item.proposalId
  const [entreprise, setEntreprise] = useState(item.title)
  const [role, setRole] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  if (!pid) return null
  const enCours = busy === pid

  const confirmer = () => {
    if (!role.trim()) {
      setErreur('Indiquez son rôle sur le chantier — il ne se devine pas.')
      return
    }
    setErreur(null)
    void agir(pid, () =>
      promoteStakeholderProposalAction({
        report_id: reportId,
        proposal_id: pid,
        role: role.trim(),
        company_name: entreprise.trim() || undefined,
      }),
    )
  }

  return (
    <li className="rounded-lg px-2 py-1.5 hover:bg-muted/50">
      <div className="flex items-center gap-1.5">
        {/* Le nom lu par MemorIA est un texte, pas une vérité : il s'édite sur
            place, sans bouton « Corriger » et sans changer de mode. */}
        <input
          value={entreprise}
          onChange={(e) => setEntreprise(e.target.value)}
          aria-label="Entreprise"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-medium hover:border-border focus:border-border focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={role}
          onChange={(e) => { setRole(e.target.value); if (erreur) setErreur(null) }}
          list={`roles-${pid}`}
          placeholder="son rôle"
          aria-label="Rôle sur le chantier"
          className={`w-28 shrink-0 rounded-md border bg-background px-1.5 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring ${
            erreur ? 'border-rose-400' : ''
          }`}
        />
        <datalist id={`roles-${pid}`}>
          {['Entreprise', 'Maître d’œuvre', 'Maître d’ouvrage', 'Bureau d’études', 'Contrôleur technique', 'Sous-traitant'].map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <button
          type="button"
          disabled={!!busy}
          onClick={confirmer}
          title="Confirmer cet intervenant"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
        >
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => agir(pid, () => dismissActionProposalAction({ report_id: reportId, proposal_id: pid }))}
          title="Ignorer"
          className="inline-flex shrink-0 items-center rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {erreur && <p className="mt-1 pl-1.5 text-[11.5px] text-rose-600 dark:text-rose-400">{erreur}</p>}
    </li>
  )
}
