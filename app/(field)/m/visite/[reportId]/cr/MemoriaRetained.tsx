'use client'

// « Ce que MemorIA a retenu » — le RÉSULTAT en premier, plus le procédé.
//
// Avant, Guillaume ouvrait le compte-rendu et tombait sur un résumé pâle (ou, au
// PDF, le verbatim « euh » compris) : il croyait que MemorIA faisait de la dictée.
// Ici, l'analyse du débrief (narratif + actions proposées + points de vigilance)
// s'affiche DIRECTEMENT. Elle se lance TOUTE SEULE à l'ouverture (lazy-once), le
// résultat est mis en cache et rejoué ensuite sans rappeler le LLM.
//
// La transcription brute reste accessible, mais REPLIÉE : c'est un détail, plus
// le résultat principal. Si l'analyse échoue, la transcription reste consultable —
// on ne bloque jamais l'accès à ce qui a été dit.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, RefreshCw, ChevronDown, AlertTriangle, ListTodo, Eye, ListChecks, Info, Calendar, Users, Check, ArrowUpRight } from 'lucide-react'
import {
  getVisitDebriefFieldAction,
  getActionProposalStatesAction,
  promoteActionProposalAction,
  dismissActionProposalAction,
  getDeadlineProposalStatesAction,
  type ActionProposalState,
  getVisitSummaryAction,
} from '../debrief-actions'
import type { VisitSummary, SummaryItem } from '@/lib/knowledge/visit-summary'
import type { StoredDebriefAnalysis, SnapshotDelta } from '@/lib/visits/debrief-analysis'
import { echeanceDateLabel, toDebriefEcheance, A_PLANIFIER_LABEL } from '@/lib/visits/echeance-labels'

type Phase = 'loading' | 'generating' | 'ready' | 'error'

/**
 * Ce que MemorIA a compris mais que personne n'a validé — dit, et à part.
 *
 * Le MÊME découpage que le PDF, parce que c'est le même contrat. Mélanger une
 * supposition aux faits actés ferait croire au conducteur qu'il a approuvé ce
 * qu'il n'a jamais lu.
 */
