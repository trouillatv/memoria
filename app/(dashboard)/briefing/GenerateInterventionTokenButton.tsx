'use client'

import { useState, useTransition } from 'react'
import { Link2, MessageCircle, Copy, Check, Loader2, ChevronDown, Infinity } from 'lucide-react'
import { generateInterventionTokenAction } from './intervention-token-actions'

interface ShareChecklistItem {
  id: string
  label: string
  delegated: boolean
}

interface Props {
  interventionId: string
  missionName: string
  siteName: string
  checklistItems?: ShareChecklistItem[]
}

export function GenerateInterventionTokenButton({
  interventionId,
  missionName,
  siteName,
  checklistItems = [],
}: Props) {
  const assignable = checklistItems.filter((c) => !c.delegated)
  const [recipientLabel, setRecipientLabel] = useState('')
  const [permanent, setPermanent] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(assignable.map((c) => c.id)))
  const [result, setResult] = useState<{ url: string; whatsappText: string; permanent: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  function toggleItem(id: string) {
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
      const res = await generateInterventionTokenAction({
        interventionId,
        recipientLabel: recipientLabel.trim() || undefined,
        permanent,
        checklistItemIds:
          assignable.length > 0 && selected.size > 0 && selected.size < assignable.length
            ? Array.from(selected)
            : assignable.length > 0 && selected.size > 0 && checklistItems.some((c) => c.delegated)
              ? Array.from(selected)
              : undefined,
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

  if (result) {
    const waUrl = `https://wa.me/?text=${encodeURIComponent(result.whatsappText)}`
    return (
      <div className="mt-2 space-y-2 rounded-lg border bg-muted/20 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 transition-colors"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Envoyer WhatsApp
          </a>
          <button
            type="button"
            onClick={copyUrl}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copié' : 'Copier le lien'}
          </button>
        </div>
        <details className="group">
          <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 list-none">
            <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
            Voir le lien
          </summary>
          <p className="mt-1 rounded border bg-background px-2 py-1.5 text-[10px] font-mono break-all text-foreground/70">
            {result.url}
          </p>
        </details>
        {result.permanent ? (
          <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            <Infinity className="h-3 w-3" />
            Permanent · révocable depuis la fiche intervention.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">Valable 48h · révocable depuis la fiche intervention.</p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-1 space-y-1.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {checklistItems.length > 0 && (
        <div className="space-y-1 rounded-md border bg-background p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tâches confiées</p>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {checklistItems.map((c) => (
              <label key={c.id} className={`flex items-start gap-2 text-xs ${c.delegated ? 'opacity-50' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  disabled={c.delegated}
                  onChange={() => toggleItem(c.id)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-muted-foreground accent-foreground shrink-0"
                />
                <span className="leading-snug">
                  {c.label}
                  {c.delegated && <span className="text-muted-foreground"> · déjà confiée</span>}
                </span>
              </label>
            ))}
          </div>
          {assignable.length > 0 && (
            <p className="text-[10px] text-muted-foreground/70">
              {selected.size === assignable.length && !checklistItems.some((c) => c.delegated)
                ? 'Intervention entière'
                : `${selected.size} tâche${selected.size > 1 ? 's' : ''} confiée${selected.size > 1 ? 's' : ''}`}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={recipientLabel}
          onChange={(e) => setRecipientLabel(e.target.value)}
          placeholder="Pour qui ? (optionnel)"
          maxLength={80}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring w-44"
        />
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-muted-foreground accent-foreground"
          />
          <span className="text-xs text-muted-foreground inline-flex items-center gap-0.5">
            <Infinity className="h-3 w-3" />
            Permanent
          </span>
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={isPending || (assignable.length > 0 && selected.size === 0)}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Link2 className="h-3 w-3" />
          )}
          Générer le lien
        </button>
      </div>
    </div>
  )
}
