'use client'

// LE TRAVAIL RESTANT — la colonne de droite de l'atelier.
//
// LE DÉFAUT QU'IL CORRIGE : on lisait deux fois la même histoire. Le document
// racontait la visite ; « Ce que MemorIA a retenu » la racontait à nouveau,
// dans le même axe de lecture, juste en dessous. Le conducteur se demandait
// pourquoi il relisait.
//
// ── CE PANNEAU COMPTE DES DÉCISIONS, PAS DES OBJETS (Vincent, 2026-07-22) ───
//
// Première version : « 17 propositions à regarder », avec une barre de
// progression et « 0 arbitrée sur 17 ». Juste à côté, la concrétisation
// annonçait « 19 éléments proposés · 15 seront créés ». Deux totaux de la même
// visite, côte à côte, qui ne tombaient pas juste — et le cerveau cherchait
// forcément à les rapprocher.
//
// Or ils ne parlent pas de la même chose :
//   · ici        → « qu'est-ce que MemorIA me demande encore de DÉCIDER ? »
//   · à gauche   → « si je valide, qu'est-ce qui SERA CRÉÉ ? »
//
// Ce sont deux ÉTAPES successives, pas deux mesures concurrentes. Elles n'ont
// donc plus le même poids : ce panneau est une liste de choses à faire, pas un
// résumé. D'où la disparition de la barre et du ratio — un « 0 / 17 » se lit
// comme une note à remplir. Et il ne porte PLUS AUCUN TOTAL en tête : un nombre
// global serait aussitôt rapproché de celui d'à côté, or c'est justement le
// rapprochement qui n'a pas de sens. Chaque famille porte son propre compte.
//
// ── UNE FAMILLE TERMINÉE RESTE À L'ÉCRAN (Vincent, 2026-07-22) ──────────────
//
// Elle la faisait d'abord disparaître — « plus rien à demander ». Mais c'est la
// LIGNE COCHÉE qui donne le sentiment d'avancer : la retirer efface la preuve
// du travail accompli, et le panneau semble ne jamais bouger. Elle reste donc,
// cochée et muette, jusqu'à la clôture — où une seule phrase la remplace.
//
// La nuance qui compte : n'avoir JAMAIS rien eu à trancher n'est pas « avoir
// fini ». Une famille sans aucune proposition n'a pas de ligne du tout.
//
// CE PANNEAU NE MONTRE QUE CE QUI A UN GESTE. Actions, échéances, intervenants :
// trois familles, trois verbes. Les décisions, vigilances et savoirs n'ont pas
// de bouton ici — ils vivent dans le document et se concrétisent plus bas. Un
// bloc qui n'aide pas à finir la visite n'a pas sa place dans cette colonne.
//
// ── LE TRAVAIL DIMINUE AUSSI PAR L'AUTRE PORTE (mig 231) ────────────────────
//
// Créer depuis le compte-rendu referme les propositions satisfaites. Sans
// `rechargerA`, ce panneau annoncerait le même nombre juste après le clic, et
// le conducteur croirait que son geste n'a servi à rien.
//
// CE QU'IL NE FERA JAMAIS : « Créer toutes ». Arbitrer six actions d'un clic,
// c'est acquitter, plus décider — exactement l'ambiguïté que la concrétisation
// a supprimée. La compacité règle la fatigue ; le lot ne réglerait qu'un
// compteur. Cf. [[ia-ne-promeut-jamais-meme-sur-demande]].

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, CheckCircle2, X, ListTodo, CalendarClock, Users, ChevronDown } from 'lucide-react'
import {
  getVisitSummaryAction,
  promoteActionProposalAction,
  dismissActionProposalAction,
  promoteStakeholderProposalAction,
} from '@/app/(field)/m/visite/[reportId]/debrief-actions'
import type { VisitSummary, SummaryItem } from '@/lib/knowledge/visit-summary'

type Cle = 'action' | 'echeance' | 'intervenant'

