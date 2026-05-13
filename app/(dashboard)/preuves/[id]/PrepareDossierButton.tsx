'use client'

// Slice B.3 — Bouton + Dialog "Préparer le dossier (PDF)".
//
// Doctrine impérative :
//   - Toggle "Inclure les identités" DEFAULT OFF, requiert une confirmation
//     modale (sous-état) avant de valider. Visible mais friction-aware.
//   - Wording calme : "Vérification client", "Audit interne", "Conservation".
//     Pas de jargon marketing.
//   - Après création : on AFFICHE le résultat dans la même dialog (pas de toast
//     éphémère qui disparaît avec l'URL). Le DG peut copier-coller à son aise.
//   - Bouton "Télécharger le PDF" → ouvre dans un nouvel onglet (le navigateur
//     gère le download via Content-Disposition).
//   - Copy-to-clipboard avec feedback visuel ("Copié ✓") pendant 2s.
//   - Cible mobile : on évite les composants UI cachés derrière du hover.

import * as React from 'react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { showTimeSavedToast } from '@/components/ui/time-saved-toast'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  ShieldAlert,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { prepareProofDossierAction } from './actions'

interface PrepareDossierButtonProps {
  interventionId: string
}

type DurationChoice = 7 | 14 | 30

const DURATION_LABELS: Record<DurationChoice, string> = {
  7: '7 jours',
  14: '14 jours',
  30: '30 jours',
}

type Step = 'configure' | 'confirm-identities' | 'submitting' | 'ready'

interface DossierResult {
  shareUrl: string
  pdfUrl: string
  expiresAt: string
  includeIdentities: boolean
}

