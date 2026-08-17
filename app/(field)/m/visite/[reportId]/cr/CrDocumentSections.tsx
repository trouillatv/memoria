'use client'

// LE CR QUE L'ON CORRIGE (Étape A).
//
// Guillaume : « MemorIA propose → je corrige → je valide. » Cet écran fait le
// deuxième temps, et lui seul. Les sept sections du compte-rendu deviennent
// éditables, une par une, tant que le document est un BROUILLON.
//
// L'ÉDITION NE RECONSTRUIT PLUS LA PAGE (Vincent, 2026-07-21). Enregistrer
// passait par `revalidatePath` : la page entière se refabriquait et le
// conducteur repartait en haut — sur mobile, corriger la sixième section
// devenait pénible, et le bloc semblait avoir disparu. Désormais les deux
// gestes rendent le document PERSISTÉ, et l'écran adopte cette réponse
// localement. Rien d'autre ne bouge : ni la position, ni les autres sections,
// ni l'analyse (qui n'est plus montée en auto ici).
//
// Ce qu'il ne fait pas, volontairement :
//   - il ne crée ni ne modifie AUCUN objet du chantier (une action corrigée ici
//     reste du texte : le document raconte, les objets vivent ailleurs) ;
//   - il ne valide pas encore (Étape B) ;
//   - il ne touche pas au PDF, qui continue de sortir par l'ancien chemin.
//
// « Revenir à la proposition » n'apparaît QUE si MemorIA a réellement proposé
// quelque chose pour cette section, et seulement si le texte a bougé depuis.
// Un bouton qui ne restaurerait rien — ou qui ramènerait au vide — mentirait.

import { useState } from 'react'
import { Pencil, RotateCcw, Check, X, Loader2, Lock, Plus, Circle, Star } from 'lucide-react'
import type { ReportDocumentSection, ReportDocumentStatus } from '@/types/db'
import type { CaptureTriageIntent } from '@/lib/db/visit-captures'
import {
  saveCrSectionAction,
  restoreCrSectionAction,
  finalizeCrAction,
  reopenCrAction,
  setCaptureIncludedInCrAction,
  setCapturePhotoTierAction,
  type PersistedCrDocument,
} from './cr-document-actions'
import { updateVisitPhotoCaptionAction } from '@/app/(dashboard)/sites/[id]/visites/[visitId]/photo-actions'

/** Ce que chaque famille narrative est devenue dans le chantier — le liant
 *  entre le récit (« Actions ») et les objets réels (« 2 actions créées »). */
export type ConcretisationSummary = Record<string, { created: number; pending: number }>

/**
 * Une photo candidate à la sélection éditoriale du CR (Vincent, 2026-08-17,
 * étendu 2026-08-18 avec `tier`). `includedInCr` et `tier` sont les DEUX
 * données que cet écran modifie ; `triageIntent` n'est affiché qu'à titre
 * INFORMATIF (qualification métier posée au débrief).
 *
 * `tier` est la valeur RÉSOLUE (choix humain explicite ou poids automatique) —
 * calculée côté page par `selectCrPhotos`, jamais recalculée ici.
 */
export interface CrPhotoCandidate {
  id: string
  url: string
  caption: string | null
  includedInCr: boolean
  triageIntent: CaptureTriageIntent
  tier: 'key' | 'reportage'
}