// Le titre est au pluriel en permanence : « Actions (1) » se lit aussi bien que
// « Actions (7) », alors qu'accorder ferait changer le mot sous l'œil à chaque
// arbitrage — un repère qui bouge n'est plus un repère.
const FAMILLE: Record<Cle, { titre: string; Icon: typeof ListTodo; teinte: string }> = {
  // Les mêmes teintes que le bureau de la visite : on retrouve « les échéances »
  // sans lire les mots.
  action: {
    titre: 'Actions', Icon: ListTodo,
    teinte: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  },
  echeance: {
    titre: 'Échéances', Icon: CalendarClock,
    teinte: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  },
  intervenant: {
    titre: 'Intervenants', Icon: Users,
    teinte: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  },
}

export function PanneauArbitrage({
  reportId,
  rechargerA = 0,
}: {
  reportId: string
  /**
   * Change quand des objets viennent d'être créés depuis le compte-rendu.
   * Créer referme les propositions satisfaites (mig 231) : sans cette relecture,
   * le panneau annoncerait le même travail restant juste après le clic.
   */
  rechargerA?: number
}) {
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

  // `rechargerA` dans les dépendances : une création à gauche referme des
  // propositions en base, et cet effet est le seul chemin par lequel le panneau
  // l'apprend. Sans lui, le nombre resterait figé après le clic.
  useEffect(() => { void relire() }, [relire, rechargerA])

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
  // Une famille n'a sa ligne que si elle a EU du travail. Celle qui n'a jamais
  // rien eu à trancher ne mérite pas un « ✓ » : n'avoir rien à faire n'est pas
  // avoir fini.
  const concernés = groupes.filter((g) => g.restants.length + g.arbitrés > 0)

  return (
    <PanneauCadre>
      {total === 0 ? (
        // Rien n'a jamais été proposé — ce n'est pas « terminé », c'est vide.
        // Les deux se disent différemment, sinon on croit avoir fait le travail.
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          MemorIA n’a rien proposé à arbitrer sur cette visite.
        </p>
      ) : restant === 0 ? (
        // LA CLÔTURE. Les lignes cochées ont fait leur travail — elles ont
        // montré la progression ; à l'arrivée, une seule phrase suffit.
        <p className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[13px] font-medium text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          Atelier terminé
        </p>
      ) : (
        // PAS DE TOTAL ICI, VOLONTAIREMENT. Un nombre global en tête serait
        // aussitôt rapproché de celui de la concrétisation, à gauche — c'est
        // exactement la comparaison qui n'a pas de sens. Les familles portent
        // leur propre compte, et le titre dit ce qu'on regarde.
        <div className="mt-2.5 space-y-1.5">
          {concernés.map((g) => (
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
      <h2 className="text-sm font-semibold">Travail restant</h2>
      {children}
    </section>
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
  // Cette famille n'attend plus rien. Elle RESTE à l'écran : c'est la ligne
  // cochée qui donne le sentiment d'avancer — la faire disparaître effacerait
  // justement la preuve du travail accompli.
  const traitée = items.length === 0

  if (traitée) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/40 px-2.5 py-2 dark:border-emerald-900/40 dark:bg-emerald-950/15">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          <Check className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-medium text-emerald-900 dark:text-emerald-200">
          {f.titre}
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-background">
      <button
        type="button"
        onClick={() => setOuverte(open ? null : cle)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-muted/60"
      >
        {/* La pastille porte l'ICÔNE, plus le nombre : celui-ci est déjà dans le
            titre, et l'écrire deux fois faisait chercher deux informations là
            où il n'y en a qu'une. La teinte, elle, reste la grammaire des
            familles — on reconnaît « les échéances » sans lire le mot. */}
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded ${f.teinte}`}>
          <f.Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-medium">
          {f.titre} <span className="font-normal tabular-nums text-muted-foreground">({items.length})</span>
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
