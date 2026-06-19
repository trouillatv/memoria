'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Sparkles, Save, CheckCircle2, Download, Loader2, AlertTriangle } from 'lucide-react'
import { generatePvAction, savePvSectionsAction, validatePvAction } from './pv-actions'
import type { DbReportDocument, ReportDocumentSection } from '@/types/db'

interface PvPanelProps {
  reportId: string
  initial: DbReportDocument | null
}

export function PvPanel({ reportId, initial }: PvPanelProps) {
  const router = useRouter()
  const [doc, setDoc] = useState<DbReportDocument | null>(initial)
  const [sections, setSections] = useState<ReportDocumentSection[]>(initial?.sections ?? [])
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const isValidated = doc?.status === 'validated' || doc?.status === 'exported'
  const readOnly = isValidated || pending

  function setSectionContent(key: string, content: string) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, content } : s)))
    setDirty(true)
  }

  function handleGenerate() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await generatePvAction(reportId)
        if (res.ok) {
          router.refresh()
        } else {
          setError(res.error)
        }
      } catch (e) {
        // Sinon un throw serveur (auth, DB, rendu) échoue en SILENCE.
        setError(e instanceof Error ? e.message : 'La génération a échoué (erreur serveur). Réessayez ou contactez l’admin.')
      }
    })
  }

  function handleSave() {
    if (!doc) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await savePvSectionsAction(reportId, doc.id, sections)
        if (res.ok) {
          setDirty(false)
          setDoc({ ...doc, sections })
        } else {
          setError(res.error ?? 'Échec de la sauvegarde')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Échec de la sauvegarde (erreur serveur).')
      }
    })
  }

  function handleValidate() {
    if (!doc) return
    setError(null)
    startTransition(async () => {
      try {
        // Sauver les éventuelles éditions avant de figer.
        if (dirty) {
          const save = await savePvSectionsAction(reportId, doc.id, sections)
          if (!save.ok) { setError(save.error ?? 'Échec de la sauvegarde'); return }
          setDirty(false)
        }
        const res = await validatePvAction(reportId, doc.id)
        if (res.ok) {
          router.refresh()
        } else {
          setError(res.error ?? 'Échec de la validation')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Échec de la validation (erreur serveur).')
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

      {!doc ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Générer un PV structuré à partir de la transcription et des actions de cette réunion.
            L&apos;IA structure et rédige ; vous relisez et validez. Aucune décision n&apos;est inventée.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" /> Générer PV chantier
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {!isValidated && (
            <p className="text-xs text-muted-foreground">
              Brouillon éditable par sections. Vérifiez chaque section, corrigez si besoin, puis validez.
              La section « Actions à faire » reflète les actions déjà validées de la réunion.
            </p>
          )}

          <div className="space-y-3">
            {sections.map((s) => (
              <div key={s.key} className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {s.title}
                </label>
                {readOnly ? (
                  <div className="whitespace-pre-wrap rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                    {s.content || <span className="italic text-muted-foreground">—</span>}
                  </div>
                ) : (
                  <textarea
                    value={s.content}
                    onChange={(e) => setSectionContent(s.key, e.target.value)}
                    rows={Math.max(2, s.content.split('\n').length)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                )}
                {s.sources && s.sources.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Sources : {s.sources.map((src) => `« ${src} »`).join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!isValidated && (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={pending || !dirty}
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> Enregistrer
                </button>
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" /> Valider le PV
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={pending}
                  title="Régénère le brouillon (applique la trame de l'entreprise). Remplace le brouillon courant."
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" /> Régénérer
                </button>
              </>
            )}
            <a
              href={`/meetings/${reportId}/pv`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40"
            >
              <Download className="h-4 w-4" /> {isValidated ? 'Télécharger le PDF' : 'Aperçu PDF'}
            </a>
          </div>
        </div>
      )}
    </section>
  )
}