function ToConfirm({ items }: { items: SummaryItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-2">
      <p className="text-[12px] text-sky-700 dark:text-sky-300">À confirmer — relevé par MemorIA :</p>
      <ul className="mt-1 space-y-1">
        {items.map((i) => (
          <li key={i.id} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
            <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full border border-sky-400" />
            <span className="min-w-0">{i.title}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MemoriaRetained({
  reportId,
  siteId,
  transcriptions,
}: {
  reportId: string
  /** Le chantier de la visite — pour renvoyer vers son planning une fois confirmé. */
  siteId: string
  /** Transcriptions brutes (vocaux) — repliées derrière « Voir la transcription ». */
  transcriptions: string[]
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [analysis, setAnalysis] = useState<StoredDebriefAnalysis | null>(null)
  // LE CONTRAT UNIQUE — le même que le PDF. L'écran ne reconstruit plus son monde
  // depuis `debrief_analysis` : ce JSON ignore le cycle de vie et continuait
  // d'affirmer ce qui avait été écarté ou déjà validé ailleurs.
  const [summary, setSummary] = useState<VisitSummary | null>(null)
  const [staleDelta, setStaleDelta] = useState<SnapshotDelta | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)
  // État des propositions d'action, indexé par la clé du ledger (null = pas encore chargé).
  const [propStates, setPropStates] = useState<Record<string, ActionProposalState> | null>(null)
  // État des propositions d'échéance, indexé par le label de l'échéance.
  const [deadlineStates, setDeadlineStates] = useState<Record<string, ActionProposalState> | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aliveRef = useRef(true)
  const loadRef = useRef<(force: boolean) => void>(() => {})

  const load = useCallback(async (force: boolean) => {
    setPhase('loading')
    // La PREMIÈRE analyse tourne DANS cet appel : le serveur ne répond qu'une fois
    // le LLM terminé, et l'écran resterait sur « Ouverture… » pendant 30 secondes —
    // silencieux au moment précis où MemorIA travaille le plus. Une lecture en
    // cache revient en quelques centaines de millisecondes : si l'attente dure,
    // c'est qu'on analyse. On le dit alors, et seulement alors.
    const slowTimer = setTimeout(() => { if (aliveRef.current) setPhase('generating') }, 1200)
    const res = await getVisitDebriefFieldAction({ report_id: reportId, ...(force ? { force: true } : {}) })
    clearTimeout(slowTimer)
    if (!aliveRef.current) return
    if (!res.ok) {
      setPhase('error')
      return
    }
    if (res.status === 'generating') {
      // Un autre appel analyse déjà : on patiente puis on relit (pas de 2ᵉ LLM).
      setPhase('generating')
      pollRef.current = setTimeout(() => { if (aliveRef.current) loadRef.current(false) }, 4000)
      return
    }
    setAnalysis(res.loaded.analysis)
    setStaleDelta(res.status === 'stale' ? res.delta : null)
    setPhase('ready')
    // Propositions d'action promouvables (« Confirmer l'action ») — après la synthèse.
    // Projette de façon idempotente côté serveur, puis renvoie leur état actuel.
    setPropStates(null)
    setDeadlineStates(null)
    const [states, deadlines, sum] = await Promise.all([
      getActionProposalStatesAction({ report_id: reportId }),
      getDeadlineProposalStatesAction({ report_id: reportId }),
      getVisitSummaryAction({ report_id: reportId }),
    ])
    if (aliveRef.current && sum.ok) setSummary(sum.summary)
    if (!aliveRef.current) return
    setPropStates(states)
    setDeadlineStates(deadlines)
  }, [reportId])

  useEffect(() => { loadRef.current = load }, [load])

  useEffect(() => {
    aliveRef.current = true
    void load(false)
    return () => {
      aliveRef.current = false
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [load])

  function regenerate() {
    setConfirmRegen(false)
    void load(true)
  }

  // « Confirmer l'action » : PROMEUT la proposition en vraie site_action. Une action
  // n'existe (Travail/Site/Accueil) et ne peut être « faite » qu'après ce geste.
  // Optimiste, puis persisté ; les autres surfaces sont revalidées côté serveur.
  /** Relit LE CONTRAT après un geste — le serveur est la source, pas un état
   *  local qui afficherait le fait deux fois le temps de l'aller-retour. */
  async function refreshSummary() {
    const sum = await getVisitSummaryAction({ report_id: reportId })
    if (aliveRef.current && sum.ok) setSummary(sum.summary)
  }

  async function createAction(key: string) {
    const st = propStates?.[key]
    if (!st || st.status !== 'proposed' || busyKey) return
    setBusyKey(key)
    const res = await promoteActionProposalAction({ report_id: reportId, proposal_id: st.proposalId })
    if (!aliveRef.current) return
    setBusyKey(null)
    if (res.ok) {
      setPropStates((prev) => ({ ...(prev ?? {}), [key]: { ...st, status: 'confirmed', promotedObjectType: 'site_action', promotedObjectId: res.objectId } }))
      void refreshSummary()
    }
  }

  // « Confirmer l'échéance » : PROMEUT la proposition en vraie échéance de chantier.
  // On ne demande PAS la date : le conducteur confirme que l'échéance existe. Sans
  // date, elle naît « à planifier » et attend dans le Planning — exiger une date ici
  // ferait renoncer, et l'échéance retournerait au néant dont on l'a tirée.
  async function confirmEcheance(label: string) {
    const st = deadlineStates?.[label]
    if (!st || st.status !== 'proposed' || busyKey) return
    setBusyKey(`ech:${label}`)
    const res = await promoteActionProposalAction({ report_id: reportId, proposal_id: st.proposalId })
    if (!aliveRef.current) return
    setBusyKey(null)
    if (res.ok) {
      setDeadlineStates((prev) => ({ ...(prev ?? {}), [label]: { ...st, status: 'confirmed', promotedObjectType: 'site_deadline', promotedObjectId: res.objectId } }))
    }
  }

  async function dismissEcheance(label: string) {
    const st = deadlineStates?.[label]
    if (!st || st.status !== 'proposed' || busyKey) return
    setBusyKey(`ech:${label}`)
    const res = await dismissActionProposalAction({ report_id: reportId, proposal_id: st.proposalId })
    if (!aliveRef.current) return
    setBusyKey(null)
    if (res.ok) setDeadlineStates((prev) => ({ ...(prev ?? {}), [label]: { ...st, status: 'dismissed' } }))
  }

  // « Écarter » : décision humaine, jamais ressuscitée par une re-synthèse.
  async function dismissAction(key: string) {
    const st = propStates?.[key]
    if (!st || st.status !== 'proposed' || busyKey) return
    setBusyKey(key)
    const res = await dismissActionProposalAction({ report_id: reportId, proposal_id: st.proposalId })
    if (!aliveRef.current) return
    setBusyKey(null)
    if (res.ok) setPropStates((prev) => ({ ...(prev ?? {}), [key]: { ...st, status: 'dismissed' } }))
  }

  // ── En cours ────────────────────────────────────────────────────────────────
  // « MemorIA analyse… » ne s'affiche QUE si une analyse tourne vraiment. Avant, ce
  // message couvrait aussi la simple LECTURE d'une analyse déjà en cache : on
  // rouvrait un compte-rendu vieux de deux jours et l'écran annonçait un travail
  // d'IA qui n'avait pas lieu. Dire « je réfléchis » quand on ne fait que relire,
  // c'est apprendre au conducteur à ne pas croire ce que l'écran raconte — et le
  // laisser penser qu'on rebrûle de l'IA à chaque ouverture.
  if (phase === 'generating') {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">MemorIA analyse…</p>
            <p className="text-[12px] text-emerald-800/80 dark:text-emerald-300/80">
              MemorIA lit ce que vous avez capturé et prépare l’essentiel.
            </p>
          </div>
        </div>
      </section>
    )
  }

  if (phase === 'loading') {
    return (
      <section className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Ouverture du compte-rendu…</p>
        </div>
      </section>
    )
  }

  // ── Échec : la transcription reste accessible, on ne bloque jamais ──
  if (phase === 'error') {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">L’analyse n’a pas pu être générée</p>
            <p className="text-[12px] text-amber-800/80 dark:text-amber-300/80">
              La transcription, elle, est conservée — vous pouvez la lire ci-dessous.
            </p>
            <button
              type="button"
              onClick={() => void load(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-background px-3 py-1.5 text-sm font-medium active:bg-accent"
            >
              <RefreshCw className="h-4 w-4" /> Réessayer
            </button>
          </div>
        </div>
        <TranscriptFold transcriptions={transcriptions} />
      </section>
    )
  }

  // ── Résultat : « Ce que MemorIA a retenu » ──
  const a = analysis!
  // Actions du ledger encore visibles (compat : on ignore les vieux 'dismissed' du
  // ledger), segmentées par le STATUT de leur PROPOSITION : active (à créer / créée)
  // vs écartée dans le nouveau cycle. Le ledger n'est plus le pilote — la proposition l'est.
  const ledgerActions = (a.action_ledger ?? []).filter((x) => x.state !== 'dismissed')
  // 'superseded' = la synthèse courante ne dit plus ce fait ; elle le dit AUTREMENT,
  // et cette nouvelle formulation est déjà affichée juste à côté. Le grand livre,
  // lui, n'oublie rien : sans ce filtre, on proposerait de confirmer une phrase que
  // MemorIA a elle-même remplacée. Ce n'est pas « écarté » (Guillaume n'a rien
  // refusé) : c'est une lecture périmée, elle n'a plus à être sur cet écran.
  const isLive = (key: string) => {
    const s = propStates?.[key]?.status
    return s !== 'dismissed' && s !== 'superseded'
  }
  const activeActions = ledgerActions.filter((x) => isLive(x.key))
  const dismissedActions = ledgerActions.filter((x) => propStates?.[x.key]?.status === 'dismissed')
  const hasActions = activeActions.length > 0
  // Ces trois notions viennent du CONTRAT, pas du JSON : une proposition écartée
  // n'y est plus, un fait validé y est marqué comme tel.
  const watch = summary?.watchpoints ?? { confirmed: [], proposed: [] }
  const decisions = summary?.decisions ?? { confirmed: [], proposed: [] }
  const savoir = summary?.knowledge ?? { confirmed: [], proposed: [] }
  const hasWatch = watch.confirmed.length + watch.proposed.length > 0
  const hasDecisions = decisions.confirmed.length + decisions.proposed.length > 0
  const hasSavoir = savoir.confirmed.length + savoir.proposed.length > 0
  // Les échéances de la LECTURE COURANTE, écartées et périmées retirées — même
  // règle que les actions : on ne propose pas de confirmer ce que MemorIA ne dit plus.
  const liveEcheances = (a.echeances ?? [])
    .map((e) => toDebriefEcheance(e))
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .filter((e) => {
      const s = deadlineStates?.[e.label]?.status
      return s !== 'dismissed' && s !== 'superseded'
    })
  const hasEcheances = liveEcheances.length > 0
  const stake = summary?.stakeholders ?? { confirmed: [], proposed: [] }
  const hasIntervenants = stake.confirmed.length + stake.proposed.length > 0
  const generatedLabel = safeDate(a.generated_at)

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <div className="flex items-center gap-2">
        <Sparkles className="h-[18px] w-[18px] shrink-0 text-emerald-600" />
        <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Ce que MemorIA a retenu</h2>
      </div>

      {staleDelta && deltaTotal(staleDelta) > 0 && (
        <div className="rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/20">
          <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">Cette visite a été enrichie depuis la dernière synthèse.</p>
          <p className="mt-0.5 text-[12px] text-amber-800/80 dark:text-amber-300/80">Nouveau : {deltaLabel(staleDelta)}. La synthèse ci-dessous ne les prend pas encore en compte.</p>
          <button
            type="button"
            onClick={() => void load(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white active:brightness-95"
          >
            <RefreshCw className="h-4 w-4" /> Prendre en compte les nouveaux éléments
          </button>
        </div>
      )}

      {a.summary.trim() && (
        <Block Icon={ListChecks} cls="text-emerald-600" title="Résumé">
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">{a.summary.trim()}</p>
        </Block>
      )}

      {hasDecisions && (
        <Block Icon={ListChecks} cls="text-indigo-600" title="Décisions">
          <BulletList items={decisions.confirmed.map((d) => d.title)} dot="bg-indigo-500" />
          <ToConfirm items={decisions.proposed} />
        </Block>
      )}

      {/* Le VALIDÉ d'abord — il fait foi, et c'est ce que le PDF montre en tête.
          Ces actions viennent du CONTRAT : ce sont les site_actions réelles nées
          de cette visite, pas des lignes du grand livre de l'IA. */}
      {summary && summary.actions.confirmed.length > 0 && (
        <Block Icon={ListTodo} cls="text-emerald-600" title="Actions confirmées">
          <ul className="space-y-2">
            {summary.actions.confirmed.map((act) => (
              <li key={act.id} className="rounded-xl border bg-background p-2.5 text-[13px] leading-snug">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Check className="h-3 w-3" /> Confirmée
                </span>
                <p className="mt-1 font-medium text-foreground/90">{act.title}</p>
                {act.detail && <p className="mt-0.5 text-[12px] text-muted-foreground">{act.detail}</p>}
                <a href="/m/actions" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-violet-700 dark:text-violet-300">
                  Ouvrir l’action <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {hasActions && (
        <Block Icon={ListTodo} cls="text-violet-600" title="Actions proposées">
          <ul className="space-y-2.5">
            {activeActions.map((act) => {
              const st = propStates?.[act.key]
              const created = st?.status === 'confirmed'
              const isNew = a.analysis_version > 1 && act.version_added === a.analysis_version
              const busy = busyKey === act.key
              return (
                <li key={act.key} className="rounded-xl border bg-background p-2.5 text-[13px] leading-snug">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {created ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <Check className="h-3 w-3" /> Action confirmée
                      </span>
                    ) : (
                      <>
                        {isNew && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">Nouveau</span>}
                        {act.priority && <PriorityChip p={act.priority} />}
                      </>
                    )}
                  </div>
                  <p className={`mt-1 font-medium ${created ? 'text-foreground/80' : 'text-foreground/90'}`}>{act.title}</p>
                  {!created && act.rationale && <p className="mt-0.5 text-[12px] text-muted-foreground">{act.rationale}</p>}
                  {!created && (act.owner || act.due) && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {act.owner && `Responsable : ${act.owner}`}{act.owner && act.due ? ' · ' : ''}{act.due && `Échéance : ${act.due}`}
                    </p>
                  )}
                  {created ? (
                    <a href="/m/actions" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-violet-700 dark:text-violet-300">
                      Ouvrir l’action <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void createAction(act.key)}
                        disabled={!st || !!busyKey}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[13px] font-medium text-white active:brightness-95 disabled:opacity-50"
                      >
                        {/* « Confirmer », pas « Créer » : partout ailleurs on annonce
                            « 3 actions à confirmer », « Voir la synthèse et confirmer ».
                            Le conducteur cherchait un mot qui n'existait sur aucun bouton.
                            Et le geste n'est pas une création : MemorIA a déjà compris —
                            l'humain valide. */}
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirmer l’action
                      </button>
                      <button
                        type="button"
                        onClick={() => void dismissAction(act.key)}
                        disabled={!st || !!busyKey}
                        className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        Écarter
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Block>
      )}

      {dismissedActions.length > 0 && (
        <details className="rounded-xl border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">
            Éléments écartés ({dismissedActions.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {dismissedActions.map((act) => (
              <li key={act.key} className="text-[12px] text-muted-foreground line-through">{act.title}</li>
            ))}
          </ul>
        </details>
      )}

      {hasWatch && (
        <Block Icon={Eye} cls="text-amber-600" title="Points de vigilance">
          <ul className="space-y-2">
            {watch.confirmed.map((w) => (
              <li key={w.id} className="flex gap-2 text-[13px] leading-snug">
                <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="min-w-0">
                  <span className="font-medium text-foreground/90">{w.title}</span>
                  {w.detail && <span className="mt-0.5 block text-[12px] text-muted-foreground">{w.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          <ToConfirm items={watch.proposed} />
        </Block>
      )}

      {hasSavoir && (
        <Block Icon={Info} cls="text-sky-600" title="À savoir">
          <BulletList items={savoir.confirmed.map((k) => k.title)} dot="bg-sky-500" />
          <ToConfirm items={savoir.proposed} />
        </Block>
      )}

      {hasEcheances && (
        <Block Icon={Calendar} cls="text-rose-600" title="Échéances proposées">
          <ul className="space-y-2.5">
            {liveEcheances.map((e) => {
              const st = deadlineStates?.[e.label]
              const created = st?.status === 'confirmed'
              const busy = busyKey === `ech:${e.label}`
              return (
                <li key={e.label} className="rounded-xl border bg-background p-2.5 text-[13px] leading-snug">
                  {created ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <Check className="h-3 w-3" /> Échéance confirmée
                    </span>
                  ) : (
                    e.date && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                        {echeanceDateLabel(e.date)}
                      </span>
                    )
                  )}
                  <p className="mt-1 font-medium text-foreground">{e.label}</p>

                  {/* La CONTRAINTE, avec les mots du débrief. On ne la traduit pas en
                      date : « sous dix jours » n'est pas le 27 juillet. */}
                  {!e.date && e.constraint && (
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      <span className="font-medium">Contrainte détectée</span> · {e.constraint}
                    </p>
                  )}
                  {/* Ce n'est pas la date qui manque : c'est la planification qui
                      reste à faire. Et elle ne bloque pas la confirmation. */}
                  {!e.date && !created && (
                    <p className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-300">{A_PLANIFIER_LABEL}</p>
                  )}

                  {created ? (
                    <a href={`/sites/${siteId}?tab=planning`} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-primary">
                      Voir dans le planning <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void confirmEcheance(e.label)}
                        disabled={!st || !!busyKey}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[13px] font-medium text-white active:brightness-95 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirmer l’échéance
                      </button>
                      <button
                        type="button"
                        onClick={() => void dismissEcheance(e.label)}
                        disabled={!st || !!busyKey}
                        className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        Écarter
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Block>
      )}

      {hasIntervenants && (
        <Block Icon={Users} cls="text-slate-600" title="Intervenants">
          <BulletList items={stake.confirmed.map((i) => i.title)} dot="bg-slate-500" />
          <ToConfirm items={stake.proposed} />
        </Block>
      )}

      {/* Discret : quand l'analyse a été faite, et la régénérer (jamais auto). */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200/60 pt-2 text-[11px] text-muted-foreground dark:border-emerald-900/40">
        <span>{generatedLabel ? `Synthèse mise à jour le ${generatedLabel}` : 'Synthèse'}</span>
        {confirmRegen ? (
          <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            <span className="text-[11px]">La mise à jour remplace les propositions, sans toucher aux actions déjà validées.</span>
            <button type="button" onClick={regenerate} className="rounded-md bg-emerald-600 px-2 py-1 font-medium text-white">Mettre à jour</button>
            <button type="button" onClick={() => setConfirmRegen(false)} className="rounded-md px-2 py-1 hover:bg-muted">Annuler</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmRegen(true)} className="inline-flex items-center gap-1 hover:text-foreground">
            <RefreshCw className="h-3.5 w-3.5" /> Mettre à jour la synthèse
          </button>
        )}
      </div>
    </section>
  )
}

function safeDate(iso: string): string | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

function deltaTotal(d: SnapshotDelta): number { return d.photos + d.videos + d.vocals + d.notes }
function deltaLabel(d: SnapshotDelta): string {
  const p: string[] = []
  if (d.photos) p.push(`${d.photos} photo${d.photos > 1 ? 's' : ''}`)
  if (d.videos) p.push(`${d.videos} vidéo${d.videos > 1 ? 's' : ''}`)
  if (d.vocals) p.push(`${d.vocals} mémo${d.vocals > 1 ? 's' : ''}`)
  if (d.notes) p.push(`${d.notes} note${d.notes > 1 ? 's' : ''}`)
  return p.length ? p.join(' · ') : 'de nouveaux éléments'
}

function Block({ Icon, cls, title, children }: { Icon: typeof Eye; cls: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${cls}`} /> {title}
      </div>
      {children}
    </div>
  )
}

function PriorityChip({ p }: { p: 'haute' | 'moyenne' | 'basse' }) {
  const meta = {
    haute: { label: 'Haute', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
    moyenne: { label: 'Moyenne', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
    basse: { label: 'Préparation', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  }[p]
  return <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}>{meta.label}</span>
}

function BulletList({ items, dot }: { items: string[]; dot: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
          <span className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${dot}`} />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  )
}

function TranscriptFold({ transcriptions }: { transcriptions: string[] }) {
  if (transcriptions.length === 0) return null
  return (
    <details className="rounded-xl border bg-muted/20 px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
        <ChevronDown className="h-4 w-4 transition-transform [details[open]_&]:rotate-180" />
        Voir la transcription
      </summary>
      <div className="mt-2 space-y-2">
        {transcriptions.map((t, i) => (
          <p key={i} className="whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">{t}</p>
        ))}
      </div>
    </details>
  )
}
