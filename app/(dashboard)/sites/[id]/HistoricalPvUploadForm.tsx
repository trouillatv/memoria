'use client'

import { useState, useRef, type FormEvent, type ChangeEvent } from 'react'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  requestHistoricalPvUpload,
  confirmHistoricalPvImport,
} from './historical-pv-upload-actions'

type UploadPhase =
  | 'idle'
  | 'requesting'
  | 'uploading'
  | 'confirming'
  | 'done'
  | 'error'

interface UploadState {
  phase: UploadPhase
  progress: number // 0-100
  message: string
  documentId?: string
  canRetry?: boolean
  uploadId?: string
  storagePath?: string
  isDuplicate?: boolean          // même contenu déjà importé
  existingFilename?: string
  dateWarning?: { count: number }
}

export function HistoricalPvUploadForm({
  siteId,
  onClose,
}: {
  siteId: string
  onClose: () => void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<UploadState>({
    phase: 'idle',
    progress: 0,
    message: '',
  })

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [effectiveDate, setEffectiveDate] = useState<string>('')

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      if (file.type !== 'application/pdf') {
        setState({ phase: 'error', progress: 0, message: 'Seuls les fichiers PDF sont acceptés' })
        return
      }
      if (file.size > 25 * 1024 * 1024) {
        setState({
          phase: 'error',
          progress: 0,
          message: 'Fichier trop volumineux (max 25 Mo)',
        })
        return
      }
      setSelectedFile(file)
      setState({ phase: 'idle', progress: 0, message: '' })
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedFile) {
      setState({ phase: 'error', progress: 0, message: 'Veuillez sélectionner un fichier' })
      return
    }
    if (!effectiveDate) {
      setState({ phase: 'error', progress: 0, message: 'Veuillez indiquer la date du PV' })
      return
    }

    try {
      // Étape 0 : Calcul du hash SHA256 (validation serveur)
      setState({ phase: 'requesting', progress: 0, message: 'Préparation de l\'envoi…' })
      const fileHash = await computeSHA256(selectedFile)

      // Étape 1 : Demande d'URL signée
      const requestResult = await requestHistoricalPvUpload({
        siteId,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        contentType: selectedFile.type,
        fileHashSha256: fileHash,
      })

      if (!requestResult.ok) {
        setState({ phase: 'error', progress: 0, message: requestResult.error, canRetry: false })
        return
      }

      const { uploadId, uploadUrl, storagePath } = requestResult

      // Étape 2 : Upload direct vers Supabase Storage avec progression
      setState({ phase: 'uploading', progress: 0, message: 'Envoi du PDF…', uploadId, storagePath })

      await uploadFileWithProgress(uploadUrl, selectedFile, (progress) => {
        setState((prev) => ({
          ...prev,
          phase: 'uploading',
          progress,
          message: `Envoi du PDF… ${progress}%`,
        }))
      })

      // Étape 3 : Confirmation serveur + création document
      setState({
        phase: 'confirming',
        progress: 100,
        message: 'Création du document…',
        uploadId,
        storagePath,
      })

      const confirmResult = await confirmHistoricalPvImport({
        uploadId,
        siteId,
        storagePath,
        effectiveDate,
      })

      if (!confirmResult.ok) {
        setState({
          phase: 'error',
          progress: 100,
          message: confirmResult.error,
          canRetry: confirmResult.canRetry,
          uploadId,
          storagePath,
        })
        return
      }

      if (confirmResult.status === 'duplicate_content') {
        setState({
          phase: 'done',
          progress: 100,
          message: `Ce PDF a déjà été importé (${confirmResult.existingFilename})`,
          documentId: confirmResult.documentId,
          isDuplicate: true,
          existingFilename: confirmResult.existingFilename,
        })
        return
      }

      setState({
        phase: 'done',
        progress: 100,
        message:
          confirmResult.status === 'already_confirmed'
            ? 'Analyse déjà lancée'
            : 'Analyse lancée — patientez quelques instants',
        documentId: confirmResult.documentId,
        dateWarning: confirmResult.status === 'analysis_started' ? confirmResult.dateWarning : undefined,
      })
    } catch (err) {
      console.error('[HistoricalPvUploadForm]', err)
      setState({
        phase: 'error',
        progress: 0,
        message: 'Erreur réseau — vérifiez votre connexion',
        canRetry: true,
      })
    }
  }

  async function retryConfirmation() {
    if (!state.uploadId || !state.storagePath) return

    setState({
      phase: 'confirming',
      progress: 100,
      message: 'Nouvelle tentative de confirmation…',
    })

    try {
      const confirmResult = await confirmHistoricalPvImport({
        uploadId: state.uploadId,
        siteId,
        storagePath: state.storagePath,
        effectiveDate,
      })

      if (!confirmResult.ok) {
        setState({
          phase: 'error',
          progress: 100,
          message: confirmResult.error,
          canRetry: confirmResult.canRetry,
          uploadId: state.uploadId,
          storagePath: state.storagePath,
        })
        return
      }

      if (confirmResult.status === 'duplicate_content') {
        setState({
          phase: 'done',
          progress: 100,
          message: `Ce PDF a déjà été importé (${confirmResult.existingFilename})`,
          documentId: confirmResult.documentId,
          isDuplicate: true,
          existingFilename: confirmResult.existingFilename,
        })
        return
      }

      setState({
        phase: 'done',
        progress: 100,
        message:
          confirmResult.status === 'already_confirmed'
            ? 'Analyse déjà lancée'
            : 'Analyse lancée — patientez quelques instants',
        documentId: confirmResult.documentId,
        dateWarning: confirmResult.status === 'analysis_started' ? confirmResult.dateWarning : undefined,
      })
    } catch (err) {
      console.error('[retryConfirmation]', err)
      setState({
        phase: 'error',
        progress: 0,
        message: 'Erreur réseau — vérifiez votre connexion',
        canRetry: true,
        uploadId: state.uploadId,
        storagePath: state.storagePath,
      })
    }
  }

  async function computeSHA256(file: File): Promise<string> {
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  function uploadFileWithProgress(
    url: string,
    file: File,
    onProgress: (progress: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100)
          onProgress(percent)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`))
        }
      })

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'))
      })

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload aborted'))
      })

      xhr.open('PUT', url)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.send(file)
    })
  }

  const isPending = ['requesting', 'uploading', 'confirming'].includes(state.phase)
  const isDone = state.phase === 'done'
  const isError = state.phase === 'error'

  return (
    <form ref={formRef} className="space-y-4" onSubmit={handleSubmit}>
      {!isDone && (
        <>
          <label className="block space-y-2">
            <span className="text-sm font-medium">PDF du PV</span>
            <input
              ref={fileInputRef}
              name="file"
              type="file"
              accept="application/pdf"
              required
              onChange={handleFileChange}
              disabled={isPending}
              className="block w-full rounded-lg border p-2 text-sm disabled:opacity-50"
            />
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                {selectedFile.name} — {(selectedFile.size / 1024 / 1024).toFixed(2)} Mo
              </p>
            )}
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">
              Date du PV <span className="text-destructive">*</span>
            </span>
            <input
              name="effective_date"
              type="date"
              required
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              disabled={isPending}
              className="block w-full rounded-lg border px-3 py-2 text-sm bg-background disabled:opacity-50"
            />
          </label>
        </>
      )}

      {/* Statut de progression */}
      {(isPending || isDone || isError) && (
        <div
          className={`rounded-lg border p-3 text-sm space-y-2 ${
            isDone
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
              : isError
                ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                : 'bg-muted/40'
          }`}
        >
          <div className="flex items-center gap-2">
            {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {isDone && <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
            {isError && <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />}
            <p className={isDone ? 'text-emerald-700 dark:text-emerald-300' : isError ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'}>
              {state.message}
            </p>
          </div>

          {state.phase === 'uploading' && state.progress > 0 && (
            <div className="w-full rounded-full bg-muted h-1.5 overflow-hidden">
              <div
                className="h-full bg-foreground transition-all duration-300"
                style={{ width: `${state.progress}%` }}
              />
            </div>
          )}

          {isDone && state.documentId && (
            <a
              href={`/documents/${state.documentId}`}
              className="inline-block underline underline-offset-2 hover:text-foreground text-sm"
            >
              {state.isDuplicate ? 'Ouvrir l\'analyse existante →' : 'Suivre l\'analyse →'}
            </a>
          )}

          {isDone && state.dateWarning && !state.isDuplicate && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ {state.dateWarning.count} PV existant{state.dateWarning.count > 1 ? 's' : ''} pour cette date sur ce chantier.
            </p>
          )}

          {isError && state.canRetry && state.uploadId && (
            <button
              type="button"
              onClick={retryConfirmation}
              className="text-sm underline underline-offset-2 hover:text-foreground"
            >
              Réessayer la confirmation
            </button>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Fermer
        </button>
        {!isDone && (
          <button
            type="submit"
            disabled={isPending || !selectedFile || !effectiveDate}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-60"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Importer et analyser
          </button>
        )}
      </div>
    </form>
  )
}