export function CrDocumentSections({
  reportId,
  sections: initialSections,
  status: initialStatus,
  onEdited,
  concretisation,
  photos,
}: {
  reportId: string
  sections: ReportDocumentSection[]
  status: ReportDocumentStatus
  /** Résumé de concrétisation par clé de section (actions, decisions). */
  concretisation?: ConcretisationSummary
  /**
   * LE TEXTE VIENT DE CHANGER, ET QUELQU'UN D'AUTRE DOIT LE SAVOIR.
   *
   * Ce qui se prépare à partir de ce document — la concrétisation — est calculé
   * en relisant CE texte. Corriger une section après cette préparation la rend
   * donc périmée, sans que rien ne le dise. Ce rappel laisse le voisin réagir.
   *
   * OPTIONNEL : là où personne n'écoute (mobile, ancienne page de bureau), rien
   * ne change. Il ne porte pas le document — seulement le fait qu'il a bougé.
   */
  onEdited?: () => void
  /** Photos candidates à la sélection éditoriale — absent/vide : pas de section. */
  photos?: CrPhotoCandidate[]
}) {
  // La vérité affichée vient du serveur, puis de CE QU'IL A ÉCRIT à chaque
  // geste. Pas de rafraîchissement global, donc pas de saut en haut de page.
  const [sections, setSections] = useState(initialSections)
  const [status, setStatus] = useState(initialStatus)
  const editable = status === 'draft'
  // Rubriques que l'utilisateur a choisi de compléter (vides au départ, ouvertes
  // pour saisie). Une fois remplies, elles rejoignent naturellement les pleines.
  const [openedKeys, setOpenedKeys] = useState<string[]>([])

  // Un seul point de passage : `adopt` est appelé aussi bien après une
  // correction qu'après une restauration — les deux changent le texte, donc les
  // deux périment ce qui en avait été déduit.
  const adopt = (doc: PersistedCrDocument) => {
    setSections(doc.sections)
    setStatus(doc.status)
    onEdited?.()
  }

  /** LE TEXTE S'AFFICHE AVANT LE RÉSEAU (Vincent, 2026-07-21). Attendre deux
   *  secondes avant de voir sa propre correction donne l'impression d'un écran
   *  figé. On applique localement tout de suite ; le serveur confirme ensuite,
   *  et sa réponse fait autorité (ou rend la main en cas d'échec). */
  const applyLocal = (key: string, content: string) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, content } : s)))
  }

  return (
    <section className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Le compte-rendu</h2>
        {editable ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            Brouillon — non validé
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden />
            {status === 'exported' ? 'Exporté' : 'Validé'}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {editable
          ? 'MemorIA a proposé ce texte. Corrigez ce qui doit l’être — vos corrections sont conservées.'
          : 'Ce compte-rendu est figé : il ne se modifie plus.'}
      </p>

      {(() => {
        // Une rubrique sans matière n'alourdit plus la lecture : en lecture seule
        // elle disparaît ; en brouillon, elle se replie en bouton « compléter »
        // (l'ajout reste possible, sans enfiler des « Rien à ce sujet »).
        const filled = sections.filter((s) => s.content.trim().length > 0)
        const empties = sections.filter((s) => s.content.trim().length === 0)
        const opened = empties.filter((s) => openedKeys.includes(s.key))
        const closed = empties.filter((s) => !openedKeys.includes(s.key))
        return (
          <div className="mt-3 space-y-2.5">
            {filled.map((section) => (
              <SectionRow
                key={section.key}
                reportId={reportId}
                section={section}
                editable={editable}
                onPersisted={adopt}
                onApplyLocal={applyLocal}
                summary={concretisation?.[section.key]}
              />
            ))}

            {editable && opened.map((section) => (
              <SectionRow
                key={section.key}
                reportId={reportId}
                section={section}
                editable
                onPersisted={adopt}
                onApplyLocal={applyLocal}
                startEditing
              />
            ))}

            {editable && closed.length > 0 && (
              <div className="rounded-xl border border-dashed bg-muted/20 p-3">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Compléter le compte-rendu
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {closed.map((section) => (
                    <button
                      key={section.key}
                      type="button"
                      onClick={() => setOpenedKeys((k) => [...k, section.key])}
                      className="inline-flex items-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground active:bg-accent"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> {section.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {photos && photos.length > 0 && (
        <PhotoSelectionSection reportId={reportId} initialPhotos={photos} editable={editable} />
      )}

      <Lifecycle reportId={reportId} status={status} onChanged={setStatus} />
    </section>
  )
}

// ── SÉLECTION ÉDITORIALE DES PHOTOS (Vincent, 2026-08-17, étendu 2026-08-18) ─
//
// Deux décisions, jamais confondues :
//   - AU DÉBRIEF, le conducteur qualifie une capture (métier — 📚/👀/⚠️/✅) :
//     c'est le badge `TRIAGE_BADGE`, affiché tel quel, jamais recalculé ici.
//   - ICI, il choisit ce qui doit apparaître dans LE DOCUMENT, et COMMENT :
//     Hors CR (absente du PDF) → Reportage (vignette) → Photo clé (grande,
//     avec légende) — un CYCLE à un clic/tap, jamais de glisser-déposer.
// Toute photo gardée entre par défaut en Reportage. Aucun plafond invisible —
// au-delà d'un certain nombre, un avertissement se dit, rien ne se coupe
// silencieusement.

// Seuil purement INDICATIF (aligné sur CR_REPORTAGE_PHOTO_CAP, lib/db/visits.ts)
// : au-delà, le reportage devient volumineux. Ce n'est jamais une coupure.
const PHOTO_COUNT_WARNING_THRESHOLD = 30

const TRIAGE_BADGE: Partial<Record<NonNullable<CaptureTriageIntent>, string>> = {
  action: 'Action',
  reserve: 'Réserve',
  follow: 'À surveiller',
  memoire: 'Mémoire',
}

type PhotoStatus = 'out' | 'reportage' | 'key'

const STATUS_LABEL: Record<PhotoStatus, string> = {
  out: 'Hors CR',
  reportage: 'Reportage',
  key: 'Clé',
}

const STATUS_STYLE: Record<PhotoStatus, string> = {
  out: 'bg-white/80 text-foreground',
  reportage: 'bg-sky-600 text-white',
  key: 'bg-amber-500 text-white',
}

/** Le cycle, dans un seul sens : Hors CR → Reportage → Clé → Hors CR. */
const NEXT_STATUS: Record<PhotoStatus, PhotoStatus> = { out: 'reportage', reportage: 'key', key: 'out' }

function PhotoSelectionSection({
  reportId,
  initialPhotos,
  editable,
}: {
  reportId: string
  initialPhotos: CrPhotoCandidate[]
  editable: boolean
}) {
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialPhotos.map((p) => [p.id, p.includedInCr])),
  )
  const [tier, setTier] = useState<Record<string, 'key' | 'reportage'>>(() =>
    Object.fromEntries(initialPhotos.map((p) => [p.id, p.tier])),
  )
  const [captions, setCaptions] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(initialPhotos.map((p) => [p.id, p.caption])),
  )
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<CrPhotoCandidate | null>(null)
  const [editingCaption, setEditingCaption] = useState(false)
  const [captionDraft, setCaptionDraft] = useState('')
  const [savingCaption, setSavingCaption] = useState(false)

  const statusOf = (id: string): PhotoStatus => (included[id] ? tier[id] : 'out')

  const selectedCount = initialPhotos.filter((p) => included[p.id]).length
  const total = initialPhotos.length

  const setAll = async (value: boolean) => {
    if (!editable) return
    const ids = initialPhotos.filter((p) => included[p.id] !== value).map((p) => p.id)
    if (ids.length === 0) return
    setIncluded((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = value
      return next
    })
    setError(null)
    const results = await Promise.all(ids.map((id) => setCaptureIncludedInCrAction(reportId, id, value)))
    const failedIds = ids.filter((_, i) => !results[i]!.ok)
    if (failedIds.length > 0) {
      setIncluded((prev) => {
        const next = { ...prev }
        for (const id of failedIds) next[id] = !value
        return next
      })
      setError('Certaines photos n’ont pas pu être mises à jour.')
    }
  }

  /** Un clic = un cran du cycle Hors CR → Reportage → Clé → Hors CR. */
  const cycleStatus = async (photo: CrPhotoCandidate) => {
    if (!editable || pendingIds.has(photo.id)) return
    const current = statusOf(photo.id)
    const next = NEXT_STATUS[current]
    const prevIncluded = included[photo.id]
    const prevTier = tier[photo.id]

    // Réponse immédiate à l'écran ; le serveur confirme ensuite.
    setIncluded((prev) => ({ ...prev, [photo.id]: next !== 'out' }))
    if (next !== 'out') setTier((prev) => ({ ...prev, [photo.id]: next }))
    setPendingIds((prev) => new Set(prev).add(photo.id))
    setError(null)

    const calls: Promise<{ ok: boolean; error?: string }>[] = []
    if ((next !== 'out') !== prevIncluded) calls.push(setCaptureIncludedInCrAction(reportId, photo.id, next !== 'out'))
    if (next !== 'out' && next !== prevTier) calls.push(setCapturePhotoTierAction(reportId, photo.id, next))

    const results = await Promise.all(calls)
    setPendingIds((prev) => {
      const p = new Set(prev)
      p.delete(photo.id)
      return p
    })
    const failed = results.find((r) => !r.ok)
    if (failed) {
      setIncluded((prev) => ({ ...prev, [photo.id]: prevIncluded }))
      setTier((prev) => ({ ...prev, [photo.id]: prevTier }))
      setError(failed.error ?? 'Mise à jour impossible')
    }
  }

  const openViewer = (photo: CrPhotoCandidate) => {
    setViewing(photo)
    setEditingCaption(false)
  }

  /** Clic direct sur la légende sous la vignette (Vincent, 2026-08-18) : ouvre
   *  la visionneuse déjà en édition — la légende du CR se corrige ICI, sans
   *  quitter la composition pour retrouver la photo ailleurs dans MemorIA. */
  const openCaptionEditor = (photo: CrPhotoCandidate) => {
    setViewing(photo)
    setCaptionDraft(captions[photo.id] ?? '')
    setEditingCaption(true)
  }

  const startEditCaption = () => {
    if (!viewing) return
    setCaptionDraft(captions[viewing.id] ?? '')
    setEditingCaption(true)
  }

  const saveCaption = async () => {
    if (!viewing || savingCaption) return
    setSavingCaption(true)
    setError(null)
    const res = await updateVisitPhotoCaptionAction({
      report_id: reportId,
      capture_id: viewing.id,
      caption: captionDraft,
    })
    setSavingCaption(false)
    if (res.ok) {
      setCaptions((prev) => ({ ...prev, [viewing.id]: captionDraft.trim() || null }))
      setEditingCaption(false)
    } else {
      setError(res.error)
    }
  }

  return (
    <section className="mt-3.5 border-t pt-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Photos du compte-rendu</h3>
        <span className="text-[12px] text-muted-foreground">{selectedCount} / {total} dans le document</span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Appuyez sur le statut d’une photo pour la faire tourner : Hors CR → Reportage → Photo clé.
        Une photo clé s’affiche en grand avec sa légende ; une photo en reportage reste en vignette.
      </p>

      {editable && (
        <div className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAll(true)}
            className="text-[12px] font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
          >
            Tout inclure
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => setAll(false)}
            className="text-[12px] font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
          >
            Tout mettre hors CR
          </button>
        </div>
      )}

      {selectedCount > PHOTO_COUNT_WARNING_THRESHOLD && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {selectedCount} photos sélectionnées — le reportage sera volumineux.
        </p>
      )}

      <div className="mt-2.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
        {initialPhotos.map((photo) => {
          const status = statusOf(photo.id)
          const badge = photo.triageIntent ? TRIAGE_BADGE[photo.triageIntent] : undefined
          const caption = captions[photo.id]
          return (
            <div key={photo.id} className="flex flex-col gap-1">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                <button
                  type="button"
                  onClick={() => openViewer(photo)}
                  className="absolute inset-0"
                  aria-label="Voir la photo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={caption ?? ''}
                    className={`h-full w-full object-cover ${status === 'out' ? 'opacity-40' : ''}`}
                    loading="lazy"
                  />
                </button>
                {badge && (
                  <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {badge}
                  </span>
                )}
                {editable ? (
                  <button
                    type="button"
                    onClick={() => cycleStatus(photo)}
                    disabled={pendingIds.has(photo.id)}
                    aria-label={`Statut : ${STATUS_LABEL[status]} — appuyer pour changer`}
                    className={`absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-full border-2 border-white px-1.5 py-0.5 text-[9px] font-semibold leading-none shadow-sm disabled:opacity-60 ${STATUS_STYLE[status]}`}
                  >
                    {status === 'key' && <Star className="h-2.5 w-2.5 shrink-0" aria-hidden fill="currentColor" />}
                    {status === 'reportage' && <Check className="h-2.5 w-2.5 shrink-0" aria-hidden />}
                    {status === 'out' && <Circle className="h-2.5 w-2.5 shrink-0" aria-hidden />}
                    {STATUS_LABEL[status]}
                  </button>
                ) : (
                  status !== 'out' ? null : (
                    <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      Hors CR
                    </span>
                  )
                )}
              </div>
              {editable ? (
                <button
                  type="button"
                  onClick={() => openCaptionEditor(photo)}
                  className="line-clamp-2 text-left text-[11px] leading-snug text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {caption || <span className="italic">Ajouter une légende…</span>}
                </button>
              ) : (
                <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {caption || <span className="italic">Sans légende</span>}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black"
          onClick={() => setViewing(null)}
        >
          <div className="flex shrink-0 items-center justify-end px-4 py-3">
            <button
              type="button"
              onClick={() => setViewing(null)}
              className="rounded-full p-1 text-white/80 active:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden px-2" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewing.url} alt={captions[viewing.id] ?? ''} className="max-h-full max-w-full rounded object-contain" />
          </div>
          <div className="shrink-0 px-4 py-4" onClick={(e) => e.stopPropagation()}>
            {editable && editingCaption ? (
              <div className="space-y-2">
                <textarea
                  value={captionDraft}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  rows={2}
                  maxLength={500}
                  autoFocus
                  placeholder="Ajouter une légende…"
                  className="w-full rounded-lg border border-white/20 bg-white/10 p-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/40"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveCaption}
                    disabled={savingCaption}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-medium text-black disabled:opacity-50"
                  >
                    {savingCaption ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingCaption(false)}
                    disabled={savingCaption}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] text-white/70 disabled:opacity-50"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-white/80">
                  {captions[viewing.id] || (editable ? <span className="italic text-white/40">Aucune légende</span> : null)}
                </p>
                {editable && (
                  <button
                    type="button"
                    onClick={startEditCaption}
                    className="shrink-0 rounded-full p-1.5 text-white/70 active:bg-white/10"
                    aria-label="Modifier la légende"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * FINALISER, PUIS ROUVRIR SI BESOIN — deux gestes explicites.
 *
 * Concrétiser des objets ne finalise PAS le compte-rendu : on peut créer quatre
 * actions et continuer à corriger le texte. Et rouvrir ne défait rien dans le
 * chantier : c'est dit avant le clic, pas découvert après.
 */
function Lifecycle({
  reportId,
  status,
  onChanged,
}: {
  reportId: string
  status: ReportDocumentStatus
  onChanged: (s: ReportDocumentStatus) => void
}) {
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<{ ok: true; status: ReportDocumentStatus } | { ok: false; error: string }>) => {
    if (pending) return
    setPending(true)
    setError(null)
    const res = await fn()
    setPending(false)
    if (res.ok) {
      onChanged(res.status)
      setConfirming(false)
    } else setError(res.error)
  }

  if (status === 'exported') return null

  return (
    <div className="mt-3.5 border-t pt-3">
      {status === 'draft' ? (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => finalizeCrAction(reportId))}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-foreground/20 px-3 py-2.5 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
            Finaliser le compte-rendu
          </button>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Il deviendra une lecture seule. Vous pourrez le rouvrir si besoin.
          </p>
        </>
      ) : confirming ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/25">
          <p className="text-[13px] font-medium text-amber-900 dark:text-amber-200">
            Rouvrir le compte-rendu ?
          </p>
          <p className="mt-1 text-[12px] text-amber-900/80 dark:text-amber-300/80">
            Il repassera en brouillon et redeviendra modifiable. Les objets déjà créés dans le
            chantier ne seront ni modifiés ni supprimés.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => reopenCrAction(reportId))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Rouvrir le brouillon
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Corriger le compte-rendu
        </button>
      )}
      {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  )
}

/** « ✓ 2 actions créées dans le chantier · ○ 1 non créée » — le lien narration →
 *  objets, avec le verbe propre à la famille (créées / enregistrées). */
function ConsequenceLine({ sectionKey, created, pending }: { sectionKey: string; created: number; pending: number }) {
  const isDecision = sectionKey === 'decisions'
  const noun = (n: number) => (isDecision ? `décision${n > 1 ? 's' : ''}` : `action${n > 1 ? 's' : ''}`)
  const verb = (n: number) => (isDecision ? `enregistrée${n > 1 ? 's' : ''}` : `créée${n > 1 ? 's' : ''}`)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-dashed pt-2 text-[12px]">
      {created > 0 && (
        <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {created} {noun(created)} {verb(created)} dans le chantier
        </span>
      )}
      {pending > 0 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Circle className="h-3 w-3 shrink-0" aria-hidden />
          {pending} {isDecision ? `non enregistrée${pending > 1 ? 's' : ''}` : `non créée${pending > 1 ? 's' : ''}`}
        </span>
      )}
    </div>
  )
}

function SectionRow({
  reportId,
  section,
  editable,
  onPersisted,
  onApplyLocal,
  startEditing = false,
  summary,
}: {
  reportId: string
  section: ReportDocumentSection
  editable: boolean
  onPersisted: (doc: PersistedCrDocument) => void
  onApplyLocal: (key: string, content: string) => void
  /** Ouvre directement en édition — pour une rubrique qu'on vient de « compléter ». */
  startEditing?: boolean
  /** Conséquence dans le chantier (créé / non créé) — seulement pour actions et décisions. */
  summary?: { created: number; pending: number }
}) {
  const [editing, setEditing] = useState(startEditing)
  const [draft, setDraft] = useState(section.content)
  const [error, setError] = useState<string | null>(null)
  // Le pending est PAR SECTION : corriger le résumé ne gèle pas les six autres.
  const [pending, setPending] = useState(false)
  // « Enregistré » — la confirmation discrète que le serveur a bien pris.
  const [justSaved, setJustSaved] = useState(false)
  // « Restaurer l'IA » demande confirmation : il écrase un texte humain.
  const [confirmed, setConfirmed] = useState(false)

  // La restauration n'a de sens que si MemorIA a proposé un texte ET que ce
  // texte a été modifié depuis. Sinon : pas de bouton, pas de promesse creuse.
  const canRestore =
    editable && section.ai_content !== undefined && section.ai_content !== section.content

  const save = async () => {
    if (pending) return // anti double-clic : jamais deux écritures concurrentes
    const previous = section.content
    // 1. L'écran obéit TOUT DE SUITE : le texte corrigé s'affiche, la section
    //    se referme, et l'attente réseau se dit à côté sans rien bloquer.
    setEditing(false)
    setJustSaved(false)
    onApplyLocal(section.key, draft)
    setPending(true)
    setError(null)
    // 2. Le serveur confirme — et sa réponse fait autorité.
    const res = await saveCrSectionAction(reportId, section.key, draft)
    setPending(false)
    if (res.ok) {
      onPersisted(res.document)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2500)
    } else {
      // 3. Échec : on rend la main sans rien perdre — le texte saisi retourne
      //    dans l'éditeur ouvert, la section retrouve son état d'avant.
      onApplyLocal(section.key, previous)
      setDraft(draft)
      setEditing(true)
      setError(res.error)
    }
  }

  const restore = async () => {
    if (pending) return
    // ON DIT CE QU'ON VA PERDRE, AVANT (Vincent, 2026-07-21). Le geste écrase
    // un texte relu par un humain : il mérite une phrase, pas une surprise.
    // Et il dit VRAI — cette section revient à la proposition FIGÉE à la
    // création, pas à une analyse recalculée depuis les captures restantes.
    if (!confirmed) {
      setConfirmed(true)
      return
    }
    setConfirmed(false)
    setPending(true)
    setError(null)
    const res = await restoreCrSectionAction(reportId, section.key)
    setPending(false)
    if (res.ok) {
      setEditing(false)
      onPersisted(res.document)
    } else {
      setError(res.error)
    }
  }

  return (
    <div data-section={section.key} className="rounded-xl border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        {/* L'ÉTAT DE SAUVEGARDE NE DÉPLACE RIEN (Vincent, 2026-07-21). Inséré
            dans la ligne d'actions, il poussait « Restaurer l'IA » hors de
            l'écran sur mobile. Il vit sous le titre, à gauche : il informe sans
            bousculer la mise en page. */}
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold">{section.title}</h3>
          {pending && (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Enregistrement…
            </span>
          )}
          {!pending && justSaved && (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
              <Check className="h-3 w-3" aria-hidden /> Enregistré
            </span>
          )}
        </div>
        {editable && !editing && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => { setDraft(section.content); setEditing(true) }}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Modifier
            </button>
            {canRestore && (
              <button
                type="button"
                onClick={restore}
                disabled={pending}
                title="Annuler mes corrections sur cette section et revenir au texte proposé par MemorIA"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restaurer l’IA
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
            aria-label={`Modifier « ${section.title} »`}
            className="w-full rounded-lg border bg-background p-2 text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => { setDraft(section.content); setEditing(false); setError(null) }}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Annuler
            </button>
          </div>
        </div>
      ) : section.content ? (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
          {section.content}
        </p>
      ) : (
        // Le vide se dit, il ne s'invente pas : MemorIA n'a rien relevé ici.
        <p className="mt-1.5 text-[12px] italic text-muted-foreground">Rien à ce sujet.</p>
      )}

      {/* LE RÉCIT DEVIENT DES OBJETS — la conséquence, pas une seconde liste.
          Le lecteur relie ce qu'il vient de lire (« Actions ») à ce qui a été
          RÉELLEMENT créé dans le chantier. Passé (« créées »), distinct du panneau
          de concrétisation qui, lui, parle au futur (« seront créées »). */}
      {!editing && summary && (summary.created > 0 || summary.pending > 0) && (
        <ConsequenceLine sectionKey={section.key} created={summary.created} pending={summary.pending} />
      )}

      {/* ON DIT CE QU'ON VA PERDRE, AVANT (Vincent, 2026-07-21). Le geste écrase
          un texte relu par un humain : il mérite une phrase, pas une surprise.
          Et il dit VRAI — la section revient à la proposition FIGÉE à la
          création, pas à une analyse recalculée depuis les captures restantes. */}
      {confirmed && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Cette section reviendra au texte proposé par MemorIA à la création du compte-rendu. Vos
          corrections sur cette section seront perdues. Cliquez à nouveau pour confirmer.
        </p>
      )}

      {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  )
}
