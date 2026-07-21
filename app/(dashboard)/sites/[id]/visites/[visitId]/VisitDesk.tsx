'use client'

// LA PAGE DE VISITE COMME BUREAU DE TRAITEMENT (maquette Vincent, 2026-07-22).
//
// « Arrêtons de penser cette page comme un rapport. » Quand Guillaume l'ouvre,
// il doit voir dans cet ordre : ce qui s'est passé · ce que MemorIA en a compris
// · ce qui attend une décision. L'audit — ignoré, obsolète, provenance — est
// précieux mais descend en bas, à un clic.
//
// Deux règles tenues malgré la maquette :
//   · les étiquettes de la frise viennent du MODÈLE (action, réserve, à suivre).
//     « Organisation », « Point de vigilance » et « Décision » étaient des
//     exemples graphiques ; les afficher serait un fait non traçable.
//   · aucun visage n'est inventé : la maquette empile des avatars par
//     proposition, or rien ne relie une proposition à des personnes.

import { useState } from 'react'
import Link from 'next/link'
import {
  Camera, Check, ChevronDown, ChevronRight, FileText, Loader2, MapPin, Mic,
  Paperclip, Play, Plus, ShieldAlert, Sparkles, Video,
} from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { promoteEvidenceToCrAction } from '@/app/(field)/m/visite/[reportId]/cr/promotion-actions'
import type { VisitNarrative, NarrativeCapture, NarrativeProposal } from '@/lib/db/visit-narrative'
import { NOUMEA_TZ } from '@/lib/time/local-date'

export type CaptureMedia = Record<string, { url: string; mime: string | null }>

const KIND_ICON: Record<string, typeof Mic> = {
  vocal: Mic, photo: Camera, video: Video, note: FileText, position: MapPin, verification: Check,
}
const KIND_FR: Record<string, string> = {
  vocal: 'Vocal', photo: 'Photo', video: 'Vidéo', note: 'Note',
  position: 'Position', verification: 'Vérification',
}
/** Les trois seules intentions que le tri connaît. Rien d'autre n'est affichable. */
const INTENT_FR: Record<string, string> = { action: 'Action', reserve: 'Réserve', follow: 'À suivre' }

/** UNE COULEUR PAR FAMILLE, tenue d'un bout à l'autre de la page : la même
 *  teinte porte la carte, la pastille d'arbitrage et l'étiquette. C'est ce qui
 *  permet de retrouver « les échéances » sans lire les mots. */