export function PrepareDossierButton({ interventionId }: PrepareDossierButtonProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('configure')
  const [duration, setDuration] = useState<DurationChoice>(7)
  const [includeIdentities, setIncludeIdentities] = useState(false)
  const [result, setResult] = useState<DossierResult | null>(null)
  const [_, startTransition] = useTransition()

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Reset à la fermeture pour préparer une éventuelle prochaine ouverture.
      // On laisse un délai pour que l'animation de fermeture termine sans flicker.
      setTimeout(() => {
        setStep('configure')
        setDuration(7)
        setIncludeIdentities(false)
        setResult(null)
      }, 200)
    }
  }

  function handleRequestSubmit() {
    if (includeIdentities) {
      setStep('confirm-identities')
    } else {
      submitNow(false)
    }
  }

  function submitNow(withIdentities: boolean) {
    setStep('submitting')
    startTransition(async () => {
      const res = await prepareProofDossierAction({
        interventionId,
        durationDays: duration,
        includeIdentities: withIdentities,
      })
      if (!res.ok) {
        toast.error(res.error || 'Erreur lors de la préparation du dossier')
        setStep('configure')
        return
      }
      setResult({
        shareUrl: res.shareUrl,
        pdfUrl: res.pdfUrl,
        expiresAt: res.expiresAt,
        includeIdentities: withIdentities,
      })
      setStep('ready')
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FileText className="mr-1" />
        Préparer le dossier (PDF)
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          {step === 'configure' && (
            <ConfigureStep
              duration={duration}
              setDuration={setDuration}
              includeIdentities={includeIdentities}
              setIncludeIdentities={setIncludeIdentities}
              onCancel={() => handleOpenChange(false)}
              onSubmit={handleRequestSubmit}
            />
          )}

          {step === 'confirm-identities' && (
            <ConfirmIdentitiesStep
              onCancel={() => setStep('configure')}
              onConfirm={() => submitNow(true)}
            />
          )}

          {step === 'submitting' && <SubmittingStep />}

          {step === 'ready' && result && (
            <ReadyStep result={result} onClose={() => handleOpenChange(false)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

// ----------------------------------------------------------------------------
// Step 1 : Configure
// ----------------------------------------------------------------------------

function ConfigureStep({
  duration,
  setDuration,
  includeIdentities,
  setIncludeIdentities,
  onCancel,
  onSubmit,
}: {
  duration: DurationChoice
  setDuration: (d: DurationChoice) => void
  includeIdentities: boolean
  setIncludeIdentities: (v: boolean) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Préparer un dossier de preuves</DialogTitle>
        <DialogDescription>
          Un PDF horodaté est généré avec les photos, validations et anomalies.
          Un lien temporaire permet de le partager.
        </DialogDescription>
      </DialogHeader>

      {/* Durée de validité */}
      <div className="space-y-2">
        <div className="text-sm font-medium">Durée de validité du lien</div>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(DURATION_LABELS) as unknown as string[]).map((k) => {
            const value = Number(k) as DurationChoice
            const selected = duration === value
            return (
              <button
                key={k}
                type="button"
                onClick={() => setDuration(value)}
                className={
                  'inline-flex items-center rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                  (selected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted border-border')
                }
              >
                {DURATION_LABELS[value]}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Passée cette durée, le lien public ne fonctionnera plus. Vous pourrez
          en générer un nouveau à tout moment.
        </p>
      </div>

      {/* Toggle identités */}
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
        <label className="flex items-start justify-between gap-3 cursor-pointer">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              Inclure les identités des agents
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              À réserver à un usage juridique (mise en demeure, audit nominatif).
              Par défaut, le dossier est anonymisé.
            </div>
          </div>
          <Switch
            checked={includeIdentities}
            onCheckedChange={(v) => setIncludeIdentities(!!v)}
          />
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button onClick={onSubmit}>Préparer</Button>
      </div>
    </>
  )
}

// ----------------------------------------------------------------------------
// Step 2 : Confirmation override identités
// ----------------------------------------------------------------------------

function ConfirmIdentitiesStep({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-amber-600" />
          Confirmer l&apos;inclusion des identités
        </DialogTitle>
        <DialogDescription>
          Cette action est tracée dans le journal d&apos;activité. Le PDF et la
          page publique afficheront les identités des agents intervenus.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Conservez ce dossier en accès restreint. Évitez de partager le lien à
        des tiers non-concernés.
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          Revenir
        </Button>
        <Button onClick={onConfirm}>Confirmer et préparer</Button>
      </div>
    </>
  )
}

// ----------------------------------------------------------------------------
// Step 3 : Submitting
// ----------------------------------------------------------------------------

function SubmittingStep() {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Préparation en cours…</DialogTitle>
        <DialogDescription>
          Génération du lien de partage et du PDF horodaté.
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    </>
  )
}

// ----------------------------------------------------------------------------
// Step 4 : Ready
// ----------------------------------------------------------------------------

function ReadyStep({
  result,
  onClose,
}: {
  result: DossierResult
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(result.shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      // Sprint 5 UX-9 — Temps retrouvé : reconnaissance discrète et factuelle.
      showTimeSavedToast('Dossier prêt à partager · lien copié')
    } catch {
      toast.error('Impossible de copier — sélectionnez l\'URL manuellement.')
    }
  }

  const expiresLabel = formatExpiresAt(result.expiresAt)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Check className="size-4 text-emerald-600" />
          Dossier prêt
        </DialogTitle>
        <DialogDescription>
          Téléchargez le PDF horodaté ou partagez le lien public temporaire.
        </DialogDescription>
      </DialogHeader>

      {result.includeIdentities && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          Ce dossier contient les identités des agents (override admin).
        </div>
      )}

      {/* Download PDF */}
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          PDF horodaté
        </div>
        <a
          href={result.pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-full items-center justify-start gap-1.5 rounded-lg border border-border bg-background px-2.5 h-8 text-sm font-medium hover:bg-muted hover:text-foreground transition-colors"
        >
          <Download className="size-4" />
          Télécharger le PDF
          <ExternalLink className="ml-auto size-3 opacity-50" />
        </a>
      </div>

      {/* Share URL */}
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Lien public temporaire
        </div>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 truncate rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs"
            title={result.shareUrl}
          >
            {result.shareUrl}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={copyShareUrl}
            aria-label="Copier le lien"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            <span className="ml-1">{copied ? 'Copié' : 'Copier'}</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Expire {expiresLabel}.
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="outline" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </>
  )
}

// ----------------------------------------------------------------------------
// Utils
// ----------------------------------------------------------------------------

function formatExpiresAt(iso: string): string {
  try {
    const d = new Date(iso)
    return `le ${d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}`
  } catch {
    return ''
  }
}
