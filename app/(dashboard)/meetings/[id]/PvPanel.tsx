'use client'

// Panneau CR de chantier — UN SEUL MOTEUR (Vincent 2026-06-20). Le CR = trame unique
// « Chantier v1 » rendue depuis la MÉMOIRE VALIDÉE (on corrige la mémoire via « Points
// à confirmer », jamais le document). + HISTORIQUE DOCUMENTAIRE : chaque version finale
// diffusée est CONSERVÉE (jamais « remplacée ») — un document diffusé est une preuve.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, CheckCircle2, Download, Loader2, AlertTriangle, Upload, History } from 'lucide-react'
import { validatePvAction } from './pv-actions'
import type { DbReportDocument } from '@/types/db'
import type { ReportFinalVersion } from '@/lib/db/report-final-versions'

interface PvPanelProps {
  reportId: string
  initial: DbReportDocument | null
  finalVersions: ReportFinalVersion[]
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function PvPanel({ reportId, initial, finalVersions }: PvPanelProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const isValidated = initial?.status === 'validated' || initial?.status === 'exported'
  const validatedAt = isValidated && initial?.updated_at ? initial.updated_at : null

  function handleValidate() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await validatePvAction(reportId)
        if (res.ok) router.refresh()
        else setError(res.error ?? 'Échec de la validation')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Échec de la validation (erreur serveur).')
      }
    })
  }

  // Téléverse une NOUVELLE version finale (jamais d'écrasement). Note de diffusion
  // optionnelle (« envoyé à 18 destinataires »…). On archive, on n'écrase pas la mémoire.
  function handleUploadFinal(file: File) {
    setError(null)
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.append('file', file)
        if (note.trim()) fd.append('note', note.trim())
        const res = await fetch(`/meetings/${reportId}/pv/final`, { method: 'POST', body: fd })
        if (res.ok) { setNote(''); router.refresh() }
        else {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          setError(j.error ?? 'Échec du téléversement.')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Échec du téléversement (erreur réseau).')
      }
    })
  }

  return (
    <section className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Finaliser le compte-rendu
          {isValidated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> Version générée figée
            </span>
          )}
        </h2>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Parcours d'ensemble — Émeline voit tout le chemin, sans quitter l'écran
          (Finding A/C). ①②③ se font dans le corps de la page ci-dessus. */}
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-muted-foreground">
        {['Vérifier les points', "Relire l'aperçu", 'Corriger', 'Télécharger', 'Téléverser le final', 'Figer (option)'].map((label, i) => (
          <li key={label} className="inline-flex items-center gap-1">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">{i + 1}</span>
            {label}
            {i < 5 && <span className="mx-0.5 text-muted-foreground/40">→</span>}
          </li>
        ))}
      </ol>

      {/* ④ Générer / télécharger — l'aperçu vivant est déjà à droite ; ici on
          obtient le PDF ou le Word à retoucher. */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-foreground">④ Générer le document</p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/meetings/${reportId}/pv`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40">
            <Download className="h-4 w-4" /> Aperçu PDF
          </a>
          <a href={`/meetings/${reportId}/pv?format=docx`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/40">
            <Download className="h-4 w-4" /> Télécharger DOCX (corriger dans Word)
          </a>
        </div>
      </div>

      {/* ⑤ Téléverser la version finale = LA preuve diffusée (action primaire). */}
      <div className="rounded-lg border border-slate-200 bg-muted/20 p-3 space-y-2">
        <p className="text-xs font-semibold text-foreground">⑤ Téléverser la version finale diffusée</p>
        <p className="text-xs text-muted-foreground">
          Le document réellement envoyé aux intervenants — <strong>conservé comme preuve</strong>, jamais écrasé.
          C&apos;est l&apos;étape qui termine le CR.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note de diffusion (ex. « envoyé à 18 destinataires »)"
            className="min-w-[14rem] flex-1 rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFinal(f); e.target.value = '' }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60">
            <Upload className="h-4 w-4" /> {finalVersions.length > 0 ? `Téléverser la v${finalVersions.length + 1}` : 'Téléverser la version finale'}
          </button>
        </div>
      </div>

      {/* ⑥ Figer la version GÉNÉRÉE = référence MemorIA (optionnel, ≠ preuve diffusée). */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-foreground">⑥ Figer la version générée <span className="font-normal text-muted-foreground">(optionnel)</span></p>
        <p className="text-xs text-muted-foreground">
          Instantané de référence du CR <strong>généré par MemorIA</strong>, pour comparaison. Ce n&apos;est
          <strong> pas</strong> le document diffusé (celui-là se téléverse à l&apos;étape ⑤).
        </p>
        <button
          type="button"
          onClick={handleValidate}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40 disabled:opacity-60"
        >
          <CheckCircle2 className="h-4 w-4" /> {isValidated ? 'Re-figer la version générée' : 'Figer la version générée'}
        </button>
      </div>

      {/* Historique documentaire — versions CONSERVÉES (preuve juridique). */}
      <div className="border-t pt-3 space-y-2">
        <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <History className="h-3.5 w-3.5 text-muted-foreground" /> Historique documentaire
        </h3>

        {(validatedAt || finalVersions.length > 0) ? (
          <ul className="space-y-1.5 text-sm">
            {validatedAt && (
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-600" />
                <span><span className="font-medium">PV validé</span> · {fmt(validatedAt)}</span>
              </li>
            )}
            {finalVersions.map((v) => (
              <li key={v.id} className="flex items-start gap-2">
                <ShieldDot />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">Version finale diffusée (v{v.versionNo})</span> · {fmt(v.finalizedAt)} · {v.format.toUpperCase()}
                  {v.note && <span className="block text-xs text-muted-foreground">{v.note}</span>}
                </span>
                <a href={`/meetings/${reportId}/pv/final?v=${v.versionNo}`} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <Download className="h-3 w-3" /> v{v.versionNo}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Aucune version finale encore. Téléversez le document diffusé à l&apos;étape ⑤ — chaque diffusion est conservée comme preuve.
          </p>
        )}
      </div>
    </section>
  )
}

// Petit marqueur de timeline (point), évite une dépendance d'icône supplémentaire.
function ShieldDot() {
  return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-400" aria-hidden />
}