type Famille = { cle: string; label: string; pluriel: string; icone: typeof Sparkles; teinte: string; puce: string }
const FAMILLES: Famille[] = [
  { cle: 'action', label: 'Actions', pluriel: 'actions', icone: Check, teinte: 'text-amber-600 dark:text-amber-400', puce: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  { cle: 'deadline', label: 'Échéances', pluriel: 'échéances', icone: FileText, teinte: 'text-sky-600 dark:text-sky-400', puce: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' },
  { cle: 'stakeholder', label: 'Intervenants', pluriel: 'intervenants', icone: Check, teinte: 'text-emerald-600 dark:text-emerald-400', puce: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  { cle: 'knowledge', label: 'À savoir', pluriel: 'connaissances', icone: Sparkles, teinte: 'text-violet-600 dark:text-violet-400', puce: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' },
  { cle: 'vigilance', label: 'Vigilances', pluriel: 'vigilances', icone: ShieldAlert, teinte: 'text-rose-600 dark:text-rose-400', puce: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' },
  { cle: 'decision', label: 'Décisions', pluriel: 'décisions', icone: Check, teinte: 'text-indigo-600 dark:text-indigo-400', puce: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' },
]
const famille = (cle: string) => FAMILLES.find((f) => f.cle === cle)

export function VisitDesk({
  narrative,
  media,
  canPromote,
  crHref,
}: {
  narrative: VisitNarrative
  media: CaptureMedia
  canPromote: boolean
  crHref: string | null
}) {
  const [preuve, setPreuve] = useState<NarrativeCapture | null>(null)
  const { captured, understood, produced, ignored } = narrative

  const terrain = captured.filter((c) => !c.addedAfterVisit)
  const versees = captured.filter((c) => c.addedAfterVisit)
  const enAttente = understood.filter((p) => p.status === 'proposed')
  const ecarteTotal = ignored.byHuman.length + ignored.superseded.length + ignored.captures.length

  return (
    <div className="space-y-4">
      <Chronologie captures={terrain} media={media} onOuvrir={setPreuve} />
      <Compris propositions={understood} crHref={crHref} />
      <EnAttente propositions={enAttente} crHref={crHref} />
      <Produit produced={produced} />
      <PiecesVersees pieces={versees} media={media} onOuvrir={setPreuve} />
      <NonRetenu ignored={ignored} total={ecarteTotal} />

      <p className="flex items-start gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Toutes les informations sont tracées et démontrables. Aucune interprétation n’est créée sans preuve.
      </p>

      <Sheet open={preuve !== null} onOpenChange={(o) => { if (!o) setPreuve(null) }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {preuve && (
            <PanneauPreuve
              capture={preuve}
              media={media[preuve.id] ?? null}
              reportId={narrative.reportId}
              canPromote={canPromote}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ── CARTE ────────────────────────────────────────────────────────────────────

function Carte({
  titre,
  compte,
  action,
  children,
}: {
  titre: string
  compte?: number | string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 pt-4">
        <h2 className="text-[15px] font-semibold">{titre}</h2>
        {compte !== undefined && <span className="text-[13px] text-muted-foreground">{compte}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  )
}

const Lien = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="text-[13px] font-medium text-primary hover:underline">
    {children}
  </Link>
)

// ── CE QUI S'EST PASSÉ — la frise, en aperçu horizontal ─────────────────────

function Chronologie({
  captures,
  media,
  onOuvrir,
}: {
  captures: NarrativeCapture[]
  media: CaptureMedia
  onOuvrir: (c: NarrativeCapture) => void
}) {
  const [tout, setTout] = useState(false)
  const APERCU = 4
  const visibles = tout ? captures : captures.slice(0, APERCU)
  const restant = captures.length - visibles.length

  return (
    <Carte
      titre="Ce qui s’est passé pendant cette visite"
      action={
        captures.length > APERCU && !tout ? (
          <button type="button" onClick={() => setTout(true)} className="text-[13px] font-medium text-primary hover:underline">
            Voir toute la chronologie
          </button>
        ) : undefined
      }
    >
      {captures.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Cette visite n’a laissé ni vocal, ni photo, ni note. Il n’y a rien à explorer — c’est un fait, pas un manque.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {visibles.map((c) => (
            <Moment key={c.id} capture={c} piece={media[c.id]} onOuvrir={onOuvrir} />
          ))}
          {restant > 0 && (
            <button
              type="button"
              onClick={() => setTout(true)}
              className="flex w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[12px] text-muted-foreground hover:bg-muted"
            >
              <span className="text-sm font-medium">+{restant}</span>
              événement{restant > 1 ? 's' : ''} suivant{restant > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
    </Carte>
  )
}

function Moment({
  capture,
  piece,
  onOuvrir,
}: {
  capture: NarrativeCapture
  piece?: { url: string; mime: string | null }
  onOuvrir: (c: NarrativeCapture) => void
}) {
  const Icon = KIND_ICON[capture.kind] ?? FileText
  const intent = capture.intent ? INTENT_FR[capture.intent] : null
  return (
    <div className="w-52 shrink-0">
      <div className="mb-1.5 flex items-center gap-1.5 border-t pt-1.5">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{heure(capture.capturedAt)}</span>
        <Icon className="h-3 w-3 text-muted-foreground" aria-hidden />
      </div>
      <button
        type="button"
        onClick={() => onOuvrir(capture)}
        className="w-full rounded-lg border bg-background p-2 text-left hover:bg-muted/50"
      >
        {piece && capture.kind === 'photo' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={piece.url} alt="" className="mb-2 h-24 w-full rounded object-cover" />
        ) : piece ? (
          <span className="mb-2 flex h-24 w-full items-center justify-center rounded bg-muted">
            <Play className="h-5 w-5 text-foreground/70" aria-hidden />
          </span>
        ) : null}
        <span className="line-clamp-2 block text-[13px] leading-snug">
          {capture.body?.trim() || KIND_FR[capture.kind] || 'Capture'}
        </span>
        {intent && (
          <span className="mt-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
            {intent}
          </span>
        )}
      </button>
    </div>
  )
}

// ── CE QUE MEMORIA A COMPRIS — par famille, jamais 44 lignes à plat ─────────

function Compris({ propositions, crHref }: { propositions: NarrativeProposal[]; crHref: string | null }) {
  const presentes = FAMILLES.map((f) => ({ f, items: propositions.filter((p) => p.type === f.cle) })).filter(
    (x) => x.items.length > 0,
  )

  return (
    <Carte
      titre="Ce que MemorIA a compris"
      compte={`${propositions.length} proposition${propositions.length > 1 ? 's' : ''}`}
      action={crHref ? <Lien href={crHref}>Voir tout</Lien> : undefined}
    >
      {presentes.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          MemorIA n’a rien proposé pour cette visite. Sans matière parlée ou écrite, il n’y a rien à comprendre.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {presentes.map(({ f, items }) => (
            <div key={f.cle} className="rounded-lg border">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <f.icone className={`h-4 w-4 ${f.teinte}`} aria-hidden />
                <span className="text-[13px] font-semibold">{f.label}</span>
                <span className={`ml-auto rounded-full px-1.5 text-[12px] font-medium tabular-nums ${f.puce}`}>
                  {items.length}
                </span>
              </div>
              <ul className="space-y-1.5 px-3 py-2.5">
                {items.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <span className="line-clamp-2 block text-[13px] leading-snug">{p.label}</span>
                    {p.rationale && (
                      <span className="line-clamp-1 block text-[11px] text-muted-foreground">{p.rationale}</span>
                    )}
                  </li>
                ))}
                {items.length > 4 && (
                  <li className="text-[12px] text-muted-foreground">
                    + {items.length - 4} autre{items.length - 4 > 1 ? 's' : ''} {f.pluriel}
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Carte>
  )
}

// ── LE VRAI TRAVAIL — ce qui demande une décision ───────────────────────────

function EnAttente({ propositions, crHref }: { propositions: NarrativeProposal[]; crHref: string | null }) {
  const APERCU = 3
  const visibles = propositions.slice(0, APERCU)
  const restant = propositions.length - visibles.length

  if (propositions.length === 0) {
    return (
      <Carte titre="Décisions en attente d’arbitrage">
        <p className="text-[13px] text-muted-foreground">
          Rien n’attend votre arbitrage. Tout ce que MemorIA a proposé a été tranché.
        </p>
      </Carte>
    )
  }

  return (
    <Carte titre="Décisions en attente d’arbitrage">
      <ul className="divide-y">
        {visibles.map((p) => {
          const f = famille(p.type)
          return (
            <li key={p.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0">
              <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${f?.puce ?? 'bg-muted'}`}>
                {f?.label ?? p.type}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium leading-snug">{p.label}</p>
                {p.rationale && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{p.rationale}</p>}
                {/* La preuve derrière la lecture : appuyée, ou isolée. */}
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  {p.sourceCount > 0
                    ? `Sources : ${p.sourceCount} élément${p.sourceCount > 1 ? 's' : ''}`
                    : 'Née de l’analyse d’ensemble — aucune source unique'}
                </p>
              </div>
              {crHref && (
                <Link
                  href={crHref}
                  className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
                >
                  Arbitrer
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      {restant > 0 && crHref && (
        <p className="pt-3 text-center">
          <Lien href={crHref}>Voir les {restant} autres propositions en attente →</Lien>
        </p>
      )}
    </Carte>
  )
}

// ── CE QUE LA VISITE A PRODUIT — replié quand il n'y a rien ─────────────────

function Produit({ produced }: { produced: VisitNarrative['produced'] }) {
  const [ouvert, setOuvert] = useState(produced.length > 0)
  if (produced.length === 0) {
    return (
      <section className="rounded-xl border bg-card px-4 py-3">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Cette visite n’a encore rien produit.</span> Concrétisez une
          ligne du compte-rendu, et l’objet apparaîtra ici avec sa provenance.
        </p>
      </section>
    )
  }
  return (
    <section className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <h2 className="text-[15px] font-semibold">Cette visite a produit</h2>
        <span className="text-[13px] text-muted-foreground">{produced.length}</span>
        <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${ouvert ? '' : '-rotate-90'}`} aria-hidden />
      </button>
      {ouvert && (
        <ul className="divide-y px-4 pb-4">
          {produced.map((p) => (
            <li key={`${p.kind}:${p.id}`} className="py-2.5 first:pt-0">
              <p className="text-[13.5px]">{p.label}</p>
              <p className="text-[11.5px] text-muted-foreground">{p.why.label}</p>
              <p className="text-[11.5px] text-muted-foreground">
                {p.evidence
                  ? `Preuve d’origine : ${p.evidence.capture_kind} — « ${p.evidence.text} »`
                  : 'Née de l’analyse de toute la visite : aucune preuve unique n’est démontrable.'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── PIÈCES VERSÉES APRÈS LA VISITE ──────────────────────────────────────────

function PiecesVersees({
  pieces,
  media,
  onOuvrir,
}: {
  pieces: NarrativeCapture[]
  media: CaptureMedia
  onOuvrir: (c: NarrativeCapture) => void
}) {
  if (pieces.length === 0) return null
  return (
    <Carte titre="Pièces versées après la visite" compte={pieces.length}>
      <ul className="divide-y">
        {pieces.map((c) => {
          const Icon = KIND_ICON[c.kind] ?? Paperclip
          const piece = media[c.id]
          return (
            <li key={c.id} className="flex items-center gap-3 py-2.5 first:pt-0">
              {piece && c.kind === 'photo' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={piece.url} alt="" className="h-10 w-14 shrink-0 rounded border object-cover" />
              ) : (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded border bg-muted/40">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                </span>
              )}
              <button type="button" onClick={() => onOuvrir(c)} className="min-w-0 flex-1 text-left">
                <span className="block text-[11.5px] text-muted-foreground">{KIND_FR[c.kind] ?? c.kind}</span>
                <span className="line-clamp-1 block text-[13.5px]">{c.body?.trim() || 'Sans texte'}</span>
                {/* Deux instants, jamais confondus. */}
                <span className="block text-[11.5px] text-muted-foreground">
                  {origineDate(c)} · versée au dossier le {dateHeure(c.addedAt)}
                </span>
              </button>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                Ajoutée après
              </span>
            </li>
          )
        })}
      </ul>
    </Carte>
  )
}

// ── AUDIT — précieux, mais pas au centre de l'écran ─────────────────────────

function NonRetenu({ ignored, total }: { ignored: VisitNarrative['ignored']; total: number }) {
  const [ouvert, setOuvert] = useState(false)
  return (
    <section className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <h2 className="text-[15px] font-semibold">Ce qui n’a pas été retenu</h2>
        <span className="text-[13px] text-muted-foreground">{total} élément{total > 1 ? 's' : ''}</span>
        <span className="ml-auto flex items-center gap-1 text-[13px] font-medium text-primary">
          Voir les détails
          <ChevronDown className={`h-4 w-4 transition-transform ${ouvert ? '' : '-rotate-90'}`} aria-hidden />
        </span>
      </button>
      {ouvert && (
        <div className="space-y-px px-4 pb-4">
          {total === 0 && (
            <p className="text-[13px] text-muted-foreground">
              Rien n’a été mis de côté : tout ce qui a été capté ou proposé est encore en jeu.
            </p>
          )}
          {[...ignored.captures.map((c) => ({ id: c.id, label: c.body?.trim() || 'Capture sans texte', why: c.why.label })),
            ...ignored.byHuman.map((p) => ({ id: p.id, label: p.label, why: p.why.label })),
            ...ignored.superseded.map((p) => ({ id: p.id, label: p.label, why: p.why.label }))].map((x) => (
            <div key={x.id} className="border-b py-2 last:border-0">
              <p className="text-[13px] text-muted-foreground">{x.label}</p>
              <p className="text-[11.5px] text-muted-foreground">{x.why}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── PANNEAU DE PREUVE — écouter, lire, citer, sans quitter la page ──────────

function PanneauPreuve({
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
  const phrases = decouper(capture.body)

  const promouvoir = async (text: string, sectionKey: 'resume' | 'a_savoir') => {
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
      <header>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {KIND_FR[capture.kind] ?? capture.kind} · {heure(capture.capturedAt)}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{capture.why.label}</p>
        {capture.addedAfterVisit && (
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {origineDate(capture)} · versée au dossier le {dateHeure(capture.addedAt)}
          </p>
        )}
      </header>

      {media && capture.kind === 'vocal' && (
        <audio src={media.url} controls preload="none" className="w-full"><track kind="captions" /></audio>
      )}
      {media && capture.kind === 'video' && (
        <video src={media.url} controls playsInline className="max-h-72 w-full rounded-lg border bg-black"><track kind="captions" /></video>
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
            : 'Cette pièce ne porte aucun texte.'}
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
                  <BoutonCiter label="Résumé" busy={pending === `resume:${phrase}`} onClick={() => promouvoir(phrase, 'resume')} />
                  <BoutonCiter label="À savoir" busy={pending === `a_savoir:${phrase}`} onClick={() => promouvoir(phrase, 'a_savoir')} />
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

function BoutonCiter({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
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

// ── AIDES ───────────────────────────────────────────────────────────────────

/** Découpe une transcription en phrases citables. On ne reformule rien. */
function decouper(text: string | null): string[] {
  if (!text) return []
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 12)
}

/** La phrase exacte, selon ce que la base sait — jamais selon ce qu'on suppose. */
export function origineDate(c: NarrativeCapture): string {
  switch (c.dateSource) {
    case 'file': return `Prise le ${dateHeure(c.capturedAt)} (date du fichier)`
    case 'visit': return 'Date déclarée : jour de la visite'
    case 'today': return 'Date déclarée : jour du dépôt'
    case 'chosen': return `Date déclarée : ${dateCourte(c.capturedAt)}`
    default: return 'Date d’origine inconnue'
  }
}

// Le rendu serveur tourne en UTC : sans `timeZone`, une capture de 09:15 à
// Nouméa s'affichait 22:15 la veille. Le fuseau de l'organisation est donc
// passé EXPLICITEMENT partout — c'est le meme ecueil que `todayLocalIso`.
const heure = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { timeZone: NOUMEA_TZ, hour: '2-digit', minute: '2-digit' })
const dateCourte = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long' })
const dateHeure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

export { ChevronRight }
