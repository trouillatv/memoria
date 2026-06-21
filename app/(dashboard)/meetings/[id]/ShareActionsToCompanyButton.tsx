'use client'

import { useState, useTransition } from 'react'
import { QrCode, Link2, MessageCircle, Copy, Check, Loader2, Camera } from 'lucide-react'
import { createActionDistributionAction } from './share-actions'
import type { DbSiteAction } from '@/types/db'

interface Props {
  reportId: string
  siteId: string
  actions: DbSiteAction[]
}

/**
 * Confier un lot d'actions à une entreprise (QR / lien).
 * Doctrine : capter une déclaration, pas gérer le travail. Le MOE choisit les
 * actions + pour chacune si une PHOTO est requise pour clôturer (« montre-moi »).
 */
export function ShareActionsToCompanyButton({ reportId, siteId, actions }: Props) {
  const shareable = actions.filter((a) => a.status === 'open' || a.status === 'planned')
  const [open, setOpen] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(shareable.map((a) => a.id)))
  // Demande de preuve par action (photo requise pour clôturer). Défaut : oui.
  const [proof, setProof] = useState<Record<string, boolean>>(
    () => Object.fromEntries(shareable.map((a) => [a.id, true])),
  )
  const [result, setResult] = useState<{ url: string; qrDataUrl: string; whatsappText: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (shareable.length === 0) return null

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function generate() {
    setError(null)
    startTransition(async () => {
      const res = await createActionDistributionAction({
        reportId,
        siteId,
        recipientLabel: recipient,
        actions: shareable
          .filter((a) => selected.has(a.id))
          .map((a) => ({ actionId: a.id, requiresProofPhoto: proof[a.id] ?? true })),
      })
      if (res.ok) setResult({ url: res.url, qrDataUrl: res.qrDataUrl, whatsappText: res.whatsappText })
      else setError(res.error)
    })
  }

  async function copyUrl() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard indisponible */ }
  }

  if (result) {
    const waUrl = `https://wa.me/?text=${encodeURIComponent(result.whatsappText)}`
    return (
      <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <p className="text-xs font-medium text-foreground">Lot envoyé à {recipient || 'l\'entreprise'}</p>
        {result.qrDataUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={result.qrDataUrl} alt="QR du lot d'actions" className="h-40 w-40 rounded-lg border bg-white p-1" />
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <a href={waUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
          <button type="button" onClick={copyUrl}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copié' : 'Copier le lien'}
          </button>
        </div>
        <button type="button" onClick={() => { setResult(null); setOpen(false) }}
          className="text-[11px] text-muted-foreground hover:text-foreground">Terminé</button>
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors">
        <QrCode className="h-3.5 w-3.5" /> Confier à une entreprise
      </button>
    )
  }

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/20 p-3">
      <input
        type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)}
        placeholder="Entreprise destinataire (ex : Colas)" maxLength={80}
        className="h-8 w-full rounded-md border bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="space-y-1 rounded-md border bg-background p-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Actions confiées · photo de preuve</p>
        <div className="max-h-48 overflow-y-auto space-y-1.5">
          {shareable.map((a) => {
            const on = selected.has(a.id)
            return (
              <div key={a.id} className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={on} onChange={() => toggle(a.id)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-muted-foreground accent-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="leading-snug">{a.title}</span>
                  {on && (
                    <label className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                      <input type="checkbox" checked={proof[a.id] ?? true}
                        onChange={(e) => setProof((p) => ({ ...p, [a.id]: e.target.checked }))}
                        className="h-3 w-3 rounded border-muted-foreground accent-foreground" />
                      <Camera className="h-3 w-3" /> photo requise pour clôturer
                    </label>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {error && <p className="text-xs text-rose-700">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={generate} disabled={isPending || selected.size === 0 || !recipient.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background disabled:opacity-50">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          Générer le QR / lien
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/40">Annuler</button>
      </div>
    </div>
  )
}
