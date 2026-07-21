'use client'

// VERSER UNE PIÈCE AU DOSSIER — le geste, au bureau.
//
// Deux usages, pas le même écran : sur le chantier « j'ai oublié une photo, je
// suis encore sur place » ; au bureau « en relisant le dossier, je complète ».
// C'est le second que cet écran sert.
//
// « Une preuve est une interprétation. Une pièce est simplement un élément versé
//   au dossier. » On verse ; MemorIA lira peut-être ensuite, si l'humain le
//   demande. Verser ne déclenche donc AUCUNE analyse : le récit signalera que la
//   pièce n'a pas été lue, et le bouton Réanalyser apparaîtra de lui-même.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, FileText, Loader2, Mic, Paperclip, Video, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  prepareVisitPieceUploadAction,
  registerVisitPieceAction,
} from './piece-actions'

type Kind = 'photo' | 'vocal' | 'video' | 'note'

const TYPES: Array<{ kind: Kind; label: string; icon: typeof Camera; accept?: string }> = [
  { kind: 'photo', label: 'Photo', icon: Camera, accept: 'image/*' },
  { kind: 'vocal', label: 'Vocal', icon: Mic, accept: 'audio/*' },
  { kind: 'video', label: 'Vidéo', icon: Video, accept: 'video/*' },
  { kind: 'note', label: 'Note', icon: FileText },
]

/** La date de la pièce ne se devine pas toujours — mais un champ vide est une
 *  mauvaise question. On propose les réponses probables, pré-remplies. */
type DateChoix = 'fichier' | 'visite' | 'aujourdhui' | 'autre'

/** Le choix de l'humain devient une origine PERSISTÉE (mig 230) : l'écran
 *  pourra dire « prise le … » ou « date déclarée … » sans supposer. */
const SOURCE: Record<DateChoix, 'file' | 'visit' | 'today' | 'chosen'> = {
  fichier: 'file', visite: 'visit', aujourdhui: 'today', autre: 'chosen',
}

