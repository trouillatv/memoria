'use client'

// N3.2 — LA SALLE D'ENQUÊTE.
//
// N3.1 avait câblé le récit ; il se lisait comme un rapport d'audit. N3.2 le
// rend explorable : un sommaire qui suit la lecture, des sections qu'on replie
// quand on a compris, une frise pour retrouver un moment, et un panneau latéral
// pour écouter une preuve SANS QUITTER SA PLACE — c'est là tout l'enjeu, parce
// qu'une visite se comprend en faisant des allers-retours.
//
// Aucune logique métier nouvelle : les mêmes données, la même règle de preuve.

import { useEffect, useRef, useState } from 'react'
import {
  Camera, Check, ChevronDown, FileText, Loader2, MapPin, Mic, Pause, Play, Plus, Video,
} from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { promoteEvidenceToCrAction } from '@/app/(field)/m/visite/[reportId]/cr/promotion-actions'
import type { VisitNarrative, NarrativeCapture } from '@/lib/db/visit-narrative'

export type CaptureMedia = Record<string, { url: string; mime: string | null }>

const KIND_ICON: Record<string, typeof Mic> = {
  vocal: Mic, photo: Camera, video: Video, note: FileText, position: MapPin, verification: Check,
}
const KIND_FR: Record<string, string> = {
  vocal: 'Vocal', photo: 'Photo', video: 'Vidéo', note: 'Note',
  position: 'Position', verification: 'Vérification',
}
const PRODUCED_FR: Record<string, string> = {
  action: 'Action', reserve: 'Réserve', decision: 'Décision',
  echeance: 'Échéance', memoire: 'Mémoire', intervenant: 'Intervenant',
}

const KIND_PLURAL: Record<string, [string, string]> = {
  action: ['action', 'actions'],
  reserve: ['réserve', 'réserves'],
  decision: ['décision', 'décisions'],
  echeance: ['échéance', 'échéances'],
  memoire: ['élément à mémoriser', 'éléments à mémoriser'],
  intervenant: ['intervenant', 'intervenants'],
}

// L'ORDRE DE LECTURE DU CONDUCTEUR (Vincent, 2026-07-22) : que s'est-il passé ?
// → qu'en a compris MemorIA ? → qu'ai-je décidé ? → qu'est-ce que ça a produit ?
// Ce que la visite a produit est la FIN de l'histoire, pas son début — c'est
// pour ça que la répartition par type a quitté l'en-tête pour venir ici.
const SOMMAIRE = [
  { id: 'capte', label: 'Chronologie' },
  { id: 'compris', label: 'Compris' },
  { id: 'tranche', label: 'Arbitrages' },
  { id: 'produit', label: 'Produit' },
  { id: 'ecarte', label: 'Écarté' },
] as const

