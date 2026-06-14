'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import {
  Share2,
  MessageCircle,
  MessageSquare,
  Copy,
  Check,
  Loader2,
  Infinity,
  X,
} from 'lucide-react'
import { generateInterventionTokenAction } from '@/app/(dashboard)/briefing/intervention-token-actions'

interface Props {
  interventionId: string
  missionName: string
  siteName: string
}

type GeneratedResult = {
  url: string
  whatsappText: string
  permanent: boolean
}

export function ShareExternalButton({ interventionId, missionName, siteName }: Props) {
  const [open, setOpen] = useState(false)
  const [recipientLabel, setRecipientLabel] = useState('')
  const [permanent, setPermanent] = useState(false)
  const [result, setResult] = useState<GeneratedResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()
  const panelRef = useRef<HTMLDivElement>(null)

  // Fermer si clic en dehors
  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  function toggle() {
    setOpen((v) => !v)
  }

  function generate() {
    setError(null)
    startTransition(async () => {
      const res = await generateInterventionTokenAction({
        interventionId,
        recipientLabel: recipientLabel.trim() || undefined,
        permanent,
      })
      if (res.ok) {
        setResult({ url: res.url, whatsappText: res.whatsappText, permanent: res.permanent })
      } else {
        setError(res.error)
      }
    })
  }

  async function copyUrl() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  function reset() {
    setResult(null)
    setError(null)
    setRecipientLabel('')
    setPermanent(false)
    setCopied(false)
  }

  const waUrl = result
    ? `https://wa.me/?text=${encodeURIComponent(result.whatsappText)}`
    : null

  const smsBody = result
    ? encodeURIComponent(result.whatsappText)
    : null

  return (
    <div ref={panelRef} className="relative">
      {/* Bouton déclencheur */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-muted/40 transition-colors active:scale-[0.98]"
      >
        <Share2 className="h-4 w-4 shrink-0" />
        Partager à un externe
      </button>

      {/* Panneau inline */}
      {open && (
        <div className="mt-2 rounded-xl border border-border bg-card shadow-sm p-4 space-y-4">
          {/* En-tête du panneau */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Lien sécurisé — pas de compte nécessaire
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Fermer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {!result ? (
            /* Phase 1 : configuration */
            <div className="space-y-3">
              {/* Champ destinataire */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block" htmlFor="share-recipient">
                  Pour qui ? <span className="opacity-50">(optionnel)</span>
                </label>
                <input
                  id="share-recipient"
                  type="text"
                  value={recipientLabel}
                  onChange={(e) => setRecipientLabel(e.target.value)}
                  placeholder="Ex : Michel, Sous-traitant plomberie…"
                  maxLength={80}
                  className="w-full h-10 rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Option permanent */}
              <label className="inline-flex items-center gap-2 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={permanent}
                  onChange={(e) => setPermanent(e.target.checked)}
                  className="h-4 w-4 rounded border-muted-foreground accent-foreground"
                />
                <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors inline-flex items-center gap-1">
                  <Infinity className="h-3.5 w-3.5" />
                  Lien permanent <span className="text-xs opacity-60">(sans expiration)</span>
                </span>
              </label>

              {!permanent && (
                <p className="text-[11px] text-muted-foreground/70">
                  Par défaut : valable 48h, révocable depuis la fiche intervention.
                </p>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}

              {/* Bouton générer */}
              <button
                type="button"
                onClick={generate}
                disabled={isPending}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-foreground text-background py-2.5 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                {isPending ? 'Génération…' : 'Générer le lien'}
              </button>
            </div>
          ) : (
            /* Phase 2 : partage */
            <div className="space-y-3">
              {/* Explication durée */}
              <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Infinity className="h-3 w-3 shrink-0" style={{ opacity: result.permanent ? 1 : 0 }} />
                {result.permanent
                  ? 'Lien permanent — révocable depuis la fiche intervention.'
                  : 'Valable 48h — révocable depuis la fiche intervention.'}
              </p>

              {/* 3 boutons de partage — larges, touch-friendly */}
              <div className="space-y-2">
                {waUrl && (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100 transition-colors active:scale-[0.98]"
                  >
                    <MessageCircle className="h-5 w-5 shrink-0" />
                    WhatsApp
                  </a>
                )}

                {smsBody && (
                  <a
                    href={`sms:?body=${smsBody}`}
                    className="flex items-center gap-3 w-full rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800 hover:bg-sky-100 transition-colors active:scale-[0.98]"
                  >
                    <MessageSquare className="h-5 w-5 shrink-0" />
                    SMS
                  </a>
                )}

                <button
                  type="button"
                  onClick={copyUrl}
                  className="flex items-center gap-3 w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors active:scale-[0.98]"
                >
                  {copied ? (
                    <Check className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <Copy className="h-5 w-5 shrink-0" />
                  )}
                  {copied ? 'Lien copié !' : 'Copier le lien'}
                </button>
              </div>

              {/* Lien brut (discret) */}
              <details className="group">
                <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 list-none">
                  <span className="group-open:hidden">▶</span>
                  <span className="hidden group-open:inline">▼</span>
                  Voir le lien
                </summary>
                <p className="mt-1.5 rounded-lg border bg-muted/20 px-3 py-2 text-[10px] font-mono break-all text-foreground/70">
                  {result.url}
                </p>
              </details>

              {/* Générer un autre lien */}
              <button
                type="button"
                onClick={reset}
                className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Générer un autre lien
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
