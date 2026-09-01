'use client'

// « Préparer ma visite » — bouton + panneau de briefing « À savoir avant d'y aller ».
//
// V1 (2026-06-16) : ouvre un panneau auto-suffisant qui agrège la mémoire déjà
// captée du LIEU (actions, anomalies, à savoir, résonances, équipes, missions,
// preuves, réunions). Lecture en 30s avant de partir sur site. Mobile-first.
//
// Doctrine : descriptif et calme. Les humains (équipes) n'apparaissent que comme
// contexte, jamais avec un score. Aucun appel LLM — pure agrégation côté serveur.

import { useRef, useState, useTransition } from 'react'
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
  Clock3,
  BellRing,
  Flag,
  History,
  Check,
  Sparkles,
  Layers,
  ChevronRight,
  Pencil,
} from 'lucide-react'
import { getSiteBriefAction, logBriefOpenAction, generateDiscussionPointsAction, type SiteBrief, type SiteBriefFactLine, type DiscussionPoint } from './site-brief-actions'
import { VISIT_INTENTS, type VisitIntent } from '@/lib/field/visit-intents'
import { selectNarrativeHighlights } from '@/lib/knowledge/visit-preparation'
import type { LiveDebrief, LiveDebriefItem, LiveDebriefObjectItem, ToHandleRank, ToHandlePriority } from '@/lib/knowledge/live-debrief'
import { LiveDebriefVuButton } from './LiveDebriefVuButton'
import { completeDeadlineAction, rescheduleDeadlineAction } from './views/planning/deadline-actions'
import { closeActionAction, updateActionDetailsAction } from '@/app/(dashboard)/actions/actions'
import { liftReserveAction } from './reserves/actions'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

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
  premiere:     { active: 'bg-emerald-600 text-white', ring: 'ring-emerald-300', text: 'text-emerald-700', banner: 'Première visite pour vous — MemorIA s’appuie sur l’historique déjà disponible.' },
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