export function VerserPiece({
  reportId,
  visitStartedAt,
}: {
  reportId: string
  /** Le début de la visite : une des réponses probables à « quand ? ». */
  visitStartedAt: string
}) {
  const router = useRouter()
  const [ouvert, setOuvert] = useState(false)
  const [kind, setKind] = useState<Kind | null>(null)
  const [fichier, setFichier] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [choix, setChoix] = useState<DateChoix>('fichier')
  const [autreDate, setAutreDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  function reset() {
    setKind(null)
    setFichier(null)
    setNote('')
    setChoix('fichier')
    setAutreDate('')
    setError(null)
    setOuvert(false)
  }

  function choisirType(k: Kind) {
    setKind(k)
    setError(null)
    setChoix(k === 'note' ? 'aujourdhui' : 'fichier')
    if (k !== 'note') setTimeout(() => inputRef.current?.click(), 0)
  }

  /** L'instant RÉEL de la pièce, selon la réponse choisie. Jamais deviné. */
  function dateReelle(): string | undefined {
    if (choix === 'visite') return visitStartedAt
    if (choix === 'aujourdhui') return new Date().toISOString()
    if (choix === 'autre') return autreDate ? new Date(autreDate).toISOString() : undefined
    // « Date du fichier » : celle que le système d'exploitation porte. Absente,
    // on n'invente rien — la pièce prendra sa date de dépôt.
    return fichier?.lastModified ? new Date(fichier.lastModified).toISOString() : undefined
  }

  async function verser() {
    if (!kind || busy) return
    if (kind !== 'note' && !fichier) { setError('Choisissez un fichier.'); return }
    if (kind === 'note' && !note.trim()) { setError('Écrivez la note.'); return }
    setBusy(true)
    setError(null)

    const clientUuid = crypto.randomUUID()
    const capturedAt = dateReelle()
    try {
      let storagePath: string | undefined
      if (kind !== 'note' && fichier) {
        // Le fichier part DIRECTEMENT au stockage : un plan PDF ou une vidéo de
        // chantier dépasse largement ce qu'un Server Action accepte.
        const prep = await prepareVisitPieceUploadAction({ report_id: reportId, client_uuid: clientUuid, kind })
        if (!prep.ok) { setError(prep.error); setBusy(false); return }
        const { error: upErr } = await createClient()
          .storage.from('site-reports')
          .uploadToSignedUrl(prep.storagePath, prep.token, fichier, { contentType: fichier.type || undefined })
        if (upErr) { setError(upErr.message); setBusy(false); return }
        storagePath = prep.storagePath
      }

      const res = await registerVisitPieceAction({
        report_id: reportId,
        client_uuid: clientUuid,
        kind,
        ...(storagePath ? { storage_path: storagePath } : {}),
        ...(fichier ? { filename: fichier.name, mime: fichier.type, size_bytes: fichier.size } : {}),
        ...(kind === 'note' ? { body: note.trim() } : {}),
        ...(capturedAt ? { captured_at: capturedAt, captured_at_source: SOURCE[choix] } : {}),
      })
      setBusy(false)
      if (!res.ok) { setError(res.error); return }
      reset()
      router.refresh()
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : 'Dépôt impossible')
    }
  }

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
      >
        <Paperclip className="h-4 w-4" aria-hidden />
        Verser une pièce au dossier
      </button>
    )
  }

  return (
    <div className="rounded-lg border bg-background p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12px] font-medium">Verser une pièce au dossier</p>
        <button type="button" onClick={reset} aria-label="Fermer" className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => choisirType(t.kind)}
            aria-pressed={kind === t.kind}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] ${
              kind === t.kind ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'
            }`}
          >
            <t.icon className="h-3 w-3" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={TYPES.find((t) => t.kind === kind)?.accept}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          setFichier(f)
          setError(null)
        }}
      />

      {kind && kind !== 'note' && (
        <p className="mt-2 truncate text-[12px] text-muted-foreground">
          {fichier ? fichier.name : 'Aucun fichier choisi — '}
          {!fichier && (
            <button type="button" onClick={() => inputRef.current?.click()} className="underline underline-offset-2">
              parcourir
            </button>
          )}
        </p>
      )}

      {kind === 'note' && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Ce que vous voulez garder au dossier"
          className="mt-2 block w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
        />
      )}

      {kind && (
        <fieldset className="mt-3">
          <legend className="text-[12px] text-muted-foreground">Date de la pièce</legend>
          <div className="mt-1 space-y-0.5">
            {kind !== 'note' && <Radio name="date" value="fichier" courant={choix} onChange={setChoix} label="Date du fichier" />}
            <Radio name="date" value="visite" courant={choix} onChange={setChoix} label="Date de la visite" />
            <Radio name="date" value="aujourdhui" courant={choix} onChange={setChoix} label="Aujourd’hui" />
            <Radio name="date" value="autre" courant={choix} onChange={setChoix} label="Autre…" />
          </div>
          {choix === 'autre' && (
            <input
              type="date"
              value={autreDate}
              onChange={(e) => setAutreDate(e.target.value)}
              className="mt-1.5 rounded-lg border bg-background px-2 py-1 text-[13px]"
            />
          )}
        </fieldset>
      )}

      {kind && (
        <button
          type="button"
          onClick={verser}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {busy ? 'Dépôt en cours…' : 'Verser au dossier'}
        </button>
      )}

      {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}

      {kind && !busy && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          La pièce entre au dossier ; MemorIA ne la lira que si vous le demandez.
        </p>
      )}
    </div>
  )
}

function Radio({
  name,
  value,
  courant,
  onChange,
  label,
}: {
  name: string
  value: DateChoix
  courant: DateChoix
  onChange: (v: DateChoix) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px]">
      <input
        type="radio"
        name={name}
        checked={courant === value}
        onChange={() => onChange(value)}
        className="h-3.5 w-3.5"
      />
      {label}
    </label>
  )
}