export function NarrativeReader({
  narrative,
  media,
  canPromote,
  crHref,
  rail,
}: {
  narrative: VisitNarrative
  media: CaptureMedia
  canPromote: boolean
  crHref: string | null
  /** Les blocs du rail rendus par le serveur (analyse, actions, statuts). Ils
   *  n'ont aucun état : ils voyagent en props plutôt que d'être réécrits ici. */
  rail?: React.ReactNode
}) {
  const [active, setActive] = useState<string>('capte')
  const [openCapture, setOpenCapture] = useState<NarrativeCapture | null>(null)
  /** La dernière preuve consultée reste marquée : en refermant le panneau, l'œil
   *  retrouve immédiatement où il en était dans la frise. */
  const [lastSeen, setLastSeen] = useState<string | null>(null)

  // Le sommaire suit la lecture au lieu de la commander.
  useEffect(() => {
    const els = SOMMAIRE.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) setActive(visible[0]!.target.id)
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  const { captured, understood, validated, produced, ignored, limits } = narrative
  const ecarteTotal = ignored.byHuman.length + ignored.superseded.length + ignored.captures.length
  const counts: Record<string, number> = {
    capte: captured.length,
    compris: understood.length,
    tranche: validated.pendingProposals,
    produit: produced.length,
    ecarte: ecarteTotal,
  }

  return (
    // Le rail est à DROITE et vient APRÈS dans le flux : sur mobile, le récit
    // commence tout de suite ; le sommaire et les actions suivent.
    <div className="lg:flex lg:flex-row-reverse lg:items-start lg:gap-8">
      <aside className="mb-6 lg:sticky lg:top-6 lg:mb-0 lg:w-64 lg:shrink-0">
        <Sommaire active={active} counts={counts} />
        {rail}
      </aside>

      <div className="min-w-0 flex-1 space-y-10 pb-24">
        {/* ── CAPTÉ — une frise, parce qu'une visite est un parcours ────────── */}
        <Section id="capte" title="Chronologie" count={captured.length}>
          {captured.length === 0 ? (
            <Empty
              title="Cette visite n’a rien laissé derrière elle."
              body="Ni vocal, ni photo, ni note : il n’y a aucune preuve à explorer. Le récit commencera au premier enregistrement de la prochaine visite."
            />
          ) : (
            <Timeline
              captures={captured}
              media={media}
              lastSeen={lastSeen}
              onOpen={(c) => {
                setOpenCapture(c)
                setLastSeen(c.id)
              }}
            />
          )}
        </Section>

        {/* ── COMPRIS ───────────────────────────────────────────────────────── */}
        <Section id="compris" title="Ce que MemorIA a compris" count={understood.length}>
          {understood.length === 0 ? (
            <Empty
              title="MemorIA n’a rien proposé."
              body="Aucune lecture n’a été tirée de cette visite. C’est un fait, pas un problème : sans matière parlée ou écrite, il n’y a rien à comprendre."
            />
          ) : (
            <div className="space-y-px">
              {understood.map((p) => (
                <Line key={p.id} tag={p.type} label={p.label} why={p.why.label}>
                  {p.rationale && <p className="text-[13px] leading-relaxed text-muted-foreground">{p.rationale}</p>}
                </Line>
              ))}
            </div>
          )}
        </Section>

        {/* ── TRANCHÉ ───────────────────────────────────────────────────────── */}
        <Section id="tranche" title="Arbitrages" count={null}>
          {/* CE QUI RESTE À TRANCHER D'ABORD — mais on ne l'annonce jamais sans
              dire où le faire : « N propositions attendent » sans bouton est
              exactement le défaut qu'on a corrigé sur les intervenants. */}
          {validated.pendingProposals > 0 && (
            <p className="mb-4 rounded-lg border px-3 py-2 text-[13px]">
              <span className="font-medium">
                {validated.pendingProposals} proposition{validated.pendingProposals > 1 ? 's attendent' : ' attend'} votre
                arbitrage.
              </span>{' '}
              {crHref ? (
                <a href={crHref} className="underline underline-offset-4">
                  Les trancher dans le compte-rendu
                </a>
              ) : (
                <span className="text-muted-foreground">Elles se tranchent depuis le compte-rendu.</span>
              )}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <Stat label="Confirmées" value={validated.confirmedProposals} />
            <Stat label="Écartées" value={validated.ignoredProposals} />
            <Stat label="En attente" value={validated.pendingProposals} />
            <Stat label="Sections corrigées" value={validated.correctedSections.length} />
            <Stat label="Captures écartées" value={validated.discardedCaptures} />
          </dl>
          {validated.supersededProposals > 0 && (
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              {validated.supersededProposals} proposition
              {validated.supersededProposals > 1 ? 's sont devenues obsolètes' : ' est devenue obsolète'} après une
              nouvelle analyse. Personne ne les a rejetées — elles ne sont comptées nulle part comme une décision.
            </p>
          )}
          {crHref && (
            <a href={crHref} className="mt-4 inline-flex items-center gap-1.5 text-sm underline underline-offset-4">
              <FileText className="h-4 w-4" aria-hidden />
              Ouvrir le compte-rendu
            </a>
          )}
        </Section>

        {/* ── PRODUIT ───────────────────────────────────────────────────────── */}
        <Section id="produit" title="Cette visite a produit" count={produced.length}>
          {produced.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5 text-[13px]">
              {Object.entries(
                produced.reduce<Record<string, number>>((acc, p) => {
                  acc[p.kind] = (acc[p.kind] ?? 0) + 1
                  return acc
                }, {}),
              ).map(([kind, n]) => (
                <span key={kind} className="rounded-full border px-2.5 py-0.5">
                  {n} {KIND_PLURAL[kind]?.[n > 1 ? 1 : 0] ?? kind}
                </span>
              ))}
            </div>
          )}
          {produced.length === 0 ? (
            <Empty
              title="Rien n’est encore sorti de cette visite."
              body="Aucun objet du chantier ne peut être rattaché à ce récit de façon démontrable. Concrétisez une ligne du compte-rendu, et elle apparaîtra ici avec sa provenance."
            />
          ) : (
            <div className="space-y-px">
              {produced.map((p) => (
                <Line
                  key={`${p.kind}:${p.id}`}
                  tag={PRODUCED_FR[p.kind] ?? p.kind}
                  label={p.label}
                  why={p.why.label}
                >
                  {/* Le 4ᵉ maillon — et son absence est dite, jamais comblée. */}
                  {p.evidence ? (
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      Preuve d’origine : {KIND_FR[p.evidence.capture_kind]?.toLowerCase() ?? p.evidence.capture_kind} du{' '}
                      {frDate(p.evidence.captured_at)} — «&nbsp;{p.evidence.text}&nbsp;»
                    </p>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      Née de l’analyse de toute la visite : aucune preuve unique n’est démontrable.
                    </p>
                  )}
                </Line>
              ))}
            </div>
          )}
          {limits.historicalAttributions > 0 && (
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              {limits.historicalAttributions} objet
              {limits.historicalAttributions > 1 ? 's portent' : ' porte'} le lien de ce compte-rendu sans qu’on puisse
              prouver qu’il en est né. Il n’est pas compté ici.
            </p>
          )}
        </Section>

        {/* ── ÉCARTÉ — montrer ses écarts, c'est ce qui rend crédible ───────── */}
        <Section id="ecarte" title="Ce qui n’a pas été retenu" count={ecarteTotal} replie>
          {ecarteTotal === 0 ? (
            <Empty
              title="Rien n’a été mis de côté."
              body="Tout ce qui a été capté ou proposé est encore en jeu. Cette section se remplira au premier arbitrage."
            />
          ) : (
            <div className="space-y-px">
              {ignored.captures.map((c) => (
                <Line key={c.id} tag={KIND_FR[c.kind] ?? c.kind} label={c.body?.trim() || 'Capture sans texte'} why={c.why.label} muted />
              ))}
              {ignored.byHuman.map((p) => (
                <Line key={p.id} tag={p.type} label={p.label} why={p.why.label} muted />
              ))}
              {ignored.superseded.map((p) => (
                <Line key={p.id} tag={p.type} label={p.label} why={p.why.label} muted />
              ))}
            </div>
          )}
        </Section>

        <p className="border-t pt-6 text-[13px] leading-relaxed text-muted-foreground">
          Un intervenant n’a pas encore de lien prouvé avec la visite qui l’a fait connaître. Ce chaînon manque, et il
          n’est pas simulé.
        </p>
      </div>

      {/* Le panneau est modal : la page ne bouge pas dessous, et la position de
          lecture est retrouvée telle quelle à la fermeture. */}
      <Sheet open={openCapture !== null} onOpenChange={(o) => { if (!o) setOpenCapture(null) }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {openCapture && (
            <EvidencePanel
              capture={openCapture}
              media={media[openCapture.id] ?? null}
              reportId={narrative.reportId}
              canPromote={canPromote}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ── SOMMAIRE — collant, il dit où on en est sans jamais reprendre la main ────

function Sommaire({ active, counts }: { active: string; counts: Record<string, number> }) {
  return (
    <nav
      aria-label="Sommaire du récit"
      className="sticky top-0 z-30 -mx-4 border-b bg-background/90 px-4 py-2 backdrop-blur lg:static lg:mx-0 lg:rounded-xl lg:border lg:bg-card lg:p-3 lg:backdrop-blur-none"
    >
      <p className="hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground lg:mb-1.5 lg:block">
        Visite
      </p>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible">
        {SOMMAIRE.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? 'true' : undefined}
              className={`flex items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-[13px] transition-colors ${
                active === s.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span
                aria-hidden
                className={`hidden h-1.5 w-1.5 shrink-0 rounded-full lg:block ${
                  active === s.id ? 'bg-foreground' : 'bg-muted-foreground/30'
                }`}
              />
              <span className="flex-1">{s.label}</span>
              {counts[s.id] !== undefined && counts[s.id]! > 0 && (
                <span className="tabular-nums text-[12px] text-muted-foreground">{counts[s.id]}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ── SECTION REPLIABLE ────────────────────────────────────────────────────────

function Section({
  id,
  title,
  count,
  replie,
  children,
}: {
  id: string
  title: string
  count: number | null
  /** Replié d'entrée : ce qui n'a pas été retenu compte, mais ne doit pas
   *  peser sur la lecture de ce qui l'a été. */
  replie?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!replie)
  return (
    <section id={id} className="scroll-mt-20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group mb-3 flex w-full items-center gap-2 border-b pb-2 text-left"
      >
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {count !== null && <span className="text-[13px] tabular-nums text-muted-foreground">{count}</span>}
        <ChevronDown
          aria-hidden
          className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && children}
    </section>
  )
}

// ── FRISE — le parcours de la visite, heure par heure ────────────────────────

/** Ce que le conducteur a DIT de la pièce au tri. Trois intentions, et trois
 *  seulement : le modèle ne connaît que celles-là, et l'écran ne montre que ce
 *  que le modèle sait démontrer. */
const INTENT_FR: Record<string, string> = {
  action: 'Action', reserve: 'Réserve', follow: 'À suivre',
}

/** Au-delà, la frise devient un mur : on montre le début, et on dit combien il
 *  reste. « Voir tout » n'ouvre pas une page — il déplie sur place. */
const APERCU = 6

function Timeline({
  captures,
  media,
  lastSeen,
  onOpen,
}: {
  captures: NarrativeCapture[]
  media: CaptureMedia
  lastSeen: string | null
  onOpen: (c: NarrativeCapture) => void
}) {
  const [tout, setTout] = useState(false)
  const visibles = tout ? captures : captures.slice(0, APERCU)
  const restant = captures.length - visibles.length

  return (
    <>
      <ol className="relative space-y-0.5 border-l pl-0">
        {visibles.map((c, i) => {
          // UNE VISITE EST FIGÉE, SON DOSSIER NE L'EST PAS. Une pièce versée
          // après coup n'est pas une capture terrain : on ne la fond pas dans la
          // frise, on ouvre un nouveau jour et on le dit.
          const jour = frJour(c.addedAt)
          const nouveauJour = i === 0 || frJour(visibles[i - 1]!.addedAt) !== jour
          const Icon = KIND_ICON[c.kind] ?? FileText
          const piece = media[c.id]
          const intent = c.intent ? INTENT_FR[c.intent] : null
          return (
            <li key={c.id} className="relative">
              {nouveauJour && (
                <p className="-ml-px mb-1 mt-3 border-t pl-5 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground first:mt-0 first:border-t-0 first:pt-0">
                  {jour}
                  {c.addedAfterVisit && ' · versé au dossier après la visite'}
                </p>
              )}
              {/* Le point de la frise, posé SUR la ligne. */}
              <span
                aria-hidden
                className={`absolute -left-[5px] top-[19px] h-2 w-2 rounded-full ring-2 ring-background ${
                  c.kept ? 'bg-foreground/50' : 'bg-muted-foreground/30'
                }`}
              />
              <div
                className={`flex items-start gap-2.5 rounded-r-lg py-2 pl-5 pr-2 transition-colors hover:bg-muted/60 ${
                  lastSeen === c.id ? 'bg-muted/50' : ''
                }`}
              >
                <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {frHeure(c.capturedAt)}
                </span>

                {/* La preuve se reconnaît d'un coup d'œil : la photo se voit, le
                    vocal s'écoute sans quitter la frise. */}
                {piece && c.kind === 'photo' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={piece.url}
                    alt=""
                    className="h-9 w-12 shrink-0 rounded border object-cover"
                  />
                ) : piece && (c.kind === 'vocal' || c.kind === 'video') ? (
                  <InlinePlayer url={piece.url} kind={c.kind} />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded border bg-muted/40">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => onOpen(c)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`text-sm ${c.kept ? '' : 'text-muted-foreground line-through'}`}>
                      {c.body?.trim() || KIND_FR[c.kind] || 'Capture'}
                    </span>
                    {intent && (
                      <span className="shrink-0 rounded border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                        {intent}
                      </span>
                    )}
                    {c.addedAfterVisit && (
                      <span className="shrink-0 rounded border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                        Ajouté après
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{c.why.label}</span>
                  {/* D'OÙ VIENT CETTE DATE. Une pièce versée après coup porte deux
                      instants : celui du fait, et celui du dépôt. Les confondre,
                      ou supposer que le premier vient toujours du fichier, serait
                      un petit mensonge répété à chaque ligne. */}
                  {c.addedAfterVisit && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {origineDate(c)} · versée au dossier le {frDateHeureCourte(c.addedAt)}
                    </span>
                  )}
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="mt-2 flex items-center gap-3 pl-5 text-[12px] text-muted-foreground">
        <span>{captures.length} événement{captures.length > 1 ? 's' : ''} au total</span>
        {restant > 0 && (
          <button type="button" onClick={() => setTout(true)} className="underline underline-offset-4">
            Voir tout ({restant} de plus)
          </button>
        )}
      </div>
    </>
  )
}

/** Écouter sans quitter la frise. Le panneau reste là pour la transcription et
 *  la citation — ici, on veut juste entendre. */
function InlinePlayer({ url, kind }: { url: string; kind: string }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [joue, setJoue] = useState(false)

  return (
    <span className="relative shrink-0">
      <audio
        ref={ref}
        src={url}
        preload="none"
        onEnded={() => setJoue(false)}
        onPause={() => setJoue(false)}
        onPlay={() => setJoue(true)}
      >
        <track kind="captions" />
      </audio>
      <button
        type="button"
        onClick={() => {
          const el = ref.current
          if (!el) return
          if (el.paused) void el.play()
          else el.pause()
        }}
        aria-label={joue ? 'Mettre en pause' : `Écouter le ${kind}`}
        className="grid h-9 w-9 place-items-center rounded border bg-background hover:bg-muted"
      >
        {joue ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </span>
  )
}

// ── PANNEAU — la preuve, entière, sans quitter le récit ──────────────────────

function EvidencePanel({
  capture,
  media,
  reportId,
  canPromote,
}: {
  capture: NarrativeCapture
  media: { url: string; mime: string | null } | null
  reportId: string
  canPromote: boolean
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  // Le panneau se recycle d'une preuve à l'autre : sans ce reset, l'état d'une
  // capture déteindrait sur la suivante.
  const shown = useRef(capture.id)
  useEffect(() => {
    if (shown.current !== capture.id) {
      shown.current = capture.id
      setPending(null)
      setDone({})
      setError(null)
    }
  }, [capture.id])

  const phrases = sentences(capture.body)

  const promote = async (text: string, sectionKey: 'resume' | 'a_savoir') => {
    if (pending) return
    setPending(`${sectionKey}:${text}`)
    setError(null)
    const res = await promoteEvidenceToCrAction({ reportId, captureId: capture.id, sectionKey, text })
    setPending(null)
    if (res.ok) setDone((d) => ({ ...d, [text]: sectionKey }))
    else setError(res.error)
  }

  return (
    <div className="space-y-5 p-5">
      <header className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {KIND_FR[capture.kind] ?? capture.kind} · {frHeure(capture.capturedAt)}
        </p>
        <p className="text-sm text-muted-foreground">{capture.why.label}</p>
      </header>

      {/* Écouter, revoir : la preuve elle-même, pas son résumé. */}
      {media && capture.kind === 'vocal' && (
        <audio src={media.url} controls preload="none" className="w-full">
          <track kind="captions" />
        </audio>
      )}
      {media && capture.kind === 'video' && (
        <video src={media.url} controls playsInline className="max-h-72 w-full rounded-lg border bg-black">
          <track kind="captions" />
        </video>
      )}
      {media && capture.kind === 'photo' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt="" className="max-h-80 w-full rounded-lg border object-contain" />
      )}

      {capture.body ? (
        <div className="space-y-1.5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {capture.kind === 'vocal' ? 'Transcription' : 'Texte'}
          </h3>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{capture.body}</p>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {capture.kind === 'vocal'
            ? 'Cet enregistrement n’a pas encore de transcription — il reste écoutable.'
            : 'Cette capture ne porte aucun texte.'}
        </p>
      )}

      {canPromote && phrases.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Citer une phrase dans le compte-rendu
          </h3>
          {phrases.map((phrase) => (
            <div key={phrase} className="rounded-lg border p-2.5">
              <p className="text-[13px] leading-snug">{phrase}</p>
              {done[phrase] ? (
                <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  <Check className="h-3 w-3" aria-hidden />
                  Ajoutée à « {done[phrase] === 'resume' ? 'Résumé' : 'À savoir'} » — sa provenance est inscrite
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <PromoteButton label="Résumé" busy={pending === `resume:${phrase}`} onClick={() => promote(phrase, 'resume')} />
                  <PromoteButton label="À savoir" busy={pending === `a_savoir:${phrase}`} onClick={() => promote(phrase, 'a_savoir')} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!canPromote && (
        <p className="border-t pt-4 text-[13px] text-muted-foreground">
          Le compte-rendu n’est pas ouvert à l’écriture : rouvrez-le pour y citer une preuve.
        </p>
      )}

      {error && <p className="text-[13px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  )
}

function PromoteButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] hover:border-foreground/40 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
      {label}
    </button>
  )
}

// ── PIÈCES COMMUNES ─────────────────────────────────────────────────────────

function Line({
  tag,
  label,
  why,
  muted,
  children,
}: {
  tag?: string
  label: string
  why: string
  muted?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="border-b py-2.5 last:border-0">
      <p className={`text-sm ${muted ? 'text-muted-foreground' : ''}`}>
        {tag && (
          <span className="mr-2 rounded border px-1.5 py-0.5 align-[1px] text-[10px] uppercase tracking-wide text-muted-foreground">
            {tag}
          </span>
        )}
        {label}
      </p>
      {children}
      {/* « Pourquoi est-ce ici ? » — répondu partout, dérivé d'un fait. */}
      <p className="mt-0.5 text-[11px] text-muted-foreground">{why}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

/** L'état vide n'est pas un cas limite : sur les visites réelles, c'est la
 *  norme. Il dit ce qui manque et ce qui le remplirait. */
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-6">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

/** Découpe une transcription en phrases citables. On ne reformule rien : on
 *  propose ce qui a été dit, tel quel. */
function sentences(text: string | null): string[] {
  if (!text) return []
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 12)
}

const frHeure = (iso: string) => iso.slice(11, 16)
const frDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
/** La phrase exacte, selon ce que la base sait — jamais selon ce qu'on
 *  suppose. Sans origine connue, on ne parle que du dépôt. */
function origineDate(c: NarrativeCapture): string {
  switch (c.dateSource) {
    case 'file':
      return `Prise le ${frDateHeureCourte(c.capturedAt)} (date du fichier)`
    case 'visit':
      return 'Date déclarée : jour de la visite'
    case 'today':
      return 'Date déclarée : jour du dépôt'
    case 'chosen':
      return `Date déclarée : ${frDateCourte(c.capturedAt)}`
    default:
      return 'Date d’origine inconnue'
  }
}

const frDateCourte = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
const frDateHeureCourte = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const frJour = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
