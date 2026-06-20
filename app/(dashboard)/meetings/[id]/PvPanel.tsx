'use client'

// Panneau CR de chantier — UN SEUL MOTEUR (Vincent 2026-06-20). Le CR est la trame
// unique « Chantier v1 », rendue depuis la MÉMOIRE VALIDÉE de la réunion. On ne
// réécrit pas le document à la main : on corrige la mémoire (écran « Points à
// confirmer ») et le CR la reflète. Plus de brouillon LLM parallèle éditable ici.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FileText, CheckCircle2, Download, Loader2, AlertTriangle, ClipboardCheck, Upload, ShieldCheck } from 'lucide-react'
import { validatePvAction } from './pv-actions'
import type { DbReportDocument } from '@/types/db'

interface PvPanelProps {
  reportId: string
  initial: DbReportDocument | null
}

export function PvPanel({ reportId, initial }: PvPanelProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const isValidated = initial?.status === 'validated' || initial?.status === 'exported'
  const finalAt = initial?.finalized_at
    ? new Date(initial.finalized_at).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  function handleValidate() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await validatePvAction(reportId)
        if (res.ok) router.refresh()
        else setError(res.error ?? 'Échec de la validation')
      } catch (e) {
        // Sinon un throw serveur (auth, DB, rendu) échoue en SILENCE.
        setError(e instanceof Error ? e.message : 'Échec de la validation (erreur serveur).')
      }
    })
  }

  // Téléverse la VERSION FINALE diffusée (DOCX/PDF corrigé à la main). N'écrase pas
  // la mémoire : on archive « ce qui a réellement été envoyé » (vérité juridique).
  function handleUploadFinal(file: File) {
    setError(null)
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/meetings/${reportId}/pv/final`, { method: 'POST', body: fd })
        if (res.ok) router.refresh()
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
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Compte-rendu de chantier
          {isValidated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> Validé
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

      <p className="text-sm text-muted-foreground">
        Le compte-rendu se génère depuis la <strong>mémoire validée</strong> de la réunion (trame unique
        «&nbsp;Chantier&nbsp;v1&nbsp;»). Pour combler un manque, complétez les <strong>points à confirmer</strong> —
        le CR reflète la mémoire, on ne le réécrit pas à la main.
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Link
          href={`/meetings/${reportId}/pv/validation`}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40"
        >
          <ClipboardCheck className="h-4 w-4" /> Points à confirmer
        </Link>
        <a
          href={`/meetings/${reportId}/pv`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40"
        >
          <Download className="h-4 w-4" /> {isValidated ? 'Télécharger le PDF' : 'Aperçu PDF'}
        </a>
        <a
          href={`/meetings/${reportId}/pv?format=docx`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/40"
        >
          <Download className="h-4 w-4" /> DOCX éditable
        </a>
        <button
          type="button"
          onClick={handleValidate}
          disabled={pending}
          title={isValidated ? 'Archive une nouvelle version à jour de la mémoire actuelle.' : 'Fige le CR et l’archive dans les documents du site.'}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          <CheckCircle2 className="h-4 w-4" /> {isValidated ? 'Re-valider (archiver à jour)' : 'Valider le PV'}
        </button>
      </div>

      {/* Version finale DIFFUSÉE — ce qui a réellement été envoyé (vérité juridique).
          Émeline télécharge le DOCX, corrige ~15 %, et téléverse ici la version finale.
          On STOCKE, on n'écrase pas la mémoire. */}
      <div className="border-t pt-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /> Version finale diffusée
          </h3>
          {finalAt && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> {finalAt}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {finalAt
            ? 'La version réellement envoyée aux intervenants est archivée. Vous pouvez la remplacer si vous re-diffusez.'
            : 'Après vos corrections manuelles (formulation, ajouts), téléversez ici le document final envoyé — il devient la version officielle.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFinal(f); e.target.value = '' }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" /> {finalAt ? 'Remplacer la version finale' : 'Téléverser la version finale'}
          </button>
          {finalAt && (
            <a
              href={`/meetings/${reportId}/pv/final`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40"
            >
              <Download className="h-4 w-4" /> Télécharger la version finale
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
