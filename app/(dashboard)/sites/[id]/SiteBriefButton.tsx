'use client'

// « Préparer ma visite » — bouton + panneau de briefing « À savoir avant d'y aller ».
//
// V1 (2026-06-16) : ouvre un panneau auto-suffisant qui agrège la mémoire déjà
// captée du LIEU (actions, anomalies, à savoir, résonances, équipes, missions,
// preuves, réunions). Lecture en 30s avant de partir sur site. Mobile-first.
//
// Doctrine : descriptif et calme. Les humains (équipes) n'apparaissent que comme
// contexte, jamais avec un score. Aucun appel LLM — pure agrégation côté serveur.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Brain,
  X,
  Loader2,
  ListTodo,
  CheckCircle2,
  AlertTriangle,
  Info,
  Repeat,
  Users,
  Hammer,
  Camera,
  MessagesSquare,
  CalendarClock,
  BellRing,
  Flag,
  History,
  Check,
  Sparkles,
  Layers,
  ChevronRight,
} from 'lucide-react'
import { getSiteBriefAction, logBriefOpenAction, generateDiscussionPointsAction, type SiteBrief, type DiscussionPoint } from './site-brief-actions'
import { VISIT_INTENTS, type VisitIntent } from '@/lib/field/visit-intents'

interface Props {
  /** Site fixé par le contexte (fiche site / mobile site). */
  siteId?: string
  /** Sélecteur de site (quand aucun site n'est fixé, ex. page Réunions). */
  sites?: Array<{ id: string; name: string }>
  variant?: 'mobile' | 'desktop'
  /** 'visit' = avant d'aller sur site · 'meeting' = avant une réunion chantier. */
  mode?: 'visit' | 'meeting'
  /** 'button' (défaut) = gros bouton d'action · 'card' = carte légère d'assistant
   *  (ces briefs aident à SE PRÉPARER, ce ne sont pas des actions principales). */
  appearance?: 'button' | 'card'
  /** Libellé override (ex. « Préparer une visite »). */
  label?: string
  /** Sous-titre affiché en mode carte : ce que le brief rappelle. */
  description?: string
  /** Motif porté par le flux de lancement (« Pourquoi êtes-vous ici ? »). Depuis
   *  la fiche chantier il est absent → le panneau ouvre en Suivi et laisse choisir. */
  initialMotive?: VisitIntent
}

// Accent par motif (jeton couleur, pas une classe métier) : Suivi=bleu ·
// Première=vert · Prévisite AO=violet. Aligné sur lib/field/visit-intents.
const MOTIVE_ACCENT: Record<VisitIntent, { active: string; ring: string; text: string; banner: string }> = {
  avancement:   { active: 'bg-sky-600 text-white',     ring: 'ring-sky-300',     text: 'text-sky-700',     banner: 'Suivi de chantier — ce qui a bougé depuis la dernière fois, ce qui traîne.' },
  premiere:     { active: 'bg-emerald-600 text-white', ring: 'ring-emerald-300', text: 'text-emerald-700', banner: 'Première visite — vous créez le point de départ. Peu de mémoire, c’est normal.' },
  previsite_ao: { active: 'bg-violet-600 text-white',  ring: 'ring-violet-300',  text: 'text-violet-700',  banner: 'Prévisite AO — évaluez le chantier avant de répondre à l’appel d’offres.' },
}

const MODE_META = {
  visit:   { label: 'Préparer ma visite',  panel: "À savoir avant d'y aller", Icon: Brain },
  meeting: { label: 'Préparer ma réunion', panel: 'À aborder en réunion',     Icon: MessagesSquare },
} as const

// Libellés courts pour le sélecteur segmenté (3 tiers de largeur).
const MOTIVE_SHORT: Record<VisitIntent, string> = {
  avancement: 'Suivi', premiere: 'Première', previsite_ao: 'Prévisite AO',
}