// Pour les dates YYYY-MM-DD du read-model — midday UTC évite le décalage de minuit.
function formatDay(isoDay: string | null | undefined): string | null {
  if (!isoDay) return null
  const d = new Date(isoDay + 'T12:00:00Z')
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function ordinalDay(n: number): string {
  return n === 1 ? '1er' : `${n}e`
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
      const r = await getSiteBriefAction(sid, variant)
      if (r.ok) {
        setBrief(r.brief)
        if (mode === 'visit' && !initialMotive) {
          setMotive(r.brief.phase === 'first_visit' ? 'premiere' : r.brief.phase === 'previsit_ao' ? 'previsite_ao' : 'avancement')
        }
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

  // D4 — après un « Vu » sur un signal du Débrief vivant : `brief` est un état
  // client, pas une page server-rendue, donc `router.refresh()` (pattern D3 dev)
  // ne s'applique pas ici. On recharge explicitement en contournant la garde
  // « déjà chargé » de `loadBrief`.
  function refetchBrief() {
    if (!loadedSite) return
    startTransition(async () => {
      const r = await getSiteBriefAction(loadedSite, variant)
      if (r.ok) setBrief(r.brief)
      else toast.error(r.error)
    })
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
            className="w-full sm:max-w-3xl lg:max-w-5xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border bg-card shadow-xl"
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

            <div className="px-4 py-4 flex flex-col gap-5">
              {needsSitePick && (
                <div className="space-y-1">
                  <label htmlFor="brief-site" className="text-xs text-muted-foreground">Site</label>
                  <select
                    id="brief-site"
                    value={selectedSite}
                    onChange={(e) => pickSite(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— choisir un chantier —</option>
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
                    {VISIT_INTENTS.filter((it) => {
                      if (brief.phase === 'first_visit') return it.slug === 'premiere' || it.slug === 'previsite_ao'
                      if (brief.phase === 'previsit_ao') return it.slug === 'previsite_ao'
                      return it.slug === 'avancement'
                    }).map((it) => {
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
                <section className="order-last rounded-xl border border-sky-200 bg-sky-50/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-sky-600" />
                      {mode === 'meeting' ? 'Points à discuter' : 'Recommandations MemorIA'}
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
                    <>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Priorité complémentaire suggérée par MemorIA</p>
                    <ul className="space-y-1">
                      {[...points].sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high')).map((p, i) => (
                        <li key={i} className="flex gap-1.5 text-sm text-sky-950">
                          <span aria-hidden className="text-sky-500">•</span>
                          <span className="min-w-0">
                            {(p.priority === 'high' || i === 0) && <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-rose-700">Priorité</span>}
                            <span>{p.text}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    </>
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

              {brief && loadedSite && (
                <BriefBody brief={brief} mode={mode} motive={motive} siteId={loadedSite} variant={variant} onDebriefChange={refetchBrief} />
              )}

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

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

function FactLines({ items, empty = 'Rien à signaler.', defaultDotClass = 'bg-emerald-500' }: { items: SiteBriefFactLine[]; empty?: string; defaultDotClass?: string }) {
  if (items.length === 0) return <p className="text-sm italic text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item.sourceType}:${item.sourceId ?? item.text}:${index}`} className="flex items-start gap-2 text-sm">
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.status === 'in_progress' || item.status === 'unconfirmed' ? 'bg-amber-500' : item.status === 'interpretation' ? 'bg-violet-500' : defaultDotClass}`} aria-hidden />
          <span className="min-w-0 flex-1">
            {/* Un nombre qui ne s'ouvre pas oblige à le croire. Quand ses objets sont
                déjà chargés, il devient dépliable et dit ce qu'il compte exactement. */}
            {item.items && item.items.length > 0 ? (
              <details className="group">
                <summary className="cursor-pointer list-none marker:content-none hover:underline">
                  {item.text}
                  <span className="ml-1 text-[10px] text-muted-foreground/70 group-open:hidden">— voir le détail</span>
                </summary>
                {item.itemsDefinition && (
                  <p className="mt-1 text-[11px] italic text-muted-foreground/80">{item.itemsDefinition}</p>
                )}
                <ul className="mt-1 space-y-1 border-l pl-3">
                  {item.items.map((detail) => (
                    <li key={detail.id} className="text-[13px] text-muted-foreground">
                      {detail.href ? <a href={detail.href} className="hover:underline">{detail.label}</a> : detail.label}
                    </li>
                  ))}
                </ul>
                {item.itemsHiddenCount ? (
                  <p className="mt-1 pl-3 text-[11px] text-muted-foreground/70">
                    + {item.itemsHiddenCount} {item.itemsHiddenCount > 1 ? 'autres, non listés ici' : 'autre, non listé ici'}
                    {item.sourceHref ? <> — <a href={item.sourceHref} className="underline">tout voir</a></> : null}
                  </p>
                ) : null}
              </details>
            ) : item.sourceHref ? (
              <a href={item.sourceHref} className="hover:underline">{item.text}</a>
            ) : (
              item.text
            )}
          </span>
          {item.status === 'in_progress' && <span className="shrink-0 text-[10px] text-amber-700">En cours</span>}
          {item.status === 'unconfirmed' && <span className="shrink-0 text-[10px] text-amber-700">Non confirmé</span>}
          {item.status === 'interpretation' && <span className="shrink-0 text-[10px] text-violet-700">Interprétation</span>}
        </li>
      ))}
    </ul>
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
  { label: 'Ce qui nécessite mon attention', dot: 'bg-rose-500',    keys: ['followedPoints', 'vigilance', 'anomalies', 'reserves', 'actions', 'openActivityItems'] },
  { label: 'Ce qui a changé',                dot: 'bg-amber-500',   keys: ['change'] },
  { label: "Ce qu'il faut savoir",           dot: 'bg-emerald-500', keys: ['aSavoir', 'recurring'] },
  { label: "Qui peut m'aider",               dot: 'bg-sky-500',     keys: ['teams'] },
  { label: 'Historique',                     dot: 'bg-slate-400',   keys: ['recentDone', 'missions', 'meetings', 'photos'] },
]
const TIERS_MEETING: Tier[] = [
  { label: 'À aborder / arbitrer',           dot: 'bg-rose-500',    keys: ['followedPoints', 'change', 'reserves', 'actions', 'openActivityItems'] },
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

// D4 — bandeau compact d'état confirmé (Action/Échéance/Réserve), source unique
// = liveDebrief.confirmedToday (mêmes compteurs que l'Aperçu, cf. D2 §8). Des
// compteurs en ligne, jamais une carte : la doctrine D4 interdit de refaire une
// grosse carte ici.
function ConfirmedTodayChips({ confirmedToday }: { confirmedToday: LiveDebrief['confirmedToday'] }) {
  const { actionsActive, actionsOverdue, deadlinesToPlan, deadlinesPlanned, reservesOpen, nextEvent } = confirmedToday
  const hasAny = actionsActive > 0 || actionsOverdue > 0 || deadlinesToPlan > 0 || deadlinesPlanned > 0 || reservesOpen > 0 || nextEvent
  if (!hasAny) return <p className="text-sm italic text-muted-foreground">Rien d&apos;actif confirmé pour le moment.</p>
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {actionsActive > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 px-2.5 py-1 font-medium">
          <ListTodo className="h-3.5 w-3.5" />
          {actionsActive} action{actionsActive > 1 ? 's' : ''} active{actionsActive > 1 ? 's' : ''}
        </span>
      )}
      {actionsOverdue > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 px-2.5 py-1 font-medium">
          <AlertTriangle className="h-3.5 w-3.5" />
          {actionsOverdue} en retard
        </span>
      )}
      {deadlinesToPlan > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2.5 py-1 font-medium">
          <CalendarClock className="h-3.5 w-3.5" />
          {deadlinesToPlan} échéance{deadlinesToPlan > 1 ? 's' : ''} à planifier
        </span>
      )}
      {deadlinesPlanned > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
          <CalendarClock className="h-3.5 w-3.5" />
          {deadlinesPlanned} échéance{deadlinesPlanned > 1 ? 's' : ''} planifiée{deadlinesPlanned > 1 ? 's' : ''}
        </span>
      )}
      {reservesOpen > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 px-2.5 py-1 font-medium">
          <Flag className="h-3.5 w-3.5" />
          {reservesOpen} réserve{reservesOpen > 1 ? 's' : ''} ouverte{reservesOpen > 1 ? 's' : ''}
        </span>
      )}
      {nextEvent && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
          <CalendarClock className="h-3.5 w-3.5" />
          Prochain : {formatDate(nextEvent.startsAt) ?? nextEvent.title}
        </span>
      )}
    </div>
  )
}

// D4 — rendu unique d'un item du Débrief vivant (Action/Échéance/Réserve ou
// signal informationnel). « Vu » n'apparaît jamais sur un objet métier — la
// discrimination par `kind` type-locke ça au niveau TypeScript, pas seulement
// visuel (cf. LiveDebriefVuButton, type-locked à LiveDebriefInformationalItem).
// 14A — restitution du classement déterministe « À traiter » (desktop). La raison
// vient du même calcul que le rang (`rankLiveDebriefToHandle`) ; jamais un score.
// Couleurs : rouge (retard), orange (imminence / réouverture), gris (ancienneté).
const RANK_STYLE: Record<ToHandlePriority, { dot: string; text: string }> = {
  retard: { dot: 'bg-rose-500', text: 'text-rose-700' },
  imminence: { dot: 'bg-amber-500', text: 'text-amber-700' },
  reopened: { dot: 'bg-orange-500', text: 'text-orange-700' },
  age: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
}

function RankReason({ rank }: { rank: ToHandleRank }) {
  const s = RANK_STYLE[rank.priority]
  return (
    <p className={`mt-0.5 flex items-center gap-1.5 text-[11px] font-medium ${s.text}`}>
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
      <span>{rank.reason}</span>
      {rank.secondary && <span className="font-normal text-muted-foreground">· {rank.secondary}</span>}
    </p>
  )
}

function LiveDebriefItemRow({
  item,
  siteId,
  canLiftReserve,
  onDebriefChange,
}: {
  item: LiveDebriefItem
  siteId: string
  variant: 'mobile' | 'desktop'
  canLiftReserve: boolean
  onDebriefChange: () => void
}) {
  const [actionClosing, setActionClosing] = useState(false)
  const [reserveLifting, setReserveLifting] = useState(false)
  const [planningDeadline, setPlanningDeadline] = useState(false)
  const [modifying, setModifying] = useState(false)
  const [completing, startCompleting] = useTransition()

  if (item.kind === 'informational_signal') {
    return (
      <li className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
        <div className="min-w-0">
          <a href={item.href} className="text-sm font-medium hover:underline">{item.title}</a>
          {item.rank && <RankReason rank={item.rank} />}
          {item.reasons.length > 0 && <p className="mt-0.5 text-[11px] text-muted-foreground">{item.reasons.join(' · ')}</p>}
        </div>
        {item.disposition === 'to_watch' && <LiveDebriefVuButton item={item} siteId={siteId} onSeen={onDebriefChange} />}
      </li>
    )
  }
  const kindLabel = item.kind === 'action' ? 'Action' : item.kind === 'deadline' ? 'Échéance' : 'Réserve'
  const dateLabel = formatDate(item.date)
  const canClose = item.kind === 'action' && item.status === 'open'
  const canLift = item.kind === 'reserve' && item.status === 'open' && canLiftReserve
  const canPlan = item.kind === 'deadline' && item.status === 'to_plan'
  const canReplan = item.kind === 'deadline' && item.status === 'planned'
  const canModify = item.kind === 'action' && (item.status === 'open' || item.status === 'planned')
  const hasMenu = canClose || canLift || canPlan || canReplan || canModify
  const expanded = actionClosing || reserveLifting || planningDeadline || modifying
  const objectId = item.id

  function markDeadlineDone() {
    startCompleting(async () => {
      const result = await completeDeadlineAction(objectId)
      if (result.ok) onDebriefChange()
      else toast.error(result.error ?? 'Échec')
    })
  }

  return (
    <li className="rounded-lg border bg-background px-3 py-2 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a href={item.href} className="text-sm font-medium hover:underline">{item.title}</a>
          {item.rank && <RankReason rank={item.rank} />}
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  />
                }
              >
                {kindLabel} <span aria-hidden>›</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {canReplan && (
                  <DropdownMenuItem onClick={markDeadlineDone} disabled={completing}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Marquer réalisée
                  </DropdownMenuItem>
                )}
                {(canPlan || canReplan) && (
                  <DropdownMenuItem onClick={() => setPlanningDeadline(true)}>
                    <CalendarClock className="h-3.5 w-3.5" /> {canReplan ? 'Replanifier' : 'Planifier'}
                  </DropdownMenuItem>
                )}
                {canClose && (
                  <DropdownMenuItem onClick={() => setActionClosing(true)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Clôturer
                  </DropdownMenuItem>
                )}
                {canLift && (
                  <DropdownMenuItem onClick={() => setReserveLifting(true)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Lever la réserve
                  </DropdownMenuItem>
                )}
                {canModify && (
                  <DropdownMenuItem onClick={() => setModifying(true)}>
                    <Pencil className="h-3.5 w-3.5" /> Modifier
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => { window.location.href = item.href }}>
                  <ChevronRight className="h-3.5 w-3.5" /> Ouvrir la fiche
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{kindLabel}</p>
          )}
        </div>
        {/* 14A — pour un item classé (À traiter desktop), la date vit déjà dans la
            raison/complément : on masque la date brute à droite pour ne pas la
            tripler. À surveiller / Traité récemment / mobile gardent la date. */}
        {!expanded && dateLabel && !item.rank && (
          <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">{dateLabel}</span>
        )}
      </div>
      {planningDeadline && item.kind === 'deadline' && (
        <LiveDebriefDeadlineForm
          item={item}
          onCancel={() => setPlanningDeadline(false)}
          onDone={onDebriefChange}
        />
      )}
      {actionClosing && item.kind === 'action' && (
        <LiveDebriefActionCloseForm
          actionId={item.id}
          siteId={siteId}
          onCancel={() => setActionClosing(false)}
          onDone={onDebriefChange}
        />
      )}
      {reserveLifting && item.kind === 'reserve' && (
        <LiveDebriefReserveLiftForm
          reserveId={item.id}
          siteId={siteId}
          onCancel={() => setReserveLifting(false)}
          onDone={onDebriefChange}
        />
      )}
      {modifying && item.kind === 'action' && (
        <LiveDebriefActionDetailsForm
          item={item}
          siteId={siteId}
          onCancel={() => setModifying(false)}
          onDone={() => { setModifying(false); onDebriefChange() }}
        />
      )}
    </li>
  )
}

// D5 lot 2 — clôture inline d'une Action `open`, desktop uniquement. Réutilise
// strictement closeActionAction (même contrat que ActionFicheCta.tsx : commentaire
// requis, photo optionnelle — même champ FormData `file`).
function LiveDebriefActionCloseForm({
  actionId,
  siteId,
  onCancel,
  onDone,
}: {
  actionId: string
  siteId: string
  onCancel: () => void
  onDone: () => void
}) {
  const [comment, setComment] = useState('')
  const [photoName, setPhotoName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!comment.trim()) {
      toast.error('Ajoutez un commentaire de clôture.')
      return
    }
    const fd = new FormData()
    fd.set('id', actionId)
    fd.set('site_id', siteId)
    fd.set('comment', comment.trim())
    const f = fileRef.current?.files?.[0]
    if (f) fd.set('file', f)
    startTransition(async () => {
      const result = await closeActionAction(fd)
      if (result.ok) onDone()
      else toast.error(result.error)
    })
  }

  return (
    <div className="rounded-md border bg-muted/20 p-2 space-y-1.5">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        autoFocus
        maxLength={1000}
        placeholder="Ex : joints repris et vérifiés — plus rien à suivre."
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
          <Camera className="h-3.5 w-3.5" />
          {photoName ? 'Photo ajoutée' : 'Photo (optionnel)'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <button type="button" onClick={onCancel} disabled={pending} className="text-xs text-muted-foreground hover:text-foreground">
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !comment.trim()}
            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            {pending ? '…' : 'Clôturer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Modifier — édition inline titre + description d'une Action, ouverte depuis le
// menu de la pilule. Réutilise strictement updateActionDetailsAction (P0-1B,
// même contrat que DetailsForm dans ActionFicheCta.tsx) : pas de deuxième
// primitive d'édition. Seedée avec item.body pour ne jamais écraser une
// description existante avec une valeur vide.
function LiveDebriefActionDetailsForm({
  item,
  siteId,
  onCancel,
  onDone,
}: {
  item: LiveDebriefObjectItem
  siteId: string
  onCancel: () => void
  onDone: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [body, setBody] = useState(item.body ?? '')
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!title.trim()) {
      toast.error('Le titre est requis.')
      return
    }
    const fd = new FormData()
    fd.set('id', item.id)
    fd.set('site_id', siteId)
    fd.set('title', title.trim())
    fd.set('body', body)
    startTransition(async () => {
      const result = await updateActionDetailsAction(fd)
      if (result.ok) { toast.success('Action modifiée'); onDone() }
      else toast.error(result.error)
    })
  }

  return (
    <div className="rounded-md border bg-muted/20 p-2.5 space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        autoFocus
        disabled={pending}
        placeholder="Titre de l'action"
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={2000}
        disabled={pending}
        placeholder="Description (optionnel)"
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className="text-xs text-muted-foreground hover:text-foreground">
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !title.trim()}
          className="rounded border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
        >
          {pending ? '…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}

// D5 lot 3 — levée inline d'une Réserve `open`, desktop + rôle managerOrAdmin
// uniquement (canLiftReserve, calculé côté serveur). Réutilise strictement
// liftReserveAction ; note + photo optionnelles (champ FormData `photoAfter`,
// distinct du `file` de closeActionAction — contrat serveur existant).
function LiveDebriefReserveLiftForm({
  reserveId,
  siteId,
  onCancel,
  onDone,
}: {
  reserveId: string
  siteId: string
  onCancel: () => void
  onDone: () => void
}) {
  const [liftNote, setLiftNote] = useState('')
  const [photoName, setPhotoName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('id', reserveId)
    fd.set('siteId', siteId)
    if (liftNote.trim()) fd.set('liftNote', liftNote.trim())
    const f = fileRef.current?.files?.[0]
    if (f) fd.set('photoAfter', f)
    startTransition(async () => {
      const result = await liftReserveAction(fd)
      if ('error' in result) {
        setError(result.error)
        toast.error(result.error)
      } else {
        onDone()
      }
    })
  }

  return (
    <div className="rounded-md border bg-muted/20 p-2 space-y-1.5">
      <textarea
        value={liftNote}
        onChange={(e) => setLiftNote(e.target.value)}
        rows={2}
        autoFocus
        maxLength={280}
        placeholder="Note de levée (optionnel)"
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
          <Camera className="h-3.5 w-3.5" />
          {photoName ? 'Photo ajoutée' : 'Photo (optionnel)'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <button type="button" onClick={onCancel} disabled={pending} className="text-xs text-muted-foreground hover:text-foreground">
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            {pending ? '…' : 'Lever'}
          </button>
        </div>
      </div>
    </div>
  )
}

// D5 lot 1 — planification/replanification inline d'une échéance, ouverte
// depuis le menu de la pilule (jamais depuis un bouton logé dans l'entête :
// le formulaire s'affiche toujours pleine largeur SOUS le titre, jamais à
// côté — cf. correctif layout Vincent 2026-08-31). Réutilise strictement
// rescheduleDeadlineAction.
function LiveDebriefDeadlineForm({
  item,
  onCancel,
  onDone,
}: {
  item: LiveDebriefObjectItem
  onCancel: () => void
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [dueDate, setDueDate] = useState('')

  function submit() {
    if (!dueDate) return
    startTransition(async () => {
      const result = await rescheduleDeadlineAction({ deadlineId: item.id, dueDate })
      if (result.ok) onDone()
      else toast.error(result.error ?? 'Échec')
    })
  }

  return (
    <div className="rounded-md border bg-muted/20 p-2.5 space-y-2">
      <p className="text-xs font-medium">
        {item.status === 'planned' ? 'Replanifier cette échéance' : 'Planifier cette échéance'}
      </p>
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        disabled={pending}
        autoFocus
        className="h-9 w-full rounded border px-2 text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className="text-xs text-muted-foreground hover:text-foreground">
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !dueDate}
          className="rounded border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
        >
          {pending ? '…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}

// Conditionnellement rendu (masqué si vide) — pas de bloc vide pour « À traiter »
// / « À surveiller » / « Traité récemment » quand le chantier n'a rien de ce type.
//
// `initialLimit` (D7 §2, « Traité récemment » uniquement) : n'affiche que les
// N éléments les plus récents au premier rendu — l'ordre vient de LiveDebrief,
// jamais retrié ici — avec un dépli local (« Voir les N éléments »), sans
// action métier ajoutée et sans persistance : se referme à la fermeture du
// panneau, ne retient rien au-delà de la fenêtre déjà appliquée par D1.
function LiveDebriefBlock({
  title,
  icon,
  items,
  siteId,
  variant,
  canLiftReserve,
  onDebriefChange,
  initialLimit,
  overflowHref,
}: {
  title: string
  icon: React.ReactNode
  items: LiveDebriefItem[]
  siteId: string
  variant: 'mobile' | 'desktop'
  canLiftReserve: boolean
  onDebriefChange: () => void
  initialLimit?: number
  /** 11A' — si fourni, le dépassement du plafond ne DÉPLIE PAS la liste dans le
   *  Brief : il renvoie vers la surface métier (liste complète). Le Brief reste
   *  un Brief. Sans `overflowHref`, comportement historique (dépli local, réservé
   *  à « Traité récemment »). */
  overflowHref?: string
}) {
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null
  const capped = initialLimit != null && !expanded && items.length > initialLimit
  const visibleItems = capped ? items.slice(0, initialLimit) : items
  const overflowCount = initialLimit != null ? items.length - initialLimit : 0
  return (
    <section className="rounded-xl border bg-background p-3.5 space-y-2.5">
      <SectionTitle icon={icon} count={items.length}>{title}</SectionTitle>
      <ul className="space-y-1.5">
        {visibleItems.map((item) => (
          <LiveDebriefItemRow
            key={`${item.kind}-${item.kind === 'informational_signal' ? item.signalKey : item.id}`}
            item={item}
            siteId={siteId}
            variant={variant}
            canLiftReserve={canLiftReserve}
            onDebriefChange={onDebriefChange}
          />
        ))}
      </ul>
      {capped && overflowHref && (
        // 11A' : « Voir les N autres » MÈNE à la surface métier (liste complète),
        // jamais un dépli des N dans le Brief — sinon on recrée le problème sous un clic.
        <a href={overflowHref} className="text-xs font-medium text-sky-700 hover:underline">
          Voir les {overflowCount} autre{overflowCount > 1 ? 's' : ''}
        </a>
      )}
      {capped && !overflowHref && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs font-medium text-sky-700 hover:underline"
        >
          Voir les {items.length} éléments
        </button>
      )}
    </section>
  )
}

function BriefBody({
  brief,
  mode,
  motive,
  siteId,
  variant,
  onDebriefChange,
}: {
  brief: SiteBrief
  mode: 'visit' | 'meeting'
  motive: VisitIntent
  siteId: string
  variant: 'mobile' | 'desktop'
  onDebriefChange: () => void
}) {
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
    phaseLabel,
    minuteSummary,
    urgentItems,
    blockedItems,
    lastPresence,
    activities,
    persistedNarrative,
    beforeLeaving,
    verificationQuestions,
    deadlines,
    decisions,
    narratives,
    proofs,
    objective,
    estimatedPhase,
    freshness,
    freshnessKind,
    coherenceInsights,
    rememberToday,
    unknowns,
    activityReadModel,
    liveDebrief,
    canLiftReserve,
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
    || activities.length > 0
    || persistedNarrative != null

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
    openActivityItems: brief.openActivityItems.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Clock3 className="h-3.5 w-3.5 text-amber-600" />} count={brief.openActivityItems.reduce((total, item) => total + item.proposals.length, 0)}>
          Activité en cours · à confirmer
        </SectionTitle>
        <div className="space-y-2">
          {brief.openActivityItems.map((activity) => (
            <div key={activity.sourceId} className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-950">
                    {activity.sourceType === 'visit' ? 'Visite' : 'Réunion'} en cours · {activity.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-800">
                    Non consolidée · {activity.photoCount} photo{activity.photoCount > 1 ? 's' : ''} · {activity.memoCount} mémo{activity.memoCount > 1 ? 's' : ''}
                  </p>
                </div>
                <a href={activity.sourceHref} className="shrink-0 text-[11px] font-medium text-amber-800 hover:underline">Ouvrir</a>
              </div>
              <ul className="mt-2 space-y-1 border-t border-amber-200/70 pt-2">
                {activity.proposals.map((proposal) => (
                  <li key={proposal.id} className="flex items-start gap-2 text-sm text-amber-950">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                    <span><span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">{proposal.type}</span> · {proposal.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
        <SectionTitle icon={<Hammer className="h-3.5 w-3.5" />}>Missions sur le chantier</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {missionNames.map((name) => (
            <span key={name} className="inline-flex items-center rounded-full border bg-card px-2.5 py-0.5 text-xs">{name}</span>
          ))}
        </div>
      </section>
    ),
    teams: teams.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Users className="h-3.5 w-3.5" />}>Équipes qui connaissent le chantier</SectionTitle>
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
      <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-3.5 space-y-2.5">
        <SectionTitle icon={<CalendarClock className="h-3.5 w-3.5 text-sky-700" />}>Pourquoi je vais sur ce chantier</SectionTitle>
        {objective ? (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-sky-700">
                {objective.kind === 'scheduled' ? 'Motif du passage planifié' : 'Motif opérationnel principal'}
              </p>
              <p className="mt-1 text-sm font-medium">{objective.sourceHref ? <a href={objective.sourceHref} className="hover:underline">{objective.text}</a> : objective.text}</p>
            </div>
            <span className="shrink-0 text-[10px] text-emerald-700">Déterminé</span>
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">Aucun objectif déterminé. Une recommandation IA peut être demandée.</p>
        )}
      </section>

      <section className="rounded-xl border bg-background p-3.5 space-y-2.5">
        <SectionTitle icon={<History className="h-3.5 w-3.5 text-sky-600" />}>Depuis votre dernière venue</SectionTitle>
        {liveDebrief.sinceLastVisit.kind === 'first_visit' ? (
          <p className="text-sm italic text-muted-foreground">Première visite : aucune venue antérieure identifiée sur ce chantier.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Depuis votre dernière venue {liveDebrief.sinceLastVisit.personal ? 'personnelle' : 'connue'} du{' '}
              {formatDateTime(liveDebrief.sinceLastVisit.at) ?? liveDebrief.sinceLastVisit.visitDateLabel}
              {typeof liveDebrief.sinceLastVisit.daysAgo === 'number' ? ` (il y a ${liveDebrief.sinceLastVisit.daysAgo} j)` : ''}
            </p>
            {liveDebrief.sinceLastVisit.items.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">Aucun changement enregistré depuis cette venue.</p>
            ) : (
              <ul className="space-y-1.5">
                {liveDebrief.sinceLastVisit.items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-hidden />
                    <span className="min-w-0 flex-1">{it.label}</span>
                    {formatDate(it.at) && <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">{formatDate(it.at)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {liveDebrief.sinceLastVisit.overflow > 0 && (
              <p className="text-[11px] text-muted-foreground">
                + {liveDebrief.sinceLastVisit.overflow} autre{liveDebrief.sinceLastVisit.overflow > 1 ? 's' : ''} changement{liveDebrief.sinceLastVisit.overflow > 1 ? 's' : ''}
              </p>
            )}
          </>
        )}
      </section>

      {/* D7 §1 — synthèse compacte, dérivée EXCLUSIVEMENT des trois blocs
          LiveDebrief ci-dessous (aucun nouveau comptage) : elle annonce ce que
          la page contient avant de le détailler, jamais un chiffre inventé.
          Absente si les trois blocs sont vides — la page se vide naturellement,
          jamais de synthèse d'un vide. */}
      {(liveDebrief.toHandle.length > 0 || liveDebrief.toWatch.length > 0 || liveDebrief.recentlyHandled.length > 0) && (
        <p className="px-1 text-xs font-medium text-muted-foreground">
          {liveDebrief.recentlyHandled.length} traité{liveDebrief.recentlyHandled.length > 1 ? 's' : ''} · {liveDebrief.toHandle.length} à traiter · {liveDebrief.toWatch.length} à surveiller
        </p>
      )}

      {/* 11A' — sélectivité DESKTOP uniquement (gate variant) : le Brief montre
          les 5 déjà prioritaires par l'ordre actuel (aucun retri), le titre porte
          le total (« À traiter (89) »), et « Voir les N autres » renvoie vers la
          surface métier (liste complète), jamais un dépli dans le Brief. Aucune
          modification mobile (initialLimit/overflowHref undefined si variant !== desktop). */}
      <LiveDebriefBlock
        title="À traiter"
        icon={<ListTodo className="h-3.5 w-3.5 text-rose-600" />}
        items={liveDebrief.toHandle}
        siteId={siteId}
        variant={variant}
        canLiftReserve={canLiftReserve}
        onDebriefChange={onDebriefChange}
        initialLimit={variant === 'desktop' ? 5 : undefined}
        overflowHref={variant === 'desktop' ? `/sites/${siteId}/actions` : undefined}
      />
      <LiveDebriefBlock
        title="À surveiller"
        icon={<BellRing className="h-3.5 w-3.5 text-amber-600" />}
        items={liveDebrief.toWatch}
        siteId={siteId}
        variant={variant}
        canLiftReserve={canLiftReserve}
        onDebriefChange={onDebriefChange}
        initialLimit={variant === 'desktop' ? 5 : undefined}
        overflowHref={variant === 'desktop' ? `/sites/${siteId}/historique` : undefined}
      />
      {/* D7 §2 — bloc volontairement secondaire : peu d'éléments visibles
          d'emblée, dépli local pour le reste. Pas d'action métier ici (déjà
          garanti par LiveDebriefItemRow — un item recently_handled n'expose
          jamais de CTA), pas de bouton « Vu ». */}
      <LiveDebriefBlock
        title="Traité récemment"
        icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
        items={liveDebrief.recentlyHandled}
        siteId={siteId}
        variant={variant}
        canLiftReserve={canLiftReserve}
        onDebriefChange={onDebriefChange}
        initialLimit={3}
      />

      <section className="rounded-xl border bg-background p-3.5 space-y-2.5">
        <SectionTitle icon={<Brain className="h-3.5 w-3.5 text-sky-600" />}>Ce que je dois retenir aujourd&apos;hui</SectionTitle>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">État confirmé aujourd&apos;hui</p>
        <ConfirmedTodayChips confirmedToday={liveDebrief.confirmedToday} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
          <span>Indice de phase (objets ouverts) : <strong className="font-semibold text-foreground">{estimatedPhase}</strong><span className="ml-1 text-muted-foreground/70">— déduit, non confirmé sur site</span></span>
          {/* « Mémoire : il y a 3 jours » ne disait ni de quoi il s'agissait ni depuis
              quand. C'est le started_at de la dernière activité rapportée : on nomme
              sa nature et sa date, le délai relatif ne reste qu'en appoint. */}
          <span>
            {freshnessKind === 'meeting' ? 'Dernière réunion' : activities[0]?.status === 'in_progress' ? 'Activité terrain en cours' : 'Dernière visite consolidée'} :{' '}
            <strong className={freshness.level === 'stale' ? 'font-semibold text-amber-700' : 'font-semibold text-foreground'}>
              {formatDay(freshness.at?.slice(0, 10)) ?? freshness.label}
            </strong>
            {freshness.at ? <span className="ml-1 text-muted-foreground/70">({freshness.label})</span> : null}
          </span>
        </div>
        <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dernier état rapporté</p>
        <FactLines items={rememberToday} empty="Aucun fait consolidé à retenir pour le moment." />
      </section>

      {/* D10 — Modèle B : activités parallèles constatées. Jamais une phase unique.
          Ne s'affiche que si le read-model a détecté une intervention ou des activités.
          OCEF (interventionStarted=null, activitiesInProgress=[]) → bloc absent. */}
      {(activityReadModel.interventionStarted === true || activityReadModel.activitiesInProgress.length > 0) && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 space-y-2.5">
          <SectionTitle icon={<Hammer className="h-3.5 w-3.5 text-emerald-700" />}>Activités constatées récemment</SectionTitle>
          {activityReadModel.interventionStarted && (
            <p className="text-[11px] font-medium text-emerald-700">
              {activityReadModel.dayIndex
                ? `${ordinalDay(activityReadModel.dayIndex)} jour d’intervention constaté`
                : 'Intervention en cours'}
            </p>
          )}
          {activityReadModel.activitiesInProgress.length > 0 && (
            <ul className="space-y-2">
              {activityReadModel.activitiesInProgress.map((item, i) => (
                <li key={i} className="flex items-start justify-between gap-3 text-sm leading-snug">
                  <span className="min-w-0">{item.label}</span>
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-emerald-700">
                    {item.status === 'in_progress' ? 'en cours' : 'démarré'}
                    {formatDay(item.proofDate) ? ` · ${formatDay(item.proofDate)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* « non mis à jour automatiquement » se lisait comme un aveu de panne.
              Le fait exact est : ceci est l'état CONSTATÉ à la dernière preuve terrain,
              et il n'est pas présumé avoir changé depuis. On le dit ainsi. */}
          <p className="text-[11px] text-muted-foreground/80">
            {formatDay(freshness.at?.slice(0, 10))
              ? `État constaté lors de ${freshnessKind === 'meeting' ? 'la réunion' : 'la visite'} du ${formatDay(freshness.at?.slice(0, 10))} · à reconfirmer sur site`
              : 'État constaté lors du dernier passage · à reconfirmer sur site'}
          </p>
        </section>
      )}

      {coherenceInsights.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-2.5">
          <SectionTitle icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-700" />}>Ce qui n&apos;est plus cohérent</SectionTitle>
          <FactLines items={coherenceInsights} />
        </section>
      )}

      {unknowns.length > 0 && (
        <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-3.5 space-y-2.5">
          <SectionTitle icon={<Info className="h-3.5 w-3.5 text-violet-700" />}>Ce que je ne sais pas encore</SectionTitle>
          <FactLines items={unknowns} />
        </section>
      )}

      {activities.length > 0 && (
        <section className="space-y-2.5">
          <SectionTitle icon={<History className="h-3.5 w-3.5 text-sky-600" />}>Activité récente</SectionTitle>
          <div className="space-y-2">
            {activities.slice(0, 5).map((activity) => {
              const excerpt = activity.narrative ? selectNarrativeHighlights([activity.narrative], 1)[0] : null
              const statusLabel = activity.status === 'in_progress'
                ? 'En cours — non consolidé'
                : activity.status === 'very_recent' ? 'Très récent' : 'Validé'
              const statusClass = activity.status === 'in_progress'
                ? 'bg-amber-50 text-amber-700'
                : activity.status === 'very_recent' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'
              return (
                <article key={activity.id} className="rounded-xl border bg-background p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {activity.kind === 'visit' ? 'Visite' : 'Réunion'}
                      </p>
                      <p className="text-sm font-medium">{activity.title}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>{statusLabel}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDate(activity.startedAt)}
                    {activity.photoCount > 0 ? ` · ${activity.photoCount} photo${activity.photoCount > 1 ? 's' : ''}` : ''}
                    {activity.memoCount > 0 ? ` · ${activity.memoCount} note${activity.memoCount > 1 ? 's' : ''}` : ''}
                  </p>
                  {excerpt && (
                    <p className="text-sm leading-relaxed text-foreground/85">{excerpt}</p>
                  )}
                  <a href={activity.href} className="inline-flex text-xs font-medium text-sky-700 hover:underline">
                    Voir le résumé complet <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                  </a>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {proofs.length > 0 && (
        <section className="rounded-xl border bg-background p-3.5 space-y-2.5">
          <SectionTitle icon={<Camera className="h-3.5 w-3.5 text-violet-600" />}>Preuves et sources</SectionTitle>
          <ul className="space-y-1.5">
            {proofs.slice(0, 5).map((proof) => (
              <li key={`${proof.type}:${proof.id}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{proof.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {proof.reason === 'new_since_last_visit' ? 'Nouveau depuis votre venue' : proof.reason === 'latest_report' ? 'Dernière source enregistrée' : 'Photo clé du chantier'}
                  </span>
                </span>
                <a href={proof.href} className="shrink-0 text-xs font-medium text-sky-700 hover:underline">Ouvrir</a>
              </li>
            ))}
          </ul>
        </section>
      )}


      <details className="rounded-xl border bg-background">
        <summary className="cursor-pointer list-none px-3.5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Voir toutes les données du chantier</summary>
        <div className="space-y-5 border-t px-3.5 py-3.5">
      <section className="rounded-xl border bg-background p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Préparation de visite</p>
            <p className="mt-0.5 text-sm font-semibold">{phaseLabel}</p>
          </div>
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">En une minute</span>
        </div>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {minuteSummary.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>

      {urgentItems.length > 0 && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-3.5 space-y-2">
          <SectionTitle icon={<BellRing className="h-3.5 w-3.5 text-rose-600" />}>À faire avant la visite</SectionTitle>
          <ul className="space-y-1.5">
            {urgentItems.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-rose-950">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {blockedItems.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-2">
          <SectionTitle icon={<Flag className="h-3.5 w-3.5 text-amber-600" />}>En attente</SectionTitle>
          <ul className="space-y-1 text-sm text-amber-950">
            {blockedItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      {lastPresence && (
        <section className="rounded-xl border bg-muted/20 p-3.5 space-y-2">
          <SectionTitle icon={<Camera className="h-3.5 w-3.5 text-sky-600" />}>Dernière présence terrain</SectionTitle>
          <p className="text-sm">
            {formatDate(lastPresence.occurredAt) ?? 'Dernier passage'}
            {lastPresence.actor ? ` · ${lastPresence.actor}` : ''}
            {lastPresence.photoCount > 0 ? ` · ${lastPresence.photoCount} photo${lastPresence.photoCount > 1 ? 's' : ''}` : ''}
          </p>
        </section>
      )}

      {persistedNarrative && activities.length === 0 && (
        <section className="rounded-xl border bg-muted/20 p-3.5 space-y-2">
          <SectionTitle icon={<History className="h-3.5 w-3.5 text-sky-600" />}>Dernier résumé enregistré</SectionTitle>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">{persistedNarrative}</p>
        </section>
      )}

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
      </details>
    </div>
  )
}
