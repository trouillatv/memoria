'use client'

// Actions sur un brief : Partager, Marquer comme reconnu, Archiver.
// Vincent 2026-05-22.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { Share2, CheckCircle2, Archive, Loader2, Copy, QrCode, FileDown, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  shareBriefAction,
  acknowledgeBriefAction,
  archiveBriefAction,
  deleteBriefAction,
} from '../actions'

interface Props {
  briefId: string
  status: string
  sharedToken: string | null
  expiresAt: string | null
}

export function HandoverActions({ briefId, status, sharedToken, expiresAt }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [shareOpen, setShareOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [daysValid, setDaysValid] = useState(7)

  const archived = status === 'archived'
  const acknowledged = status === 'acknowledged'
  const expired = expiresAt != null && new Date(expiresAt) < new Date()

  // QR du lien public — généré côté client (le lien /h/<token> est stable tant
  // que le token n'expire pas). Sert à l'imprimer / le montrer à la relève qui
  // scanne pour ouvrir le brief sur son téléphone.
  const shareUrl = sharedToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/h/${sharedToken}` : null
  useEffect(() => {
    if (!shareUrl) { setQrDataUrl(null); return }
    let alive = true
    QRCode.toDataURL(shareUrl, { errorCorrectionLevel: 'M', margin: 1, scale: 8 })
      .then((url) => { if (alive) setQrDataUrl(url) })
      .catch(() => { if (alive) setQrDataUrl(null) })
    return () => { alive = false }
  }, [shareUrl])

  function handleShare() {
    startTransition(async () => {
      const r = await shareBriefAction({ id: briefId, daysValid })
      if (r.ok) {
        toast.success('Lien de partage généré')
        setShareOpen(false)
        router.refresh()
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  function handleAcknowledge() {
    if (!confirm('Marquer ce brief comme reconnu (transmis et lu) ?')) return
    startTransition(async () => {
      const r = await acknowledgeBriefAction({ id: briefId })
      if (r.ok) {
        toast.success('Brief marqué comme reconnu')
        router.refresh()
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  function handleArchive() {
    if (!confirm('Archiver ce brief ? Il restera consultable dans l\'onglet « Archivé ».')) return
    startTransition(async () => {
      const r = await archiveBriefAction({ id: briefId })
      if (r.ok) {
        toast.success('Brief archivé')
        router.push('/handovers')
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  function handleDelete() {
    if (!confirm(
      'Supprimer ce passage de témoin ?\n\n' +
      'Il disparaît de l\'application et le lien public cesse de fonctionner. ' +
      'La donnée est conservée et restaurable par un administrateur.',
    )) return
    startTransition(async () => {
      const r = await deleteBriefAction({ id: briefId })
      if (r.ok) {
        toast.success('Passage de témoin supprimé')
        router.push('/handovers')
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  function copyShareUrl() {
    if (!sharedToken) return
    const url = `${window.location.origin}/h/${sharedToken}`
    navigator.clipboard.writeText(url)
    toast.success('URL copiée')
  }

  if (archived) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground italic">
          Brief archivé.
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={pending}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Supprimer
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {/* Partager / Régénérer / Copier */}
      {!sharedToken || expired ? (
        <Dialog open={shareOpen} onOpenChange={setShareOpen}>
          <DialogTrigger
            render={
              <Button variant="outline" size="sm" disabled={pending}>
                <Share2 className="h-3.5 w-3.5" />
                {expired ? 'Renouveler le partage' : 'Partager (URL publique)'}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Générer un lien de partage</DialogTitle>
              <DialogDescription>
                Un lien public sera créé. La personne destinataire pourra
                consulter le brief sans se connecter. Audit log des consultations.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label htmlFor="days" className="text-sm">
                Durée de validité
              </label>
              <select
                id="days"
                value={daysValid}
                onChange={(e) => setDaysValid(Number(e.target.value))}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value={1}>1 jour</option>
                <option value={3}>3 jours</option>
                <option value={7}>7 jours</option>
                <option value={14}>14 jours</option>
                <option value={30}>30 jours</option>
                <option value={60}>60 jours (max)</option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                Au-delà, le lien renvoie une page « expiré ». Tu peux régénérer
                un nouveau lien à tout moment.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShareOpen(false)} disabled={pending}>
                Annuler
              </Button>
              <Button onClick={handleShare} disabled={pending}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                Générer le lien
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <>
          <Button variant="outline" size="sm" onClick={copyShareUrl}>
            <Copy className="h-3.5 w-3.5" />
            Copier l'URL publique
          </Button>

          {/* QR à montrer/imprimer pour la relève — le moment magique terrain */}
          <Dialog open={qrOpen} onOpenChange={setQrOpen}>
            <DialogTrigger
              render={
                <Button variant="outline" size="sm">
                  <QrCode className="h-3.5 w-3.5" />
                  Code QR
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Partager par QR code</DialogTitle>
                <DialogDescription>
                  La relève scanne ce code pour ouvrir le brief sur son téléphone,
                  sans connexion. Imprime-le ou montre-le à l’écran.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3 py-2">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt="QR code du brief"
                    className="h-56 w-56 rounded-lg border bg-white p-2"
                  />
                ) : (
                  <div className="h-56 w-56 rounded-lg border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
                    Génération…
                  </div>
                )}
                {shareUrl && (
                  <p className="text-[11px] text-muted-foreground break-all text-center max-w-xs">{shareUrl}</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={copyShareUrl}>
                  <Copy className="h-3.5 w-3.5" />
                  Copier l'URL
                </Button>
                {sharedToken && (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={
                      <a href={`/h/${sharedToken}/pdf`} target="_blank" rel="noopener noreferrer" />
                    }
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    Ouvrir le PDF
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Lien PDF direct (hors dialog) */}
          {sharedToken && (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={
                <a href={`/h/${sharedToken}/pdf`} target="_blank" rel="noopener noreferrer" />
              }
            >
              <FileDown className="h-3.5 w-3.5" />
              PDF
            </Button>
          )}
        </>
      )}

      {/* Marquer reconnu */}
      {!acknowledged && (
        <Button variant="outline" size="sm" onClick={handleAcknowledge} disabled={pending}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          Marquer comme reconnu
        </Button>
      )}

      {/* Archiver */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleArchive}
        disabled={pending}
        className="text-muted-foreground hover:text-foreground"
      >
        <Archive className="h-3.5 w-3.5" />
        Archiver
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={handleDelete}
        disabled={pending}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Supprimer
      </Button>
    </div>
  )
}