const STATE_FR: Record<string, string> = {
  bloqué: 'Bloqué', en_attente: 'En attente', actif: 'Actif', résolu: 'Résolu', dormant: 'En sommeil',
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function ageDaysLabel(iso: string | null): string | null {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (Number.isNaN(days) || days < 0) return null
  if (days === 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  return `il y a ${days} j`
}

export function SiteBriefButton({ siteId, sites, variant = 'desktop', mode = 'visit', appearance = 'button', label, description, initialMotive }: Props) {
  const [open, setOpen] = useState(false)
  // Motif de préparation (mode visite uniquement). Depuis la fiche : Suivi par
  // défaut + sélecteur ; depuis le flux de lancement : le motif choisi est porté.
  const [motive, setMotive] = useState<VisitIntent>(initialMotive ?? 'avancement')
  const [brief, setBrief] = useState<SiteBrief | null>(null)
  const [selectedSite, setSelectedSite] = useState('')
  const [loadedSite, setLoadedSite] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Priorité C — points à discuter (LLM encadré), généré à la demande.
  const [points, setPoints] = useState<DiscussionPoint[] | null>(null)
  const [pointsMock, setPointsMock] = useState(false)
  const [pointsHadInput, setPointsHadInput] = useState(false)
  // Double-clic : 1er clic = arme + prévient du coût IA ; 2e clic = exécute.
  const [confirmGen, setConfirmGen] = useState(false)
  const [genPending, startGen] = useTransition()
  const meta = MODE_META[mode]
  const MetaIcon = meta.Icon
  const needsSitePick = !siteId

  function generatePoints() {
    if (!loadedSite) return
    setConfirmGen(false) // masque aussitôt « Confirmer / Annuler » + la note coût
    startGen(async () => {
      const r = await generateDiscussionPointsAction(loadedSite, mode)
      if (r.ok) { setPoints(r.points); setPointsMock(r.mock); setPointsHadInput(r.hadInput) }
      else { toast.error(r.error); setPoints([]); setPointsMock(false) }
    })
  }

  function loadBrief(sid: string) {
    if (loadedSite === sid && brief) return // déjà chargé pour ce site
    void logBriefOpenAction(sid, mode) // usage produit, best-effort
    startTransition(async () => {
      const r = await getSiteBriefAction(sid)
      if (r.ok) {
        setBrief(r.brief)
        setLoadedSite(sid)
      } else {
        toast.error(r.error)
        if (siteId) setOpen(false)
      }
    })
  }

  function openPanel() {
    setOpen(true)
    if (siteId) loadBrief(siteId) // site fixe → charge direct ; sinon on attend la sélection
  }

  function pickSite(sid: string) {
    setSelectedSite(sid)
    setBrief(null)
    setLoadedSite(null)
    setPoints(null)
    setConfirmGen(false)
    if (sid) loadBrief(sid)
  }

  return (
    <>
      {appearance === 'card' ? (
        <button
          type="button"
          onClick={openPanel}
          className={`flex h-full w-full flex-col gap-1.5 rounded-2xl border shadow-sm p-3 text-left active:brightness-95 ${
            mode === 'meeting' ? 'bg-sky-50/60 dark:bg-sky-950/25' : 'bg-violet-50/60 dark:bg-violet-950/25'
          }`}
        >
          <span className="flex w-full items-center gap-2">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
              mode === 'meeting'
                ? 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300'
                : 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300'
            }`}>
              <MetaIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{label ?? meta.label}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </span>
          {description && <span className="block text-[12px] leading-snug text-muted-foreground">{description}</span>}
        </button>
      ) : (
        <button
          type="button"
          onClick={openPanel}
          className={
            variant === 'mobile'
              ? 'w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-3.5 text-base font-semibold text-background active:scale-[0.99] transition-transform'
              : 'inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 transition-[transform,opacity] active:scale-[0.97]'
          }
        >
          <MetaIcon className={variant === 'mobile' ? 'h-5 w-5' : 'h-4 w-4'} />
          {label ?? meta.label}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={meta.panel}
          >
            {/* En-tête collant */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-card px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight inline-flex items-center gap-2">
                  <MetaIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  {meta.panel}
                </h2>
                {brief && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {brief.siteName}
                    {brief.contractName ? ` · ${brief.contractName}` : ''}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-5">
              {needsSitePick && (
                <div className="space-y-1">
                  <label htmlFor="brief-site" className="text-xs text-muted-foreground">Site</label>
                  <select
                    id="brief-site"
                    value={selectedSite}
                    onChange={(e) => pickSite(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— choisir un site —</option>
                    {(sites ?? []).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {pending && !brief && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Préparation du brief…
                </div>
              )}

              {/* Motif de la visite (mode visite) : même chantier, préparation
                  différente. Le brief est le MÊME moteur ; le motif réordonne et
                  recolore. Depuis le flux de lancement, il arrive déjà choisi. */}
              {brief && mode === 'visit' && (
                <div className="space-y-1.5">
                  <div className="flex w-full gap-0.5 rounded-xl border bg-muted/40 p-0.5 text-xs font-medium">
                    {VISIT_INTENTS.map((it) => {
                      const active = motive === it.slug
                      return (
                        <button
                          key={it.slug}
                          type="button"
                          onClick={() => setMotive(it.slug)}
                          className={`flex-1 rounded-lg px-2 py-1.5 transition ${active ? MOTIVE_ACCENT[it.slug].active : 'text-muted-foreground active:bg-muted'}`}
                        >
                          {MOTIVE_SHORT[it.slug]}
                        </button>
                      )
                    })}
                  </div>
                  <p className={`text-[12px] leading-snug ${MOTIVE_ACCENT[motive].text}`}>{MOTIVE_ACCENT[motive].banner}</p>
                </div>
              )}

              {/* Priorité C — LLM encadré (sources affichées dessous). Réunion =
                  « Points à discuter » · Visite = « Objectif de la visite ». */}
              {brief && (
                <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-sky-600" />
                      {mode === 'meeting' ? 'Points à discuter' : 'Objectif de la visite'}
                      <span className="rounded bg-sky-100 px-1 text-[9px] font-medium text-sky-700">IA</span>
                    </h3>
                    {confirmGen ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={generatePoints}
                          disabled={genPending}
                          className="inline-flex items-center gap-1 rounded-lg border border-sky-600 bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                        >
                          {genPending && <Loader2 className="h-3 w-3 animate-spin" />}
                          Confirmer
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmGen(false)}
                          disabled={genPending}
                          className="rounded-lg border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmGen(true)}
                        disabled={genPending}
                        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
                      >
                        {genPending && <Loader2 className="h-3 w-3 animate-spin" />}
                        {points === null ? 'Générer' : 'Régénérer'}
                      </button>
                    )}
                  </div>
                  {confirmGen && !genPending && (
                    <p className="inline-flex items-start gap-1 text-[11px] text-amber-700">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      Cette analyse lance une requête IA — elle consomme un peu de crédit (coût très faible). Confirmer&nbsp;?
                    </p>
                  )}
                  {points && points.length > 0 && (
                    <ul className="space-y-1">
                      {points.map((p, i) => (
                        <li key={i} className="flex gap-1.5 text-sm text-sky-950">
                          <span aria-hidden className="text-sky-500">•</span>
                          <span className="min-w-0">{p.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {points && points.length === 0 && !genPending && (
                    pointsMock ? (
                      <p className="text-xs italic text-amber-700">
                        IA en mode démo sur cet environnement (aucune clé configurée) — les points ne sont pas générés.
                      </p>
                    ) : pointsHadInput ? (
                      <p className="text-xs italic text-amber-700">
                        L&apos;IA n&apos;a rien renvoyé cette fois — réessaie. Si ça persiste, c&apos;est un souci de configuration IA.
                      </p>
                    ) : (
                      <p className="text-xs italic text-muted-foreground">Rien de saillant à discuter pour l&apos;instant.</p>
                    )
                  )}
                  {points !== null && points.length > 0 && (
                    <p className="text-[10px] text-muted-foreground/70">
                      Rédigé par l&apos;IA à partir des éléments ci-dessous — vérifiez les sources.
                    </p>
                  )}
                </section>
              )}

              {brief && <BriefBody brief={brief} mode={mode} motive={motive} />}

              {needsSitePick && !selectedSite && !pending && (
                <p className="py-6 text-center text-sm italic text-muted-foreground">
                  Choisis un site pour préparer la réunion.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function SectionTitle({
  icon,
  children,
  count,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  count?: number
}) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
      {icon}
      {children}
      {typeof count === 'number' && count > 0 && (
        <span className="font-normal normal-case">({count})</span>
      )}
    </h3>
  )
}

// Hiérarchie par paliers (Vincent 2026-06-16) : le cerveau hiérarchise, pas une
// liste plate. Du plus urgent au contexte. Un palier sans contenu disparaît.
// L'ORDRE dépend du MODE (sinon visite et réunion sont identiques) :
//  - Visite = « sur place, que dois-je VÉRIFIER ? » → vigilances / anomalies /
//    réserves en tête (ce qu'on va regarder sur le terrain).
//  - Réunion = « face aux gens, que dois-je ABORDER / ARBITRER ? » → ce qui a
//    changé depuis la dernière réunion + réserves + actions (qui doit quoi) en tête.
type Tier = { label: string; dot: string; keys: string[] }
const TIERS_VISIT: Tier[] = [
  { label: 'Ce qui nécessite mon attention', dot: 'bg-rose-500',    keys: ['followedPoints', 'vigilance', 'anomalies', 'reserves', 'actions'] },
  { label: 'Ce qui a changé',                dot: 'bg-amber-500',   keys: ['change'] },
  { label: "Ce qu'il faut savoir",           dot: 'bg-emerald-500', keys: ['aSavoir', 'recurring'] },
  { label: "Qui peut m'aider",               dot: 'bg-sky-500',     keys: ['teams'] },
  { label: 'Historique',                     dot: 'bg-slate-400',   keys: ['recentDone', 'missions', 'meetings', 'photos'] },
]
const TIERS_MEETING: Tier[] = [
  { label: 'À aborder / arbitrer',           dot: 'bg-rose-500',    keys: ['followedPoints', 'change', 'reserves', 'actions'] },
  { label: 'Points de vigilance',            dot: 'bg-amber-500',   keys: ['vigilance', 'anomalies'] },
  { label: "Ce qu'il faut savoir",           dot: 'bg-emerald-500', keys: ['aSavoir', 'recurring'] },
  { label: "Qui peut m'aider",               dot: 'bg-sky-500',     keys: ['teams'] },
  { label: 'Historique',                     dot: 'bg-slate-400',   keys: ['recentDone', 'missions', 'meetings', 'photos'] },
]
// Suivi : « ce qui a changé » MÈNE (on vient voir l'évolution). Première /
// Prévisite AO : l'attention d'abord (base) — la mémoire y est de toute façon
// mince, et le bandeau d'intention porte le sens.
function tiersForVisit(motive: VisitIntent): Tier[] {
  if (motive === 'avancement') {
    return [
      { label: 'Ce qui a changé', dot: 'bg-amber-500', keys: ['change'] },
      ...TIERS_VISIT.filter((t) => !t.keys.includes('change')),
    ]
  }
  return TIERS_VISIT
}
const tiersFor = (mode: 'visit' | 'meeting', motive: VisitIntent): Tier[] =>
  mode === 'meeting' ? TIERS_MEETING : tiersForVisit(motive)

function BriefBody({ brief, mode, motive }: { brief: SiteBrief; mode: 'visit' | 'meeting'; motive: VisitIntent }) {
  const {
    situation,
    vigilance,
    openActions,
    recentDoneActions,
    anomaliesOpen,
    aSavoir,
    recurring,
    teams,
    missionNames,
    recentPhotosCount,
    meetings,
    openReserves,
    lastReport,
    changeSinceLastReport,
    followedPoints,
  } = brief

  const nextLabel = formatDate(situation.nextScheduledAt)

  const hasAnyDetail =
    followedPoints.length > 0 ||
    changeSinceLastReport != null ||
    vigilance.length > 0 ||
    openReserves.length > 0 ||
    (lastReport?.actionTitles.length ?? 0) > 0 ||
    openActions.length > 0 ||
    recentDoneActions.length > 0 ||
    anomaliesOpen.length > 0 ||
    aSavoir.length > 0 ||
    recurring.length > 0 ||
    teams.length > 0 ||
    missionNames.length > 0 ||
    recentPhotosCount > 0 ||
    meetings.length > 0

  const sections: Record<string, React.ReactNode> = {
    followedPoints: followedPoints.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Layers className="h-3.5 w-3.5 text-violet-600" />} count={followedPoints.length}>
          Points suivis à aborder
        </SectionTitle>
        <ul className="space-y-1.5">
          {followedPoints.map((p) => (
            <li key={p.id} className="rounded-lg border bg-background px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-sm font-medium">{p.name}</span>
                <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-violet-700">
                  {STATE_FR[p.state] ?? p.state}
                </span>
              </div>
              {(p.openQuestion ?? p.cause) && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{p.openQuestion ?? p.cause}</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    ),
    change: !changeSinceLastReport ? null : (
      <section className="space-y-2.5 rounded-xl border bg-muted/30 p-3">
        <SectionTitle icon={<History className="h-3.5 w-3.5" />}>
          Depuis la dernière réunion
          {formatDate(changeSinceLastReport.sinceDate) ? ` · ${formatDate(changeSinceLastReport.sinceDate)}` : ''}
        </SectionTitle>
        {lastReport && lastReport.actionTitles.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Décidé alors</p>
            <ul className="space-y-0.5">
              {lastReport.actionTitles.map((t, i) => (
                <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                  <span aria-hidden className="text-muted-foreground/50">›</span>
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {changeSinceLastReport.resolved.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Résolu</p>
            <ul className="space-y-0.5">
              {changeSinceLastReport.resolved.map((t, i) => (
                <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {changeSinceLastReport.stillOpen.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Toujours ouvert</p>
            <ul className="space-y-0.5">
              {changeSinceLastReport.stillOpen.map((t, i) => (
                <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {changeSinceLastReport.newItems.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Nouveaux</p>
            <ul className="space-y-0.5">
              {changeSinceLastReport.newItems.map((t, i) => (
                <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                  <BellRing className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    ),
    vigilance: vigilance.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<BellRing className="h-3.5 w-3.5 text-rose-600" />} count={vigilance.length}>
          À ne pas oublier
        </SectionTitle>
        <ul className="space-y-1.5">
          {vigilance.map((v) => (
            <li key={v.id} className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
              <span className="text-sm min-w-0 text-rose-950">{v.title}</span>
              <span className="shrink-0 text-[11px] font-medium whitespace-nowrap text-rose-700">
                {v.overdue ? 'en retard' : `depuis ${v.ageDays} j`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ),
    reserves: openReserves.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Flag className="h-3.5 w-3.5 text-rose-600" />} count={openReserves.length}>
          Réserves non levées
        </SectionTitle>
        <ul className="space-y-1.5">
          {openReserves.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
              <span className="text-sm min-w-0">
                {r.label}
                {r.location && <span className="text-muted-foreground"> · {r.location}</span>}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">depuis {r.ageDays} j</span>
            </li>
          ))}
        </ul>
      </section>
    ),
    actions: openActions.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<ListTodo className="h-3.5 w-3.5" />} count={situation.openActions}>
          Actions à suivre
        </SectionTitle>
        <ul className="space-y-1.5">
          {openActions.map((a) => {
            const due = formatDate(a.dueDate)
            const age = ageDaysLabel(a.createdAt)
            return (
              <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                <span className="text-sm min-w-0">{a.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                  {due ? `échéance ${due}` : age ?? ''}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    ),
    anomalies: anomaliesOpen.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<AlertTriangle className="h-3.5 w-3.5" />} count={anomaliesOpen.length}>
          Anomalies ouvertes
        </SectionTitle>
        <ul className="space-y-1.5">
          {anomaliesOpen.map((a) => (
            <li key={a.id} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
              {a.description}
            </li>
          ))}
        </ul>
      </section>
    ),
    aSavoir: aSavoir.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Info className="h-3.5 w-3.5" />} count={aSavoir.length}>À savoir</SectionTitle>
        <ul className="space-y-1.5">
          {aSavoir.map((n) => (
            <li key={n.id} className="flex gap-1.5 text-sm text-amber-900">
              <span aria-hidden className="text-amber-600">⚠</span>
              <span className="min-w-0">{n.body}</span>
            </li>
          ))}
        </ul>
      </section>
    ),
    recurring: recurring.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Repeat className="h-3.5 w-3.5" />}>Ce qui revient ici</SectionTitle>
        <ul className="space-y-1.5">
          {recurring.map((r, i) => (
            <li key={i} className="text-sm text-muted-foreground italic leading-relaxed">{r.text}</li>
          ))}
        </ul>
      </section>
    ),
    missions: missionNames.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Hammer className="h-3.5 w-3.5" />}>Missions sur le site</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {missionNames.map((name) => (
            <span key={name} className="inline-flex items-center rounded-full border bg-card px-2.5 py-0.5 text-xs">{name}</span>
          ))}
        </div>
      </section>
    ),
    teams: teams.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Users className="h-3.5 w-3.5" />}>Équipes qui connaissent le site</SectionTitle>
        <ul className="space-y-1">
          {teams.map((t) => (
            <li key={t.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{t.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                {t.passages} passage{t.passages > 1 ? 's' : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ),
    recentDone: recentDoneActions.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Récemment fait</SectionTitle>
        <ul className="space-y-1.5">
          {recentDoneActions.map((a) => {
            const when = ageDaysLabel(a.doneAt)
            return (
              <li key={a.id} className="flex items-start justify-between gap-3 text-sm text-muted-foreground">
                <span className="min-w-0 inline-flex gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="min-w-0">{a.title}</span>
                </span>
                {when && <span className="shrink-0 text-[11px] whitespace-nowrap">{when}</span>}
              </li>
            )
          })}
        </ul>
      </section>
    ),
    meetings: meetings.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<MessagesSquare className="h-3.5 w-3.5" />}>Réunions récentes</SectionTitle>
        <ul className="space-y-1">
          {meetings.map((m) => {
            const when = formatDate(m.createdAt)
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span className="min-w-0 truncate">{m.title ?? 'Compte-rendu'}</span>
                {when && <span className="shrink-0 text-[11px] whitespace-nowrap">{when}</span>}
              </li>
            )
          })}
        </ul>
      </section>
    ),
    photos: recentPhotosCount === 0 ? null : (
      <section>
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5" />
          {recentPhotosCount} preuve{recentPhotosCount > 1 ? 's' : ''} photo récente{recentPhotosCount > 1 ? 's' : ''}
        </p>
      </section>
    ),
  }

  return (
    <div className="space-y-5">
      {/* Situation — chips de synthèse (toujours en tête) */}
      <section className="space-y-2">
        <SectionTitle icon={<Info className="h-3.5 w-3.5" />}>En un coup d&apos;œil</SectionTitle>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 px-2.5 py-1 font-medium">
            <ListTodo className="h-3.5 w-3.5" />
            {situation.openActions} action{situation.openActions > 1 ? 's' : ''} ouverte{situation.openActions > 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2.5 py-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            {situation.openAnomalies} anomalie{situation.openAnomalies > 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
            <Hammer className="h-3.5 w-3.5" />
            {situation.passagesThisMonth} passage{situation.passagesThisMonth > 1 ? 's' : ''} ce mois
          </span>
          {nextLabel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
              <CalendarClock className="h-3.5 w-3.5" />
              Prochain : {nextLabel}
            </span>
          )}
        </div>
      </section>

      {tiersFor(mode, motive).map((tier) => {
        const hasContent = tier.keys.some((k) => sections[k])
        if (!hasContent) return null
        return (
          <div key={tier.label} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${tier.dot}`} aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{tier.label}</span>
            </div>
            <div className="space-y-4 border-l border-border/40 pl-3">
              {tier.keys.map((k) => (sections[k] ? <div key={k}>{sections[k]}</div> : null))}
            </div>
          </div>
        )
      })}

      {!hasAnyDetail && (
        <p className="text-sm text-muted-foreground italic py-4 text-center">
          Pas encore de mémoire notable sur ce site. Les premières traces apparaîtront ici.
        </p>
      )}
    </div>
  )
}
